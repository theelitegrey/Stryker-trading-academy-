#!/usr/bin/env python3
"""Import the Models v2 content into the bundled seed (assets/models-data.js).

Re-runnable and idempotent: reads the content team's JSON files and
writes/refreshes ONLY the entries it manages. The existing six models (and
their storyboards) are copied through byte-for-byte; the script checks that.

    python3 tools/models/import-models-v2.py            # import / refresh
    python3 tools/models/import-models-v2.py --check    # validate only, write nothing

Source (override with --src DIR):
    /root/projects/stryker-notes/content/models-v2/<id>.json          model objects
    /root/projects/stryker-notes/content/models-v2/storyboards/<id>.json   optional
        content-designer storyboard format, mapped to the setup-player schema
        by map_storyboard() below (see the header of assets/setup-player.js).

Validation (any failure = nothing is written, exit 1):
  - required fields present and typed; id slug-safe and unique across the seed
  - no <script>, <iframe>, on*= handlers or javascript: URLs in bodyHtml / step descHtml
  - steps: non-empty list of {title, desc, descHtml?}
  - a "stats" block is REFUSED unless stats.approved === true (Owner sign-off)
  - a mapped storyboard must pass SetupPlayer.validate() (run through node), and
    nothing the mapper produced may be silently dropped by it
Nothing here writes Firestore. See reports/models-v2-HANDBACK.md "Firestore plan".
"""
import argparse, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED = os.path.join(ROOT, 'assets', 'models-data.js')
DEFAULT_SRC = '/root/projects/stryker-notes/content/models-v2'
MANAGED = ['silver-bullet-model', 'turtle-soup-model', 'ib-80-rule-model',
           'vwap-reversion-model', 'unicorn-model']
FIELD_ORDER = ['id', 'name', 'category', 'group', 'summary', 'video', 'minRole',
               'bodyHtml', 'paragraphs', 'steps', 'storyboard', 'stats']
SLUG = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
UNSAFE = re.compile(r'<\s*(script|iframe|object|embed)\b|\son[a-z]+\s*=|javascript\s*:', re.I)

# Storyboards that pass the player validator but whose chart contradicts the
# model's own rules (found on review). Held back with the reason until re-delivered.
HOLD = {
    'silver-bullet-model': [
        'frames 1, 2 and 7: PRL is drawn and captioned at 20,000, but the lowest low of the 09:30-09:55 candles (0-5) is 20,004 '
        '(candle 0, 09:30). "Mark the high and low of the 09:30-09:59 candles" gives 20,004, so the line sits under every range candle. '
        'Fix: candle 0 low 20004 -> 20000',
    ],
    'ib-80-rule-model': [
        'frame 3 ("SHIFT: two bars close back inside value"): the 10:00 and 10:30 bars close at 20,022 and 20,006, '
        'both ABOVE the prior VAH (20,000), so neither closes inside value; the chart shows a setup the rules say is no trade',
        'frame 6 ("STOP"): entry 20,006 to stop 20,041 is 35 points, over the 25-point max stated in the same caption and in '
        'the model steps ("skip if over 25 points")',
    ],
    'unicorn-model': [
        'frame 2: SL1 (10:00 low 20,055) is first swept by candle 3 (10:15, low 20,040), not bar 6 (10:30) as captioned',
        'frame 3: bar 7 (10:35) closes 20,048, 42 points BELOW SH (20,090); the first close above SH is candle 10 (10:50, 20,092)',
        'frames 4-8: breaker zone, FVG, entry, stop and target are described but the file has no annotations, so the chart shows none of them',
    ],
    'vwap-reversion-model': [
        'no VWAP line or bands in the file, so the chart never shows the level every caption refers to. From the candles '
        '(typical price since 10:00): candle 0 closes 20,058 under VWAP ~20,064 (frame 1 says above); candle 7 closes 20,032 '
        'under VWAP ~20,044 (frame 4 says it reclaims); candle 8 low 20,030 under VWAP ~20,044 (frame 5 says it holds)',
        'frame 6: stop = lower low of bars 7 and 8 (20,018) - 2 = 20,016; entry 20,048 -> 32 points, over the 20-point max',
    ],
}

