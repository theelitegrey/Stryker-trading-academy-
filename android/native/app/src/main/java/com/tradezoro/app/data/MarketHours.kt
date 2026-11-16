package com.tradezoro.app.data

import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId

private val NY: ZoneId = ZoneId.of("America/New_York")

/**
 * CME Globex equity-index hours in New York time: Sunday 18:00 to Friday 17:00,
 * with a daily break 17:00-18:00. Exchange holidays are not modelled.
 * shortcut: no holiday calendar; upgrade if members report a wrong chip on a holiday.
 */
fun isFuturesMarketOpen(now: Instant): Boolean {
    val t = now.atZone(NY)
    val mins = t.hour * 60 + t.minute
    return when (t.dayOfWeek) {
        DayOfWeek.SATURDAY -> false
        DayOfWeek.SUNDAY -> mins >= 18 * 60
        DayOfWeek.FRIDAY -> mins < 17 * 60
        else -> mins < 17 * 60 || mins >= 18 * 60
    }
}

enum class DayPart { MORNING, AFTERNOON, EVENING }

fun dayPart(hour: Int): DayPart = when (hour) {
    in 5..11 -> DayPart.MORNING
    in 12..16 -> DayPart.AFTERNOON
    else -> DayPart.EVENING
}
