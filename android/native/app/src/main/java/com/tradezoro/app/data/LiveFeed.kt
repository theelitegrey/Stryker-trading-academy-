package com.tradezoro.app.data

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/*
 * LIVE prices for the Home watchlist (Owner bug 17 Nov: agreement signed, still polled every 25 s).
 * Futures: the SAME live hub the website's charts use (assets/chart-tick-engine.js + tick-feed-core.js): a WebSocket to
 * the book recorder's /ts-live with the member's Firebase ID token as the "tz-auth" subprotocol, then {op:'tsub', symbol}
 * per root; the hub streams every trade as {type:'tt', symbol, t:[[px, size, side, ts_ms]..]}. The SERVER decides who
 * may connect (src/ts-access.js tsTier: signed agreement / admin / add-on); anyone else gets 403, so the app only
 * opens the socket when /api/chart/rt said "current data" for this member (DataAccess.current).
 * The hub closes sockets at token age with 4401: reconnect at once with a fresh token (as the site does).
 * Crypto: the exchange's public mini-ticker stream (no account needed), the same source as the site's crypto charts.
 */
const val HUB_URL = "wss://book-recorder.theelitegrey.workers.dev/ts-live"
const val CRYPTO_WS = "wss://data-stream.binance.vision/stream"

/** Live only when the server granted current futures data to this member. Unknown (null) is never "live". */
fun liveWanted(d: DataAccess): Boolean = d.signedIn && d.current == true

/** "futures:MNQ1!" -> "MNQ" (the hub's symbol); null for anything else. */
fun hubRoot(id: String): String? = id.takeIf { it.startsWith("futures:") }?.substringAfter(':')?.removeSuffix("1!")?.removeSuffix("2!")

/** "binance:BTCUSDT" -> "BTCUSDT" (spot USDT pairs only); null for anything else. */
fun cryptoPair(id: String): String? = id.takeIf { it.startsWith("binance:") }?.substringAfter(':')?.takeIf { Regex("[A-Z0-9]{2,16}USDT").matches(it) }

private val json = Json { ignoreUnknownKeys = true }

/** One hub frame -> (root, last trade price), or null (pings, status, other frames). */
fun parseHubFrame(text: String): Pair<String, Double>? = runCatching {
    val o = json.parseToJsonElement(text).jsonObject
    val type = o["type"]?.jsonPrimitive?.contentOrNull
    if (type != "tt" && type != "ticks") return null
    val sym = o["symbol"]?.jsonPrimitive?.contentOrNull ?: return null
    val last = (o["t"] as? JsonArray)?.lastOrNull()?.jsonArray?.getOrNull(0)?.jsonPrimitive?.doubleOrNull ?: return null
    if (last > 0 && last.isFinite()) sym to last else null
}.getOrNull()

/** One mini-ticker frame ({"stream","data":{"s","c"}}) -> (pair, last price), or null. */
fun parseCryptoFrame(text: String): Pair<String, Double>? = runCatching {
    val d = json.parseToJsonElement(text).jsonObject["data"]?.jsonObject ?: return null
    val s = d["s"]?.jsonPrimitive?.contentOrNull ?: return null
    val c = d["c"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return null
    if (c > 0) s to c else null
}.getOrNull()

class LiveFeed(
    /** [force] = a fresh token from Firebase (after the hub closed the socket for token age). */
    private val token: suspend (force: Boolean) -> String?,
    private val client: OkHttpClient = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS).build(),
    private val hubUrl: String = HUB_URL,
    private val cryptoUrl: String = CRYPTO_WS,
) {
    /** Streams futures trades for [roots] until cancelled. [onLive] = the hub accepted us and is sending. */
    suspend fun futures(roots: Set<String>, onPrice: (String, Double) -> Unit, onLive: (Boolean) -> Unit) {
        if (roots.isEmpty()) return
        var fails = 0
        var force = false
        while (currentCoroutineContext().isActive) {
            val tok = token(force) ?: run { onLive(false); return }
            force = false
            val code = session(Request.Builder().url(hubUrl).header("Sec-WebSocket-Protocol", "tz-auth, $tok").build(),
                onOpen = { w -> fails = 0; roots.forEach { w.send("{\"op\":\"tsub\",\"symbol\":\"$it\"}") } },
                onText = { t -> if (t.contains("\"hub_attached\"")) onLive(true); parseHubFrame(t)?.let { (s, p) -> onLive(true); onPrice(s, p) } })
            onLive(false)
            when (code) {
                4401 -> { force = true; delay(50) }                    // token age: reconnect at once, fresh token
                403, 4003 -> { force = true; delay(60_000) }           // not (or no longer) allowed: ask again later
                else -> delay(backoff(fails++))
            }
        }
    }

    /** Streams spot crypto last prices for [pairs] ("BTCUSDT") until cancelled. */
    suspend fun crypto(pairs: Set<String>, onPrice: (String, Double) -> Unit) {
        if (pairs.isEmpty()) return
        var fails = 0
        val url = cryptoUrl + "?streams=" + pairs.joinToString("/") { it.lowercase() + "@miniTicker" }
        while (currentCoroutineContext().isActive) {
            session(Request.Builder().url(url).build(), onOpen = { fails = 0 }, onText = { t -> parseCryptoFrame(t)?.let { (s, p) -> onPrice(s, p) } })
            delay(backoff(fails++))
        }
    }

    /** One socket: returns the close code (or the HTTP status of a refused upgrade, -1 on a network error). */
    private suspend fun session(req: Request, onOpen: (WebSocket) -> Unit, onText: (String) -> Unit): Int {
        val done = CompletableDeferred<Int>()
        val ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = onOpen(webSocket)
            override fun onMessage(webSocket: WebSocket, text: String) = onText(text)
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { webSocket.close(1000, null); done.complete(code) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { done.complete(code) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { done.complete(response?.code ?: -1) }
        })
        return try { done.await() } finally { ws.cancel() }
    }

    private fun backoff(n: Int): Long = (500L shl n.coerceAtMost(5)).coerceAtMost(15_000L)
}
