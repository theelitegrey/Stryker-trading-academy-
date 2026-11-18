package com.tradezoro.app.ui.chart

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color as AColor
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.zIndex
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import com.tradezoro.app.ui.theme.Tz
import com.tradezoro.app.data.ChartData
import com.tradezoro.app.data.FrameStore
import com.tradezoro.app.ui.common.TzIcons
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.tradezoro.app.data.CHART_ORIGIN
import com.tradezoro.app.data.CHART_URL
import com.tradezoro.app.data.jsString
import com.tradezoro.app.data.jobValue
import com.tradezoro.app.data.parseBridge
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * Owns the one chart WebView for the activity, so switching tabs does not reload the chart.
 * The page is the live https://tradezoro.com/charts; assets/chart-bridge.js is injected at document start.
 * No JavaScript interface is exposed to the page; the app only calls into it.
 */
class ChartWeb(private val appContext: Context) {
    private var view: WebView? = null
    private var themeDark: Boolean = true

    @SuppressLint("SetJavaScriptEnabled")
    fun get(context: Context, dark: Boolean): WebView = view ?: WebView(context).also { w ->
        themeDark = dark
        w.layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        w.setBackgroundColor(if (dark) AColor.rgb(10, 10, 11) else AColor.rgb(245, 245, 247))
        w.settings.apply {
            javaScriptEnabled = true          // the chart engine is JavaScript
            domStorageEnabled = true          // layouts, paper account, settings (as on the site)
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
        }
        val script = bridgeScript(dark)
        var docStart = false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, script, setOf(CHART_ORIGIN)); docStart = true
        }
        w.webViewClient = object : WebViewClient() {
            // Only the chart page stays inside the app; sign-in, plans and every other link open in the browser.
            override fun shouldOverrideUrlLoading(v: WebView, req: WebResourceRequest): Boolean {
                val u = req.url
                if (u.scheme == "https" && u.host == "tradezoro.com" && (u.path == "/charts" || u.path == "/charts.html")) return false
                runCatching { v.context.startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                return true
            }
            // Older WebViews without document-start scripts: inject when the page has loaded (the bridge is idempotent).
            override fun onPageFinished(v: WebView, url: String?) { if (!docStart) v.evaluateJavascript(script, null) }
        }
        w.loadUrl(CHART_URL)
        view = w
    }

    private fun bridgeScript(dark: Boolean): String =
        appContext.assets.open("chart-bridge.js").bufferedReader().use { it.readText() }.replace("%THEME%", if (dark) "night" else "day")

    fun call(js: String) { view?.evaluateJavascript("window.TZB&&$js", null) }
    fun reload() { view?.reload() }

    /** Reads TZB.state(); evaluateJavascript returns a JSON-encoded string literal (or "null"). */
    fun readState(onState: (com.tradezoro.app.data.BridgeState) -> Unit) {
        view?.evaluateJavascript("window.TZB?JSON.stringify(TZB.state()):null") { raw ->
            val inner = runCatching { (Json.parseToJsonElement(raw ?: "null") as? JsonPrimitive)?.jsonPrimitive?.contentOrNull }.getOrNull()
            inner?.let(::parseBridge)?.let(onState)
        }
    }

    /** Reads TZB.paper() (the Trade tab's snapshot of the site's paper account). */
    fun readPaper(onSnap: (com.tradezoro.app.data.PaperSnapshot) -> Unit) {
        view?.evaluateJavascript("window.TZB&&TZB.paper?JSON.stringify(TZB.paper()):null") { raw ->
            val inner = runCatching { (Json.parseToJsonElement(raw ?: "null") as? JsonPrimitive)?.jsonPrimitive?.contentOrNull }.getOrNull()
            inner?.let { com.tradezoro.app.data.parsePaper(it) }?.let(onSnap)
        }
    }

    /** Reads TZB.frame() (bars + indicator output for the native renderer) as raw JSON, or null. */
    fun readFrame(full: Boolean, onRaw: (String?) -> Unit) {
        val v = view ?: return onRaw(null)
        v.evaluateJavascript("window.TZB&&TZB.frame?JSON.stringify(TZB.frame($full)):null") { raw ->
            onRaw(runCatching { (Json.parseToJsonElement(raw ?: "null") as? JsonPrimitive)?.contentOrNull }.getOrNull())
        }
    }

    private var jobSeq = 0

    /**
     * Runs one of the page's async jobs (TZB.run: "find" = the site's symbol search, "quote" = bars through the chart's
     * own provider) and waits for its JSON answer. null = no page yet, page error, or no answer in [timeoutMs].
     */
    suspend fun job(kind: String, arg: String, timeoutMs: Long = 8000): String? = withContext(Dispatchers.Main) {
        val v = view ?: return@withContext null
        val key = "j${jobSeq++}"
        v.evaluateJavascript("window.TZB&&TZB.run(${jsString(key)},${jsString(kind)},${jsString(arg)})", null)
        val until = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < until) {
            delay(120)
            val raw = suspendCancellableCoroutine { k -> v.evaluateJavascript("window.TZB?TZB.take(${jsString(key)}):null") { k.resume(it) } }
            val inner = runCatching { (Json.parseToJsonElement(raw ?: "null") as? JsonPrimitive)?.contentOrNull }.getOrNull() ?: continue
            return@withContext jobValue(inner)
        }
        null
    }

    fun destroy() { view?.destroy(); view = null }
}