# Models-list filter chips (CoS decision 26 Sep): chip group per model id.
GROUP_BY_ID = {
    'silver-bullet-model': 'Opening & Session', 'ib-80-rule-model': 'Opening & Session',
    'turtle-soup-model': 'Liquidity & Reversal',
    'unicorn-model': 'Imbalance / FVG',
    'vwap-reversion-model': 'Mean Reversion',
}

errors = []
def err(msg): errors.append(msg)


# ---- seed file parsing -------------------------------------------------------
def split_seed(src):
    """Return (prefix, [entry_text...], suffix) for the MODELS_SEED array,
    using a string-aware brace scanner so entries are kept verbatim."""
    start = src.index('const MODELS_SEED = [') + len('const MODELS_SEED = [')
    i, n, entries = start, len(src), []
    depth, in_str, esc, obj_start = 0, False, False, None
    while i < n:
        ch = src[i]
        if in_str:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == '"': in_str = False
        elif ch == '"': in_str = True
        elif ch == '{':
            if depth == 0: obj_start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: entries.append((obj_start, i + 1))
        elif ch == ']' and depth == 0:
            break
        i += 1
    end = i
    return src[:start], [src[a:b] for a, b in entries], src[end:]


def dump_entry(obj):
    ordered = {k: obj[k] for k in FIELD_ORDER if k in obj}
    ordered.update({k: v for k, v in obj.items() if k not in ordered})
    txt = json.dumps(ordered, indent=2, ensure_ascii=True)
    # one candle per line keeps the seed readable
    txt = re.sub(r'\{\s*"o": ([^,]+),\s*"h": ([^,]+),\s*"l": ([^,]+),\s*"c": ([^\s]+)\s*\}',
                 r'{"o": \1, "h": \2, "l": \3, "c": \4}', txt)
    return '\n'.join(('  ' + l if i else l) for i, l in enumerate(txt.split('\n')))


# ---- model validation --------------------------------------------------------
def check_html(where, html):
    if not isinstance(html, str): err(f'{where}: not a string'); return
    m = UNSAFE.search(html)
    if m: err(f'{where}: unsafe markup {m.group(0)!r}')


def validate_model(m, src_name):
    w = src_name
    for k, t in (('id', str), ('name', str), ('category', str), ('summary', str),
                 ('bodyHtml', str), ('steps', list)):
        if not isinstance(m.get(k), t) or (t is str and not m.get(k).strip()):
            err(f'{w}: missing or empty "{k}"')
    if isinstance(m.get('id'), str) and not SLUG.match(m['id']):
        err(f'{w}: id {m["id"]!r} is not slug-safe')
    if 'video' in m and not isinstance(m['video'], str): err(f'{w}: "video" must be a string')
    if 'paragraphs' in m and not (isinstance(m['paragraphs'], list) and all(isinstance(p, str) for p in m['paragraphs'])):
        err(f'{w}: "paragraphs" must be a list of strings')
    check_html(f'{w}.bodyHtml', m.get('bodyHtml', ''))
    steps = m.get('steps') or []
    if not steps: err(f'{w}: no steps')
    for i, s in enumerate(steps):
        if not isinstance(s, dict) or not isinstance(s.get('title'), str) or not s['title'].strip() \
                or not isinstance(s.get('desc'), str):
            err(f'{w}.steps[{i}]: needs a title and a desc string'); continue
        extra = set(s) - {'title', 'desc', 'descHtml'}
        if extra: err(f'{w}.steps[{i}]: unexpected keys {sorted(extra)}')
        if 'descHtml' in s: check_html(f'{w}.steps[{i}].descHtml', s['descHtml'])
    if 'stats' in m and not (isinstance(m['stats'], dict) and m['stats'].get('approved') is True):
        err(f'{w}: has a "stats" block without stats.approved === true; refused (Owner sign-off required)')
    known = set(FIELD_ORDER)
    extra = set(m) - known
    if extra: err(f'{w}: unknown top-level keys {sorted(extra)}')


