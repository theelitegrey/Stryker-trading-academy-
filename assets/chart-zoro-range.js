// TradeZoro — ZoroOptions chart indicators, price pane: "Zoro Range" (stk_zrange) and "Gamma Zone" (stk_zzone). ES module.
// Stream 4 of the ZoroOptions build (spec section 3, items 2 and 3). Everything here is behind the page flag (chart-zoro-data.js zoroOn()).
//
// Zoro Range: shaded 0DTE / 1DTE / weekly / monthly range from the ATM straddle, as bands with a thin edge line and a small tag.
//   Lighter than the old Expected Move (no dashed pair of tags per expiry unless "Tags" is on). Futures are mapped
//   (ES/NQ/RTY/GC/CL) with ratio = chart price / underlying spot at the summary time; the tag says "mapped from SPX".
// Gamma Zone: a faint tint above the Flip Line (Cushion) and below it (Swing). Off by default (it is its own indicator).
// Input "Levels from": Through the day (refreshes every few minutes) or Daily close (levels from the last 16:00 ET close).
// Bar replay: nothing is drawn (today's range and flip would leak the future). The chip says so.
// Wording: "updated X min ago" only. Education only. Not financial advice.
import * as ZD from './chart-zoro-data.js?v=955';
import * as ProGate from './chart-pro-gate.js?v=955';

export const ZRANGE_TYPE = 'stk_zrange';
export const ZZONE_TYPE = 'stk_zzone';
export const ZRANGE_DESC = 'Shaded Zoro Range bands from the ATM straddle: 0DTE, 1DTE, weekly, monthly. SPX, SPY, QQQ, IWM, GLD, USO and ES, NQ, RTY, GC, CL (mapped).';
export const ZZONE_DESC = 'A faint tint above the Flip Line (Cushion) and below it (Swing). Off by default.';
const PRICING = '/pricing';
export const BASIS_DAY = 'Through the day', BASIS_CLOSE = 'Daily close';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);
const basisSel = { key: 'levelsFrom', title: 'Levels from', type: 'string', defval: BASIS_DAY, options: [BASIS_DAY, BASIS_CLOSE] };
const RSCHEMA = [
  basisSel,
  { key: 'expiry', title: 'Expiry', type: 'string', defval: 'All', options: ['All', '0DTE', '1DTE', 'Weekly', 'Monthly'] },
  { key: 'fill', title: 'Shade the range', type: 'bool', defval: true },
  { key: 'labels', title: 'Tags', type: 'bool', defval: true },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true }
];
const ZSCHEMA = [
  basisSel,
  { key: 'cushionColor', title: 'Cushion colour (above Flip Line)', type: 'color', defval: '#03c988' },
  { key: 'swingColor', title: 'Swing colour (below Flip Line)', type: 'color', defval: '#ee4276' },
  { key: 'strength', title: 'Tint strength', type: 'float', defval: 0.07, min: 0.02, max: 0.2, step: 0.01 },
  { key: 'showStatus', title: 'Status', type: 'bool', defval: true }
];

// ---- pure ----------------------------------------------------------------------------------------
// ranges of one summary on the chart's price scale. [{ k, x, lo, hi, color }]; conv = strike -> chart price.
export function rangeBands(zs, conv, expiry) {
  if (!zs) return [];
  const out = [];
  for (const r of zs.ranges) {
    if (expiry && expiry !== 'All' && r.k !== expiry) continue;
    const lo = conv(r.lo), hi = conv(r.hi);
    if (!isNum(lo) || !isNum(hi) || !(hi > lo)) continue;
    const dup = out.find((b) => b.lo === lo && b.hi === hi);   // same expiry listed twice (weekly = monthly)
    if (dup) { dup.k += ' / ' + r.k; continue; }
    out.push({ k: r.k, x: r.x, lo, hi, color: ZD.RANGE_RGB[r.k] || ZD.RANGE_RGB['0DTE'] });
  }
  return out;
}
// zone tint payload: { flip, zone } (flip on the chart's price scale), zone from spot vs flip.
export function zoneTint(zs, conv) {
  if (!zs || !isNum(zs.flip)) return null;
  const flip = conv(zs.flip);
  if (!isNum(flip)) return null;
  return { flip, zone: ZD.zoneOf(zs.spot, zs.flip) || zs.zone };
}

