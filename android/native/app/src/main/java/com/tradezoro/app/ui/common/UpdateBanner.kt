package com.tradezoro.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.data.Dl
import com.tradezoro.app.data.UpdateKind
import com.tradezoro.app.data.UpdateUiState
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

/** One line under the title: download progress, an error, the permission hint, or the first release note. */
private fun statusLine(s: UpdateUiState): String = when (val d = s.dl) {
    is Dl.Running -> if (d.total > 0) "Downloading… ${(d.fraction * 100).toInt()}%" else "Downloading…"
    is Dl.Failed -> d.message
    else -> if (s.needsPermission) "Allow \"Install unknown apps\" for TradeZoro, then come back."
        else s.release?.notes?.firstOrNull().orEmpty()
}

@Composable
private fun UpdatePill(s: UpdateUiState, onUpdate: () -> Unit, modifier: Modifier = Modifier) {
    val busy = s.dl is Dl.Running
    Button(
        onClick = onUpdate, enabled = !busy, shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint, disabledContainerColor = Mint.copy(alpha = 0.5f), disabledContentColor = OnMint),
        modifier = modifier.height(40.dp).testTag("update-pill"),
    ) { Text(if (s.dl is Dl.Failed) "Retry" else "Update", style = MaterialTheme.typography.labelLarge) }
}

@Composable
private fun Progress(s: UpdateUiState, modifier: Modifier = Modifier) {
    val d = s.dl as? Dl.Running ?: return
    if (d.total > 0) LinearProgressIndicator(progress = { d.fraction }, color = Mint, trackColor = Tz.colors.hairline, modifier = modifier.fillMaxWidth().height(4.dp))
    else LinearProgressIndicator(color = Mint, trackColor = Tz.colors.hairline, modifier = modifier.fillMaxWidth().height(4.dp))
}

/** Top-of-app card, same look as the notification cards (TopNotes): surface card, green edge, 12dp radius, X. */
@Composable
fun UpdateBanner(s: UpdateUiState, onUpdate: () -> Unit, onClose: () -> Unit, modifier: Modifier = Modifier) {
    if (s.kind != UpdateKind.BANNER) return
    val r = s.release ?: return
    Surface(
        shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 6.dp,
        modifier = modifier.padding(horizontal = 12.dp, vertical = 8.dp).fillMaxWidth().border(1.dp, Tz.colors.hairline, RoundedCornerShape(12.dp)).testTag("update-banner"),
    ) {
        Column {
            Row(Modifier.height(IntrinsicSize.Min).heightIn(min = 64.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(4.dp).fillMaxHeight().background(Mint))
                Column(Modifier.weight(1f).padding(start = 12.dp, top = 12.dp, bottom = 12.dp, end = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("Update available · v${r.versionName}", style = MaterialTheme.typography.titleSmall.merge(Tabular), fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("update-title"))
                    val line = statusLine(s)
                    if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodySmall.merge(Tabular),
                        color = if (s.dl is Dl.Failed) Tz.colors.down else Tz.colors.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                UpdatePill(s, onUpdate)
                IconButton(onClick = onClose, modifier = Modifier.padding(end = 2.dp).testTag("update-close")) {
                    Icon(TzIcons.Close, contentDescription = "Dismiss update", tint = Tz.colors.muted)
                }
            }
            Progress(s)
        }
    }
}

/** Below minVersionCode: covers the whole app, no X. */
@Composable
fun UpdateRequired(s: UpdateUiState, onUpdate: () -> Unit) {
    if (s.kind != UpdateKind.BLOCKING) return
    val r = s.release ?: return
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).safeDrawingPadding().padding(24.dp).testTag("update-required"), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 420.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(48.dp).height(4.dp).background(Mint, RoundedCornerShape(2.dp)))
            Text("Please update to keep using TradeZoro", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onBackground)
            Text("Version ${r.versionName} is required.", style = MaterialTheme.typography.bodyMedium.merge(Tabular), color = Tz.colors.muted, textAlign = TextAlign.Center)
            val line = statusLine(s)
            if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodyMedium.merge(Tabular), textAlign = TextAlign.Center,
                color = if (s.dl is Dl.Failed) Tz.colors.down else Tz.colors.muted)
            Spacer(Modifier.height(4.dp))
            UpdatePill(s, onUpdate, Modifier.fillMaxWidth())
            Progress(s)
        }
    }
}
