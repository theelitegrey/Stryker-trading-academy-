// Shared page setup for the phone-speed suites (fixture server only): richstub Firebase (signed in,
// plan Elite), prompts dismissed, clock fixed at the fixture's 2026-10-21 17:00 UTC, and the two
// auth hooks rt-access.js uses (apps non-empty + onIdTokenChanged), so the bars request is not held
// by rt-access's 4 s "no Firebase" wait, which a real visitor never hits.
const stub = require('./richstub.js');
async function speedInit(ctx) {
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now, authMs, gateMs]) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    try {
      const fb = window.firebase; fb.apps = [{}];
      const a = window.__stubAuth;
      a.onIdTokenChanged = (cb) => { setTimeout(() => cb(a.currentUser), 30 + authMs); return () => {}; };
      // SPEED_AUTH_MS: the sign-in answer takes this long, like live Firebase on a phone (~1.5-2.5 s)
      // SPEED_GATE_MS: every Firestore read answers this late (the plan / role reads behind the login gate)
      if (gateMs) {
        const D = window.__stubDb, wrapRef = (r) => { if (r && r.get) { const g = r.get; r.get = (...x) => new Promise((ok) => setTimeout(ok, gateMs)).then(() => g.apply(r, x)); } return r; };
        const c0 = D.collection, d0 = D.doc;
        D.collection = (...x) => { const c = c0(...x); const dd = c.doc; if (dd) c.doc = (...y) => wrapRef(dd.apply(c, y)); return wrapRef(c); };
        D.doc = (...x) => wrapRef(d0(...x));
      }
      if (authMs) { const o = a.onAuthStateChanged; a.onAuthStateChanged = (cb) => o((u) => setTimeout(() => cb(u), authMs)); }
    } catch (e) {}
  }, [Date.UTC(2026, 9, 21, 17, 0), Number(process.env.SPEED_AUTH_MS) || 0, Number(process.env.SPEED_GATE_MS) || 0]);
}
module.exports = { speedInit };
