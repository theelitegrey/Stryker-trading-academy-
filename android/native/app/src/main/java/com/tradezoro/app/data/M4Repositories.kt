package com.tradezoro.app.data

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

class SignInRequired : IOException("sign_in_required")

private val firebaseOk get() = runCatching { FirebaseApp.getInstance() }.isSuccess
private fun uidOrNull() = if (firebaseOk) FirebaseAuth.getInstance().currentUser?.uid else null

/** Omega levels from the site's API with the member's ID token (same call as assets/gex-auth.js + gex.js). */
class GexRepository(
    private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build(),
    private val base: String = "https://tradezoro.com",
) {
    suspend fun levels(m: GexMarket): GexView {
        val user = if (firebaseOk) FirebaseAuth.getInstance().currentUser else null
        if (user == null || user.isAnonymous) throw SignInRequired()
        val token = user.getIdToken(false).await().token ?: throw SignInRequired()
        val body = withContext(Dispatchers.IO) {
            val req = Request.Builder().url("$base/api/gex/levels/${m.api}?dte=1").header("authorization", "Bearer $token").header("accept", "application/json").build()
            client.newCall(req).execute().use { r ->
                if (r.code == 403) throw SignInRequired()
                if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
                r.body?.string() ?: throw IOException("empty body")
            }
        }
        return parseGex(body, m) ?: throw IOException("no levels for ${m.fut}")
    }
}

/** Mentis catalog + the member's completed lessons (students/{uid}, owner read). */
class LearnRepository(private val ctx: Context) {
    fun seed(): List<Chapter> = parseSeed(ctx.assets.open("chapters-seed.json").bufferedReader().use { it.readText() })

    /** The chapters collection when signed in (the site's live catalog); the bundled catalog if that read fails or is empty. */
    suspend fun chapters(): List<Chapter> {
        if (uidOrNull() == null) return seed()
        return runCatching {
            FirebaseFirestore.getInstance().collection("chapters").get().await().documents.mapNotNull { d ->
                val num = d.getString("num") ?: d.id
                val lessons = (d.get("lessons") as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.get("title") as? String }.orEmpty()
                Chapter(num, d.getString("title") ?: return@mapNotNull null, d.getString("track") ?: "core", lessons)
            }
        }.getOrNull()?.takeIf { it.isNotEmpty() } ?: seed()
    }

    fun completed(uid: String): Flow<Set<String>> = callbackFlow {
        val reg = FirebaseFirestore.getInstance().collection("students").document(uid).addSnapshotListener { s, _ ->
            trySend((s?.get("completedLessons") as? List<*>)?.mapNotNull { it as? String }?.toSet().orEmpty())
        }
        awaitClose { reg.remove() }
    }
}

/** Nemesis: students/{uid}/journal (owner-only rule, unchanged). */
class JournalRepository {
    private fun col(uid: String) = FirebaseFirestore.getInstance().collection("students").document(uid).collection("journal")

    fun trades(uid: String): Flow<Result<List<JournalTrade>>> = callbackFlow {
        val reg = col(uid).addSnapshotListener { snap, err ->
            if (err != null) { trySend(Result.failure(err)); return@addSnapshotListener }
            val list = snap?.documents.orEmpty().mapNotNull { journalTradeFrom(it.id, it.data.orEmpty()) }
                .sortedByDescending { it.date + "T" + (it.time ?: "00:00") }
            trySend(Result.success(list))
        }
        awaitClose { reg.remove() }
    }

    /** Same writes as the site's saveTrade: the trade doc, then the achievement counters on the student doc. */
    suspend fun add(doc: Map<String, Any?>) {
        val uid = uidOrNull() ?: throw SignInRequired()
        col(uid).document().set(doc + mapOf("createdAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp())).await()
        val counters = mutableMapOf<String, Any>("journalEntryCount" to FieldValue.increment(1))
        if (((doc["pnl"] as? Double) ?: 0.0) > 0) counters["hasWinningTrade"] = true
        runCatching { FirebaseFirestore.getInstance().collection("students").document(uid).set(counters, SetOptions.merge()).await() }
    }
}
