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
import androidx.compose.material3.DropdownMenu
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

    fun destroy() { view?.destroy(); view = null }
}

@Composable
fun ChartRoute(
    web: ChartWeb,
    vm: ChartViewModel,
    dark: Boolean,
    snack: SnackbarHostState,
    modifier: Modifier = Modifier,
) {
    val state by vm.state.collectAsState()
    val pending by vm.pendingSymbol.collectAsState()
    ChartPolling(web, vm, snack)
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
    )
    ChartContent(state, actions, modifier) { m -> ChartHost(web, dark, visible = true, modifier = m) }
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

/** Polls the chart page once a second while a chart-backed screen (Charts or Trade) is shown; engine toasts -> snackbars. */
@Composable
fun ChartPolling(web: ChartWeb, vm: ChartViewModel, snack: SnackbarHostState, onPaper: ((com.tradezoro.app.data.PaperSnapshot) -> Unit)? = null) {
    val messages by vm.messages.collectAsState()
    LaunchedEffect(web, onPaper) { while (true) { web.readState(vm::onBridge); onPaper?.let(web::readPaper); delay(1000) } }
    LaunchedEffect(messages) { messages.firstOrNull()?.let { snack.showSnackbar(it); vm.consumeMessage() } }
}

/** The chart's top bar (lives in the app Scaffold) with its overflow menu. */
@Composable
fun ChartTopBarHost(web: ChartWeb, vm: ChartViewModel, onBack: () -> Unit) {
    val ctx = LocalContext.current
    var menu by remember { mutableStateOf(false) }
    ChartTopBar(onBack = onBack, onFullscreen = { vm.setFullscreen(true) }, onMore = { menu = true }, onAlerts = { web.call("TZB.alerts()") }) {
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("Reload chart") }, onClick = { menu = false; web.reload() })
            DropdownMenuItem(text = { Text("Open on tradezoro.com") }, onClick = {
                menu = false; ctx.startActivity(Intent(Intent.ACTION_VIEW, CHART_URL.toUri()))
            })
        }
    }
}
