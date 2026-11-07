#!/usr/bin/env python3
"""TradeZoro Discord levels bot (LEVELS-EXPORT, 07 Nov 2026). Education only. Not financial advice.

  post.py morning   today's free levels for SPX, once, before the US open (skips if the data is not from today)
  post.py prints    new dark pool prints of $25M or more (free data on the site), at most 5 per run, never twice
  Add --dry to print the message instead of posting (needs no token).

FREE SET ONLY: levels come from the public teaser answer of the Worker (/zo/summary?u=SPX with no sign-in), which already cuts the data down
to what free members see. Pro-only pieces (Zoro Levels nodes, other symbols, futures mapping) are never read. Each post links to the site.
Dark pool prints are free on the site for everyone, so they are fine to post.

Env:
  DISCORD_LEVELS_CHANNEL_ID   channel id to post in (required unless --dry)
  DISCORD_ENV_FILE            path of the env file that holds DISCORD_BOT_TOKEN=... (read here, never printed or logged)
  TZ_LEVELS_STATE             state dir (default ~/.local/state/tradezoro-discord-levels)
  TZ_RECORDER_URL             Worker base URL (default https://book-recorder.theelitegrey.workers.dev)
"""
import gzip, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
API = 'https://discord.com/api/v10'
BASE = os.environ.get('TZ_RECORDER_URL', 'https://book-recorder.theelitegrey.workers.dev').rstrip('/')
SITE = 'https://tradezoro.com'
MIN_USD = 25e6
MAX_POSTS = 5
MAX_AGE_S = 3 * 3600          # a print older than this is not posted (no floods after a long gap)
OFF_PRICE = set('BW47VPZU')   # conditions: price is not the market price of that moment (same list as the chart indicator)
DP_SYMS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD', 'JPM', 'V', 'WMT', 'XOM', 'LLY',
           'BAC', 'DIS', 'COST', 'INTC', 'PLTR', 'BA', 'COIN', 'MSTR', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TQQQ']
NOTICE = 'Education only. Not financial advice.'
UA = 'TradeZoroDiscordLevels/1.0 (tradezoro.com)'


def get(url, binary=False):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=20) as r:
        b = r.read()
        return b if binary else json.loads(b)


def num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float('inf')


def fmt(x):
    return ('%.2f' % x).rstrip('0').rstrip('.')


