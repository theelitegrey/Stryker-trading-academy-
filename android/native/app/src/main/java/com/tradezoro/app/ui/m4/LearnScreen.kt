package com.tradezoro.app.ui.m4

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tradezoro.app.R
import com.tradezoro.app.data.Chapter
import com.tradezoro.app.data.ChapterProgress
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.probe
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tz

data class LearnActions(val onChapter: (Chapter) -> Unit = {}, val onSignIn: () -> Unit = {})

/** Mentis: continue card + every chapter with its progress ring (mock 5-mentis). Reading happens on the website reader. */
@Composable
fun LearnContent(st: LearnState, actions: LearnActions, modifier: Modifier = Modifier) {
    if (st !is LearnState.Ready) { Box(modifier.fillMaxSize()) { Notice("Loading courses\u2026", null, null, null) }; return }
    val m = st.model
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
        item { ContinueCard(st, actions) }
        m.sections.forEach { (name, list) ->
            item(key = name) {
                Text(if (name == "Core curriculum") "Your courses" else name, style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(top = 24.dp, bottom = 8.dp).semantics { heading() })
            }
            items(list, key = { it.chapter.num }) { p -> CourseRow(p, st.signedIn, actions) }
        }
        item {
            Text(if (st.sample) "Sample data" else "Every chapter is free for members. Education only. Not financial advice.",
                style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        }
    }
}

@Composable
private fun ContinueCard(st: LearnState.Ready, actions: LearnActions) {
    val m = st.model
    val c = m.cont
    val first = m.sections.firstOrNull()?.second?.firstOrNull()?.chapter
    com.tradezoro.app.ui.home.Card {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Image(painterResource(R.drawable.product_mentis), contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.probe("icon").size(40.dp).clip(RoundedCornerShape(12.dp)))
            Text(when { !st.signedIn -> "Mentis"; c != null -> "Continue where you left off"; m.doneLessons > 0 -> "Curriculum complete"; else -> "Start learning" },
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted, modifier = Modifier.probe("kicker"))
        }
        Spacer(Modifier.height(12.dp))
        val title = c?.chapter?.title ?: if (st.signedIn && m.doneLessons > 0) "Every lesson, done." else first?.title ?: "Mentis"
        Text(title, style = MaterialTheme.typography.titleLarge.copy(fontSize = 20.sp, lineHeight = 26.sp), maxLines = 2, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.semantics { heading() })
        val sub = when {
            !st.signedIn -> "Sign in to keep your progress in sync with the website."
            c != null -> "Lesson ${c.lessonIndex + 1} \u00b7 ${c.lessonTitle}"
            m.doneLessons > 0 -> "${m.doneLessons} of ${m.totalLessons} lessons"
            else -> "Chapter ${first?.num ?: "01"} \u00b7 ${first?.lessons?.firstOrNull() ?: ""}"
        }
        Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.72f), modifier = Modifier.padding(top = 4.dp))
        if (st.signedIn && c != null) {
            val frac = if (c.total == 0) 0f else c.done.toFloat() / c.total
            Box(Modifier.padding(vertical = 16.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(Tz.colors.selected)
                .clearAndSetSemantics { contentDescription = "${c.done} of ${c.total} lessons done in this chapter" }) {
                Box(Modifier.fillMaxWidth(frac).fillMaxHeight().clip(RoundedCornerShape(3.dp)).background(MaterialTheme.colorScheme.onSurface))
            }
        } else Spacer(Modifier.height(16.dp))
        val target = c?.chapter ?: first
        Button(
            onClick = { if (!st.signedIn) actions.onSignIn() else target?.let(actions.onChapter) },
            shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
            modifier = Modifier.fillMaxWidth().height(48.dp).probe("continue"),
        ) { Text(when { !st.signedIn -> "Sign in"; c != null -> "Continue lesson"; m.doneLessons > 0 -> "Review chapter 01"; else -> "Start chapter ${first?.num ?: "01"}" }, style = MaterialTheme.typography.titleSmall) }
    }
}

@Composable
private fun CourseRow(p: ChapterProgress, signedIn: Boolean, actions: LearnActions) {
    val spoken = "Chapter ${p.chapter.num}, ${p.chapter.title}" + if (signedIn) ", ${p.done} of ${p.total} lessons done" else ", ${p.total} lessons"
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.padding(bottom = 8.dp).probe("row:${p.chapter.num}").fillMaxWidth().heightIn(min = 80.dp).clip(shape).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, Tz.colors.hairline, shape).clickable(role = Role.Button, onClickLabel = "Open chapter") { actions.onChapter(p.chapter) }
            .clearAndSetSemantics { contentDescription = spoken }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (signedIn) Box(Modifier.probe("ring:${p.chapter.num}")) { Ring(p.pct) } else Box(Modifier.size(48.dp).clip(RoundedCornerShape(24.dp)).background(Tz.colors.selected), contentAlignment = Alignment.Center) {
            Text(p.chapter.num.takeLast(2), style = MaterialTheme.typography.labelMedium)
        }
        Column(Modifier.weight(1f).probe("text:${p.chapter.num}")) {
            Text(p.chapter.title, style = MaterialTheme.typography.bodyLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (signedIn) "${p.done} of ${p.total} lessons" else "${p.total} lessons", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted)
        }
        Icon(TzIcons.Forward, contentDescription = null, tint = Tz.colors.muted, modifier = Modifier.probe("chev:${p.chapter.num}"))
    }
}

/** 48dp ring: 4dp track, light arc for progress (mock), percentage inside. */
@Composable
private fun Ring(pct: Int) {
    val track = Tz.colors.selected
    val arc = MaterialTheme.colorScheme.onSurface
    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(48.dp)) {
            val w = 4.dp.toPx()
            val tl = Offset(w / 2 + 2.dp.toPx(), w / 2 + 2.dp.toPx())
            val sz = Size(size.width - tl.x * 2, size.height - tl.y * 2)
            drawArc(track, 0f, 360f, false, tl, sz, style = Stroke(w))
            if (pct > 0) drawArc(arc, -90f, 360f * pct / 100f, false, tl, sz, style = Stroke(w, cap = StrokeCap.Round))
            else drawCircle(arc, 2.dp.toPx(), Offset(size.width / 2, tl.y))
        }
        Text("$pct%", style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp))
    }
}
