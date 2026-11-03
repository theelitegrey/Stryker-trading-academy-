// Renders home-share.html -> assets/images/og/share/index.png (1200x630) + tools/og/home-share@2x.png.
// Run: tools/chrome-slot.sh node tools/og/render-home-share.mjs
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
const { launch } = require('../tests/lib.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const out2x = path.join(here, 'home-share@2x.png');
const out1x = path.join(here, '../../assets/images/og/share/index.png');
const b = await launch();
const pg = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await pg.goto('file://' + path.join(here, 'home-share.html'));
await pg.waitForLoadState('load');
await pg.screenshot({ path: out2x });
await b.close();
const py = `from PIL import Image
im=Image.open(${JSON.stringify(out2x)}).convert('RGB')
im.resize((1200,630),Image.LANCZOS).save(${JSON.stringify(out1x)},optimize=True)
im.quantize(256,dither=Image.NONE).save(${JSON.stringify(out2x)},optimize=True)
Image.open(${JSON.stringify(out1x)}).resize((300,158),Image.LANCZOS).save('/tmp/og-thumb.png')`;
execFileSync('python3', ['-c', py]);