def ago(sec):
    m = max(0, int(sec // 60))
    return 'just now' if m < 1 else '%d min ago' % m if m < 60 else '%d h ago' % (m // 60)


# ------------------------------------------------------------------ morning levels (free set)
def morning_message(s, now_s):
    """s = the teaser summary for SPX. Returns text, or None when it is not today's data."""
    if not isinstance(s, dict):
        return None
    built = s.get('built') if num(s.get('built')) else s.get('t')
    today = datetime.fromtimestamp(now_s, ET).strftime('%Y-%m-%d')
    day = s.get('day') or (datetime.fromtimestamp(built, ET).strftime('%Y-%m-%d') if num(built) else None)
    if not num(built) or day != today or now_s - built > 20 * 3600:
        return None
    lv = s.get('levels') or {}
    ce, fl, pf = lv.get('call_ceiling', lv.get('ceiling')), lv.get('flip_line', lv.get('flip')), lv.get('put_floor', lv.get('floor'))
    rg = s.get('ranges') or {}
    r0, rw = rg.get('0') or rg.get('0dte'), rg.get('w') or rg.get('weekly')
    lines = []
    if num(ce): lines.append('Call Ceiling  %s' % fmt(ce))
    if num(fl): lines.append('Flip Line     %s' % fmt(fl))
    if num(pf): lines.append('Put Floor     %s' % fmt(pf))
    if isinstance(r0, list) and len(r0) == 2 and num(r0[0]) and num(r0[1]): lines.append('Zoro Range 0DTE  %s to %s' % (fmt(r0[0]), fmt(r0[1])))
    if isinstance(rw, list) and len(rw) == 2 and num(rw[0]) and num(rw[1]): lines.append('Zoro Range weekly  %s to %s' % (fmt(rw[0]), fmt(rw[1])))
    if not lines:
        return None
    return ('**SPX levels for today** (%s)\n```\n%s\n```\n'
            'Updated %s. The full set (every level, more symbols, dark pool levels, files for your platform) is on %s/gex\n%s'
            % (day, '\n'.join(lines), ago(now_s - built), SITE, NOTICE))


# ------------------------------------------------------------------ big dark pool prints
def big_prints(part, now_s):
    """part = a dp_<ticker> scan part. -> [(t_ms, price, shares, usd)] newest session, market-price prints >= $25M, not older than MAX_AGE_S."""
    out = []
    if not isinstance(part, dict) or part.get('cols') != ['t', 'p', 's', 'c']:
        return out
    for r in part.get('rows') or []:
        try:
            t, p, sh, c = r
            if not (num(t) and num(p) and num(sh)) or p <= 0 or sh <= 0:
                continue
        except (TypeError, ValueError):
            continue
        usd = p * sh
        if usd >= MIN_USD and not (set(str(c)) & OFF_PRICE) and now_s - t / 1000 <= MAX_AGE_S and t / 1000 <= now_s + 60:
            out.append((t, p, sh, usd))
    return out


def usd_text(v):
    return '$%.1fB' % (v / 1e9) if v >= 1e9 else '$%dM' % round(v / 1e6)


def print_message(sym, t, p, sh, usd, now_s):
    et = datetime.fromtimestamp(t / 1000, ET).strftime('%H:%M')
    return ('**%s dark pool print: %s** at %s\n%s shares, reported %s ET (%s). A dark pool print is a large trade done off the exchanges; '
            'the price is where it traded, not a signal.\nAll prints: %s/charts\n%s'
            % (sym, usd_text(usd), fmt(p), format(int(sh), ','), et, ago(now_s - t / 1000), SITE, NOTICE))


# ------------------------------------------------------------------ state, token, Discord
def state_path():
    d = os.environ.get('TZ_LEVELS_STATE') or os.path.join(os.path.expanduser('~'), '.local', 'state', 'tradezoro-discord-levels')
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, 'state.json')


def load_state():
    try:
        with open(state_path()) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(st):
    p = state_path()
    with open(p + '.tmp', 'w') as f:
        json.dump(st, f)
    os.replace(p + '.tmp', p)


def read_token(path):
    """KEY=value lines; the value is returned and never printed."""
    with open(path) as f:
        for line in f:
            if line.startswith('DISCORD_BOT_TOKEN='):
                return line.split('=', 1)[1].strip().strip('"\'')
    return ''


def send(token, channel, text):
    body = json.dumps({'content': text[:1900], 'allowed_mentions': {'parse': []}}).encode()
    for _ in range(4):
        req = urllib.request.Request('%s/channels/%s/messages' % (API, channel), data=body, method='POST',
                                     headers={'Authorization': 'Bot ' + token, 'Content-Type': 'application/json', 'User-Agent': UA})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status in (200, 201)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                try: wait = float(json.loads(e.read() or b'{}').get('retry_after', 2))
                except ValueError: wait = 2
                time.sleep(min(wait, 30) + 0.5)
                continue
            print('discord HTTP', e.code)        # status only: the body can echo request details
            return False
        except OSError:
            print('discord unreachable')
            return False
    return False


def main(argv):
    dry = '--dry' in argv
    args = [a for a in argv[1:] if not a.startswith('--')]
    if not args or args[0] not in ('morning', 'prints'):
        print(__doc__); return 2
    mode, now_s = args[0], time.time()
    token = channel = ''
    if not dry:
        channel = os.environ.get('DISCORD_LEVELS_CHANNEL_ID', '').strip()
        envf = os.environ.get('DISCORD_ENV_FILE', '').strip()
        if not channel.isdigit() or not envf:
            print('set DISCORD_LEVELS_CHANNEL_ID (a number) and DISCORD_ENV_FILE'); return 2
        try: token = read_token(envf)
        except OSError: print('cannot read the env file'); return 2
        if not token:
            print('no DISCORD_BOT_TOKEN in the env file'); return 2
    st = load_state()
    texts = []
    if mode == 'morning':
        today = datetime.fromtimestamp(now_s, ET).strftime('%Y-%m-%d')
        if datetime.fromtimestamp(now_s, ET).weekday() >= 5:
            print('weekend: nothing to post'); return 0
        if st.get('morning') == today and not dry:
            print('already posted today'); return 0
        try: s = get(BASE + '/zo/summary?u=SPX')
        except (OSError, ValueError): print('levels not reachable'); return 1
        m = morning_message(s, now_s)
        if not m:
            print('no levels from today yet: nothing posted'); return 0
        texts.append(m)
        done = lambda: st.update(morning=today)
    else:
        seen = {k: v for k, v in (st.get('seen') or {}).items() if now_s - v < 2 * 86400}
        found = []
        for i, sym in enumerate(DP_SYMS):
            try:
                part = json.loads(gzip.decompress(get(BASE + '/scan?part=dp_' + sym.lower(), binary=True)))
            except (OSError, ValueError, EOFError):
                continue   # a missing part is skipped, never guessed
            for t, p, sh, usd in big_prints(part, now_s):
                key = '%s|%d|%s|%d' % (sym, t, fmt(p), sh)
                if key not in seen: found.append((usd, sym, t, p, sh, key))
            time.sleep(3.2)   # the Worker allows 20 reads a minute per address
        found.sort(reverse=True)
        for usd, sym, t, p, sh, key in found[:MAX_POSTS]:
            texts.append(print_message(sym, t, p, sh, usd, now_s))
        def done():
            for f in found: seen[f[5]] = now_s   # older ones beyond the cap are marked too: no backlog later
            st['seen'] = seen
        if not texts:
            print('no new prints of $25M or more'); done(); save_state(st); return 0
    for t in texts:
        if dry: print(t); print('---')
        elif not send(token, channel, t):
            print('post failed; will retry next run'); return 1
        else: time.sleep(1.2)
    if not dry:
        done(); save_state(st)
    print('posted %d' % len(texts) if not dry else 'dry run: %d message(s)' % len(texts))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
