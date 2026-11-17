package com.tradezoro.app.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class ThemeMode(val label: String) { SYSTEM("System"), DARK("Dark"), LIGHT("Light") }

/** App settings (Account sheet): theme, default chart timeframe, the active watchlist per member. This device only. */
class AppPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
    private val _theme = MutableStateFlow(ThemeMode.entries.firstOrNull { it.name == p.getString("theme", null) } ?: ThemeMode.SYSTEM)
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()
    private val _tf = MutableStateFlow(Timeframe.entries.firstOrNull { it.name == p.getString("default_tf", null) } ?: Timeframe.M5)
    val defaultTf: StateFlow<Timeframe> = _tf.asStateFlow()

    fun setTheme(m: ThemeMode) { _theme.value = m; p.edit().putString("theme", m.name).apply() }
    fun setDefaultTf(t: Timeframe) { _tf.value = t; p.edit().putString("default_tf", t.name).apply() }

    /** Like the site's stryker_wl_active_<uid>. */
    fun activeList(uid: String?): String? = p.getString("wl_active_${uid ?: "guest"}", null)
    fun setActiveList(uid: String?, id: String) = p.edit().putString("wl_active_${uid ?: "guest"}", id).apply()
}
