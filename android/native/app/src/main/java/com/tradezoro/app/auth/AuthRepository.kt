package com.tradezoro.app.auth

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

data class TzUser(val uid: String, val email: String?, val displayName: String?, val emailVerified: Boolean, val photoUrl: String? = null) {
    /** "Alex Morgan" -> "AM"; email -> its first letter. For the avatar when there is no photo. */
    val initials: String get() {
        val parts = displayName?.trim()?.split(Regex("\\s+"))?.filter { it.isNotEmpty() }.orEmpty()
        return when {
            parts.size >= 2 -> "${parts.first()[0]}${parts.last()[0]}"
            parts.size == 1 -> parts[0].take(1)
            else -> email?.take(1) ?: "?"
        }.uppercase()
    }
}

/** Firebase Auth, same project as the website. Null-safe when the build has no Firebase config. */
class AuthRepository(context: Context) {
    private val auth: FirebaseAuth? =
        if (FirebaseApp.getApps(context).isNotEmpty() || FirebaseApp.initializeApp(context) != null) FirebaseAuth.getInstance() else null

    val available: Boolean get() = auth != null

    val user: Flow<TzUser?> = auth?.let { a ->
        callbackFlow {
            val l = FirebaseAuth.AuthStateListener { trySend(it.currentUser?.let { u -> TzUser(u.uid, u.email, u.displayName, u.isEmailVerified, u.photoUrl?.toString()) }) }
            a.addAuthStateListener(l)
            awaitClose { a.removeAuthStateListener(l) }
        }
    } ?: flowOf(null)

    suspend fun signInEmail(email: String, password: String) { requireAuth().signInWithEmailAndPassword(email, password).await() }

    suspend fun signInGoogle(idToken: String) { requireAuth().signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await() }

    /** Passkey sign-in and the chart page's sign-in both end in a Firebase custom token from the site. */
    suspend fun signInToken(token: String) { requireAuth().signInWithCustomToken(token).await() }

    suspend fun sendReset(email: String) { requireAuth().sendPasswordResetEmail(email).await() }

    fun signOut() { auth?.signOut() }

    private fun requireAuth() = auth ?: throw IllegalStateException("Sign-in is not available in this build.")
}

/** Firebase Android error codes -> the site's wording (assets/auth.js friendlyAuthError). */
fun friendlyAuthError(code: String?): String = when (code) {
    "ERROR_INVALID_EMAIL" -> "That email address looks invalid."
    "ERROR_USER_DISABLED" -> "This account has been disabled."
    "ERROR_USER_NOT_FOUND" -> "No account found with that email."
    "ERROR_WRONG_PASSWORD" -> "Incorrect password. Try again or reset it below."
    "ERROR_INVALID_CREDENTIAL" -> "Incorrect email or password."
    "ERROR_TOO_MANY_REQUESTS" -> "Too many attempts. Please wait a moment and try again."
    "ERROR_NETWORK_REQUEST_FAILED" -> "No connection. Check your internet and try again."
    else -> "Something went wrong. Please try again."
}
