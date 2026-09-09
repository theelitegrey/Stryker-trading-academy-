/**
 * Stryker Trading Academy — Roadmap editor (roadmap-admin.html)
 * Edits settings/roadmap (shape in roadmap-data.js). Starts from the built-in
 * defaults when the document does not exist yet.
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const $ = (id) => document.getElementById(id); const errEl = $('rma-error');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let data = null;
  const slug = (t) => String(t || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  function readForm() {
    const items = [...document.querySelectorAll('#rma-list .rma-item')].map((el) => { const g = (k) => el.querySelector('[data-k="' + k + '"]').value.trim(); const it = { id: g('id') || slug(g('title')), title: g('title'), desc: g('desc'), status: g('status'), when: g('when'), link: g('link'), details: g('details'), build: g('build') ? Number(g('build')) : null, date: g('date') || null, progress: g('progress') ? Number(g('progress')) : null, sub: g('sub') ? g('sub').split(',').map((x) => x.trim()).filter(Boolean) : [], milestones: g('milestones') ? g('milestones').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ({ done: /^\[x\]/i.test(x), label: x.replace(/^\[[ x]?\]\s*/i, '') })) : [] }; if (!it.when) it.when = { progress: 'In progress', shipped: 'Shipped', planned: 'Planned' }[it.status]; return it; }).filter((it) => it.title);
    const changelog = [...document.querySelectorAll('#rma-cl .rma-cl')].map((el) => ({ build: Number(el.querySelector('[data-k="build"]').value) || null, date: el.querySelector('[data-k="date"]').value || null, title: el.querySelector('[data-k="title"]').value.trim() })).filter((c) => c.title);
    return { heading: $('rma-heading').value.trim(), note: $('rma-note').value.trim(), items, changelog };
  }
  function itemHtml(it, i) {
    return '<div class="rma-item is-' + esc(it.status) + '" data-i="' + i + '"><div class="rma-row"><label>Title<input data-k="title" value="' + esc(it.title) + '"></label><label>Status<select data-k="status"><option value="progress"' + (it.status === 'progress' ? ' selected' : '') + '>In progress</option><option value="planned"' + (it.status === 'planned' ? ' selected' : '') + '>Planned</option><option value="shipped"' + (it.status === 'shipped' ? ' selected' : '') + '>Shipped</option></select></label><label>When (label)<input data-k="when" value="' + esc(it.when || '') + '" placeholder="Q4 2026 / Shipped"></label><label>Progress %<input data-k="progress" type="number" min="0" max="100" value="' + (it.progress != null ? it.progress : '') + '"></label><label>Build<input data-k="build" type="number" value="' + (it.build || '') + '"></label><label>Date<input data-k="date" type="date" value="' + esc(it.date || '') + '"></label><label>Link<input data-k="link" value="' + esc(it.link || '') + '" placeholder="backtests.html"></label><label>Id<input data-k="id" value="' + esc(it.id || '') + '"></label></div>' +
      '<div class="rma-full"><label>One-line description<input data-k="desc" value="' + esc(it.desc || '') + '"></label></div><div class="rma-full"><label>Details (member page)<textarea data-k="details" rows="3">' + esc(it.details || '') + '</textarea></label></div><div class="rma-row"><label>Sub-features (comma separated)<input data-k="sub" value="' + esc((it.sub || []).join(', ')) + '"></label></div><div class="rma-full"><label>Milestones (one per line, [x] = done)<textarea data-k="milestones" rows="4">' + esc((it.milestones || []).map((m) => (m.done ? '[x] ' : '[ ] ') + m.label).join('\n')) + '</textarea></label></div>' +
      '<div class="rma-actions"><button type="button" data-act="up">↑</button><button type="button" data-act="down">↓</button><button type="button" class="danger" data-act="del">Delete</button></div></div>';
  }
  function render() {
    $('rma-heading').value = data.heading || ''; $('rma-note').value = data.note || '';
    $('rma-list').innerHTML = data.items.map(itemHtml).join('');
    $('rma-cl').innerHTML = data.changelog.map((c, i) => '<div class="rma-cl" data-i="' + i + '"><input data-k="build" type="number" value="' + (c.build || '') + '" placeholder="build"><input data-k="date" type="date" value="' + esc(c.date || '') + '"><input data-k="title" value="' + esc(c.title || '') + '" placeholder="What shipped"><button type="button" class="rp-mini" data-act="cldel">✕</button></div>').join('');
  }
  function status(msg, ok) { $('rma-status').textContent = msg; $('rma-status').style.color = ok ? 'var(--gold)' : ''; }
  guardAdminPage(() => {
    StrykerRoadmap.load().then((d) => { data = JSON.parse(JSON.stringify(d)); data.items = data.items || []; data.changelog = data.changelog || []; render(); }).catch((err) => { errEl.textContent = 'Could not load the roadmap: ' + (err.message || err); errEl.style.display = 'block'; });
  });
  $('rma-add').addEventListener('click', () => { data = readForm(); data.items.unshift({ id: '', title: '', desc: '', status: 'planned', when: 'Planned', sub: [], milestones: [] }); render(); });
  $('rma-cl-add').addEventListener('click', () => { data = readForm(); data.changelog.unshift({ build: null, date: new Date().toISOString().slice(0, 10), title: '' }); render(); });
  $('rma-list').addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); const row = e.target.closest('.rma-item'); if (!b || !row) return; data = readForm(); const i = Number(row.dataset.i); if (b.dataset.act === 'del') { if (!confirm('Delete this item?')) return; data.items.splice(i, 1); } else if (b.dataset.act === 'up' && i > 0) { const t = data.items[i - 1]; data.items[i - 1] = data.items[i]; data.items[i] = t; } else if (b.dataset.act === 'down' && i < data.items.length - 1) { const t = data.items[i + 1]; data.items[i + 1] = data.items[i]; data.items[i] = t; } render(); });
  $('rma-list').addEventListener('change', (e) => { if (e.target.dataset.k === 'status') { const row = e.target.closest('.rma-item'); row.className = 'rma-item is-' + e.target.value; } });
  $('rma-cl').addEventListener('click', (e) => { const b = e.target.closest('[data-act="cldel"]'); const row = e.target.closest('.rma-cl'); if (!b || !row) return; data = readForm(); data.changelog.splice(Number(row.dataset.i), 1); render(); });
  $('rma-reset').addEventListener('click', () => { if (!confirm('Replace the editor contents with the built-in defaults? Nothing is saved until you press Save.')) return; data = JSON.parse(JSON.stringify(StrykerRoadmap.DEFAULT)); render(); });
  $('rma-save').addEventListener('click', () => {
    errEl.style.display = 'none'; const out = readForm(); if (!out.items.length) { errEl.textContent = 'Add at least one item.'; errEl.style.display = 'block'; return; }
    out.updatedAt = firebase.firestore.FieldValue.serverTimestamp(); status('Saving…');
    db.collection('settings').doc('roadmap').set(out).then(() => { status('Saved · members see it on their next page load', true); if (typeof showToast === 'function') showToast('Roadmap saved', 'success'); }).catch((err) => { status(''); errEl.textContent = 'Could not save: ' + (err.message || err); errEl.style.display = 'block'; });
  });
});
