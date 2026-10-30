#!/usr/bin/env node
// Removes the demo community and everything flagged demo (Owner order 2026-10-30). DRY RUN by default; add --apply to delete.
//   node tools/creator/demo-cleanup.js [--slug tradezoro] [--apply]
// Deletes: communities/<slug> and every sub-collection, slugs/<slug>, students/demo_tr_* (demo:true only), their Auth accounts if any,
// and lowers creatorMeta/<owner>.count by 1. Never touches the owner's account or any other community.
(async () => {
  const g = await import('../demo-account/lib/gcp.mjs');
  const APPLY = process.argv.includes('--apply');
  const slug = process.argv.includes('--slug') ? process.argv[process.argv.indexOf('--slug') + 1] : 'tradezoro';
  const cm = await g.getDoc('communities/' + slug);
  if (!cm) { console.log('no community', slug); return; }
  if (cm.demo !== true) { console.log('refusing: community is not flagged demo'); process.exit(1); }
  const paths = [];
  async function walk(doc) {
    paths.push(doc);
    for (const c of await g.listCollectionIds(doc)) for (const p of await g.listPaths(doc + '/' + c)) await walk(p);
  }
  await walk('communities/' + slug);
  const uids = [];
  for (const p of await g.listPaths(`communities/${slug}/members`)) { const u = p.split('/').pop(); if (/^demo_/.test(u)) uids.push(u); }
  const students = [];
  for (const u of uids) { const s = await g.getDoc('students/' + u); if (s && s.demo === true) students.push('students/' + u); }
  console.log('community docs:', paths.length, '| demo members:', uids.length, '| demo student docs:', students.length, '| slug doc: slugs/' + slug);
  if (!APPLY) { console.log('DRY RUN. Nothing deleted. Add --apply.'); return; }
  await g.deleteDocs([...paths.reverse(), ...students, 'slugs/' + slug]);
  for (const u of uids) { try { await g.authDelete(u); } catch (e) { /* no auth account for sample members */ } }
  const meta = await g.getDoc('creatorMeta/' + cm.ownerUid);
  if (meta) await g.mergeDoc('creatorMeta/' + cm.ownerUid, { count: Math.max(0, (meta.count || 1) - 1) });
  console.log('deleted.');
})().catch((e) => { console.error(e.message); process.exit(1); });
