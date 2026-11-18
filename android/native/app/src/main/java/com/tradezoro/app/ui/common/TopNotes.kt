package com.tradezoro.app.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.ui.theme.Tz
import kotlinx.coroutines.delay

enum class NoteKind { INFO, SUCCESS, ERROR }

class Note(val id: Long, val text: String, val kind: NoteKind)

/**
 * The app's notifications (Owner 18 Nov): newest on top, at most [MAX] shown (older ones drop off), each gone after
 * [SHOW_MS]. Replaces the grey bottom snackbar, which covered the tabs and the order buttons. Drawn by [TopNotesHost].
 */
class TopNotes {
    val items = mutableStateListOf<Note>()
    private var next = 0L

    fun show(text: String, kind: NoteKind = NoteKind.INFO) {
        if (text.isBlank()) return
        items.add(0, Note(next++, text, kind))
        while (items.size > MAX) items.removeAt(items.lastIndex)
    }

    fun dismiss(id: Long) { items.removeAll { it.id == id } }

    companion object { const val MAX = 3; const val SHOW_MS = 4000L }
}

/** Place at the top of the content area (below the app bar). Takes no touches outside the cards. */
@Composable
fun TopNotesHost(notes: TopNotes, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        notes.items.forEach { n -> androidx.compose.runtime.key(n.id) { NoteCard(n) { notes.dismiss(n.id) } } }
    }
}

@Composable
private fun NoteCard(n: Note, onClose: () -> Unit) {
    LaunchedEffect(n.id) { delay(TopNotes.SHOW_MS); onClose() }
    val state = rememberSwipeToDismissBoxState()
    LaunchedEffect(state.currentValue) { if (state.currentValue != SwipeToDismissBoxValue.Settled) onClose() }
    val accent = when (n.kind) { NoteKind.SUCCESS -> Tz.colors.up; NoteKind.ERROR -> Tz.colors.down; NoteKind.INFO -> MaterialTheme.colorScheme.primary }
    SwipeToDismissBox(state, backgroundContent = {}) {
        Surface(
            shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 6.dp,
            modifier = Modifier.fillMaxWidth().border(1.dp, Tz.colors.hairline, RoundedCornerShape(12.dp)),
        ) {
            Row(Modifier.height(IntrinsicSize.Min).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(4.dp).fillMaxHeight().background(accent))
                Text(
                    n.text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 3, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f).padding(start = 12.dp, top = 12.dp, bottom = 12.dp),
                )
                IconButton(onClick = onClose, modifier = Modifier.padding(end = 2.dp)) {
                    Icon(TzIcons.Close, contentDescription = "Dismiss", tint = Tz.colors.muted)
                }
            }
        }
    }
}
