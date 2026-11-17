package com.tradezoro.app.data

import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/*
 * Market data agreement + futures data access, decided exactly as the website does:
 *  - Signed = students/{uid}.marketDataAgreement { version: "v1", nonProfessional: true } (assets/market-data-agreement.js
 *    accepted(); server: functions/api/chart/_rt.js hasAgreementDoc). Written only by the server callable.
 *  - Current (not 10-min) futures data = the SERVER's answer: GET /api/chart/rt with the member's ID token -> {admin}
 *    (assets/rt-access.js). The bars endpoint applies the same rule when it gets the token.
 * BUG 17 Nov: the app never sent the token (Home) and the chart page inside the app was signed out, so a member who had
 * signed still got 10-minute data and the "sign the agreement" offer. Fixed by sending the token and signing the chart
 * page in as the same member (ChartAuthLink).
 */
const val MDA_VERSION = "v1"

fun agreementSigned(student: Map<String, Any?>?): Boolean {
    val a = student?.get("marketDataAgreement") as? Map<*, *> ?: return false
    return a["version"] == MDA_VERSION && a["nonProfessional"] == true
}

/** /api/chart/rt body -> true (current data) / false; null when unreadable (unknown is never treated as "no"). */
fun parseRtAnswer(body: String?): Boolean? = runCatching {
    Json.parseToJsonElement(body ?: "").jsonObject["admin"]?.jsonPrimitive?.booleanOrNull
}.getOrNull()

data class DataAccess(
    val signedIn: Boolean = false,
    /** null = not known yet. */
    val agreement: Boolean? = null,
    /** Server says current futures data for this member. null = not known yet. */
    val current: Boolean? = null,
) {
    /** Offer the agreement only when we KNOW it is not signed and the server does not already give current data. */
    val offerAgreement: Boolean get() = agreement == false && current != true
    val label: String get() = when {
        !signedIn -> "Futures update 10 min after the market. Sign in and sign the free data agreement for current data."
        current == true -> "Current futures data"
        agreement == true -> "Agreement signed. Checking your data access\u2026"
        agreement == false -> "Futures update 10 min after the market. Sign the free data agreement for current data."
        else -> "Checking your data access\u2026"
    }
}

class DataAccessRepository(
    private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build(),
) {
    private val ok get() = runCatching { FirebaseApp.getInstance() }.isSuccess

    suspend fun idToken(): String? {
        if (!ok) return null
        val u = FirebaseAuth.getInstance().currentUser ?: return null
        return runCatching { u.getIdToken(false).await().token }.getOrNull()
    }

    suspend fun load(): DataAccess {
        val u = if (ok) FirebaseAuth.getInstance().currentUser else null
        if (u == null) return DataAccess(signedIn = false)
        val agreement = runCatching {
            agreementSigned(FirebaseFirestore.getInstance().collection("students").document(u.uid).get().await().data)
        }.getOrNull()
        val token = idToken()
        val current = token?.let { t ->
            runCatching {
                withContext(Dispatchers.IO) {
                    client.newCall(Request.Builder().url("https://tradezoro.com/api/chart/rt").header("authorization", "Bearer $t").build())
                        .execute().use { r -> if (r.isSuccessful) parseRtAnswer(r.body?.string()) else null }
                }
            }.getOrNull()
        }
        return DataAccess(signedIn = true, agreement = agreement, current = current)
    }
}
