package com.tradezoro.app

import android.content.Intent
import androidx.core.net.toUri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.tradezoro.app.auth.AuthRepository
import com.tradezoro.app.auth.TzUser
import com.tradezoro.app.auth.googleIdToken
import com.tradezoro.app.data.dayPart
import com.tradezoro.app.data.isFuturesMarketOpen
import com.tradezoro.app.ui.auth.SignInContent
import com.tradezoro.app.ui.auth.SignInViewModel
import androidx.compose.foundation.isSystemInDarkTheme
import com.tradezoro.app.data.WatchSymbol
import com.tradezoro.app.data.chartIdFor
import com.tradezoro.app.ui.chart.ChartRoute
import com.tradezoro.app.ui.chart.ChartTopBarHost
import com.tradezoro.app.ui.chart.ChartViewModel
import com.tradezoro.app.ui.chart.ChartWeb
import com.tradezoro.app.ui.home.HomeContent
import com.tradezoro.app.ui.home.RowState
import com.tradezoro.app.ui.home.HomeViewModel
import com.tradezoro.app.ui.home.Product
import com.tradezoro.app.ui.nav.ComingSoon
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TabTopBar
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.TradeZoroTheme
import com.tradezoro.app.ui.theme.Tz
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import android.Manifest
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import com.tradezoro.app.data.jsString
import com.tradezoro.app.push.EXTRA_LINK
import com.tradezoro.app.push.PushTokens
import com.tradezoro.app.ui.alerts.AlertsActions
import com.tradezoro.app.ui.alerts.AlertsContent
import com.tradezoro.app.ui.alerts.AlertsTopBar
import com.tradezoro.app.ui.alerts.AlertsViewModel
import com.tradezoro.app.ui.chart.ChartHost
import com.tradezoro.app.ui.chart.ChartPolling
import com.tradezoro.app.ui.nav.MenuTopBar
import com.tradezoro.app.ui.trade.TradeActions
import com.tradezoro.app.ui.trade.TradeContent
import com.tradezoro.app.ui.trade.TradeViewModel
import java.time.Instant
import java.time.LocalTime

class MainActivity : ComponentActivity() {
    private lateinit var chartWeb: ChartWeb
    /** Link from a tapped push notification, consumed by TzRoot. */
    private val pushLink = MutableStateFlow<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val auth = AuthRepository(applicationContext)
        chartWeb = ChartWeb(applicationContext)
        pushLink.value = intent?.getStringExtra(EXTRA_LINK)
        setContent { TradeZoroTheme { TzRoot(auth, chartWeb, pushLink) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_LINK)?.let { pushLink.value = it }
    }

    override fun onDestroy() { chartWeb.destroy(); super.onDestroy() }
}

