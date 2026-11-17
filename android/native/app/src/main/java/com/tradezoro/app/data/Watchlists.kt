package com.tradezoro.app.data

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.SecureRandom

/*
 * WATCHLISTS, the same storage as the website (assets/chart-watchlist.js), so a list made on one shows on the other:
 *   signed in -> students/{uid}/watchlists/{id} { name, items[], collapsed[], view{}, shared, updatedAt } (owner only,
 *                firestore.rules validWatchlist: name 1-60, items <= 260, id 20-40 chars, updatedAt = server time).
 *                A shared list also mirrors to watchlistShared/{id} { ownerUid, name, items, updatedAt } (as the site).
 *   guest     -> this device only (the site keeps guests in its own localStorage, which the app cannot reach).
 * items[] = symbols ("futures:NQ1!", "fx:EURUSD", "binance:BTCUSDT") and "###NAME" section markers.
 * Caps (client side, like the site): 20 lists, 200 symbols, 260 items.
 */

const val MAX_LISTS = 20
const val MAX_SYMBOLS = 200
const val MAX_ITEMS = 260
const val NAME_MAX = 60

/** [collapsed] and [view] are kept as read so the app never drops the website's own settings when it saves. */
data class Watchlist(
    val id: String,
    val name: String,
    val items: List<String>,
    val collapsed: List<String> = emptyList(),
    val view: Map<String, Any?> = emptyMap(),
    val shared: Boolean = false,
    val updatedAt: Long = 0,
) {
    val symbols: List<String> get() = items.filterNot(::isSection)
}

private val ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
private val rnd = SecureRandom()
/** 20 random letters/digits, the site's rid(). */
fun newListId(): String = buildString { repeat(20) { append(ALPHA[rnd.nextInt(62)]) } }

/** Pure list edits (tested). Each returns the new list, or the same one when nothing changes. */
object WatchEdit {
    sealed interface Result { data class Ok(val list: Watchlist) : Result; data class No(val why: String) : Result }

    fun add(l: Watchlist, rawId: String): Result {
        val id = canonicalId(rawId)
        if (id in l.items) return Result.No("${symbolOf(id).chartTicker} is already in this list.")
        if (l.symbols.size >= MAX_SYMBOLS) return Result.No("A list holds up to $MAX_SYMBOLS symbols.")
        if (l.items.size >= MAX_ITEMS) return Result.No("This list is full.")
        return Result.Ok(l.copy(items = l.items + id))
    }

    fun remove(l: Watchlist, id: String): Watchlist = l.copy(items = l.items.filterNot { it == id })

    /** Moves symbol [id] to the place of symbol [over] (drag and drop in the symbol rows). Sections stay put. */
    fun move(l: Watchlist, id: String, over: String): Watchlist {
        if (id == over) return l
        val items = l.items.toMutableList()
        val from = items.indexOf(id); val to = items.indexOf(over)
        if (from < 0 || to < 0) return l
        items.removeAt(from)
        items.add(to, id)
        return l.copy(items = items)
    }

    fun rename(l: Watchlist, name: String): Watchlist = l.copy(name = cleanName(name).ifEmpty { l.name })

    fun cleanName(s: String) = s.replace(Regex("[\\u0000-\\u001f]"), "").trim().take(NAME_MAX)
}

/** Firestore doc -> list (the site's cloudStore.list shape, with its defaults). */
fun watchlistFrom(id: String, d: Map<String, Any?>): Watchlist = Watchlist(
    id = id,
    name = (d["name"] as? String)?.takeIf { it.isNotEmpty() } ?: "Watchlist",
    items = (d["items"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
    collapsed = (d["collapsed"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
    view = (d["view"] as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value }.orEmpty(),
    shared = d["shared"] == true,
    updatedAt = (d["updatedAt"] as? com.google.firebase.Timestamp)?.toDate()?.time ?: 0,
)

/** List -> Firestore fields. Only the keys firestore.rules allows; updatedAt = server time (the rule demands it). */
fun watchlistFields(l: Watchlist): Map<String, Any> = mapOf(
    "name" to l.name.take(NAME_MAX).ifEmpty { "Watchlist" },
    "items" to l.items.take(MAX_ITEMS),
    "collapsed" to l.collapsed.take(50),
    "view" to l.view.filterValues { it != null }.entries.take(12).associate { it.key to it.value!! },
    "shared" to l.shared,
    "updatedAt" to FieldValue.serverTimestamp(),
)

interface WatchStore {
    val lists: Flow<List<Watchlist>?>
    suspend fun save(l: Watchlist)
    suspend fun remove(l: Watchlist)
}

/** students/{uid}/watchlists, live (a list changed on the website shows here within a second or two). */
class CloudWatchStore(private val uid: String) : WatchStore {
    private val db get() = FirebaseFirestore.getInstance()
    private fun col() = db.collection("students").document(uid).collection("watchlists")
    override val lists: Flow<List<Watchlist>?> = callbackFlow {
        val reg = col().addSnapshotListener { snap, err ->
            if (err != null) { trySend(null); return@addSnapshotListener }
            trySend(snap?.documents.orEmpty().map { watchlistFrom(it.id, it.data.orEmpty()) })
        }
        awaitClose { reg.remove() }
    }
    override suspend fun save(l: Watchlist) {
        col().document(l.id).set(watchlistFields(l)).await()
        if (l.shared) db.collection("watchlistShared").document(l.id)
            .set(mapOf("ownerUid" to uid, "name" to l.name, "items" to l.items.take(MAX_ITEMS), "updatedAt" to FieldValue.serverTimestamp())).await()
    }
    override suspend fun remove(l: Watchlist) {
        if (l.shared) runCatching { db.collection("watchlistShared").document(l.id).delete().await() }
        col().document(l.id).delete().await()
    }
}

/** Guests: this device only, JSON in SharedPreferences (same fields as the site's guest store). */
class LocalWatchStore(ctx: Context) : WatchStore {
    private val prefs = ctx.getSharedPreferences("tz_watchlists", Context.MODE_PRIVATE)
    private val state = MutableStateFlow<List<Watchlist>?>(read())
    override val lists: Flow<List<Watchlist>?> = state
    private fun read(): List<Watchlist> = runCatching {
        Json.parseToJsonElement(prefs.getString("guest", "[]") ?: "[]").jsonArray.map { e ->
            val o = e.jsonObject
            Watchlist(o["id"]!!.jsonPrimitive.content, o["name"]?.jsonPrimitive?.contentOrNull ?: "Watchlist",
                o["items"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty(),
                shared = o["shared"]?.jsonPrimitive?.booleanOrNull ?: false)
        }
    }.getOrDefault(emptyList())
    private fun write(v: List<Watchlist>) {
        prefs.edit().putString("guest", JsonArray(v.map { l ->
            JsonObject(mapOf("id" to JsonPrimitive(l.id), "name" to JsonPrimitive(l.name), "items" to JsonArray(l.items.map(::JsonPrimitive))))
        }).toString()).apply()
        state.value = v
    }
    override suspend fun save(l: Watchlist) { val v = state.value.orEmpty(); write(if (v.any { it.id == l.id }) v.map { if (it.id == l.id) l else it } else v + l) }
    override suspend fun remove(l: Watchlist) = write(state.value.orEmpty().filterNot { it.id == l.id })
}

fun watchStoreFor(ctx: Context): WatchStore {
    val uid = if (runCatching { FirebaseApp.getInstance() }.isSuccess) FirebaseAuth.getInstance().currentUser?.uid else null
    return if (uid != null) CloudWatchStore(uid) else LocalWatchStore(ctx)
}
