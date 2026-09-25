#!/usr/bin/env node
// Runs every browser suite against a local copy of the site.
//
//   node tools/tests/run.js            all suites
//   node tools/tests/run.js mm ec      just those (prefix match)
//
// Starts `python3 -m http.server` on the test port when nothing is listening
// there, and stops it again afterwards. Exit code is the number of failing
// suites, so CI and humans can read it the same way.
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');
const { ROOT, PORT, BASE } = require('./lib.js');

const SUITES = [
  ['mb-test',     'market brief'],
  ['mm-test',     'market map'],
  ['ec-test',     'economic calendar'],
  ['pad-test',    'section padding'],
  ['video-test',  'chapter player'],
  ['width-check', 'phone-width layout'],
  ['cheatsheet-test', 'cheat-sheet pages + links'],
];

const want = process.argv.slice(2);
const picked = want.length ? SUITES.filter(([n]) => want.some((w) => n.startsWith(w))) : SUITES;
if (!picked.length) { console.error('no suite matches', want.join(' ')); process.exit(2); }

function listening() {
  return new Promise((res) => {
    const req = http.get(BASE + '/assets/version.json', (r) => { r.resume(); res(r.statusCode === 200); });
    req.on('error', () => res(false));
    req.setTimeout(1500, () => { req.destroy(); res(false); });
  });
}

async function startServer() {
  if (await listening()) return null;
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', ROOT],
                    { stdio: 'ignore', detached: false });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await listening()) return srv;
  }
  srv.kill();
  throw new Error('http.server did not come up on ' + BASE);
}

(async () => {
  const srv = await startServer();
  console.log(srv ? 'started http.server on ' + BASE : 'using the server already on ' + BASE);
  let failed = 0;
  const summary = [];
  for (const [name, label] of picked) {
    console.log('\n===== ' + name + '  (' + label + ')');
    const r = spawnSync(process.execPath, [path.join(__dirname, name + '.js')],
                        { stdio: 'inherit', env: process.env });
    const ok = r.status === 0;
    if (!ok) failed++;
    summary.push((ok ? 'PASS  ' : 'FAIL  ') + name);
  }
  if (srv) srv.kill();
  console.log('\n===== summary\n' + summary.join('\n'));
  process.exit(failed);
})().catch((e) => { console.error(e.message); process.exit(2); });
