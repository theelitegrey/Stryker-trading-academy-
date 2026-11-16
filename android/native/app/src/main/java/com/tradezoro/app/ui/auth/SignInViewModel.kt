package com.tradezoro.app.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuthException
import com.tradezoro.app.auth.friendlyAuthError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Auth calls are injected so the view-model is testable without Firebase. */
class SignInViewModel(
    private val signInEmail: suspend (String, String) -> Unit,
    private val sendReset: suspend (String) -> Unit,
) : ViewModel() {
    private val _form = MutableStateFlow(SignInForm())
    val form: StateFlow<SignInForm> = _form.asStateFlow()

    fun email(v: String) = _form.update { it.copy(email = v.trim(), error = null, info = null) }
    fun password(v: String) = _form.update { it.copy(password = v, error = null, info = null) }

    fun submit(onDone: () -> Unit) {
        val f = _form.value
        if (!f.canSubmit) return
        run({ signInEmail(f.email, f.password); onDone() })
    }

    fun forgot() {
        val e = _form.value.email
        if (!e.contains('@')) { _form.update { it.copy(error = "Enter your email first, then tap Forgot password.") }; return }
        run({ sendReset(e); _form.update { it.copy(info = "Reset link sent. Check your inbox.") } })
    }

    fun googleFailed(message: String) = _form.update { it.copy(busy = false, error = message) }
    fun busy(b: Boolean) = _form.update { it.copy(busy = b, error = null, info = null) }

    private fun run(block: suspend () -> Unit) {
        busy(true)
        viewModelScope.launch {
            try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) {
                _form.update { it.copy(error = errorText(e)) }
            } finally { _form.update { it.copy(busy = false) } }
        }
    }

    companion object {
        fun errorText(e: Exception): String =
            if (e is FirebaseAuthException) friendlyAuthError(e.errorCode)
            else (e as? IllegalStateException)?.message ?: friendlyAuthError(null)
    }
}