private const val SIGN_IN = "signin"
private const val ALERTS = "alerts"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TzRoot(auth: AuthRepository, chartWeb: ChartWeb, pushLink: MutableStateFlow<String?> = MutableStateFlow(null)) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val user by auth.user.collectAsState(initial = null)
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var accountOpen by rememberSaveable { mutableStateOf(false) }
    var confirmFlatten by remember { mutableStateOf(false) }
    val tab = Tab.entries.firstOrNull { it.route == route }
    val chartVm: ChartViewModel = viewModel()
    val chartState by chartVm.state.collectAsState()
    val dark = isSystemInDarkTheme()
    val ctx = LocalContext.current
    val tradeVm: TradeViewModel = viewModel()
    val alertsVm: AlertsViewModel = viewModel()
    var pushOn by remember { mutableStateOf(PushTokens.canNotify(ctx)) }
    val askPush = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pushOn = ok
        if (ok) scope.launch { runCatching { PushTokens.sync(ctx) } }
    }
    // Signed in: register this phone for the member's pushes (pushTokens, same as the site) and load their alerts.
    LaunchedEffect(user?.uid) {
        alertsVm.setUser(user?.uid)
        if (user != null && PushTokens.canNotify(ctx)) runCatching { PushTokens.sync(ctx) }
    }
    val goTab: (Tab) -> Unit = { t ->
        nav.navigate(t.route) {
            popUpTo(nav.graph.findStartDestination().id) { saveState = true }
            launchSingleTop = true; restoreState = true
        }
    }
    val chartFull = tab == Tab.CHARTS && chartState.fullscreen
    // Open the chart page's own alert form (new alerts are made on the chart, as on the site).
    val newAlert: () -> Unit = { goTab(Tab.CHARTS); chartWeb.call("TZB.alerts()") }
    // Tapped push: chart links open the Charts tab on that symbol; anything else opens on the website.
    val link by pushLink.collectAsState()
    LaunchedEffect(link) {
        val l = link ?: return@LaunchedEffect
        pushLink.value = null
        val sym = Regex("^/charts(?:\\.html)?\\?symbol=([A-Za-z0-9_:!.\\-]{1,40})").find(l)?.groupValues?.get(1)
        when {
            sym != null -> { chartVm.openSymbol(sym, sym, null); goTab(Tab.CHARTS) }
            l.startsWith("/charts") -> goTab(Tab.CHARTS)
            else -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://tradezoro.com$l".toUri())) }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            when (tab) {
                Tab.HOME -> HomeTopBar(onMenu = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                Tab.CHARTS -> if (!chartFull) ChartTopBarHost(chartWeb, chartVm, onBack = { goTab(Tab.HOME) })
                Tab.TRADE -> MenuTopBar("Trade", onMenu = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                null -> if (route == ALERTS) AlertsTopBar(onBack = { nav.popBackStack() }, onNew = newAlert)
                else -> TabTopBar(tab.label)
            }
        },
        bottomBar = {
            if (tab != null && !chartFull) TzBottomBar(tab, goTab)
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        NavHost(nav, startDestination = Tab.HOME.route, modifier = Modifier.padding(pad)) {
            composable(Tab.HOME.route) {
                HomeRoute(user, onSnack = { m -> scope.launch { snack.showSnackbar(m) } }, onSymbol = { sym, pct ->
                    chartVm.openSymbol(chartIdFor(sym), sym.ticker, pct); goTab(Tab.CHARTS)
                })
            }
            composable(Tab.CHARTS.route) { ChartRoute(chartWeb, chartVm, dark, snack) }
            composable(Tab.TRADE.route) {
                val ts by tradeVm.state.collectAsState()
                ChartPolling(chartWeb, chartVm, snack, onPaper = tradeVm::onSnapshot)
                Box(Modifier.fillMaxSize()) {
                    // The paper engine lives in the chart page: keep it attached (transparent, untouchable) under the native screen.
                    ChartHost(chartWeb, dark, visible = false, modifier = Modifier.fillMaxSize())
                    TradeContent(ts, TradeActions(
                        onType = tradeVm::setType, onPrice = tradeVm::setPriceText, onPriceStep = tradeVm::stepPrice,
                        onQty = tradeVm::stepQty, onBracket = tradeVm::stepBracket,
                        onBuy = { tradeVm.orderCall("buy")?.let(chartWeb::call) },
                        onSell = { tradeVm.orderCall("sell")?.let(chartWeb::call) },
                        onFlatten = { confirmFlatten = true },
                        onPaperOn = { chartWeb.call("TZB.paperOn()") },
                        onClose = { sym -> chartWeb.call("TZB.close(${jsString(sym)})") },
                        onCancel = { id -> chartWeb.call("TZB.cancel($id)") },
                        onSymbol = { goTab(Tab.CHARTS); chartWeb.call("TZB.search()") },
                    ), Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
                }
            }
            composable(Tab.LEARN.route) { ComingSoon(Tab.LEARN, "a later update", "/courses") }
            composable(Tab.JOURNAL.route) { ComingSoon(Tab.JOURNAL, "a later update", "/journal") }
            composable(SIGN_IN) { SignInRoute(auth, onClose = { nav.popBackStack() }) }
            composable(ALERTS) {
                val st by alertsVm.state.collectAsState()
                val err: (String) -> Unit = { m -> scope.launch { snack.showSnackbar(m) } }
                AlertsContent(st, pushOn, AlertsActions(
                    onNew = newAlert,
                    onToggle = { a, on -> alertsVm.toggle(a, on, err) },
                    onDelete = { a -> alertsVm.delete(a, err) },
                    onAllowPush = {
                        if (Build.VERSION.SDK_INT >= 33) askPush.launch(Manifest.permission.POST_NOTIFICATIONS)
                        else ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
                    },
                    onTestPush = { alertsVm.test(err) },
                    onSignIn = { nav.navigate(SIGN_IN) },
                ))
            }
        }
    }

    if (accountOpen) {
        ModalBottomSheet(onDismissRequest = { accountOpen = false }, containerColor = MaterialTheme.colorScheme.surface) {
            AccountSheet(user, auth.available,
                onSignIn = { accountOpen = false; nav.navigate(SIGN_IN) },
                onSignOut = { accountOpen = false; scope.launch { runCatching { PushTokens.forget(ctx) }; auth.signOut() } })
        }
    }
    if (confirmFlatten) {
        AlertDialog(
            onDismissRequest = { confirmFlatten = false },
            title = { Text("Flatten all?") },
            text = { Text("Close every paper position and cancel every working paper order?") },
            confirmButton = { TextButton(onClick = { confirmFlatten = false; chartWeb.call("TZB.flatten()") }) { Text("Flatten all") } },
            dismissButton = { TextButton(onClick = { confirmFlatten = false }) { Text("Keep") } },
        )
    }
}

@Composable
private fun HomeRoute(user: TzUser?, onSnack: (String) -> Unit, onSymbol: (WatchSymbol, Double?) -> Unit, vm: HomeViewModel = viewModel()) {
    val state by vm.state.collectAsState()
    val owner = LocalLifecycleOwner.current
    // Poll only while Home is on screen (like the site pauses on a hidden tab).
    DisposableEffect(owner) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_START) vm.start() else if (e == Lifecycle.Event.ON_STOP) vm.stop() }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs); vm.stop() }
    }
    HomeContent(
        state = state,
        firstName = user?.displayName?.substringBefore(' ')?.takeIf { it.isNotBlank() },
        dayPart = dayPart(LocalTime.now().hour),
        marketOpen = isFuturesMarketOpen(Instant.now()),
        onProduct = { p: Product -> onSnack("${p.title} arrives in a later update.") },
        onSymbol = { t ->
            val row = state.rows.firstOrNull { it.symbol.ticker == t }
            val q = when (val r = row?.state) { is RowState.Ready -> r.quote; is RowState.Failed -> r.stale; else -> null }
            row?.let { onSymbol(it.symbol, q?.changePct) }
        },
    )
}

