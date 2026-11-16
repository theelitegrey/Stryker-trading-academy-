package com.tradezoro.app.ui.alerts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.BorderStroke
import com.tradezoro.app.data.AlertsState
import com.tradezoro.app.data.PriceAlert
import com.tradezoro.app.data.alertPrice
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

data class AlertsActions(
    val onBack: () -> Unit = {},
    val onNew: () -> Unit = {},
    val onToggle: (PriceAlert, Boolean) -> Unit = { _, _ -> },
    val onDelete: (PriceAlert) -> Unit = {},
    val onAllowPush: () -> Unit = {},
    val onTestPush: () -> Unit = {},
    val onSignIn: () -> Unit = {},
)

@Composable
fun AlertsTopBar(onBack: () -> Unit, onNew: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Back, contentDescription = "Back") }
        Text("Price alerts", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { heading() })
        IconButton(onClick = onNew, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Plus, contentDescription = "New alert on the chart") }
    }
}

/** Alerts list. Alerts are created on the chart (the site's own form); here they are listed, paused and deleted. */
@Composable
fun AlertsContent(state: AlertsState, pushOn: Boolean, actions: AlertsActions, modifier: Modifier = Modifier, sample: Boolean = false) {
    Column(modifier.fillMaxSize().padding(horizontal = 16.dp)) {
        when (state) {
            AlertsState.SignedOut -> Message(
                "Sign in to see your alerts",
                "Price alerts are saved to your account and checked on our servers, so they reach this phone even when the app is closed.",
                "Sign in", actions.onSignIn,
            )
            AlertsState.Loading -> Message("Loading alerts\u2026", null, null, null)
            is AlertsState.Failed -> Message(state.message, null, null, null)
            is AlertsState.Ready -> {
                PushCard(pushOn, actions)
                Spacer(Modifier.height(16.dp))
                if (state.alerts.isEmpty()) {
                    Message("No price alerts yet", "Create one on the chart: tap + and pick a level.", "New alert", actions.onNew)
                } else {
                    LazyColumn(Modifier.weight(1f)) {
                        items(state.alerts, key = { it.id }) { a -> AlertRow(a, actions) }
                    }
                }
            }
        }
        Text(if (sample) "Sample data" else "Alerts are checked on live prices. Education only. Not financial advice.",
            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp))
    }
}

@Composable
private fun PushCard(pushOn: Boolean, actions: AlertsActions) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceVariant, contentColor = MaterialTheme.colorScheme.onSurface, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(if (pushOn) "Phone push is on" else "Phone push is off", style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            Text(if (pushOn) "When an alert fires, this phone gets a notification, even when the app is closed."
                else "Allow notifications so your alerts reach this phone.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
            if (pushOn) OutlinedButton(onClick = actions.onTestPush, shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Tz.colors.hairline),
                modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Send test notification", color = MaterialTheme.colorScheme.onBackground) }
            else Button(onClick = actions.onAllowPush, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Allow notifications", style = MaterialTheme.typography.titleSmall) }
        }
    }
}

@Composable
private fun AlertRow(a: PriceAlert, actions: AlertsActions) {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
            Text("${a.ticker} \u00b7 ${a.condLabel} ${alertPrice(a.price)}", style = MaterialTheme.typography.bodyLarge.merge(Tabular), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text((if (a.active) "" else "Paused \u00b7 ") + (if (a.message.isNotBlank()) a.message + " \u00b7 " else "") + a.freqLabel,
                style = MaterialTheme.typography.labelMedium, color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Switch(
            checked = a.active, onCheckedChange = { actions.onToggle(a, it) },
            colors = SwitchDefaults.colors(checkedTrackColor = Mint, checkedThumbColor = OnMint),
            modifier = Modifier.semantics { contentDescription = "Alert ${a.ticker} ${a.condLabel} ${alertPrice(a.price)}"; stateDescription = if (a.active) "Active" else "Paused" },
        )
        // 12dp into the gutter: the 24dp glyph box then ends 16dp from the screen edge, matching the text's left gutter.
        IconButton(onClick = { actions.onDelete(a) }, modifier = Modifier.offset(x = 12.dp).size(48.dp)) {
            Icon(TzIcons.Close, contentDescription = "Delete alert ${a.ticker} ${alertPrice(a.price)}", tint = Tz.colors.muted)
        }
    }
    HorizontalDivider(color = Tz.colors.hairline)
}

@Composable
private fun Message(title: String, body: String?, button: String?, onClick: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(TzIcons.Bell, contentDescription = null, tint = Tz.colors.muted)
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        body?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, textAlign = TextAlign.Center) }
        if (button != null && onClick != null) {
            Spacer(Modifier.height(8.dp))
            Button(onClick = onClick, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.height(48.dp)) { Text(button) }
        }
    }
}