@Composable
fun ChartRoute(
    web: ChartWeb,
    vm: ChartViewModel,
    dark: Boolean,
    snack: SnackbarHostState,
    modifier: Modifier = Modifier,
    /** The active watchlist's symbols (site ids), for the symbol wheel. */
    symbols: List<String> = emptyList(),
    defaultTf: com.tradezoro.app.data.Timeframe? = null,
    onTrade: () -> Unit = {},
    onPaper: ((com.tradezoro.app.data.PaperSnapshot) -> Unit)? = null,
) {
    val state by vm.state.collectAsState()
    val pending by vm.pendingSymbol.collectAsState()
    var drawMenu by remember { mutableStateOf(false) }
    BackHandler(enabled = state.tool != null) { vm.setTool(null) }
    ChartPolling(web, vm, snack, onPaper)
    LaunchedEffect(state.ready, defaultTf) {
        if (state.ready && defaultTf != null && !vm.defaultTfApplied) {
            vm.defaultTfApplied = true
            if (state.tf != defaultTf) { vm.pickTf(defaultTf); web.call("TZB.setTf(${jsString(defaultTf.id)})") }
        }
    }
    // A symbol picked on Home is applied once the chart is ready.
    LaunchedEffect(pending, state.ready) {
        val p = pending ?: return@LaunchedEffect
        if (state.ready) { web.call("TZB.setSymbol(${jsString(p.first)},${jsString(p.second)})"); vm.clearPending() }
    }
    BackHandler(enabled = state.fullscreen) { vm.setFullscreen(false) }

    val actions = ChartActions(
        onSymbol = { web.call("TZB.search()") },
        onTf = { t -> vm.pickTf(t); web.call("TZB.setTf(${jsString(t.id)})") },
        onIndicators = { web.call("TZB.indicators()") },
        onDrawings = { web.call("TZB.drawings()") },
        onAlerts = { web.call("TZB.alerts()") },
        onSell = { web.call("TZB.paperOrder('sell',${state.qty})") },
        onBuy = { web.call("TZB.paperOrder('buy',${state.qty})") },
        onDec = vm::dec, onInc = vm::inc,
        onPaperOn = { web.call("TZB.paperOn()") },
        onExitFullscreen = { vm.setFullscreen(false) },
        onPickSymbol = { id -> web.call("TZB.setSymbol(${jsString(id)},${jsString(com.tradezoro.app.data.symbolOf(id).chartTicker)})") },
        onTrade = onTrade,
    )
    ChartContent(state, actions.copy(onDrawings = { if (state.classic) web.call("TZB.drawings()") else drawMenu = true }), modifier, symbols) { m ->
        if (state.classic) ChartHost(web, dark, visible = true, modifier = m)
        else Box(m) {
            NativeChartHost(web, state, vm, dark, Modifier.fillMaxSize())
            DrawMenu(drawMenu, onDismiss = { drawMenu = false }, onPick = { t -> drawMenu = false; vm.setTool(t) },
                onClear = { drawMenu = false; web.call("TZB.clearDrawings()") },
                onMore = { drawMenu = false; vm.setClassic(true); web.call("TZB.drawings()") })
        }
    }
}

