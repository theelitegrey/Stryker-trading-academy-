// node tools/app-shell/apply.js suggestions.html:/suggestions help.html:/help ...
// Converts public-and-app pages (see dual-shell.js). Idempotent. Generated Learn pages are handled by tools/gen-learn.js.
const fs = require('fs');
const { toDual } = require('./dual-shell.js');
for (const a of process.argv.slice(2)) {
  const i = a.indexOf(':'); const f = i < 0 ? a : a.slice(0, i); const active = i < 0 ? null : a.slice(i + 1);
  const s = fs.readFileSync(f, 'utf8'); const o = toDual(s, { active });
  if (o !== s) { fs.writeFileSync(f, o); console.log('converted', f); } else console.log('unchanged', f);
}
