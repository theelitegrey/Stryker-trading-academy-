package com.tradezoro.app.data

import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions

/*
 * ONE ACCOUNT, SYNCED EVERYWHERE (Owner 18 Nov): the website's account settings doc, read and written natively.
 *   users/{uid}/prefs/app  { v: { <id>: "<string>" }, t: { <id>: serverTimestamp }, updatedAt }   (assets/account-sync.js)
 * The chart screen runs the site's own /charts page, which loads account-sync.js itself (chart, tools, trade groups,
 * templates, layouts, workspaces, drawing tools, hotkeys). Watchlists + active list are native (Watchlists.kt).
 * Native settings here: the theme (site id "theme": "day" | "night"), and the app's own default chart timeframe and
 * native chart price style ("mobileDefaultTf", "mobileChartStyle": stored in the account, ignored by the website). Keys the app does not know are never touched:
 * writes are merge-sets of only our own ids, so desktop-only settings stay in the account.
 */
object AccountPrefsCodec {
    const val THEME = "theme"
    const val MOBILE_TF = "mobileDefaultTf"
    const val MOBILE_STYLE = "mobileChartStyle"
    private val STYLES = setOf("CANDLES", "BARS", "LINE", "AREA")
    fun styleOf(v: Map<String, Any?>): String? = (v[MOBILE_STYLE] as? String)?.takeIf { it in STYLES }

    /** The site's theme value -> the app's theme; null = no account value (keep the phone's own choice). */
    fun themeOf(v: Map<String, Any?>): ThemeMode? = when (v[THEME] as? String) { "day" -> ThemeMode.LIGHT; "night" -> ThemeMode.DARK; else -> null }
    /** The app's theme -> the site's value; SYSTEM has no site equivalent, so it is not written. */
    fun themeValue(m: ThemeMode): String? = when (m) { ThemeMode.LIGHT -> "day"; ThemeMode.DARK -> "night"; ThemeMode.SYSTEM -> null }
    fun tfOf(v: Map<String, Any?>): Timeframe? = (v[MOBILE_TF] as? String)?.let { s -> Timeframe.entries.firstOrNull { it.name == s } }

    /** The merge-set body for one changed key (same shape the website writes). */
    fun body(id: String, value: String?, ts: Any): Map<String, Any?> =
        mapOf("v" to mapOf(id to value), "t" to mapOf(id to ts), "updatedAt" to ts)
}

/** Live link between [AppPrefs] and the account doc. One per signed-in member; [stop] on sign-out. */
class AccountPrefsSync(private val prefs: AppPrefs, private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {
    private var reg: ListenerRegistration? = null
    private var uid: String? = null
    private var applying = false

    private fun doc(u: String) = db.collection("users").document(u).collection("prefs").document("app")

    fun start(u: String?) {
        if (u == uid) return
        stop(); uid = u
        if (u == null) return
        prefs.onChange = { id, value -> if (!applying) push(id, value) }
        var first = true
        reg = doc(u).addSnapshotListener { snap, err ->
            if (err != null || snap == null || snap.metadata.hasPendingWrites()) return@addSnapshotListener
            @Suppress("UNCHECKED_CAST")
            val v = (snap.get("v") as? Map<String, Any?>).orEmpty()
            val theme = AccountPrefsCodec.themeOf(v)
            val tf = AccountPrefsCodec.tfOf(v)
            val style = AccountPrefsCodec.styleOf(v)
            applying = true
            try {
                if (theme != null && theme != prefs.theme.value) prefs.setTheme(theme)
                if (tf != null && tf != prefs.defaultTf.value) prefs.setDefaultTf(tf)
                if (style != null && style != prefs.chartStyle.value) prefs.setChartStyle(style)
            } finally { applying = false }
            // first sign-in on this phone: the account lacks a value the phone has -> upload it (never wipe with empty)
            if (first) {
                first = false
                if (theme == null) AccountPrefsCodec.themeValue(prefs.theme.value)?.let { push(AccountPrefsCodec.THEME, it) }
                if (tf == null && prefs.hasDefaultTf()) push(AccountPrefsCodec.MOBILE_TF, prefs.defaultTf.value.name)
                if (style == null) prefs.chartStyle.value?.let { push(AccountPrefsCodec.MOBILE_STYLE, it) }
            }
        }
    }

    private fun push(id: String, value: String?) {
        val u = uid ?: return
        doc(u).set(AccountPrefsCodec.body(id, value, FieldValue.serverTimestamp()), SetOptions.merge())
    }

    fun stop() { reg?.remove(); reg = null; uid = null; prefs.onChange = null }
}
