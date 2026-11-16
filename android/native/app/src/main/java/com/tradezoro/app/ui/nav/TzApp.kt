package com.tradezoro.app.ui.nav

import android.content.Intent
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.Wordmark
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tz

enum class Tab(val route: String, val label: String, val icon: ImageVector) {
    HOME("home", "Home", TzIcons.Home),
    CHARTS("charts", "Charts", TzIcons.Charts),
    TRADE("trade", "Trade", TzIcons.Trade),
    LEARN("learn", "Learn", TzIcons.Learn),
    JOURNAL("journal", "Journal", TzIcons.Journal),
}

/** Top bar from the mock: menu · wordmark · bell. 64dp tall, 48dp touch targets. */
@Composable
fun HomeTopBar(onMenu: () -> Unit, onBell: () -> Unit) {
    // 48dp buttons with a 12dp edge inset put the 24dp glyphs 24dp from the edge, as in the mock.
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onMenu, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Menu, contentDescription = "Account menu") }
        Box(Modifier.weight(1f).padding(start = 8.dp)) {
            Wordmark(Modifier.height(28.dp))
        }
        IconButton(onClick = onBell, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Alerts") }
    }
}

@Composable
fun TabTopBar(title: String) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
    }
}

/** Trade top bar from the mock: menu · title · bell. Same 12dp inset + 48dp buttons as Home. */
@Composable
fun MenuTopBar(title: String, onMenu: () -> Unit, onBell: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onMenu, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Menu, contentDescription = "Account menu") }
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { heading() })
        IconButton(onClick = onBell, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Price alerts") }
    }
}

@Composable
fun TzBottomBar(current: Tab, onSelect: (Tab) -> Unit) {
    NavigationBar(containerColor = Tz.colors.navBar, tonalElevation = 0.dp) {
        Tab.entries.forEach { t ->
            NavigationBarItem(
                selected = t == current, onClick = { onSelect(t) },
                icon = { Icon(t.icon, contentDescription = null) },
                label = { Text(t.label, style = MaterialTheme.typography.labelMedium) },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    selectedTextColor = MaterialTheme.colorScheme.onSecondaryContainer,
                    indicatorColor = Tz.colors.selected,
                    unselectedIconColor = Tz.colors.muted, unselectedTextColor = Tz.colors.muted,
                ),
            )
        }
    }
}

/** Tabs whose native screen lands in a later milestone. Says so plainly; offers the site meanwhile. */
@Composable
fun ComingSoon(tab: Tab, milestone: String, webPath: String, modifier: Modifier = Modifier) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Column(modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(tab.icon, contentDescription = null, tint = Tz.colors.muted)
        Spacer(Modifier.height(16.dp))
        Text("${tab.label} is coming to the app", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text("The native ${tab.label.lowercase()} screen arrives in $milestone. You can use it on the website now.",
            style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, textAlign = TextAlign.Center)
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = { ctx.startActivity(Intent(Intent.ACTION_VIEW, "https://tradezoro.com$webPath".toUri())) },
            shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
            modifier = Modifier.height(48.dp),
        ) { Text("Open on tradezoro.com") }
    }
}

