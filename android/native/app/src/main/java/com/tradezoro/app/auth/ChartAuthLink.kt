package com.tradezoro.app.auth

import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.TimeUnit

/*
 * Signs the chart page (the WebView) in as the app's member, so the page gets the member's data access (signed market
 * data agreement = current futures data), layouts and paper account instead of a signed-out page that offers the
 * agreement again (Owner bug 17 Nov). Uses the site's existing one-time sign-in handoff (functions/api/desktop, built for
 * the Windows app): POST handoff {nonce} with the member's ID token -> {code}; POST handoff/redeem {code, verifier}
 * -> Firebase custom token; the page then calls signInWithCustomToken (chart-bridge.js TZB.signIn). The server only
 * accepts an ID token from a sign-in in the last 10 minutes, so this runs right after the member signs in in the app;
 * the page keeps its own session after that.
 */
class ChartAuthLink(private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()) {
    private val json = Json { ignoreUnknownKeys = true }
    private val type = "application/json".toMediaType()

    /** Custom token for the current member, or null (signed out, sign-in too old, offline). Never logs the token. */
    suspend fun customToken(): String? {
        val user = FirebaseAuth.getInstance().currentUser ?: return null
        val id = runCatching { user.getIdToken(false).await().token }.getOrNull() ?: return null
        val verifier = b64u(ByteArray(32).also { SecureRandom().nextBytes(it) })
        val nonce = b64u(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()))
        val code = post("handoff", "{\"nonce\":\"$nonce\"}", id)?.let { field(it, "code") } ?: return null
        return post("handoff/redeem", "{\"code\":\"$code\",\"verifier\":\"$verifier\"}", null)?.let { field(it, "token") }
    }

    private fun field(body: String, k: String) = runCatching { json.parseToJsonElement(body).jsonObject[k]?.jsonPrimitive?.contentOrNull }.getOrNull()

    private suspend fun post(path: String, body: String, bearer: String?): String? = withContext(Dispatchers.IO) {
        runCatching {
            val b = Request.Builder().url("https://tradezoro.com/api/desktop/$path").post(body.toRequestBody(type))
            if (bearer != null) b.header("authorization", "Bearer $bearer").header("origin", "https://tradezoro.com")
            client.newCall(b.build()).execute().use { r -> if (r.isSuccessful) r.body?.string() else null }
        }.getOrNull()
    }

    companion object {
        fun b64u(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
    }
}
