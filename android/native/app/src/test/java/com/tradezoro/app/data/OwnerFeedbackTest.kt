package com.tradezoro.app.data

import com.tradezoro.app.auth.passkeyRequestJson
import com.tradezoro.app.auth.passkeyVerifyBody
import com.tradezoro.app.ui.chart.chartTitle
import com.tradezoro.app.ui.chart.wheelSymbols
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Owner feedback 17 Nov: agreement bug (11), watchlist edits (5/6/7), passkey JSON (2), chart title + wheel (8/9). */
class OwnerFeedbackTest {

    // ---- 11: market-data agreement, read exactly as assets/market-data-agreement.js accepted() ----
    @Test fun agreementSignedAndNotSigned() {
        val signed = mapOf<String, Any?>("marketDataAgreement" to mapOf("version" to "v1", "nonProfessional" to true))
        val unsigned = mapOf<String, Any?>("email" to "a@b.c")
        assertTrue(agreementSigned(signed))
        assertFalse(agreementSigned(unsigned))
        assertFalse(agreementSigned(null))
        assertFalse("old version", agreementSigned(mapOf("marketDataAgreement" to mapOf("version" to "v0", "nonProfessional" to true))))
        assertFalse("professional", agreementSigned(mapOf("marketDataAgreement" to mapOf("version" to "v1", "nonProfessional" to false))))
    }

    @Test fun signedMemberIsNeverAskedAgain() {
        // The bug: a signed member was offered the agreement. Signed -> never offered, whatever the rt answer.
        assertFalse(DataAccess(signedIn = true, agreement = true, current = null).offerAgreement)
        assertFalse(DataAccess(signedIn = true, agreement = true, current = false).offerAgreement)
        assertEquals("Current futures data", DataAccess(signedIn = true, agreement = true, current = true).label)
        // Not signed -> offered, unless the server already grants current data (admin, add-on).
        assertTrue(DataAccess(signedIn = true, agreement = false, current = false).offerAgreement)
        assertFalse(DataAccess(signedIn = true, agreement = false, current = true).offerAgreement)
        // Unknown (still loading / offline) is never treated as "not signed".
        assertFalse(DataAccess(signedIn = true, agreement = null, current = null).offerAgreement)
    }

    @Test fun rtAnswer() {
        assertEquals(true, parseRtAnswer("""{"admin":true,"l2":false}"""))
        assertEquals(false, parseRtAnswer("""{"admin":false}"""))
        assertNull(parseRtAnswer("<html>"))
        assertNull(parseRtAnswer(null))
    }

    // ---- 5/6/7: watchlist edits + the site's Firestore shape ----
    private val base = Watchlist("abcdefghijklmnopqrst", "Main", listOf("###FUTURES", "futures:NQ1!", "futures:ES1!", "binance:BTCUSDT"))

    @Test fun addRemoveMove() {
        val added = (WatchEdit.add(base, "MNQ1!") as WatchEdit.Result.Ok).list
        assertEquals("futures:MNQ1!", added.items.last())
        assertTrue(WatchEdit.add(base, "futures:NQ1!") is WatchEdit.Result.No)
        assertEquals(listOf("###FUTURES", "futures:ES1!", "binance:BTCUSDT"), WatchEdit.remove(base, "futures:NQ1!").items)
        assertEquals(listOf("###FUTURES", "futures:ES1!", "futures:NQ1!", "binance:BTCUSDT"), WatchEdit.move(base, "futures:NQ1!", "futures:ES1!").items)
        assertEquals("Swing", WatchEdit.rename(base, "  Swing\u0007 ").name)
        assertEquals("Main", WatchEdit.rename(base, "   ").name)
        assertEquals(NAME_MAX, WatchEdit.cleanName("x".repeat(99)).length)
    }

    @Test fun capsLikeTheSite() {
        val full = base.copy(items = List(MAX_SYMBOLS) { "fx:P$it" })
        assertTrue(WatchEdit.add(full, "futures:GC1!") is WatchEdit.Result.No)
    }

    @Test fun firestoreRoundTripKeepsSiteFields() {
        val doc = mapOf<String, Any?>("name" to "Main", "items" to base.items, "collapsed" to listOf("FOREX"),
            "view" to mapOf("table" to true, "disp" to "symbol"), "shared" to false)
        val l = watchlistFrom("abcdefghijklmnopqrst", doc)
        assertEquals(base.items, l.items); assertEquals(listOf("FOREX"), l.collapsed); assertEquals("symbol", l.view["disp"])
        // Only the keys firestore.rules validWatchlist allows.
        val keys = listOf("name", "items", "collapsed", "view", "shared", "updatedAt")
        assertEquals(keys.toSet(), watchlistFields(l).keys)
        assertEquals("Watchlist", watchlistFrom("x".repeat(20), emptyMap()).name)
        val id = newListId(); assertEquals(20, id.length); assertTrue(id.all { it.isLetterOrDigit() })
    }

    // ---- 2: passkey JSON in / out (the site's API shapes) ----
    @Test fun passkeyJson() {
        val req = passkeyRequestJson("""{"publicKey":{"challenge":"abc","rpId":"tradezoro.com","timeout":60000,"userVerification":"required","allowCredentials":[]}}""")
        val o = Json.parseToJsonElement(req).jsonObject
        assertEquals("tradezoro.com", o["rpId"]!!.jsonPrimitive.content); assertEquals("abc", o["challenge"]!!.jsonPrimitive.content)
        val out = Json.parseToJsonElement(passkeyVerifyBody(
            """{"id":"cid","rawId":"cid","type":"public-key","response":{"clientDataJSON":"c","authenticatorData":"a","signature":"s","userHandle":"u","extra":"x"},"clientExtensionResults":{}}""")).jsonObject
        assertEquals("cid", out["id"]!!.jsonPrimitive.content)
        val r = out["response"]!!.jsonObject
        assertEquals(setOf("clientDataJSON", "authenticatorData", "signature", "userHandle"), r.keys)
    }

    // ---- 8/9: chart title and wheel ----
    @Test fun chartTitleAndWheel() {
        assertEquals("NQ1! \u00b7 CME", chartTitle("futures:NQ1!"))
        assertEquals("NQ1! \u00b7 CME", chartTitle("NQ1!"))
        assertEquals("", chartTitle(""))
        assertEquals(listOf("futures:NQ1!", "futures:ES1!"), wheelSymbols(listOf("futures:NQ1!", "futures:ES1!"), "NQ1!"))
        assertEquals(listOf("futures:GC1!", "futures:NQ1!"), wheelSymbols(listOf("futures:NQ1!"), "GC1!"))
    }
}