# ---- content-designer storyboard -> setup-player schema ---------------------
TONE_BY_COLOR = {'#e5484d': 'bear', '#03c988': 'bull', '#d97706': 'liq', '#f5c542': 'liq', '#5c6472': 'liq'}
PRICE_IN_LABEL = re.compile(r'\s*[-–—]?\s*\d{1,3}(?:,\d{3})+(?:\.\d+)?|\s+\d{4,}(?:\.\d+)?')

def short_label(text):
    """Chart labels carry no price figures (the player never prints prices; at
    390px they also collide). '"ENTRY 20,036" -> "Entry"', 'TARGET 20,000 - reached'
    -> 'Target - reached'. Captions are the content team's words and are kept."""
    t = PRICE_IN_LABEL.sub('', text or '').strip()
    t = re.sub(r'\s{2,}', ' ', t)
    t = re.sub(r'^\s*-\s*', '', t)
    t = re.sub(r'[\s=:\-–—]+$', '', t)     # "TARGET 2R = 19,992.5" -> "Target 2R"
    t = re.sub(r'\s*-\s*-\s*', ' - ', t)
    # ENTRY/STOP/TARGET/SWEEP read as shouting on a chart; acronyms (PRH, FVG) stay.
    t = re.sub(r'\b(ENTRY|STOP|TARGET|SWEEP)\b', lambda mm: mm.group(1).capitalize(), t)
    return t.replace(' - ', ' · ')


def map_storyboard(cd, gaps):
    candles = cd.get('candles') or []
    frames_in = cd.get('frames') or []
    out_c = [{'o': c['o'], 'h': c['h'], 'l': c['l'], 'c': c['c']} for c in candles]
    last = len(out_c) - 1
    frames, live = [], {}         # live: key -> annotation id currently on the chart
    seq = [0]

    def nid(kind):
        seq[0] += 1
        return f'{kind}{seq[0]}'

    for fi, fr in enumerate(frames_in):
        sc = fr.get('showCandles') or [0, last]
        reveal = int(sc[1]) + 1
        wanted = {}               # key -> annotation (without id)
        hl = fr.get('highlight') or []
        focus_keys = []
        for a in fr.get('annotations') or []:
            t = a.get('type'); tone = TONE_BY_COLOR.get((a.get('color') or '').lower(), 'neutral')
            text = a.get('text', '')
            if t == 'line':
                up = text.upper()
                kind = 'entry' if up.startswith('ENTRY') else 'stop' if up.startswith('STOP') else \
                       'target' if up.startswith('TARGET') else 'level'
                ann = {'type': kind, 'price': a['price'], 'label': short_label(text)}
                if kind == 'level': ann['tone'] = 'liq'
                if kind in ('entry', 'stop', 'target'):
                    ann['from'] = max(0, reveal - 3) if not hl else min(hl)
                key = ('line', kind, a['price'])
            elif t == 'zone':
                cs = a.get('candles') or [0, last]
                ann = {'type': 'fvg', 'top': max(a['from'], a['to']), 'bottom': min(a['from'], a['to']),
                       'from': cs[0], 'to': last, 'label': short_label(text),
                       'tone': 'bear' if tone == 'bear' else 'bull'}
                key = ('zone', ann['top'], ann['bottom'])
            elif t == 'label':
                at = min(max(0, reveal - 2), last)
                ann = {'type': 'note', 'at': at, 'price': a['price'], 'label': short_label(text)}
                key = ('note', text)
            elif t == 'arrow':
                if not hl:
                    gaps.append(f'frame {fi+1}: arrow has prices but no candle position (no highlight to anchor it); dropped')
                    continue
                at = hl[0]
                if 'sweep' in text.lower():
                    ann = {'type': 'sweep', 'at': at, 'side': 'high' if a['to'] > a['from'] else 'low',
                           'label': short_label(text).capitalize()}
                    key = ('sweep', at)
                else:
                    ann = {'type': 'arrow', 'from': {'at': max(0, at - 1), 'price': a['from']},
                           'to': {'at': at, 'price': a['to']}, 'label': short_label(text)}
                    key = ('arrow', at, a['from'], a['to'])
            else:
                gaps.append(f'frame {fi+1}: annotation type {t!r} has no mapping; dropped')
                continue
            wanted[key] = ann
        if hl:
            wanted[('hl', min(hl), max(hl))] = {'type': 'highlight', 'from': min(hl), 'to': max(hl)}
        add, remove = [], []
        for key in list(live):
            if key not in wanted:
                remove.append(live.pop(key))
        for key, ann in wanted.items():
            if key in live:
                focus_keys.append(live[key]); continue
            ann = dict(ann); ann['id'] = nid(ann['type'])
            live[key] = ann['id']; add.append(ann); focus_keys.append(ann['id'])
        f = {'title': fr.get('title', ''), 'caption': fr.get('caption', ''), 'reveal': reveal, 'add': add}
        if remove: f['remove'] = remove
        frames.append(f)
    used = max([f['reveal'] for f in frames] or [len(out_c)])
    out_c = out_c[:used]            # a second series after the used range is not drawn
    return {'version': 1, 'title': cd.get('title', ''), 'timeframe': cd.get('timeframe', ''),
            'illustrative': True, 'source': 'content-designer', 'candles': out_c, 'frames': frames}


