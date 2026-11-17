package com.tradezoro.app.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.auth.TzUser
import com.tradezoro.app.data.DataAccess
import com.tradezoro.app.data.ThemeMode
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.nav.Avatar
import com.tradezoro.app.ui.nav.ProfileButton
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tz

data class AccountActions(
    val onSignIn: () -> Unit = {},
    val onSignOut: () -> Unit = {},
    val onTheme: (ThemeMode) -> Unit = {},
    val onTf: (Timeframe) -> Unit = {},
    val onNotifications: () -> Unit = {},
    val onAgreement: () -> Unit = {},
    val onHelp: () -> Unit = {},
)

/** Account sheet (Owner 17 Nov): who you are, Settings (theme, notifications, default timeframe, data access), Help, Sign out. */
@Composable
fun AccountContent(
    user: TzUser?,
    avatar: Avatar?,
    available: Boolean,
    theme: ThemeMode,
    defaultTf: Timeframe,
    notifications: Boolean,
    data: DataAccess,
    a: AccountActions,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
        // Identity
        Row(Modifier.fillMaxWidth().heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ProfileButton(avatar) {} }
            Column(Modifier.weight(1f).padding(start = 12.dp)) {
                Text(user?.displayName?.takeIf { it.isNotBlank() } ?: if (user != null) "Signed in" else "Not signed in",
                    style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
                Text(user?.email ?: "Sign in to sync watchlists, journal and courses with tradezoro.com.",
                    style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        if (user == null) {
            Spacer(Modifier.height(12.dp))
            Button(onClick = a.onSignIn, enabled = available, shape = RoundedCornerShape(50),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Sign in") }
        }
        Section("Settings")
        Label("Theme")
        Segmented(ThemeMode.entries.map { it.label }, ThemeMode.entries.indexOf(theme)) { a.onTheme(ThemeMode.entries[it]) }
        Spacer(Modifier.height(16.dp))
        Label("Default chart timeframe")
        Segmented(Timeframe.entries.map { it.label }, Timeframe.entries.indexOf(defaultTf)) { a.onTf(Timeframe.entries[it]) }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Switch) { a.onNotifications() },
            verticalAlignment = Alignment.CenterVertically) {
            Icon(TzIcons.Bell, contentDescription = null, tint = Tz.colors.muted)
            Column(Modifier.weight(1f).padding(start = 16.dp)) {
                Text("Notifications", style = MaterialTheme.typography.bodyLarge)
                Text(if (notifications) "Price alerts can reach this phone." else "Off. Price alerts won't reach this phone.", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted)
            }
            Switch(checked = notifications, onCheckedChange = { a.onNotifications() },
                colors = SwitchDefaults.colors(checkedTrackColor = Mint, checkedThumbColor = OnMint))
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp))
            .clickable(enabled = user != null && data.offerAgreement, role = Role.Button) { a.onAgreement() },
            verticalAlignment = Alignment.CenterVertically) {
            Icon(TzIcons.Shield, contentDescription = null, tint = if (data.current == true) Tz.colors.up else Tz.colors.muted)
            Column(Modifier.weight(1f).padding(start = 16.dp)) {
                Text("Market data", style = MaterialTheme.typography.bodyLarge)
                Text(data.label, style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted)
                if (data.agreement == true) Text("Market data agreement signed", style = MaterialTheme.typography.bodySmall, color = Tz.colors.up)
            }
            if (user != null && data.offerAgreement) Text("Sign", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 8.dp))
        }
        HorizontalDivider(Modifier.padding(vertical = 8.dp), color = Tz.colors.hairline)
        LinkRow(TzIcons.Help, "Help", a.onHelp)
        if (user != null) LinkRow(TzIcons.SignOut, "Sign out", a.onSignOut)
        Spacer(Modifier.height(8.dp))
        Text("Education only. Not financial advice.", style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted)
    }
}

@Composable
private fun Section(t: String) = Text(t, style = MaterialTheme.typography.titleSmall,
    modifier = Modifier.padding(top = 24.dp, bottom = 12.dp).semantics { heading() })

@Composable
private fun Label(t: String) = Text(t, style = MaterialTheme.typography.labelMedium, color = Tz.colors.muted, modifier = Modifier.padding(bottom = 8.dp))

/** A pill segmented control, 40dp visual in a 48dp row, equal segments. */
@Composable
fun Segmented(labels: List<String>, selected: Int, onPick: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        labels.forEachIndexed { i, l ->
            val on = i == selected
            Box(Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(50)).then(if (on) Modifier.background(Tz.colors.selected) else Modifier)
                .clickable(role = Role.RadioButton) { onPick(i) }.semantics { this.selected = on }, contentAlignment = Alignment.Center) {
                Text(l, style = MaterialTheme.typography.labelLarge, color = if (on) MaterialTheme.colorScheme.onBackground else Tz.colors.muted)
            }
        }
    }
}

@Composable
private fun LinkRow(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onClick),
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Tz.colors.muted)
        Spacer(Modifier.width(16.dp))
        Text(label, style = MaterialTheme.typography.bodyLarge)
    }
}