@Composable
private fun SignInRoute(auth: AuthRepository, onClose: () -> Unit) {
    val ctx = LocalContext.current
    val vm: SignInViewModel = viewModel { SignInViewModel(auth::signInEmail, auth::sendReset) }
    val form by vm.form.collectAsState()
    val scope = rememberCoroutineScope()
    SignInContent(
        form, auth.available,
        onEmail = vm::email, onPassword = vm::password,
        onSubmit = { vm.submit(onClose) },
        onGoogle = {
            vm.busy(true)
            scope.launch {
                try {
                    val token = googleIdToken(ctx)
                    if (token == null) vm.busy(false) else { auth.signInGoogle(token); vm.busy(false); onClose() }
                } catch (e: Exception) { vm.googleFailed(SignInViewModel.errorText(e)) }
            }
        },
        onForgot = vm::forgot,
        onCreate = { ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://tradezoro.com/signup".toUri())) },
        onClose = onClose,
    )
}

@Composable
private fun AccountSheet(user: TzUser?, available: Boolean, onSignIn: () -> Unit, onSignOut: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Account", style = MaterialTheme.typography.titleLarge)
        if (user == null) {
            Text("Sign in to sync your watchlist, journal and courses with the website.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
            Button(onClick = onSignIn, enabled = available, shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Sign in") }
        } else {
            Column {
                Text(user.displayName ?: "Signed in", style = MaterialTheme.typography.titleMedium)
                Text(user.email ?: "", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
            }
            OutlinedButton(onClick = onSignOut, shape = RoundedCornerShape(24.dp), modifier = Modifier.fillMaxWidth().height(48.dp)) {
                Text("Sign out", color = MaterialTheme.colorScheme.onSurface)
            }
        }
        Text("Education only. Not financial advice.", style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted)
    }
}

