// Screenshots + ALIGNMENT GATE numbers for the "Connect your AI to ZoroCharts" pages: /ai, /ai/consent (verified and
// unverified app), /charts/agents, at 1440 / 390 / 412, dark and light. Needs the local stack (tools/tests/ai-agent-dev.sh).
// Firebase is replaced by a stand-in member ("devtok.<uid>", loopback only). Shots + measure.json go to $AI_SHOTS.
// Run: tools/chrome-slot.sh node tools/tests/ai-pages-shots.js
const { launch } = require('./lib.js');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const BASE = process.env.AI_BASE || 'http://127.0.0.1:8788';
const SHOTS = process.env.AI_SHOTS || path.join(process.env.TMPDIR || '/tmp', 'ai-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const UID = 'aishot' + Date.now().toString(36);
let fails = 0, n = 0;
const ok = (c, msg) => { n++; if (c) console.log('ok   ' + msg); else { fails++; console.log('FAIL ' + msg); } };

// Real Firebase loads (auth-compat replaces firebase.auth late), so the stand-in member is installed right before
// assets/ai-connect.js runs: the route prepends a wrapper that makes firebase.auth() report "devtok.<uid>" (loopback only).
const wrapSrc = (uid) => `(function(){var u={uid:${JSON.stringify(uid)},email:'member@example.com',displayName:'Test Member',emailVerified:true,providerData:[],
 getIdToken:function(){return Promise.resolve('devtok.'+u.uid);}};var f=window.firebase,real=f.auth;
 f.auth=function(){var a=real.apply(f,arguments);return new Proxy(a,{get:function(t,k){if(k==='currentUser')return u;
 if(k==='onAuthStateChanged'||k==='onIdTokenChanged')return function(cb){setTimeout(function(){cb(u);},0);return function(){};};
 var v=t[k];return typeof v==='function'?v.bind(t):v;}});};Object.assign(f.auth,real);})();\n`;

const b64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const REG = {};
async function register() {
  for (const [k, name, redir] of [['verified', 'Claude', 'https://claude.ai/api/mcp/auth_callback'], ['unverified', 'My research bot', 'http://127.0.0.1:33418/callback']]) {
    REG[k] = { redir, reg: await fetch(BASE + '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [redir], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) }).then((r) => r.json()) };
    ok(!!REG[k].reg.client_id, 'registered ' + k + ' client');
  }
}
async function consentIds() {
  const out = {};
  for (const k of ['verified', 'unverified']) {
    const { redir, reg } = REG[k];
    const ch = b64(crypto.createHash('sha256').update(b64(crypto.randomBytes(32))).digest());
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: redir, code_challenge: ch, code_challenge_method: 'S256', scope: 'mcp:read mcp:chart mcp:alerts', state: 's1', resource: BASE + '/mcp' });
    const r = await fetch(BASE + '/oauth/authorize?' + q, { redirect: 'manual' });
    const loc = r.headers.get('location') || '';
    out[k] = new URL(loc, BASE).searchParams.get('r');
    ok(!!out[k], 'authorize -> consent request id (' + k + ')');
  }
  return out;
}

// generic alignment numbers for rows on the page
async function measure(p, sel) {
  return p.evaluate((sel) => {
    const R = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), cy: +(b.y + b.height / 2).toFixed(1) }; };
    const vw = document.documentElement.clientWidth;
    const res = { vw, rows: [], cards: [], buttons: [], top: null };
    const top = document.querySelector('.aic-top');
    if (top) { const kids = [...top.children].filter((e) => e.getBoundingClientRect().width); res.top = { box: R(top), kids: kids.map(R) }; }
    document.querySelectorAll(sel.card).forEach((c) => {
      const b = R(c), cs = getComputedStyle(c);
      res.cards.push({ ...b, padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight), left: b.x, right: +(vw - b.x - b.w).toFixed(1) });
    });
    document.querySelectorAll(sel.row).forEach((r) => {
      const kids = [...r.children].filter((e) => e.getBoundingClientRect().width && getComputedStyle(e).position !== 'absolute');
      if (kids.length < 2) return;
      const m = kids.map(R); const cys = m.map((k) => k.cy);
      res.rows.push({ cls: r.className, n: kids.length, spread: +(Math.max(...cys) - Math.min(...cys)).toFixed(1), hs: m.map((k) => k.h) });
    });
    document.querySelectorAll('.aic-btn, .aic-copy-b, .aic-page button.btn').forEach((b) => { if (b.getBoundingClientRect().width) res.buttons.push({ t: b.textContent.trim().slice(0, 18), h: +b.getBoundingClientRect().height.toFixed(1) }); });
    // multi-line rows: radio/checkbox centred on the TITLE line; row button centred on the row (desktop) or left-aligned under the text (phone)
    res.choices = [...document.querySelectorAll('.aic-choice')].filter((c) => c.getBoundingClientRect().width).map((c) => {
      const i = R(c.querySelector('input')), t = R(c.querySelector('.aic-choice-t b')), b = R(c), cs = getComputedStyle(c);
      return { d: +(i.cy - t.cy).toFixed(1), padT: +(t.y - b.y - 1).toFixed(1), padL: +(i.x - b.x - 1).toFixed(1), padR: parseFloat(cs.paddingRight), gap: +(t.x - i.x - i.w).toFixed(1) };
    });
    res.listRows = [...document.querySelectorAll('.aic-row')].map((r) => {
      const b = R(r), btn = r.querySelector('.aic-btn'), t = r.querySelector('.aic-row-t'); if (!btn) return null;
      const k = R(btn), tt = R(t), stacked = k.y > tt.y + tt.h;
      return { stacked, d: stacked ? +(k.x - tt.x).toFixed(1) : +(k.cy - b.cy).toFixed(1), padL: +(tt.x - b.x - 1).toFixed(1), padR: stacked ? null : +(b.x + b.w - 1 - k.x - k.w).toFixed(1) };
    }).filter(Boolean);
    res.overflowX = document.documentElement.scrollWidth > vw + 1;
    return res;
  }, sel);
}

