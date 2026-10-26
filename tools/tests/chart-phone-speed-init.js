// Shared page setup for the phone-speed suites (fixture server only): richstub Firebase (signed in,
// plan Elite), prompts dismissed, clock fixed at the fixture's 2026-10-21 17:00 UTC, and the two
// auth hooks rt-access.js uses (apps non-empty + onIdTokenChanged), so the bars request is not held
// by rt-access's 4 s "no Firebase" wait, which a real visitor never hits.
const stub = require('./richstub.js');
async function speedInit(ctx) {
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    try {
      const fb = window.firebase; fb.apps = [{}];
      const a = window.__stubAuth;
      a.onIdTokenChanged = (cb) => { setTimeout(() => cb(a.currentUser), 30); return () => {}; };
    } catch (e) {}
  }, [Date.UTC(2026, 9, 21, 17, 0)]);
}
module.exports = { speedInit };
