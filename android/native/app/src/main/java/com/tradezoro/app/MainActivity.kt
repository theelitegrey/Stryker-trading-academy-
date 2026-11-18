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
import com.tradezoro.app.ui.common.TopNotes
import com.tradezoro.app.ui.common.TopNotesHost
import com.tradezoro.app.auth.AuthRepository
import com.tradezoro.app.auth.TzUser
import com.tradezoro.app.auth.ChartAuthLink
import com.tradezoro.app.auth.silentGoogleIdToken
import com.tradezoro.app.auth.PasskeyClient
import com.tradezoro.app.data.AccountPrefsSync
import com.tradezoro.app.data.AppPrefs
import com.tradezoro.app.data.ThemeMode
import com.tradezoro.app.data.DataAccess
import com.tradezoro.app.data.DataAccessRepository
import com.tradezoro.app.data.HttpQuoteRepository
import com.tradezoro.app.data.PageQuoteRepository
import com.tradezoro.app.data.parseFind
import com.tradezoro.app.data.LiveFeed
import com.tradezoro.app.data.homeDataNote
import com.tradezoro.app.data.liveWanted
import com.tradezoro.app.data.watchStoreFor
import com.tradezoro.app.ui.account.AccountActions
import com.tradezoro.app.ui.account.AccountContent
import com.tradezoro.app.ui.home.AddSymbolContent
import com.tradezoro.app.ui.home.WatchActions
import com.tradezoro.app.ui.nav.Avatar
import com.tradezoro.app.ui.trade.TradeSheetContent
import androidx.compose.ui.graphics.asImageBitmap
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
import com.tradezoro.app.ui.m4.AddTradeForm
import com.tradezoro.app.ui.m4.BackTopBar
import com.tradezoro.app.ui.m4.JournalActions
import com.tradezoro.app.ui.m4.JournalContent
import com.tradezoro.app.ui.m4.JournalViewModel
import com.tradezoro.app.ui.m4.LearnActions
import com.tradezoro.app.ui.m4.LearnContent
import com.tradezoro.app.ui.m4.LearnViewModel
import com.tradezoro.app.ui.m4.NewTrade
import com.tradezoro.app.ui.m4.OmegaActions
import com.tradezoro.app.ui.m4.OmegaContent
import com.tradezoro.app.ui.m4.OmegaViewModel
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TabTopBar
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.TradeZoroTheme
import com.tradezoro.app.ui.theme.Tz
import kotlinx.coroutines.delay
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
        val prefs = AppPrefs(applicationContext)
        chartWeb = ChartWeb(applicationContext)
        pushLink.value = intent?.getStringExtra(EXTRA_LINK)
        setContent {
            val mode by prefs.theme.collectAsState()
            val dark = when (mode) { ThemeMode.DARK -> true; ThemeMode.LIGHT -> false; ThemeMode.SYSTEM -> isSystemInDarkTheme() }
            TradeZoroTheme(dark) { TzRoot(auth, chartWeb, pushLink, prefs, dark) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_LINK)?.let { pushLink.value = it }
    }

    override fun onDestroy() { chartWeb.destroy(); super.onDestroy() }
}

