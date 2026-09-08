/**
 * Stryker Trading Academy — small SVG chart kit for the Backtesting views
 *
 * Responsive SVG charts with a shared hover tooltip: line/area with crosshair,
 * donut, lollipop, horizontal pos/neg bars, gauge, histogram and a percentile
 * fan (Monte Carlo). Colours come from CSS custom properties so light and dark
 * themes each get their own validated steps (see style.css --chart-*).
 * Marks are thin, labels selective, one axis per chart.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const css = (name, fb) => (getComputedStyle(document.documentElement).getPropertyValue(name) || '').trim() || fb;
  const C = () => ({ c1: css('--chart-1', '#03a872'), c2: css('--chart-2', '#3f7fe8'), c3: css('--chart-3', '#b07c0e'), c4: css('--chart-4', '#8b7dd8'), pos: css('--bull', '#03c988'), neg: css('--bear', '#e5484d'), grid: css('--chart-grid', 'rgba(255,255,255,0.07)'), text: css('--ink-2', '#8b93a0'), text2: css('--ink-3', '#5c6472'), ink: css('--ink-0', '#eee'), track: css('--bg-0', '#050506') });
  let tip = null;
  function showTip(x, y, html) { if (!tip) { tip = document.createElement('div'); tip.className = 'btc-tip'; document.body.appendChild(tip); } tip.innerHTML = html; tip.style.display = 'block'; const w = tip.offsetWidth, h = tip.offsetHeight; const left = Math.min(window.innerWidth - w - 8, x + 14), top = y - h - 12 < 4 ? y + 16 : y - h - 12; tip.style.left = left + 'px'; tip.style.top = top + 'px'; }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  const fmtMoney = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const nice = (lo, hi, n) => { const range = hi - lo || 1; const raw = range / n; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out; };
  const fmtTime = (t, span) => { const d = new Date(t); return span > 3 * 86400000 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); };

  // ---- line / area over time (multi-series, one axis) ------------------------------------------
  function line(node, o) {
    node.innerHTML = ''; const k = C(); const W = node.clientWidth || 600, H = o.height || 240; const m = { l: 56, r: 14, t: 12, b: 26 };
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'btc' }, node);
    const series = (o.series || []).filter((s) => s.points && s.points.length); if (!series.length) { el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: k.text, 'font-size': 12 }, svg).textContent = o.empty || 'No data'; return; }
    const xs = series.flatMap((s) => s.points.map((p) => p.x)), ys = series.flatMap((s) => s.points.map((p) => p.y)); let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 - x0 < 60000) { x0 -= 1800000; x1 += 1800000; } let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys); const ticks = nice(y0, y1, 4); y0 = Math.min(y0, ticks[0]); y1 = Math.max(y1, ticks[ticks.length - 1]); if (y1 === y0) y1 = y0 + 1;
    const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = (v) => m.t + (y1 - v) / (y1 - y0) * (H - m.t - m.b);
    for (const tv of ticks) { el('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), stroke: k.grid }, svg); el('text', { x: m.l - 8, y: Y(tv) + 4, 'text-anchor': 'end', fill: k.text2, 'font-size': 10.5, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = (o.yFmt || fmtMoney)(tv); }
    el('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: k.text2, 'stroke-dasharray': '3 3', opacity: 0.7 }, svg);
    const nx = Math.max(2, Math.floor((W - m.l - m.r) / 110)); for (let i = 0; i <= nx; i++) { const t = x0 + (x1 - x0) * i / nx; el('text', { x: X(t), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === nx ? 'end' : 'middle', fill: k.text2, 'font-size': 10.5 }, svg).textContent = o.xFmt ? o.xFmt(t) : fmtTime(t, x1 - x0); }
    series.forEach((s, si) => {
      const col = s.color || [k.c1, k.c2, k.c3, k.c4][si % 4]; const pts = s.points.slice().sort((a, b) => a.x - b.x);
      const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
      if (s.area !== false && series.length === 1) { const gid = 'g' + Math.random().toString(36).slice(2, 8); const g = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, el('defs', {}, svg)); el('stop', { offset: 0, 'stop-color': col, 'stop-opacity': 0.28 }, g); el('stop', { offset: 1, 'stop-color': col, 'stop-opacity': 0.02 }, g); el('path', { d: d + ' L' + X(pts[pts.length - 1].x).toFixed(1) + ' ' + Y(0).toFixed(1) + ' L' + X(pts[0].x).toFixed(1) + ' ' + Y(0).toFixed(1) + ' Z', fill: 'url(#' + gid + ')' }, svg); }
      el('path', { d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      if (pts.length <= 60) for (const p of pts) el('circle', { cx: X(p.x), cy: Y(p.y), r: 2.6, fill: col, stroke: css('--bg-2', '#131316'), 'stroke-width': 1.5 }, svg);
    });
    if (series.length > 1) { const lg = document.createElement('div'); lg.className = 'btc-legend'; lg.innerHTML = series.map((s, i) => '<span><i style="background:' + (s.color || [k.c1, k.c2, k.c3, k.c4][i % 4]) + '"></i>' + s.name + '</span>').join(''); node.appendChild(lg); }
    // hover crosshair
    const hl = el('line', { y1: m.t, y2: H - m.b, stroke: k.text, 'stroke-dasharray': '2 3', opacity: 0 }, svg); const dots = series.map((s, i) => el('circle', { r: 4, fill: s.color || [k.c1, k.c2, k.c3, k.c4][i % 4], stroke: css('--bg-2', '#131316'), 'stroke-width': 2, opacity: 0 }, svg));
    const all = series.map((s) => s.points.slice().sort((a, b) => a.x - b.x));
    svg.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * W / r.width; const xv = x0 + (px - m.l) / (W - m.l - m.r) * (x1 - x0); let html = ''; let anyX = null; all.forEach((pts, si) => { let best = pts[0]; for (const p of pts) if (Math.abs(p.x - xv) < Math.abs(best.x - xv)) best = p; anyX = best.x; dots[si].setAttribute('cx', X(best.x)); dots[si].setAttribute('cy', Y(best.y)); dots[si].setAttribute('opacity', 1); html += (o.tooltip ? o.tooltip(best, series[si]) : '<b>' + series[si].name + '</b> ' + (o.yFmt || fmtMoney)(best.y)); }); if (anyX == null) return; hl.setAttribute('x1', X(anyX)); hl.setAttribute('x2', X(anyX)); hl.setAttribute('opacity', 0.6); showTip(e.clientX, e.clientY, '<div class="btc-tip-t">' + (o.xFmt ? o.xFmt(anyX) : new Date(anyX).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })) + '</div>' + html); });
    svg.addEventListener('mouseleave', () => { hl.setAttribute('opacity', 0); dots.forEach((d) => d.setAttribute('opacity', 0)); hideTip(); });
  }

  // ---- donut ------------------------------------------------------------------------------------
  function donut(node, o) {
    node.innerHTML = ''; const k = C(); const size = o.size || 150, r = size / 2 - 6, rin = r * 0.68; const parts = (o.parts || []).filter((p) => p.value > 0); const total = parts.reduce((a, p) => a + p.value, 0);
    const wrap = document.createElement('div'); wrap.className = 'btc-donut'; node.appendChild(wrap);
    const svg = el('svg', { viewBox: '0 0 ' + size + ' ' + size, width: size, height: size }, wrap);
    if (!total) { el('circle', { cx: size / 2, cy: size / 2, r: (r + rin) / 2, fill: 'none', stroke: k.grid, 'stroke-width': r - rin }, svg); }
    let a0 = -Math.PI / 2; const cx = size / 2, cy = size / 2;
    if (parts.length === 1) { const p = parts[0]; const c = el('circle', { cx, cy, r: (r + rin) / 2, fill: 'none', stroke: p.color, 'stroke-width': r - rin }, svg); c.addEventListener('mousemove', (ev) => showTip(ev.clientX, ev.clientY, '<b>' + p.label + '</b> ' + (o.fmt ? o.fmt(p.value) : p.value) + ' · 100%')); c.addEventListener('mouseleave', hideTip); }
    else for (const p of parts) { const a1 = a0 + 2 * Math.PI * p.value / total; const gap = parts.length > 1 ? 0.03 : 0; const s = a0 + gap, e = a1 - gap; const big = e - s > Math.PI ? 1 : 0; const d = 'M' + (cx + r * Math.cos(s)) + ' ' + (cy + r * Math.sin(s)) + ' A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + (cx + r * Math.cos(e)) + ' ' + (cy + r * Math.sin(e)) + ' L' + (cx + rin * Math.cos(e)) + ' ' + (cy + rin * Math.sin(e)) + ' A' + rin + ' ' + rin + ' 0 ' + big + ' 0 ' + (cx + rin * Math.cos(s)) + ' ' + (cy + rin * Math.sin(s)) + ' Z'; const path = el('path', { d, fill: p.color }, svg); path.addEventListener('mousemove', (ev) => showTip(ev.clientX, ev.clientY, '<b>' + p.label + '</b> ' + (o.fmt ? o.fmt(p.value) : p.value) + ' · ' + Math.round(100 * p.value / total) + '%')); path.addEventListener('mouseleave', hideTip); a0 = a1; }
    el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', fill: k.ink, 'font-size': 18, 'font-weight': 700, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = o.center != null ? o.center : total;
    if (o.sub) el('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', fill: k.text2, 'font-size': 10.5 }, svg).textContent = o.sub;
    const lg = document.createElement('div'); lg.className = 'btc-legend btc-legend-v'; lg.innerHTML = (o.parts || []).map((p) => '<span><i style="background:' + p.color + '"></i>' + p.label + '<b>' + (o.fmt ? o.fmt(p.value) : p.value) + (total ? ' <small>' + Math.round(100 * p.value / total) + '%</small>' : '') + '</b></span>').join(''); wrap.appendChild(lg);
  }

  // ---- lollipop (categories on x, value on y) -----------------------------------------------------
  function lollipop(node, o) {
    node.innerHTML = ''; const k = C(); const rows = o.rows || []; const W = node.clientWidth || 300, H = o.height || 190; const m = { l: 44, r: 10, t: 14, b: 30 };
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'btc' }, node); if (!rows.length) { el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: k.text, 'font-size': 12 }, svg).textContent = 'No data'; return; }
    const vals = rows.map((r) => r.value || 0); let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (o.max != null) hi = Math.max(hi, o.max); if (hi === lo) hi = lo + 1; const ticks = nice(lo, hi, 3); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const Y = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b); const step = (W - m.l - m.r) / rows.length;
    for (const tv of ticks) { el('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), stroke: k.grid }, svg); el('text', { x: m.l - 6, y: Y(tv) + 4, 'text-anchor': 'end', fill: k.text2, 'font-size': 10, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = o.fmt ? o.fmt(tv) : tv; }
    rows.forEach((r, i) => { const x = m.l + step * (i + 0.5); const v = r.value || 0; const col = r.color || (o.signed ? (v >= 0 ? k.pos : k.neg) : k.c2); el('line', { x1: x, x2: x, y1: Y(0), y2: Y(v), stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round', opacity: 0.8 }, svg); const c = el('circle', { cx: x, cy: Y(v), r: 5, fill: col, stroke: css('--bg-2', '#131316'), 'stroke-width': 2 }, svg); el('text', { x, y: H - 12, 'text-anchor': 'middle', fill: k.text, 'font-size': 10.5 }, svg).textContent = r.label; el('text', { x, y: Y(v) - 9, 'text-anchor': 'middle', fill: k.ink, 'font-size': 10.5, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = o.fmt ? o.fmt(v) : v; c.addEventListener('mousemove', (ev) => showTip(ev.clientX, ev.clientY, '<b>' + r.label + '</b> ' + (o.fmt ? o.fmt(v) : v) + (r.extra ? '<br>' + r.extra : ''))); c.addEventListener('mouseleave', hideTip); });
  }

  // ---- horizontal pos/neg bars ------------------------------------------------------------------------
  function hbars(node, o) {
    node.innerHTML = ''; const k = C(); const rows = o.rows || []; if (!rows.length) { node.innerHTML = '<p class="rp-empty">No trades in this view.</p>'; return; }
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value || 0)));
    node.innerHTML = '<div class="btc-hb">' + rows.map((r) => { const v = r.value || 0; const w = 50 * Math.abs(v) / max; return '<div class="btc-hb-row" data-tip="' + (r.tip || '') + '"><span class="btc-hb-l">' + r.label + '</span><span class="btc-hb-t"><i class="' + (v >= 0 ? 'p' : 'n') + '" style="width:' + w + '%"></i></span><span class="btc-hb-v ' + (v >= 0 ? 'up' : 'down') + '">' + (o.fmt ? o.fmt(v) : v) + (r.sub != null ? '<small>' + r.sub + '</small>' : '') + '</span></div>'; }).join('') + '</div>';
    node.querySelectorAll('.btc-hb-row').forEach((row) => { if (!row.dataset.tip) return; row.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, row.dataset.tip)); row.addEventListener('mouseleave', hideTip); });
  }

  // ---- gauge (semicircle) --------------------------------------------------------------------------------
  function gauge(node, o) {
    node.innerHTML = ''; const k = C(); const W = o.size || 160, H = W * 0.72, r = W / 2 - 10, cx = W / 2, cy = H - 26; const v = Math.max(0, Math.min(o.max, o.value || 0)); const frac = o.max ? v / o.max : 0;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H }, node);
    const arc = (f0, f1, col, wdt) => { const a0 = Math.PI + Math.PI * f0, a1 = Math.PI + Math.PI * f1; el('path', { d: 'M' + (cx + r * Math.cos(a0)) + ' ' + (cy + r * Math.sin(a0)) + ' A' + r + ' ' + r + ' 0 0 1 ' + (cx + r * Math.cos(a1)) + ' ' + (cy + r * Math.sin(a1)), fill: 'none', stroke: col, 'stroke-width': wdt, 'stroke-linecap': 'round' }, svg); };
    arc(0, 1, k.grid, 10); if (frac > 0) arc(0, frac, o.color || (o.good != null ? (v >= o.good ? k.pos : v >= (o.ok || 0) ? k.c3 : k.neg) : k.c1), 10);
    if (o.marker != null) { const a = Math.PI + Math.PI * Math.min(1, o.marker / o.max); el('circle', { cx: cx + r * Math.cos(a), cy: cy + r * Math.sin(a), r: 3.5, fill: k.ink }, svg); }
    el('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', fill: k.ink, 'font-size': 22, 'font-weight': 700, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = o.display != null ? o.display : (o.value == null ? '—' : o.value);
    if (o.label) el('text', { x: cx, y: cy + 16, 'text-anchor': 'middle', fill: k.text2, 'font-size': 10 }, svg).textContent = o.label;
  }

  // ---- histogram ------------------------------------------------------------------------------------------
  function hist(node, o) {
    node.innerHTML = ''; const k = C(); const bins = o.bins || []; const W = node.clientWidth || 300, H = o.height || 170; const m = { l: 34, r: 10, t: 12, b: 28 };
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'btc' }, node); const max = Math.max(1, ...bins.map((b) => b.n)); const step = (W - m.l - m.r) / bins.length; const Y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
    for (const tv of nice(0, max, 3)) { el('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), stroke: k.grid }, svg); el('text', { x: m.l - 6, y: Y(tv) + 4, 'text-anchor': 'end', fill: k.text2, 'font-size': 10, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = tv; }
    bins.forEach((b, i) => { const x = m.l + step * i + 4, w = Math.max(2, step - 8); const rect = el('rect', { x, y: Y(b.n), width: w, height: Math.max(0, Y(0) - Y(b.n)), rx: 3, fill: b.color || (b.neg ? k.neg : k.pos), opacity: 0.85 }, svg); el('text', { x: x + w / 2, y: H - 10, 'text-anchor': 'middle', fill: k.text2, 'font-size': 9.5 }, svg).textContent = b.label; if (b.n) el('text', { x: x + w / 2, y: Y(b.n) - 4, 'text-anchor': 'middle', fill: k.ink, 'font-size': 10, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = b.n; rect.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, '<b>' + b.label + '</b> ' + b.n + ' trades')); rect.addEventListener('mouseleave', hideTip); });
  }

  // ---- percentile fan (Monte Carlo) ---------------------------------------------------------------------------
  function fan(node, o) {
    node.innerHTML = ''; const k = C(); const W = node.clientWidth || 600, H = o.height || 240; const m = { l: 56, r: 14, t: 12, b: 24 }; const b = o.bands; const n = b.p50.length;
    const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, class: 'btc' }, node);
    const all = b.p5.concat(b.p95, o.actual || []); let lo = Math.min(0, ...all), hi = Math.max(0, ...all); const ticks = nice(lo, hi, 4); lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]); if (hi === lo) hi = lo + 1;
    const X = (i) => m.l + i / (n - 1) * (W - m.l - m.r), Y = (v) => m.t + (hi - v) / (hi - lo) * (H - m.t - m.b);
    for (const tv of ticks) { el('line', { x1: m.l, x2: W - m.r, y1: Y(tv), y2: Y(tv), stroke: k.grid }, svg); el('text', { x: m.l - 8, y: Y(tv) + 4, 'text-anchor': 'end', fill: k.text2, 'font-size': 10.5, 'font-family': 'JetBrains Mono, monospace' }, svg).textContent = fmtMoney(tv); }
    const band = (up, dn, op) => { const d = up.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ') + ' ' + dn.map((v, i) => 'L' + X(n - 1 - i).toFixed(1) + ' ' + Y(dn[n - 1 - i]).toFixed(1)).join(' ') + ' Z'; el('path', { d, fill: k.c2, opacity: op }, svg); };
    band(b.p95, b.p5, 0.14); band(b.p75, b.p25, 0.22);
    const lineP = (arr, col, w, dash) => el('path', { d: arr.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' '), fill: 'none', stroke: col, 'stroke-width': w, 'stroke-dasharray': dash || '' }, svg);
    lineP(b.p50, k.c2, 2); if (o.actual) lineP(o.actual, k.c1, 2.2); el('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), stroke: k.text2, 'stroke-dasharray': '3 3', opacity: 0.7 }, svg);
    el('text', { x: m.l, y: H - 6, fill: k.text2, 'font-size': 10.5 }, svg).textContent = 'trade 1'; el('text', { x: W - m.r, y: H - 6, 'text-anchor': 'end', fill: k.text2, 'font-size': 10.5 }, svg).textContent = 'trade ' + (n - 1);
    const lg = document.createElement('div'); lg.className = 'btc-legend'; lg.innerHTML = '<span><i style="background:' + k.c1 + '"></i>Your sequence</span><span><i style="background:' + k.c2 + '"></i>Median of ' + (o.runs || '') + ' shuffles</span><span><i style="background:' + k.c2 + ';opacity:.35"></i>25–75% and 5–95% bands</span>'; node.appendChild(lg);
    svg.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) * W / r.width - m.l) / (W - m.l - m.r) * (n - 1)))); showTip(e.clientX, e.clientY, '<div class="btc-tip-t">After trade ' + i + '</div>' + (o.actual ? '<b>You</b> ' + fmtMoney(o.actual[i]) + '<br>' : '') + '<b>Median</b> ' + fmtMoney(b.p50[i]) + '<br><b>5–95%</b> ' + fmtMoney(b.p5[i]) + ' … ' + fmtMoney(b.p95[i])); });
    svg.addEventListener('mouseleave', hideTip);
  }
  root.BTCharts = { line, donut, lollipop, hbars, gauge, hist, fan, fmtMoney, hideTip };
})(window);
