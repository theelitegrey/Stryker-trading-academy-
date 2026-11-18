package com.tradezoro.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode(val label: String) { SYSTEM("System"), DARK("Dark"), LIGHT("Light") }

/** App settings (Account sheet): theme, default chart timeframe, the active watchlist per member. Signed in, theme and
 *  timeframe follow the account live (AccountPrefs.kt); the active list is synced by Watchlists.kt. */
class AppPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
    private val _theme = MutableStateFlow(ThemeMode.entries.firstOrNull { it.name == p.getString("theme", null) } ?: ThemeMode.SYSTEM)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()
    private val _tf = MutableStateFlow(Timeframe.entries.firstOrNull { it.name == p.getString("default_tf", null) } ?: Timeframe.M5)
    val defaultTf: StateFlow<Timeframe> = _tf.asStateFlow()

    /** Set by [AccountPrefsSync] while signed in: a change here goes to the account (users/{uid}/prefs/app). */
    var onChange: ((id: String, value: String) -> Unit)? = null

    fun setTheme(m: ThemeMode) {
        _theme.value = m; p.edit().putString("theme", m.name).apply()
        AccountPrefsCodec.themeValue(m)?.let { onChange?.invoke(AccountPrefsCodec.THEME, it) }   // "System" stays on this phone
    }
    fun setDefaultTf(t: Timeframe) { _tf.value = t; p.edit().putString("default_tf", t.name).apply(); onChange?.invoke(AccountPrefsCodec.MOBILE_TF, t.name) }
    fun hasDefaultTf(): Boolean = p.contains("default_tf")

    /** The native chart's price style (candles / bars / line / area). Account id "mobileChartStyle": every phone of the
     *  member shares it; the website stores it but has its own chart type per layout, so it ignores it. */
    private val _style = MutableStateFlow(p.getString("chart_style", null))
    val chartStyle: StateFlow<String?> = _style.asStateFlow()
    fun setChartStyle(name: String) { _style.value = name; p.edit().putString("chart_style", name).apply(); onChange?.invoke(AccountPrefsCodec.MOBILE_STYLE, name) }

    /** Like the site's stryker_wl_active_<uid>. */
    fun activeList(uid: String?): String? = p.getString("wl_active_${uid ?: "guest"}", null)
    fun setActiveList(uid: String?, id: String) = p.edit().putString("wl_active_${uid ?: "guest"}", id).apply()
}