/**
 * The native chart (M5) over the chart page. The page stays loaded underneath as the data and indicator engine
 * (the site's own JavaScript); the app reads TZB.frame() 4x a second and draws it. When one of the site's sheets is
 * open (indicators, symbol search, alerts), the page is shown on top so the member can use it.
 */
@Composable
fun NativeChartHost(web: ChartWeb, state: ChartUiState, vm: ChartViewModel, dark: Boolean, modifier: Modifier = Modifier) {
    val store = remember { FrameStore() }
    var data by remember { mutableStateOf<ChartData?>(null) }
    var modal by remember { mutableStateOf(false) }
    val vp = remember { ChartViewport() }
    var lastPage by remember { mutableLongStateOf(0L) }
    LaunchedEffect(web) {
        while (true) {
            val raw = suspendCancellableCoroutine { k -> web.readFrame(store.needFull) { k.resume(it) } }
            if (raw != null) {
                val d = withContext(Dispatchers.Default) { store.apply(raw) }
                modal = store.modal
                if (d !== data) data = d
            }
            delay(if (raw != null && raw.length > 50_000) 400 else 250)
        }
    }
    Box(modifier) {
        // The page: invisible and untouchable under the native chart, shown on top while one of its sheets is open.
        ChartHost(web, dark, visible = modal, modifier = Modifier.fillMaxSize())
        val skipped = data?.drawings?.count { it.type !in NATIVE_DRAWINGS } ?: 0
        if (!modal && skipped > 0) Text(
            if (skipped == 1) "1 drawing shows in the classic chart only" else "$skipped drawings show in the classic chart only",
            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted,
            modifier = Modifier.align(Alignment.TopStart).padding(start = 8.dp, top = 8.dp).zIndex(1f)
                .clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.background.copy(alpha = 0.8f)).padding(horizontal = 4.dp),
        )
        if (!modal) NativeChart(
            data, vp, state.priceStyle, Modifier.fillMaxSize(), tool = state.tool,
            onDrawn = { t, pts ->
                vm.setTool(null)
                web.call("TZB.addDrawing(${jsString(t.type)},[" + pts.joinToString(",") { (tm, p) -> "{time:$tm,price:${if (p.isFinite()) p else 0.0}}" } + "])")
            },
            onNeedHistory = { val now = System.currentTimeMillis(); if (now - lastPage > 4000) { lastPage = now; web.call("TZB.page()") } },
        )
    }
}

/** Drawing types the native renderer draws (ChartPainter.drawing); others are skipped with a note. */
val NATIVE_DRAWINGS = setOf("trendline", "arrow", "infoline", "trendangle", "ray", "extendedline", "hline", "hray", "vline", "box", "rectangle", "fibretracement", "parallelchannel")

/** Native drawing tools; the site's full set stays one tap away in the classic chart. */
@Composable
fun DrawMenu(open: Boolean, onDismiss: () -> Unit, onPick: (DrawTool) -> Unit, onClear: () -> Unit, onMore: () -> Unit) {
    Box(Modifier.fillMaxWidth().wrapContentSize(Alignment.TopEnd)) {
        DropdownMenu(expanded = open, onDismissRequest = onDismiss) {
            DrawTool.entries.forEach { t -> DropdownMenuItem(text = { Text(t.label) }, onClick = { onPick(t) }) }
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Clear all drawings") }, onClick = onClear)
            DropdownMenuItem(text = { Text("More tools (classic chart)") }, onClick = onMore)
        }
    }
}

/**
 * Hosts the one chart WebView. The Trade tab hosts it too, transparent behind its native content: the paper engine
 * keeps running on the chart's price stream (its timers keep going), while the view takes no touches and is
 * hidden from TalkBack.
 */
@SuppressLint("ClickableViewAccessibility")  // the hidden host only swallows touches; it is also hidden from TalkBack
@Composable
fun ChartHost(web: ChartWeb, dark: Boolean, visible: Boolean, modifier: Modifier = Modifier) {
    AndroidView(
        factory = { c -> web.get(c, dark).also { (it.parent as? ViewGroup)?.removeView(it) } },
        update = { v ->
            // Alpha, not INVISIBLE: an invisible WebView reports document.hidden and the page throttles its timers.
            v.alpha = if (visible) 1f else 0f
            if (visible) v.setOnTouchListener(null) else v.setOnTouchListener { _, _ -> true }
            v.importantForAccessibility = if (visible) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        },
        modifier = modifier,
    )
}

