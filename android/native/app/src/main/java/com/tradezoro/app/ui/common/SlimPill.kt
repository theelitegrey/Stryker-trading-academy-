package com.tradezoro.app.ui.common

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.indication
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A quiet 40dp outlined pill inside a full 48dp touch box (HIG/M3 minimum target, measured in the alignment tests). */
@Composable
fun SlimPill(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, desc: String? = null) {
    val src = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(50)
    val fg = MaterialTheme.colorScheme.onBackground.copy(alpha = if (enabled) 1f else 0.38f)
    Box(
        modifier.height(48.dp).clickable(interactionSource = src, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .semantics { if (desc != null) contentDescription = desc },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.height(40.dp).clip(shape).border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = if (enabled) 1f else 0.38f), shape)
            .indication(src, ripple()).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
            Text(text, style = MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp), color = fg)
        }
    }
}