def geometry_gaps(cd, gaps, bad_frames):
    """Checks the player cannot make: does the chart show what the caption says?"""
    c = cd.get('candles') or []
    times = [x.get('t') for x in c]
    def mins(t):
        h, m = t.split(':'); return int(h) * 60 + int(m)
    try:
        steps = sorted({mins(times[i + 1]) - mins(times[i]) for i in range(len(times) - 1)})
        if len(steps) > 1:
            gaps.append(f'candle times are unevenly spaced (gaps of {steps} minutes). '
                        'The player draws candles evenly and shows no times, so this is cosmetic, but the captions quote times')
    except Exception:
        pass
    prev = None
    for fi, fr in enumerate(cd.get('frames') or []):
        if fi in bad_frames: continue  # separate series, already reported and not shipped
        sc = fr.get('showCandles') or [0, len(c) - 1]
        if prev is not None and sc[1] < prev[1]:
            gaps.append(f'frame {fi+1} ("{fr.get("title")}"): shows fewer candles ({sc[1]+1}) than frame {fi} ({prev[1]+1}); '
                        f'candles disappear on play, and frame {fi} already shows the move that frame {fi+1} calls the outcome')
        prev = sc
    for fi, fr in enumerate(cd.get('frames') or []):
        if fi in bad_frames: continue
        txt = (fr.get('caption', '') + ' ' + fr.get('title', '')).lower()
        lines = {a.get('text', '').split()[0].upper(): a.get('price') for a in fr.get('annotations', []) if a.get('type') == 'line' and a.get('text')}
        if 'stop' in txt and 'hit' in txt and 'ENTRY' in lines and 'STOP' in lines:
            entry, stop = lines['ENTRY'], lines['STOP']
            tgt = 20000 if 'target' in txt else None
            sc = fr.get('showCandles') or [0, len(c) - 1]
            # the order can only fill after the gap it sits in has formed
            formed = max([z['candles'][1] for f2 in cd['frames'] for z in f2.get('annotations', [])
                          if z.get('type') == 'zone' and z.get('candles')] or [0])
            fill = next((i for i in range(formed, sc[1] + 1) if c[i]['l'] <= entry <= c[i]['h']), None)
            if fill is not None and tgt is not None:
                hit_t = next((i for i in range(fill, sc[1] + 1) if c[i]['l'] <= tgt), None)
                hit_s = next((i for i in range(fill, sc[1] + 1) if c[i]['h'] >= stop), None)
                if hit_t is not None and (hit_s is None or hit_t < hit_s):
                    gaps.append(f'frame {fi+1} ("{fr.get("title")}"): says the stop is hit before the target, but on the '
                                f'drawn candles the entry fills at candle {fill} ({c[fill]["t"]}) and candle {hit_t} '
                                f'({c[hit_t]["t"]}, low {c[hit_t]["l"]}) reaches the {tgt} target first'
                                + (f'; the stop is only crossed at candle {hit_s} ({c[hit_s]["t"]})' if hit_s is not None else '')
                                + '. It reuses the winning path\'s candles, so it needs its own candle series. '
                                  'FRAME DROPPED on import until re-delivered')
                    bad_frames.add(fi)


