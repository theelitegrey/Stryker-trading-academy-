package com.tradezoro.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.Wordmark
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
) {
    val field = RoundedCornerShape(12.dp)
    Column(modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())) {
        Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onClose, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Close, contentDescription = "Close") }
        }
        Column(Modifier.padding(horizontal = 24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Wordmark(Modifier.height(32.dp))
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Sign in", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                Text("Use the same account as tradezoro.com.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
            }
            if (!available) {
                Text("Sign-in is not available in this build.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            }
            OutlinedTextField(
                form.email, onEmail, label = { Text("Email") }, singleLine = true, shape = field,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                form.password, onPassword, label = { Text("Password") }, singleLine = true, shape = field,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (form.canSubmit) onSubmit() }),
                modifier = Modifier.fillMaxWidth(),
            )
            form.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            form.info?.let {
                Text(it, color = Tz.colors.up, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            Button(
                onClick = onSubmit, enabled = available && form.canSubmit, shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) {
                if (form.busy) CircularProgressIndicator(Modifier.padding(4.dp), color = OnMint, strokeWidth = 2.dp)
                else Text("Sign in", style = MaterialTheme.typography.titleMedium)
            }
            TextButton(onClick = onForgot, enabled = available && !form.busy, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                Text("Forgot password?", color = MaterialTheme.colorScheme.onSurface)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                HorizontalDivider(Modifier.weight(1f), color = Tz.colors.hairline)
                Text("or", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, modifier = Modifier.padding(horizontal = 12.dp))
                HorizontalDivider(Modifier.weight(1f), color = Tz.colors.hairline)
            }
            OutlinedButton(
                onClick = onGoogle, enabled = available && !form.busy, shape = RoundedCornerShape(24.dp),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("Continue with Google", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurface) }
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = onCreate, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                Text("New here? Create an account", color = MaterialTheme.colorScheme.onSurface)
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}