// ---- natives -------------------------------------------------------------------------------------
class ZNative {
  constructor(kind) { this.kind = kind; this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = inputs || {};
    ZD.zoWatch(this);
    ProGate.tier().then((t) => { this.tier = t; this.load(); });
    this.load();
  }
  basis() { return str(this.inputs.levelsFrom, BASIS_DAY) === BASIS_CLOSE ? 'close' : ''; }
  wants() {
    if (!this.ctx || !this.tier || ZD.replayOn() || ProGate.isFree()) return [];
    const src = ZD.srcOfCtx(this.ctx);
    return src ? [{ kind: 'summary', u: src.u, x: this.basis() }] : [];
  }
  load() { this.refresh(); ZD.zoLoad(this); }
  onBars() { const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); } else this.refresh(); }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { ZD.zoUnwatch(this); try { this.ctx.pushData(null); } catch (e) {} }
  refresh() {
    if (!this.ctx) return;
    const I = this.inputs, name = this.kind === 'range' ? 'Zoro Range' : 'Gamma Zone';
    let payload;
    const src = ZD.srcOfCtx(this.ctx);
    if (ZD.replayOn()) payload = { note: name + ' is hidden during bar replay' };
    else if (!ZD.zoroOn() || !src) payload = { note: name + ': SPX, SPY, QQQ, IWM, GLD, USO, ES, NQ, RTY, GC, CL and top stocks' };
    else if (!this.tier) payload = { note: 'Loading ' + name + '…' };
    else if (ProGate.isFree()) payload = { pill: 'Unlock ' + name + ' with Pro', href: PRICING };
    else {
      const zs = ZD.zsum(ZD.zoCached('summary', src.u, this.basis()));
      if (!zs) payload = { note: 'Loading ' + name + '…' };
      else {
        let bars = [];
        try { bars = this.ctx.bars() || []; } catch (e) {}
        const conv = ZD.convFor(zs, src, bars);
        const ago = this.basis() ? 'daily close levels' : ZD.agoText(zs.t);
        const map = src.fut ? ' · mapped from ' + src.u : '';
        if (this.kind === 'range') {
          const bands = rangeBands(zs, conv, I.expiry);
          payload = bands.length
            ? { bands, fill: I.fill !== false, labels: I.labels !== false, showStatus: I.showStatus !== false, status: 'Zoro Range ' + src.root + map + ' · ' + ago }
            : { note: src.fut && !isNum(conv(zs.spot)) ? 'No ' + src.fut + ' bar at the options time' : 'No Zoro Range for this expiry today' };
        } else {
          const z = zoneTint(zs, conv);
          payload = z
            ? { flip: z.flip, zone: z.zone, cushion: str(I.cushionColor, '#03c988'), swing: str(I.swingColor, '#ee4276'), strength: isNum(I.strength) ? I.strength : 0.07,
              showStatus: I.showStatus !== false, status: 'Gamma Zone ' + src.root + map + ' · ' + (z.zone === 'swing' ? 'Swing' : 'Cushion') + ' · ' + ago }
            : { note: 'No Flip Line yet for ' + src.root };
        }
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

// ---- layers --------------------------------------------------------------------------------------
function chipLayer(draw, below) {
  return function create() {
    let canvas = null, chip = null, last = '';
    function paintChip(d, bottomPx, row) {
      if (!chip && canvas && canvas.parentElement) {
        chip = document.createElement('div');
        chip.className = 'stk-gex-chip stk-zoro-chip'; chip.hidden = true;
        canvas.parentElement.appendChild(chip);
      }
      if (!chip) return;
      // phone: the legend row already says it; only notes and the upgrade pill get a chip
      if (d && d.status && !d.note && !d.pill && window.innerWidth < 520) d = Object.assign({}, d, { status: '' });
      const k = d ? JSON.stringify([d.note, d.pill, d.showStatus === false ? '' : d.status, bottomPx]) : '';
      if (k === last) return;
      last = k;
      if (!d || !(d.note || d.pill || (d.showStatus !== false && d.status))) { chip.hidden = true; return; }
      chip.hidden = false; chip.style.right = 'auto'; chip.style.left = '8px'; chip.style.bottom = (bottomPx + 24 * row) + 'px';
      chip.textContent = '';
      if (d.pill) { const a = document.createElement('a'); a.className = 'stk-gex-pill'; a.href = d.href || PRICING; a.textContent = d.pill; chip.appendChild(a); }
      else { chip.classList.toggle('is-note', !!d.note); chip.appendChild(document.createTextNode(d.note || d.status)); }
    }
    return {
      mount(cv) { canvas = cv; },
      render(a) {
        if (!canvas) return;
        const g = canvas.getContext('2d'); if (!g) return;
        const dpr = a.coords.dpr || 1;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
        const d = a.data, fullH = canvas.height / dpr;
        paintChip(d, Math.max(0, fullH - (a.bounds.top + a.bounds.height)) + 8, below ? 2 : 3);
        canvas.__stkZoro = { bands: 0, tint: false };
        if (!d) return;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const W = a.coords.width, top = a.bounds.top, H = a.bounds.height;
        g.save(); g.beginPath(); g.rect(0, top, W, H); g.clip();
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; g.textBaseline = 'middle';
        draw(g, d, (p) => a.coords.priceToY(p, a.scale, a.bounds), W, top, H, canvas.__stkZoro);
        g.restore();
      },
      destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
    };
  };
}
const fmt = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rangeLayer = chipLayer((g, d, Y, W, top, H, probe) => {
  if (!d.bands) return;
  for (const b of d.bands) {
    const yH = Math.round(Y(b.hi)) + 0.5, yL = Math.round(Y(b.lo)) + 0.5;
    probe.bands++;
    if (d.fill) { g.fillStyle = ZD.hexA(b.color, d.bands.length > 1 ? 0.045 : 0.08); g.fillRect(0, Math.min(yH, yL), W, Math.abs(yL - yH)); }
    g.strokeStyle = ZD.hexA(b.color, 0.7); g.lineWidth = 1; g.setLineDash([]);
    [yH, yL].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
    if (d.labels) {
      [[yH, 'Range ' + b.k + ' ' + fmt(b.hi)], [yL, 'Range ' + b.k + ' ' + fmt(b.lo)]].forEach(([y, t]) => {
        if (y < top || y > top + H) return;
        const w = Math.ceil(g.measureText(t).width) + 10, x = Math.max(2, W - w - 150);
        g.fillStyle = ZD.hexA(b.color, 0.9); g.fillRect(x, y - 8, w, 16);
        g.fillStyle = '#0b0b0b'; g.fillText(t, x + 5, y + 0.5);
      });
    }
  }
}, false);
const zoneLayer = chipLayer((g, d, Y, W, top, H, probe) => {
  if (!isNum(d.flip)) return;
  const y = Math.round(Y(d.flip));
  if (!isFinite(y)) return;
  probe.tint = true;
  const a = Math.max(0.02, Math.min(0.2, d.strength || 0.07));
  g.fillStyle = ZD.hexA(d.cushion, a); g.fillRect(0, top, W, Math.max(0, Math.min(y, top + H) - top));
  g.fillStyle = ZD.hexA(d.swing, a); g.fillRect(0, Math.max(y, top), W, Math.max(0, top + H - Math.max(y, top)));
  if (y > top + 14 && y < top + H - 14) {
    g.fillStyle = ZD.hexA(d.cushion, 0.8); g.fillText('CUSHION', 8, Math.max(top + 10, y - 9));
    g.fillStyle = ZD.hexA(d.swing, 0.8); g.fillText('SWING', 8, y + 10);
  }
}, true);

// ---- registration --------------------------------------------------------------------------------
let installed = false;
export function installZoroRange(Core) {
  if (installed || !ZD.zoroOn()) return;
  installed = true;
  Core.registerRendererLayer({ id: ZRANGE_TYPE, placement: 'above-data', create: rangeLayer });
  Core.registerRendererLayer({ id: ZZONE_TYPE, placement: 'below-data', create: zoneLayer });
  const reg = (type, title, shortTitle, schema, kind) => Core.registerNativeIndicator({
    type, title, shortTitle, paneHint: 'price', overlay: true,
    inputsSchema: () => schema, defaultInputs: () => Object.fromEntries(schema.map((x) => [x.key, x.defval])),
    create: () => new ZNative(kind),
    legendNote: (d) => (d ? (d.pill || d.note || String(d.status || '').replace(/^(Zoro Range|Gamma Zone) /, '')) : '')
  });
  reg(ZRANGE_TYPE, 'Zoro Range', 'Zoro Range', RSCHEMA, 'range');
  reg(ZZONE_TYPE, 'Gamma Zone (Cushion / Swing)', 'Gamma Zone', ZSCHEMA, 'zone');
  ZD.persist(Core, 'stryker.zrange', ZRANGE_TYPE, RSCHEMA, 2);
  ZD.persist(Core, 'stryker.zzone', ZZONE_TYPE, ZSCHEMA, 1);
}
