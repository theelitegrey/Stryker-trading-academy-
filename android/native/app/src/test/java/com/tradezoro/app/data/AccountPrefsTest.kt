package com.tradezoro.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The app reads/writes the website's account doc users/{uid}/prefs/app with the same ids and values (account-sync.js). */
class AccountPrefsTest {
    @Test fun themeMapsBothWays() {
        assertEquals(ThemeMode.LIGHT, AccountPrefsCodec.themeOf(mapOf("theme" to "day")))
        assertEquals(ThemeMode.DARK, AccountPrefsCodec.themeOf(mapOf("theme" to "night")))
        assertNull(AccountPrefsCodec.themeOf(mapOf("theme" to "")))          // empty never overrides the phone
        assertNull(AccountPrefsCodec.themeOf(emptyMap()))
        assertEquals("day", AccountPrefsCodec.themeValue(ThemeMode.LIGHT))
        assertEquals("night", AccountPrefsCodec.themeValue(ThemeMode.DARK))
        assertNull(AccountPrefsCodec.themeValue(ThemeMode.SYSTEM))          // "System" is this phone only
    }

    @Test fun mobileTimeframe() {
        assertEquals(Timeframe.M15, AccountPrefsCodec.tfOf(mapOf("mobileDefaultTf" to "M15")))
        assertNull(AccountPrefsCodec.tfOf(mapOf("mobileDefaultTf" to "bogus")))
    }

    @Test fun bodyIsAMergeOfOnlyOurKey() {
        // same shape the website writes and the rules accept: v / t / updatedAt, only the changed id inside v and t,
        // so desktop-only settings in the same doc are never touched by the phone
        val b = AccountPrefsCodec.body("theme", "day", "TS")
        assertEquals(setOf("v", "t", "updatedAt"), b.keys)
        assertEquals(mapOf("theme" to "day"), b["v"])
        assertEquals(mapOf("theme" to "TS"), b["t"])
    }

    @Test fun chartStyle() {
        assertEquals("LINE", AccountPrefsCodec.styleOf(mapOf("mobileChartStyle" to "LINE")))
        assertNull(AccountPrefsCodec.styleOf(mapOf("mobileChartStyle" to "Heikin")))   // unknown value never applied
        assertEquals(mapOf("mobileChartStyle" to "BARS"), AccountPrefsCodec.body(AccountPrefsCodec.MOBILE_STYLE, "BARS", "TS")["v"])
    }

    /** The exact doc the website's assets/account-sync.js wrote in its own test (tools/tests/account-sync.test.mjs
     *  ACCT_FIXTURE=...): the app reads the same ids and values, and leaves the site's other keys alone. */
    @Test fun readsTheDocTheWebsiteWrites() {
        val raw = javaClass.classLoader!!.getResource("account-prefs-app.json")!!.readText()
        val root = kotlinx.serialization.json.Json.parseToJsonElement(raw) as kotlinx.serialization.json.JsonObject
        val v = (root["v"] as kotlinx.serialization.json.JsonObject).mapValues { (it.value as kotlinx.serialization.json.JsonPrimitive).content }
        assertEquals(setOf("v", "t", "updatedAt"), root.keys)
        assertEquals(ThemeMode.DARK, AccountPrefsCodec.themeOf(v))             // site doc says "night" -> the app turns dark
        assertEquals(Timeframe.M15, AccountPrefsCodec.tfOf(v))                 // the phone's own id survived the site's later writes
        // a phone write is a merge of one id: applied to the site's doc, every website key survives
        val merged = v + (AccountPrefsCodec.body("theme", "day", "TS")["v"] as Map<*, *>).mapKeys { it.key as String }.mapValues { it.value as String }
        assertEquals("day", merged["theme"])
        assertEquals(v["globalMonitorTab"], merged["globalMonitorTab"])
    }

    @Test fun unknownDesktopKeysIgnored() {
        val v = mapOf("theme" to "night", "dashMods" to "{\"w\":1200}", "navSections" to "[1,2]")
        assertEquals(ThemeMode.DARK, AccountPrefsCodec.themeOf(v))
        assertNull(AccountPrefsCodec.tfOf(v))
    }
}