private const val SIGN_IN = "signin"
private const val ALERTS = "alerts"
private const val OMEGA = "omega"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TzRoot(
    auth: AuthRepository, chartWeb: ChartWeb, pushLink: MutableStateFlow<String?> = MutableStateFlow(null),
    prefs: AppPrefs = AppPrefs(LocalContext.current), dark: Boolean = isSystemInDarkTheme(),
) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val user by auth.user.collectAsState(initial = null)
    val snack = remember { TopNotes() }
    val scope = rememberCoroutineScope()
    var accountOpen by rememberSaveable { mutableStateOf(false) }
    var confirmFlatten by remember { mutableStateOf(false) }
    val ctx = LocalContext.current
    val tab = Tab.entries.firstOrNull { it.route == route }
    // Omega lives under Charts in the mock (back arrow, Charts highlighted).
    val navTab = tab ?: if (route == OMEGA) Tab.CHARTS else null
    val learnVm: LearnViewModel = viewModel()
    val journalVm: JournalViewModel = viewModel()
    val omegaVm: OmegaViewModel = viewModel()
    var addTrade by remember { mutableStateOf<NewTrade?>(null) }
    var addBusy by remember { mutableStateOf(false) }
    var addError by remember { mutableStateOf<String?>(null) }
    val openWeb: (String) -> Unit = { path -> runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://tradezoro.com$path".toUri())) } }
    val chartVm: ChartViewModel = viewModel()
    val chartState by chartVm.state.collectAsState()
    val tradeVm: TradeViewModel = viewModel()
    // Futures / forex / indices / main crypto: direct sources; anything else (stocks, other venues): the chart page's own provider.
    val homeVm: HomeViewModel = viewModel { HomeViewModel(PageQuoteRepository(HttpQuoteRepository(token = DataAccessRepository()::idToken), chartWeb::job)) }
    val homeState by homeVm.state.collectAsState()
    val defaultTf by prefs.defaultTf.collectAsState()
    val themeMode by prefs.theme.collectAsState()
    var tradeOpen by rememberSaveable { mutableStateOf(false) }
    var addOpen by rememberSaveable { mutableStateOf(false) }
    var data by remember { mutableStateOf(DataAccess()) }
    val dataRepo = remember { DataAccessRepository() }
    val avatar = rememberAvatar(user)
    val alertsVm: AlertsViewModel = viewModel()
    var pushOn by remember { mutableStateOf(PushTokens.canNotify(ctx)) }
    val askPush = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        pushOn = ok
        if (ok) scope.launch { runCatching { PushTokens.sync(ctx) } }
    }
    // Signed in: register this phone for the member's pushes (pushTokens, same as the site) and load their alerts.
    // One account everywhere: theme + default timeframe follow the member's account live (same doc as the website).
    val acctPrefs = remember(prefs) { runCatching { AccountPrefsSync(prefs) }.getOrNull() }
    DisposableEffect(acctPrefs) { onDispose { acctPrefs?.stop() } }
    LaunchedEffect(user?.uid) {
        runCatching { acctPrefs?.start(user?.uid) }
        alertsVm.setUser(user?.uid)
        learnVm.setUser(user?.uid)
        journalVm.setUser(user?.uid)
        if (route == OMEGA) scope.launch { omegaVm.refresh() }
        if (user != null && PushTokens.canNotify(ctx)) runCatching { PushTokens.sync(ctx) }
        // Watchlists: the member's account lists (shared with the website), or this phone's when signed out.
        homeVm.bind(watchStoreFor(ctx), user != null, prefs.activeList(user?.uid)) { id -> prefs.setActiveList(user?.uid, id) }
        data = DataAccess(signedIn = user != null)
        data = runCatching { dataRepo.load() }.getOrDefault(DataAccess(signedIn = user != null))
        // An unanswered data-access check (offline, server blip) is asked again, never left as "delayed" (as rt-access.js).
        var wait = 3000L
        while (user != null && data.current == null && wait <= 60_000L) {
            delay(wait); wait *= 2
            data = runCatching { dataRepo.load() }.getOrDefault(data)
        }
    }
    // Keep the chart page signed in as the same member (data access, layouts, paper account): Owner bug 17 Nov.
    var relinkTried by remember(user?.uid) { mutableStateOf(false) }
    LaunchedEffect(user?.uid, chartState.ready, chartState.pageUid) {
        val u = user
        if (!chartState.ready) return@LaunchedEffect
        if (u == null && chartState.pageUid.isNotEmpty()) chartWeb.call("TZB.signOut()")
        else if (u != null && chartState.pageUid != u.uid) {
            // Owner bug 17 Nov (round 2): the link only works within 10 min of a sign-in, so a member signed in earlier
            // kept a signed-out chart page = delayed chart. Re-check a Google member silently, then link; otherwise ask once.
            var t = ChartAuthLink().customToken()
            if (t == null && !relinkTried) {
                relinkTried = true
                if (auth.isGoogle) silentGoogleIdToken(ctx)?.let { g -> runCatching { auth.signInGoogle(g) }.onSuccess { t = ChartAuthLink().customToken() } }
                if (t == null) snack.show("Sign in again to make the chart live on this phone.")
            }
            t?.let { chartWeb.call("TZB.signIn(${jsString(it)})") }
        }
    }
    LaunchedEffect(homeVm) { homeVm.notes.collect { n -> if (n != null) { snack.show(n); homeVm.consumeNote() } } }
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
                Tab.HOME -> HomeTopBar(avatar, onAccount = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                Tab.CHARTS -> if (!chartFull) ChartTopBarHost(chartWeb, chartVm, onBack = { goTab(Tab.HOME) }, appPrefs = prefs)
                Tab.TRADE -> MenuTopBar("Trade", avatar, onAccount = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                Tab.LEARN -> MenuTopBar("Mentis", avatar, onAccount = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                Tab.JOURNAL -> MenuTopBar("Nemesis", avatar, onAccount = { accountOpen = true }, onBell = { nav.navigate(ALERTS) })
                null -> if (route == ALERTS) AlertsTopBar(onBack = { nav.popBackStack() }, onNew = newAlert)
                    else if (route == OMEGA) BackTopBar("Omega", onBack = { nav.popBackStack() }, onBell = { nav.navigate(ALERTS) })
                else -> TabTopBar(tab.label)
            }
        },
        bottomBar = {
            if (navTab != null && !chartFull) TzBottomBar(navTab, goTab)
        },
    ) { pad ->
        Box(Modifier.padding(pad)) {
        NavHost(nav, startDestination = Tab.HOME.route, modifier = Modifier) {
            composable(Tab.HOME.route) {
                // The chart page stays loaded (invisible, untouchable) under Home: the site's symbol search and quotes run
                // in it, and the chart is warm when a row is tapped.
                Box(Modifier.fillMaxSize()) {
                    ChartHost(chartWeb, dark, visible = false, modifier = Modifier.fillMaxSize())
                    // Reads the page's state, so the page is signed in as this member (live chart) before Charts opens.
                    ChartPolling(chartWeb, chartVm, snack)
                    HomeRoute(user, homeVm, data, onAdd = { addOpen = true }, onProduct = { p ->
                        when (p) {
                            Product.KRONOS -> openWeb("/replay.html")
                            Product.OMEGA -> nav.navigate(OMEGA) { launchSingleTop = true }
                            Product.MENTIS -> goTab(Tab.LEARN)
                            Product.NEMESIS -> goTab(Tab.JOURNAL)
                        }
                    }, onSymbol = { sym, pct ->
                        chartVm.openSymbol(chartIdFor(sym), sym.chartTicker, pct); goTab(Tab.CHARTS)
                    })
                }
            }
            composable(Tab.CHARTS.route) {
                ChartRoute(chartWeb, chartVm, dark, snack, symbols = homeState.active?.symbols.orEmpty(), defaultTf = defaultTf,
                    onTrade = { tradeOpen = true }, onPaper = tradeVm::onSnapshot)
            }
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
                        onTab = tradeVm::setTab,
                        onScalpBuy = { tradeVm.scalpCall("buy")?.let(chartWeb::call) },
                        onScalpSell = { tradeVm.scalpCall("sell")?.let(chartWeb::call) },
                        onDom = { side, price -> tradeVm.domCall(side, price)?.let(chartWeb::call) },
                    ), Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
                }
            }
            composable(Tab.LEARN.route) {
                val st by learnVm.state.collectAsState()
                LearnContent(st, LearnActions(onChapter = { c -> openWeb("/chapter.html?ch=${c.num}") }, onSignIn = { nav.navigate(SIGN_IN) }))
            }
            composable(Tab.JOURNAL.route) {
                val st by journalVm.state.collectAsState()
                val month by journalVm.month.collectAsState()
                JournalContent(st, month, java.time.LocalDate.now(), JournalActions(
                    onMonth = journalVm::shiftMonth, onAdd = { addError = null; addTrade = NewTrade() },
                    onSignIn = { nav.navigate(SIGN_IN) }, onWeb = { openWeb("/trade-journal.html") },
                ))
            }
            composable(OMEGA) {
                val st by omegaVm.state.collectAsState()
                val owner = LocalLifecycleOwner.current
                DisposableEffect(owner) {
                    val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_START) omegaVm.start() else if (e == Lifecycle.Event.ON_STOP) omegaVm.stop() }
                    owner.lifecycle.addObserver(obs)
                    onDispose { owner.lifecycle.removeObserver(obs); omegaVm.stop() }
                }
                // Re-render the "GEX updated N min ago" text every 30 s between polls.
                var now by remember { androidx.compose.runtime.mutableLongStateOf(System.currentTimeMillis()) }
                LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(30_000); now = System.currentTimeMillis() } }
                OmegaContent(st, now, OmegaActions(
                    onMarket = omegaVm::select, onSignIn = { nav.navigate(SIGN_IN) },
                    onRetry = { scope.launch { omegaVm.refresh() } },
                    onChart = { val f = st.market.fut; chartVm.openSymbol("${f}1!", f, null); goTab(Tab.CHARTS) },
                ))
            }
            composable(SIGN_IN) { SignInRoute(auth, onClose = { nav.popBackStack() }) }
            composable(ALERTS) {
                val st by alertsVm.state.collectAsState()
                val err: (String) -> Unit = { m -> scope.launch { snack.show(m) } }
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
        TopNotesHost(snack)
        }
    }

    if (accountOpen) {
        ModalBottomSheet(onDismissRequest = { accountOpen = false }, containerColor = MaterialTheme.colorScheme.surface) {
            AccountContent(user, avatar, auth.available, themeMode, defaultTf, pushOn, data, AccountActions(
                onSignIn = { accountOpen = false; nav.navigate(SIGN_IN) },
                onSignOut = { accountOpen = false; scope.launch { runCatching { PushTokens.forget(ctx) }; auth.signOut() } },
                onTheme = prefs::setTheme,
                onTf = { t -> prefs.setDefaultTf(t) },
                onNotifications = {
                    if (!pushOn && Build.VERSION.SDK_INT >= 33) askPush.launch(Manifest.permission.POST_NOTIFICATIONS)
                    else ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName))
                },
                // The agreement is signed on the site (it is a legal form with the server callable); the app re-checks on return.
                onAgreement = { accountOpen = false; openWeb("/charts.html") },
                onHelp = { accountOpen = false; openWeb("/contact.html") },
            ))
        }
    }
    if (tradeOpen) {
        val ts by tradeVm.state.collectAsState()
        ModalBottomSheet(onDismissRequest = { tradeOpen = false }, containerColor = MaterialTheme.colorScheme.surface) {
            TradeSheetContent(ts, TradeActions(
                onType = tradeVm::setType, onPrice = tradeVm::setPriceText, onPriceStep = tradeVm::stepPrice,
                onQty = tradeVm::stepQty, onBracket = tradeVm::stepBracket,
                onBuy = { tradeVm.orderCall("buy")?.let(chartWeb::call) },
                onSell = { tradeVm.orderCall("sell")?.let(chartWeb::call) },
                onFlatten = { confirmFlatten = true },
                onPaperOn = { chartWeb.call("TZB.paperOn()") },
                onTab = tradeVm::setTab,
                onScalpBuy = { tradeVm.scalpCall("buy")?.let(chartWeb::call) },
                onScalpSell = { tradeVm.scalpCall("sell")?.let(chartWeb::call) },
                onDom = { side, price -> tradeVm.domCall(side, price)?.let(chartWeb::call) },
            ))
        }
    }
    if (addOpen) {
        ModalBottomSheet(onDismissRequest = { addOpen = false }, containerColor = MaterialTheme.colorScheme.surface) {
            AddSymbolContent(homeState.active?.name ?: "Watchlist", homeState.items.toSet(), onAdd = homeVm::add,
                search = { q -> chartWeb.job("find", q)?.let(::parseFind) })
        }
    }
    addTrade?.let { t ->
        ModalBottomSheet(onDismissRequest = { if (!addBusy) addTrade = null }, containerColor = MaterialTheme.colorScheme.surface) {
            AddTradeForm(t, addBusy, addError, onChange = { addTrade = it; addError = null },
                onSave = {
                    val err = t.error
                    if (err != null) addError = err else {
                        addBusy = true
                        journalVm.add(t) { e -> addBusy = false; if (e == null) { addTrade = null; scope.launch { snack.show("Trade saved.") } } else addError = e }
                    }
                },
                onFullForm = { addTrade = null; openWeb("/trade-journal.html") })
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
private fun HomeRoute(user: TzUser?, vm: HomeViewModel, data: DataAccess, onAdd: () -> Unit, onProduct: (Product) -> Unit, onSymbol: (WatchSymbol, Double?) -> Unit) {
    val state by vm.state.collectAsState()
    val owner = LocalLifecycleOwner.current
    // Poll + stream only while Home is on screen (like the site pauses on a hidden tab). Futures stream live from the
    // site's hub once the server granted current data (signed agreement); otherwise they stay on the delayed poll.
    val wantLive = liveWanted(data)
    val repo = remember { DataAccessRepository() }
    val feed = remember { LiveFeed(token = { f -> repo.idToken(f) }) }
    DisposableEffect(owner, wantLive) {
        val obs = LifecycleEventObserver { _, e -> if (e == Lifecycle.Event.ON_START) { vm.start(); vm.startLive(feed, wantLive) } else if (e == Lifecycle.Event.ON_STOP) vm.stop() }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs); vm.stop() }
    }
    HomeContent(
        state = state,
        firstName = user?.displayName?.substringBefore(' ')?.takeIf { it.isNotBlank() },
        dayPart = dayPart(LocalTime.now().hour),
        marketOpen = isFuturesMarketOpen(Instant.now()),
        onProduct = onProduct,
        onSymbol = { id ->
            val row = state.row(id)
            val q = when (val r = row?.state) { is RowState.Ready -> r.quote; is RowState.Failed -> r.stale; else -> null }
            row?.let { onSymbol(it.symbol, q?.changePct) }
        },
        watch = WatchActions(
            onAdd = onAdd, onRemove = vm::remove, onMove = vm::moveLocal, onMoveEnd = vm::commitOrder,
            onSelect = vm::select, onCreate = vm::create, onRename = vm::rename, onDelete = vm::deleteActive,
        ),
        dataNote = homeDataNote(user != null, data, state.live),
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
        onPasskey = {
            vm.busy(true)
            scope.launch {
                try {
                    val token = PasskeyClient().signIn(ctx)
                    if (token == null) vm.busy(false) else { auth.signInToken(token); vm.busy(false); onClose() }
                } catch (e: Exception) { vm.googleFailed(e.message ?: "That passkey didn't work. Try again or use your email.") }
            }
        },
        onTerms = { ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://tradezoro.com/terms.html".toUri())) },
    )
}

/** The profile picture: the Google photo (downloaded once, small) or the initials. */
@Composable
private fun rememberAvatar(user: TzUser?): Avatar? {
    if (user == null) return null
    var photo by remember(user.photoUrl) { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    LaunchedEffect(user.photoUrl) {
        val url = user.photoUrl?.takeIf { it.startsWith("https://") } ?: return@LaunchedEffect
        photo = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching {
                okhttp3.OkHttpClient().newCall(okhttp3.Request.Builder().url(url).build()).execute().use { r ->
                    r.body?.bytes()?.let { android.graphics.BitmapFactory.decodeByteArray(it, 0, it.size) }?.asImageBitmap()
                }
            }.getOrNull()
        }
    }
    return Avatar(user.initials.uppercase(), photo)
}
