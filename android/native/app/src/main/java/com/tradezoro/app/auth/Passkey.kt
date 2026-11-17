package com.tradezoro.app.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.PublicKeyCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/*
 * Passkey sign-in with the website's passkeys (same accounts, RP id tradezoro.com), through the site's own API
 * (functions/api/passkey/[[path]].js, client assets/passkeys.js):
 *   POST /api/passkey/login/options -> {publicKey}      (discoverable: the phone offers the member's tradezoro.com passkeys)
 *   Credential Manager get()         -> the assertion    (needs /.well-known/assetlinks.json get_login_creds for this app)
 *   POST /api/passkey/login/verify   -> {token}          (Firebase custom token) -> signInWithCustomToken
 * The server checks the assertion's origin: android:apk-key-hash:<this app's signing key> is accepted (branch hermes/w-assetlinks).
 * Passkeys are added on the website (Account -> Passkeys); the app only signs in with them.
 */
private const val API = "https://tradezoro.com/api/passkey"
private val JSON_TYPE = "application/json".toMediaType()
private val json = Json { ignoreUnknownKeys = true }

/** The site's {publicKey: {...}} -> the WebAuthn request JSON Credential Manager takes (b64url strings, as the server sends them). */
fun passkeyRequestJson(optionsBody: String): String {
    val pk = json.parseToJsonElement(optionsBody).jsonObject["publicKey"]?.jsonObject ?: error("bad options")
    require(pk["challenge"]?.jsonPrimitive?.contentOrNull?.isNotEmpty() == true) { "no challenge" }
    return pk.toString()
}

/** Credential Manager's authenticationResponseJson -> the body login/verify reads ({id, response{...}}). */
fun passkeyVerifyBody(responseJson: String): String {
    val r = json.parseToJsonElement(responseJson).jsonObject
    val resp = r["response"]?.jsonObject ?: error("bad response")
    val keep = listOf("clientDataJSON", "authenticatorData", "signature", "userHandle")
    return JsonObject(mapOf("id" to r["id"]!!, "rawId" to (r["rawId"] ?: r["id"]!!), "type" to (r["type"] ?: kotlinx.serialization.json.JsonPrimitive("public-key")),
        "response" to JsonObject(resp.filterKeys { it in keep }))).toString()
}

class PasskeyClient(private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()) {
    private suspend fun post(path: String, body: String): String = withContext(Dispatchers.IO) {
        // The API refuses cross-site browser calls by Origin; the app speaks for tradezoro.com, as the site does.
        client.newCall(Request.Builder().url("$API/$path").header("origin", "https://tradezoro.com").post(body.toRequestBody(JSON_TYPE)).build()).execute().use { r ->
            val txt = r.body?.string().orEmpty()
            if (!r.isSuccessful) {
                val msg = runCatching { json.parseToJsonElement(txt).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                throw IllegalStateException(msg ?: if (r.code == 503) "Passkey sign-in is not available right now. Use Google or email." else "That passkey didn't work. Try again or use your email.")
            }
            txt
        }
    }

    /** Firebase custom token for the member's passkey, or null when they cancelled. */
    suspend fun signIn(activityContext: Context): String? {
        val request = passkeyRequestJson(post("login/options", "{}"))
        val cred = try {
            CredentialManager.create(activityContext).getCredential(activityContext,
                GetCredentialRequest(listOf(GetPublicKeyCredentialOption(request)))).credential
        } catch (e: GetCredentialCancellationException) { return null }
        catch (e: NoCredentialException) { throw IllegalStateException("No TradeZoro passkey on this phone. Add one on tradezoro.com (Account, Passkeys), or sign in another way.") }
        val pk = cred as? PublicKeyCredential ?: throw IllegalStateException("That passkey didn't work. Try again or use your email.")
        val out = post("login/verify", passkeyVerifyBody(pk.authenticationResponseJson))
        return json.parseToJsonElement(out).jsonObject["token"]?.jsonPrimitive?.contentOrNull ?: throw IllegalStateException("That passkey didn't work. Try again or use your email.")
    }
}