(async () => {
  const meta = await fetch(BASE + '/.well-known/oauth-authorization-server').then((r) => r.json()).catch(() => null);
  if (!meta) { console.log('FAIL local stack not running'); process.exit(2); }
  // a connection + a token so /charts/agents has rows
  await fetch(BASE + '/api/ai/personal', { method: 'POST', headers: { origin: BASE, authorization: 'Bearer devtok.' + UID, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Claude Code laptop', scope: ['mcp:read', 'mcp:chart'], days: 90 }) });
  await fetch(BASE + '/api/ai/personal', { method: 'POST', headers: { origin: BASE, authorization: 'Bearer devtok.' + UID, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cursor', scope: ['mcp:read'], days: 30 }) });

  await register();
  const b = await launch();
  const all = {};
  const pages = [['ai', '/ai'], ['consent-verified', null], ['consent-unverified', null], ['agents', '/charts/agents']];
  for (const [vw, vh] of [[1440, 900], [390, 844], [412, 915]]) {
    for (const theme of ['dark', 'light']) {
      const ids = await consentIds();
      const ctx = await b.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, ...(vw < 500 ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' } : {}) });
      await ctx.route(/\/assets\/ai-connect\.js/, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: wrapSrc(UID) + (await res.text()) }); });
      await ctx.addInitScript((th) => { try { localStorage.setItem('stryker_install_prompt_dismissed', '1'); localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true })); if (th === 'light') localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme'); } catch (e) {} }, theme);
      for (const [key, url0] of pages) {
        const url = url0 || ('/ai/consent?r=' + encodeURIComponent(ids[key.split('-')[1]]));
        const p = await ctx.newPage();
        const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)));
        await p.goto(BASE + url, { waitUntil: 'load' });
        await p.waitForTimeout(key.startsWith('consent') || key === 'agents' ? 2500 : 1200);
        const tag = key + '-' + vw + '-' + theme;
        const file = path.join(SHOTS, 'page-' + tag + '.png');
        await p.screenshot({ path: file, fullPage: true });
        const m = await measure(p, { card: '.aic-card', row: '.aic-copy, .aic-actions, .aic-row, .aic-top, .aic-choice, .aic-head' });
        all[tag] = m;
        if (key === 'consent-verified') ok(await p.evaluate(() => !!document.getElementById('aic-allow')), tag + ': consent form rendered');
        if (key === 'consent-unverified') ok(await p.evaluate(() => !!document.querySelector('.aic-warn')), tag + ': unverified warning shown');
        if (key === 'agents') ok(await p.evaluate(() => document.body.textContent.includes('Claude Code laptop')), tag + ': token list rendered');
        ok(!m.overflowX, tag + ': no sideways scroll');
        const single = m.rows.filter((r) => !/aic-choice|aic-row/.test(r.cls));
        ok(single.every((r) => r.spread <= 1), tag + ': single-line rows one vertical centre (max spread ' + Math.max(0, ...single.map((r) => r.spread)) + 'px)');
        if (m.choices.length) ok(m.choices.every((c) => Math.abs(c.d) <= 1 && c.padL === c.padR && c.gap === 12), tag + ': choices: control centred on title line (' + [...new Set(m.choices.map((c) => c.d))].join(',') + '), pad ' + [...new Set(m.choices.map((c) => c.padL + '/' + c.padR))].join(',') + ', gap ' + [...new Set(m.choices.map((c) => c.gap))].join(','));
        if (m.listRows.length) ok(m.listRows.every((r) => Math.abs(r.d) <= 1 && (r.padR == null || r.padR === r.padL)), tag + ': list rows: button ' + (m.listRows[0].stacked ? 'left-aligned under text' : 'centred on row') + ' (' + m.listRows.map((r) => r.d).join(',') + '), pad ' + m.listRows.map((r) => r.padL + '/' + r.padR).join(','));
        ok(m.cards.every((c) => c.padL === c.padR && c.padL % 4 === 0), tag + ': card padding equal + on the grid (' + [...new Set(m.cards.map((c) => c.padL + '/' + c.padR))].join(',') + ')');
        const L = Math.min(...m.cards.map((c) => c.left)), Rt = Math.min(...m.cards.map((c) => c.right));
        ok(Math.abs(L - Rt) <= 1 && L >= 16, tag + ': card column centred, not hugging the edge (' + L + '/' + Rt + ')');
        const hs = [...new Set(m.buttons.map((x) => x.h))];
        ok(hs.length <= 2, tag + ': control heights ' + hs.join('/'));
        ok(!errs.length, tag + ': no page errors' + (errs.length ? ' (' + errs[0] + ')' : ''));
        await p.close();
      }
      await ctx.close();
    }
  }
  fs.writeFileSync(path.join(SHOTS, 'pages-measure.json'), JSON.stringify(all, null, 1));
  await b.close();
  console.log('\n' + (n - fails) + ' passed, ' + fails + ' failed. Shots: ' + SHOTS);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
