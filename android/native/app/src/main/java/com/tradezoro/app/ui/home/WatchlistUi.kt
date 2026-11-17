package com.tradezoro.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.tradezoro.app.data.Cat
import com.tradezoro.app.data.NAME_MAX
import com.tradezoro.app.data.SECTION
import com.tradezoro.app.data.isSection
import com.tradezoro.app.data.searchCatalog
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Tz

data class WatchActions(
    val onAdd: () -> Unit = {},
    val onRemove: (String) -> Unit = {},
    /** Live reorder during a drag: move item [id] to the place of the adjacent item [over] (a symbol or a section). */
    val onMove: (id: String, over: String) -> Unit = { _, _ -> },
    val onMoveEnd: () -> Unit = {},
    val onSelect: (String) -> Unit = {},
    val onCreate: (String) -> Unit = {},
    val onRename: (String) -> Unit = {},
    val onDelete: () -> Unit = {},
)

/** "Watchlist ▾" (switch / new / rename / delete) on the left, "+" (add symbol) on the right. 48dp row. */
@Composable
fun WatchlistHeader(state: HomeUiState, a: WatchActions, modifier: Modifier = Modifier) {
    var menu by remember { mutableStateOf(false) }
    var naming by rememberSaveable { mutableStateOf<String?>(null) }   // "new" | "rename"
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    val name = state.active?.name ?: "Watchlist"
    Row(modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
            Row(
                Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                    .clickable(role = Role.Button, onClickLabel = "Switch or manage watchlists") { menu = true }
                    .semantics(mergeDescendants = true) { heading(); contentDescription = "Watchlist: $name. Switch or manage lists" }
                    .testTag("wl-switch"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Icon(TzIcons.ChevronDown, contentDescription = null, tint = Tz.colors.muted, modifier = Modifier.padding(start = 4.dp).size(16.dp))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                state.lists.forEach { l ->
                    DropdownMenuItem(
                        text = { Text(l.name, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        onClick = { menu = false; a.onSelect(l.id) },
                        trailingIcon = { if (l.id == state.activeId) Icon(TzIcons.Check, contentDescription = "Open") },
                    )
                }
                if (state.lists.isNotEmpty()) HorizontalDivider()
                DropdownMenuItem(text = { Text("New list") }, leadingIcon = { Icon(TzIcons.Plus, null) }, onClick = { menu = false; naming = "new" })
                if (state.active != null) {
                    DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(TzIcons.Pencil, null) }, onClick = { menu = false; naming = "rename" })
                    DropdownMenuItem(text = { Text("Delete list") }, leadingIcon = { Icon(TzIcons.Trash, null) }, enabled = state.lists.size > 1,
                        onClick = { menu = false; confirmDelete = true })
                }
            }
        }
        IconButton(onClick = a.onAdd, modifier = Modifier.size(48.dp).testTag("wl-add")) {
            Icon(TzIcons.Plus, contentDescription = "Add a symbol to $name")
        }
    }
    naming?.let { mode ->
        NameDialog(
            title = if (mode == "new") "New watchlist" else "Rename watchlist",
            initial = if (mode == "new") "" else name, confirm = if (mode == "new") "Create" else "Save",
            onDone = { v -> naming = null; if (mode == "new") a.onCreate(v) else a.onRename(v) }, onCancel = { naming = null },
        )
    }
    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Delete \u201c$name\u201d?") },
        text = { Text("The list is removed here and on tradezoro.com. The symbols themselves are not affected.") },
        confirmButton = { TextButton(onClick = { confirmDelete = false; a.onDelete() }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Keep") } },
    )
}

@Composable
fun NameDialog(title: String, initial: String, confirm: String, onDone: (String) -> Unit, onCancel: () -> Unit) {
    var v by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(title) },
        text = {
            OutlinedTextField(v, { v = it.take(NAME_MAX) }, singleLine = true, label = { Text("Name") }, shape = RoundedCornerShape(12.dp),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
                modifier = Modifier.fillMaxWidth())
        },
        confirmButton = { TextButton(onClick = { onDone(v) }, enabled = v.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

@Composable
internal fun EmptyList(onAdd: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("This list is empty", style = MaterialTheme.typography.titleSmall)
        Text("Add futures, forex, indices or crypto.", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted)
        TextButton(onClick = onAdd, modifier = Modifier.height(48.dp)) { Text("Add a symbol", color = MaterialTheme.colorScheme.onSurface) }
    }
}

/**
 * The list in the site's order, with its sections. Swipe a row left or right to remove it; long-press and drag to
 * reorder (the order is saved when the finger lifts). TalkBack gets "Remove", "Move up" and "Move down" actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun WatchRows(state: HomeUiState, onSymbol: (String) -> Unit, a: WatchActions) {
    val density = LocalDensity.current
    val rowPx = with(density) { 60.dp.toPx() }
    val secPx = with(density) { 32.dp.toPx() }
    var dragging by remember { mutableStateOf<String?>(null) }
    var dy by remember { mutableFloatStateOf(0f) }
    val items by rememberUpdatedState(state.items)
    val heightOf = { it: String -> if (isSection(it)) secPx else rowPx }
    val syms = state.items.filterNot(::isSection)
    state.items.forEach { item ->
        // No return@key inside key{}: it compiles to a non-local return the dexer rejects.
        val row = if (isSection(item)) null else state.row(item)
        if (isSection(item)) key(item) {
            Text(item.removePrefix(SECTION).ifEmpty { "Section" }, style = MaterialTheme.typography.labelMedium, color = Tz.colors.muted,
                modifier = Modifier.fillMaxWidth().height(32.dp).padding(top = 12.dp).semantics { heading() })
        } else if (row != null) key(item) {
            val moving = dragging == item
            val pos = syms.indexOf(item)
            val swipe = rememberSwipeToDismissBoxState(confirmValueChange = { v -> if (v != SwipeToDismissBoxValue.Settled) { a.onRemove(item); true } else false })
            val a11y = listOfNotNull(
                CustomAccessibilityAction("Remove ${row.symbol.chartTicker}") { a.onRemove(item); true },
                if (pos > 0) CustomAccessibilityAction("Move up") { a.onMove(item, syms[pos - 1]); a.onMoveEnd(); true } else null,
                if (pos < syms.lastIndex) CustomAccessibilityAction("Move down") { a.onMove(item, syms[pos + 1]); a.onMoveEnd(); true } else null,
            )
            Box(
                Modifier.zIndex(if (moving) 1f else 0f)
                    .graphicsLayer { translationY = if (moving) dy else 0f }
                    .then(if (moving) Modifier.shadow(8.dp, RoundedCornerShape(12.dp)) else Modifier)
                    .pointerInput(item) {
                        detectDragGesturesAfterLongPress(
                            onDragStart = { dragging = item; dy = 0f },
                            onDragEnd = { dragging = null; dy = 0f; a.onMoveEnd() },
                            onDragCancel = { dragging = null; dy = 0f; a.onMoveEnd() },
                            onDrag = { ch, d ->
                                ch.consume()
                                dy += d.y
                                val list = items; val at = list.indexOf(item)
                                if (dy > 0 && at < list.lastIndex) {
                                    val next = list[at + 1]; val h = heightOf(next)
                                    if (dy > h / 2) { a.onMove(item, next); dy -= h }
                                } else if (dy < 0 && at > 0) {
                                    val prev = list[at - 1]; val h = heightOf(prev)
                                    if (-dy > h / 2) { a.onMove(item, prev); dy += h }
                                }
                            },
                        )
                    },
            ) {
                SwipeToDismissBox(
                    state = swipe,
                    gesturesEnabled = !moving,
                    backgroundContent = {
                        Row(Modifier.fillMaxWidth().height(60.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.error.copy(alpha = 0.16f)).padding(horizontal = 16.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Icon(TzIcons.Trash, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                            Spacer(Modifier.weight(1f))
                            Icon(TzIcons.Trash, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        }
                    },
                ) {
                    WatchRowView(row, onSymbol, Modifier.background(MaterialTheme.colorScheme.surface), a11y)
                }
            }
        }
    }
}

/** "Add to watchlist": search the markets the site carries, tap to add. */
@Composable
fun AddSymbolContent(listName: String, inList: Set<String>, onAdd: (String) -> Unit, modifier: Modifier = Modifier, initialQuery: String = "") {
    var q by rememberSaveable { mutableStateOf(initialQuery) }
    val results = remember(q) { searchCatalog(q) }
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text("Add to $listName", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 8.dp, bottom = 12.dp).semantics { heading() })
        OutlinedTextField(
            q, { q = it.take(24) }, singleLine = true, placeholder = { Text("Search symbol or name") },
            leadingIcon = { Icon(TzIcons.Search, contentDescription = null) }, shape = RoundedCornerShape(50),
            colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Tz.colors.hairline),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, imeAction = ImeAction.Search),
            modifier = Modifier.fillMaxWidth().testTag("wl-search"),
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 440.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (results.isEmpty()) item {
                Text("No market matches \u201c$q\u201d.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, modifier = Modifier.padding(16.dp))
            }
            items(results, key = { it.id }) { c -> CatRow(c, c.id in inList) { onAdd(c.id) } }
        }
    }
}

@Composable
private fun CatRow(c: Cat, added: Boolean, onAdd: () -> Unit) {
    val tk = c.id.substringAfter(':')
    Row(
        Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(12.dp))
            .clickable(enabled = !added, role = Role.Button, onClickLabel = "Add $tk") { onAdd() }
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(tk, style = MaterialTheme.typography.titleSmall, maxLines = 1)
            Text("${c.name} \u00b7 ${c.exchange}", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            if (added) Icon(TzIcons.Check, contentDescription = "In the list", tint = Tz.colors.up)
            else Icon(TzIcons.Plus, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
        }
    }
}