def node_validate(sb):
    js = r'''
const fs=require('fs');global.window={matchMedia:()=>({matches:false})};
eval(fs.readFileSync(process.argv[1],'utf8'));
const sb=JSON.parse(fs.readFileSync(0,'utf8'));const v=window.SetupPlayer.validate(sb);
if(!v){console.log(JSON.stringify({ok:false}));process.exit(0);}
const inAdd=sb.frames.reduce((n,f)=>n+(f.add||[]).length,0), outAdd=v.frames.reduce((n,f)=>n+f.add.length,0);
console.log(JSON.stringify({ok:true,frames:v.frames.length,candles:v.candles.length,inAdd,outAdd}));'''
    r = subprocess.run(['node', '-e', js, os.path.join(ROOT, 'assets', 'setup-player.js')],
                       input=json.dumps(sb), capture_output=True, text=True)
    if r.returncode: return {'ok': False, 'error': r.stderr[-400:]}
    return json.loads(r.stdout.strip().splitlines()[-1])


# ---- main --------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--gaps-out', help='write storyboard gap notes (markdown) here')
    args = ap.parse_args()

    src = open(SEED, encoding='utf-8').read()
    prefix, entries, suffix = split_seed(src)
    parsed = [json.loads(e) for e in entries]
    existing_ids = [p['id'] for p in parsed]
    unmanaged = [(t, p) for t, p in zip(entries, parsed) if p['id'] not in MANAGED]

    incoming, gaps_all = {}, {}
    for mid in MANAGED:
        path = os.path.join(args.src, mid + '.json')
        if not os.path.exists(path): err(f'{mid}: source file missing ({path})'); continue
        try: m = json.load(open(path, encoding='utf-8'))
        except Exception as e: err(f'{mid}: not valid JSON ({e})'); continue
        if m.get('id') != mid: err(f'{path}: id {m.get("id")!r} does not match the file name')
        validate_model(m, os.path.basename(path))
        m.setdefault('video', ''); m.setdefault('paragraphs', [])
        m['group'] = GROUP_BY_ID[mid]
        if not m['paragraphs'] and isinstance(m.get('bodyHtml'), str):
            # same plain-text fallback the editor generates (htmlToParagraphs)
            m['paragraphs'] = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', p)).strip()
                               for p in re.findall(r'<p[^>]*>(.*?)</p>', m['bodyHtml'], re.S)]
            m['paragraphs'] = [p for p in m['paragraphs'] if p]
        sbp = os.path.join(args.src, 'storyboards', mid + '.json')
        if os.path.exists(sbp):
            cd = json.load(open(sbp, encoding='utf-8'))
            gaps, bad = [], set()
            for i, c in enumerate(cd.get('candles') or []):
                if not all(isinstance(c.get(k), (int, float)) for k in 'ohlc') or \
                        c['h'] < max(c['o'], c['c']) or c['l'] > min(c['o'], c['c']):
                    gaps.append(f'candle {i} ({c.get("t")}) is impossible: o={c.get("o")} h={c.get("h")} '
                                f'l={c.get("l")} c={c.get("c")} (high must be >= open/close, low <= open/close)')
            for i, f in enumerate(cd.get('frames') or []):
                sc = f.get('showCandles') or [0]
                if sc[0] != 0:
                    gaps.append(f'frame {i+1} ("{f.get("title")}"): showCandles {sc} is a separate candle series. The player '
                                'draws one series from candle 0, so this frame is NOT shipped. Deliver the alternate path as '
                                f'its own file ({mid}-fail.json) and it can play as a second walkthrough')
                    bad.add(i)
            geometry_gaps(cd, gaps, bad)
            # A frame whose chart contradicts its caption is not shipped.
            cd = dict(cd, frames=[f for i, f in enumerate(cd.get('frames') or []) if i not in bad])
            sb = map_storyboard(cd, gaps)
            v = node_validate(sb)
            gaps_all[mid] = gaps
            # A storyboard that can't play is left out; the model text still imports
            # and the page simply shows no player until the storyboard is fixed.
            if mid in HOLD:
                gaps.extend(HOLD[mid])
                gaps.append('STORYBOARD NOT SHIPPED: the chart contradicts the model rules (see the notes above)')
                print(f'{mid}: storyboard HELD (review), model imported without it')
            elif not v.get('ok'):
                gaps.append('STORYBOARD NOT SHIPPED: fails the player validator (see the notes above)')
                print(f'{mid}: storyboard REJECTED, model imported without it')
            elif v['inAdd'] != v['outAdd']:
                gaps.append(f'STORYBOARD NOT SHIPPED: the validator dropped {v["inAdd"] - v["outAdd"]} annotation(s)')
                print(f'{mid}: storyboard REJECTED (dropped annotations)')
            else:
                m['storyboard'] = sb
                print(f'{mid}: storyboard mapped: {v}')
        incoming[mid] = m

    all_ids = [p['id'] for _, p in unmanaged] + list(incoming)
    dup = {i for i in all_ids if all_ids.count(i) > 1}
    if dup: err(f'duplicate ids: {sorted(dup)}')
    for _, p in unmanaged:
        if isinstance(p.get('stats'), dict) or 'stats' in p:
            if not (isinstance(p.get('stats'), dict) and p['stats'].get('approved') is True):
                err(f'{p["id"]}: existing model has an unapproved stats block')

    if gaps_all:
        for mid, g in gaps_all.items():
            print(f'{mid}: {len(g)} storyboard note(s)')
            for x in g: print('   -', x)
        if args.gaps_out:
            with open(args.gaps_out, 'w') as fh:
                for mid, g in gaps_all.items():
                    fh.write(f'### {mid}\n' + ''.join(f'- {x}\n' for x in g) + '\n')

    if errors:
        print('IMPORT REFUSED, nothing written:'); [print('  -', e) for e in errors]
        sys.exit(1)
    if args.check:
        print('check OK:', len(incoming), 'models valid'); return

    # Keep existing order for entries already in the seed; append new ones.
    new_entries = []
    for t, p in zip(entries, parsed):
        new_entries.append(dump_entry(incoming[p['id']]) if p['id'] in incoming else t)
    for mid in MANAGED:
        if mid in incoming and mid not in existing_ids:
            new_entries.append(dump_entry(incoming[mid]))
    out = prefix + '\n  ' + ',\n  '.join(new_entries) + '\n' + suffix
    # Guard: the unmanaged entries must be byte-identical after the rewrite.
    _, after, _ = split_seed(out)
    after_unmanaged = [t for t in after if json.loads(t)['id'] not in MANAGED]
    if after_unmanaged != [t for t, _ in unmanaged]:
        print('ABORT: an existing model would change; nothing written'); sys.exit(1)
    if out != src:
        open(SEED, 'w', encoding='utf-8').write(out)
        # Second opinion: w1's whole-seed validator (tools/storyboards/validate.mjs)
        # checks reveal windows, id references and price ranges on every storyboard.
        v = os.path.join(ROOT, 'tools', 'storyboards', 'validate.mjs')
        if os.path.exists(v):
            r = subprocess.run(['node', v], capture_output=True, text=True, cwd=ROOT)
            if r.returncode:
                open(SEED, 'w', encoding='utf-8').write(src)
                print(r.stdout[-2000:], r.stderr[-500:])
                print('ABORT: validate.mjs failed on the new seed; the old seed was restored'); sys.exit(1)
    print(f'seed: {len(after)} models ({len(after_unmanaged)} untouched, {len(incoming)} imported)',
          '(no change)' if out == src else '(written)')


if __name__ == '__main__':
    main()
