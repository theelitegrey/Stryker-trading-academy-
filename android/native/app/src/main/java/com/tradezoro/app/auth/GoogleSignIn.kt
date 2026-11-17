package com.tradezoro.app.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Google sign-in through Credential Manager. Returns the Google ID token for Firebase,
 * null if the member cancelled. The web client ID comes from google-services.json
 * (the plugin generates R.string.default_web_client_id); without it Google sign-in is off.
 */
suspend fun googleIdToken(activityContext: Context): String? {
    @Suppress("DiscouragedApi")
    val id = activityContext.resources.getIdentifier("default_web_client_id", "string", activityContext.packageName)
    check(id != 0) { "Sign-in is not available in this build." }
    val request = GetCredentialRequest.Builder()
        .addCredentialOption(GetSignInWithGoogleOption.Builder(activityContext.getString(id)).build())
        .build()
    return try {
        val cred = CredentialManager.create(activityContext).getCredential(activityContext, request).credential
        if (cred is CustomCredential && (cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL))
            GoogleIdTokenCredential.createFrom(cred.data).idToken
        else null
    } catch (e: GetCredentialCancellationException) { null }
    catch (e: NoCredentialException) { throw IllegalStateException("No Google account on this device. Add one in Settings, or sign in with email.") }
}

/**
 * Silent Google re-check for a member already signed in with Google (no account picker when one authorised account):
 * gives a fresh sign-in so the chart page can be linked to the same member (the site's handoff needs a sign-in from the
 * last 10 minutes). null when it cannot be done without asking.
 */
suspend fun silentGoogleIdToken(activityContext: Context): String? = runCatching {
    @Suppress("DiscouragedApi")
    val id = activityContext.resources.getIdentifier("default_web_client_id", "string", activityContext.packageName)
    if (id == 0) return null
    val request = GetCredentialRequest.Builder().addCredentialOption(
        GetGoogleIdOption.Builder().setServerClientId(activityContext.getString(id)).setFilterByAuthorizedAccounts(true).setAutoSelectEnabled(true).build(),
    ).build()
    val cred = CredentialManager.create(activityContext).getCredential(activityContext, request).credential
    if (cred is CustomCredential && cred.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) GoogleIdTokenCredential.createFrom(cred.data).idToken else null
}.getOrNull()
