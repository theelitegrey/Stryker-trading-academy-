"""Swap the top-right badge on finished 1200x630 feature cards for the TZ mark (no re-capture needed).
Fills the 88px badge box from the clean column beside it, then pastes tradezoro-tzmark-1103-512.png."""
import glob, os, sys
from PIL import Image
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'images')
mark = Image.open(os.path.join(R, 'tradezoro-tzmark-1103-512.png')).convert('RGBA').resize((88, 88), Image.LANCZOS)
x0, y0 = 1200 - 40 - 88, 27
for f in sys.argv[1:]:
    im = Image.open(f)
    if im.size != (1200, 630): continue
    jpg = f.endswith('.jpg'); im = im.convert('RGBA')
    col = im.crop((x0 - 6, y0, x0 - 5, y0 + 88)).resize((100, 88))
    im.paste(col, (x0 - 6, y0)); im.alpha_composite(mark, (x0, y0))
    im.convert('RGB').save(f, quality=90) if jpg else im.convert('RGB').save(f, optimize=True)
    print('patched', f)