/** New key in M7: the classic chart became the default, so an M5/M6 choice of the native chart starts over. */
const val CLASSIC_KEY = "chart_classic_m7"

/** Polls the chart page once a second while a chart-backed screen (Charts or Trade) is shown; engine toasts -> snackbars. */
@Composable
fun ChartPolling(web: ChartWeb, vm: ChartViewModel, snack: SnackbarHostState, onPaper: ((com.tradezoro.app.data.PaperSnapshot) -> Unit)? = null) {
    val messages by vm.messages.collectAsState()
    LaunchedEffect(web, onPaper) { while (true) { web.readState(vm::onBridge); onPaper?.let(web::readPaper); delay(1000) } }
    LaunchedEffect(messages) { messages.firstOrNull()?.let { snack.showSnackbar(it); vm.consumeMessage() } }
}

/** The chart's top bar (lives in the app Scaffold) with its overflow menu. */
@Composable
fun ChartTopBarHost(web: ChartWeb, vm: ChartViewModel, onBack: () -> Unit, appPrefs: com.tradezoro.app.data.AppPrefs? = null) {
    val ctx = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    val prefs = remember { ctx.getSharedPreferences("chart", Context.MODE_PRIVATE) }
    LaunchedEffect(Unit) {
        vm.setClassic(prefs.getBoolean(CLASSIC_KEY, true))   // Owner 17 Nov: the classic chart (as the site opens) is the default
        val old = prefs.getString("chart_style", null)
        if (appPrefs != null && appPrefs.chartStyle.value == null && old != null) appPrefs.setChartStyle(old)   // M7 per-phone value -> account
        if (appPrefs == null) old?.let { n -> PriceStyle.entries.firstOrNull { it.name == n } }?.let(vm::setPriceStyle)
    }
    // one account: the price style follows the member's account live (another phone changed it)
    if (appPrefs != null) {
        val acctStyle by appPrefs.chartStyle.collectAsState()
        LaunchedEffect(acctStyle) { acctStyle?.let { n -> PriceStyle.entries.firstOrNull { it.name == n } }?.let(vm::setPriceStyle) }
    }
    val top by vm.state.collectAsState()
    ChartTopBar(onBack = onBack, onFullscreen = { vm.setFullscreen(true) }, onMore = { menu = true }, onAlerts = { web.call("TZB.alerts()") },
        state = top, onSymbol = { web.call("TZB.search()") }) {
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            val st by vm.state.collectAsState()
            if (!st.classic) PriceStyle.entries.forEach { ps ->
                DropdownMenuItem(text = { Text(ps.label) }, onClick = { menu = false; vm.setPriceStyle(ps); prefs.edit().putString("chart_style", ps.name).apply(); appPrefs?.setChartStyle(ps.name) },
                    trailingIcon = { if (st.priceStyle == ps) Icon(TzIcons.Check, contentDescription = "Selected") })
            }
            if (!st.classic) HorizontalDivider()
            DropdownMenuItem(text = { Text("Classic chart") }, onClick = { menu = false; vm.setClassic(!st.classic); prefs.edit().putBoolean(CLASSIC_KEY, !st.classic).apply() },
                trailingIcon = { if (st.classic) Icon(TzIcons.Check, contentDescription = "On") })
            HorizontalDivider()
            // Saved on the member's account by the site's own code: the same on the website and every phone.
            DropdownMenuItem(text = { Text("Layouts") }, onClick = { menu = false; web.call("TZB.layouts()") })
            DropdownMenuItem(text = { Text("Indicator templates") }, onClick = { menu = false; web.call("TZB.templates()") })
            DropdownMenuItem(text = { Text("Workspaces") }, onClick = { menu = false; web.call("TZB.workspaces()") })
            HorizontalDivider()
            DropdownMenuItem(text = { Text("Reload chart") }, onClick = { menu = false; web.reload() })
            DropdownMenuItem(text = { Text("Open on tradezoro.com") }, onClick = {
                menu = false; ctx.startActivity(Intent(Intent.ACTION_VIEW, CHART_URL.toUri()))
            })
        }
    }
}
