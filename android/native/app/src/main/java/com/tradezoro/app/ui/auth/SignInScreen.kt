package com.tradezoro.app.ui.auth

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tradezoro.app.ui.common.GoogleG
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.TzMark
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tz

data class SignInForm(
    val email: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
) {
    val canSubmit: Boolean get() = !busy && email.contains('@') && password.isNotEmpty()
}

private val Pill = RoundedCornerShape(50)

/**
 * Sign in (Owner 17 Nov): centred TZ mark, then the choices in order: Continue with Google (Google's own button colours +
 * the four-colour G), Use a passkey, then email. Background = the page colour with one faint neutral light from the top
 * (no colour wash). All buttons are 52dp pills; fields 56dp; the column is max 440dp wide.
 */
@Composable
fun SignInContent(
    form: SignInForm,
    available: Boolean,
    onEmail: (String) -> Unit,
    onPassword: (String) -> Unit,
    onSubmit: () -> Unit,
    onGoogle: () -> Unit,
    onForgot: () -> Unit,
    onCreate: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    onPasskey: () -> Unit = {},
    onTerms: () -> Unit = {},
) {
    val light = MaterialTheme.colorScheme.background.luminance() > 0.5f
    val glow = if (light) Color.White else Color.White.copy(alpha = 0.05f)
    Box(modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Box(Modifier.fillMaxWidth().height(320.dp).background(Brush.verticalGradient(listOf(glow, Color.Transparent))))
        Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Close, contentDescription = "Close") }
            }
            Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                // The mark is trimmed to its ink, so the box centre is the mark's geometric centre (measured in AlignmentTest).
                TzMark(Modifier.height(44.dp).testTag("tzmark"))
                Spacer(Modifier.height(24.dp))
                Text("Welcome back", style = MaterialTheme.typography.headlineSmall.copy(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
                    textAlign = TextAlign.Center, modifier = Modifier.semantics { heading() })
                Spacer(Modifier.height(8.dp))
                Text("Sign in with the same account you use on tradezoro.com.",
                    style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, textAlign = TextAlign.Center)
                Spacer(Modifier.height(32.dp))
                if (!available) {
                    Text("Sign-in is not available in this build.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center, modifier = Modifier.padding(bottom = 16.dp))
                }
                GoogleButton(enabled = available && !form.busy, light = light, onClick = onGoogle)
                Spacer(Modifier.height(12.dp))
                SecondaryPill("Use a passkey", TzIcons.Key, enabled = available && !form.busy, onClick = onPasskey)
                Spacer(Modifier.height(24.dp))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    HorizontalDivider(Modifier.weight(1f), color = Tz.colors.hairline)
                    Text("or with email", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted,
                        modifier = Modifier.padding(horizontal = 12.dp))
                    HorizontalDivider(Modifier.weight(1f), color = Tz.colors.hairline)
                }
                Spacer(Modifier.height(24.dp))
                val fieldColors = OutlinedTextFieldDefaults.colors(
                    unfocusedBorderColor = Tz.colors.hairline, focusedBorderColor = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.6f),
                    focusedLabelColor = MaterialTheme.colorScheme.onBackground, cursorColor = MaterialTheme.colorScheme.onBackground,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surface, focusedContainerColor = MaterialTheme.colorScheme.surface,
                )
                OutlinedTextField(
                    form.email, onEmail, label = { Text("Email") }, singleLine = true, shape = RoundedCornerShape(16.dp), colors = fieldColors,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    modifier = Modifier.fillMaxWidth().testTag("email"),
                )
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    form.password, onPassword, label = { Text("Password") }, singleLine = true, shape = RoundedCornerShape(16.dp), colors = fieldColors,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { if (form.canSubmit) onSubmit() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                form.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite })
                }
                form.info?.let {
                    Text(it, color = Tz.colors.up, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp).semantics { liveRegion = LiveRegionMode.Polite })
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = onSubmit, enabled = available && form.canSubmit, shape = Pill,
                    colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                    modifier = Modifier.fillMaxWidth().height(52.dp).testTag("signin-submit"),
                ) {
                    if (form.busy) CircularProgressIndicator(Modifier.size(20.dp), color = OnMint, strokeWidth = 2.dp)
                    else Text("Sign in", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(4.dp))
                TextButton(onClick = onForgot, enabled = available && !form.busy, modifier = Modifier.height(48.dp)) {
                    Text("Forgot password?", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onBackground)
                }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("New to TradeZoro?", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
                    TextButton(onClick = onCreate, modifier = Modifier.height(48.dp)) {
                        Text("Create an account", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = MaterialTheme.colorScheme.onBackground)
                    }
                }
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = onTerms, modifier = Modifier.fillMaxWidth()) {
                    Text(buildAnnotatedString {
                        append("By continuing you agree to the ")
                        withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("Terms") }
                        append(" and ")
                        withStyle(SpanStyle(textDecoration = TextDecoration.Underline)) { append("Privacy Policy") }
                        append(". Education only. Not financial advice.")
                    }, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp, lineHeight = 16.sp), color = Tz.colors.muted, textAlign = TextAlign.Center)
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

/**
 * Google's sign-in button per its branding guidelines: pill, the four-colour G (20dp), "Continue with Google",
 * dark theme fill #131314 / stroke #8E918F / text #E3E3E3; light theme #FFFFFF / #747775 / #1F1F1F.
 */
@Composable
private fun GoogleButton(enabled: Boolean, light: Boolean, onClick: () -> Unit) {
    val fill = if (light) Color.White else Color(0xFF131314)
    val stroke = if (light) Color(0xFF747775) else Color(0xFF8E918F)
    val text = if (light) Color(0xFF1F1F1F) else Color(0xFFE3E3E3)
    OutlinedButton(
        onClick = onClick, enabled = enabled, shape = Pill, border = BorderStroke(1.dp, if (enabled) stroke else stroke.copy(alpha = 0.4f)),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = fill, contentColor = text, disabledContainerColor = fill, disabledContentColor = text.copy(alpha = 0.4f)),
        modifier = Modifier.fillMaxWidth().height(52.dp).testTag("google"),
    ) {
        Icon(GoogleG, contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(20.dp).testTag("google-g"))
        Spacer(Modifier.width(12.dp))
        Text("Continue with Google", fontSize = 15.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.1.sp)
    }
}

@Composable
private fun SecondaryPill(label: String, icon: ImageVector, enabled: Boolean, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick, enabled = enabled, shape = Pill, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.surface, contentColor = MaterialTheme.colorScheme.onSurface),
        modifier = Modifier.fillMaxWidth().height(52.dp).testTag("passkey"),
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(label, fontSize = 15.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.1.sp)
    }
}
