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
import com.tradezoro.app.ui.home.HomeContent
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
import java.time.Instant
import java.time.LocalTime

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val auth = AuthRepository(applicationContext)
        setContent { TradeZoroTheme { TzRoot(auth) } }
    }
}

private const val SIGN_IN = "signin"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TzRoot(auth: AuthRepository) {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val user by auth.user.collectAsState(initial = null)
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var accountOpen by rememberSaveable { mutableStateOf(false) }
    val tab = Tab.entries.firstOrNull { it.route == route }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            when (tab) {
                Tab.HOME -> HomeTopBar(onMenu = { accountOpen = true }, onBell = { scope.launch { snack.showSnackbar("Price alerts arrive in a later update.") } })
                null -> {}
                else -> TabTopBar(tab.label)
            }
        },
        bottomBar = {
            if (tab != null) TzBottomBar(tab) { t ->
                nav.navigate(t.route) {
                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                    launchSingleTop = true; restoreState = true
                }
            }
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        NavHost(nav, startDestination = Tab.HOME.route, modifier = Modifier.padding(pad)) {
            composable(Tab.HOME.route) { HomeRoute(user, onSnack = { m -> scope.launch { snack.showSnackbar(m) } }) }
            composable(Tab.CHARTS.route) { ComingSoon(Tab.CHARTS, "the next update", "/charts") }
            composable(Tab.TRADE.route) { ComingSoon(Tab.TRADE, "a later update", "/charts") }
            composable(Tab.LEARN.route) { ComingSoon(Tab.LEARN, "a later update", "/courses") }
            composable(Tab.JOURNAL.route) { ComingSoon(Tab.JOURNAL, "a later update", "/journal") }
            composable(SIGN_IN) { SignInRoute(auth, onClose = { nav.popBackStack() }) }
        }
    }

    if (accountOpen) {
        ModalBottomSheet(onDismissRequest = { accountOpen = false }, containerColor = MaterialTheme.colorScheme.surface) {
            AccountSheet(user, auth.available,
                onSignIn = { accountOpen = false; nav.navigate(SIGN_IN) },
                onSignOut = { auth.signOut(); accountOpen = false })
        }
    }
}

@Composable
private fun HomeRoute(user: TzUser?, onSnack: (String) -> Unit, vm: HomeViewModel = viewModel()) {
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
        onSymbol = { s -> onSnack("$s chart arrives in the next update.") },
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

