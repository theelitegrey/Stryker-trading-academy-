package com.tradezoro.app.data

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/**
 * Nemesis (journal). Same collection and shape as the site: students/{uid}/journal/{id}, docs starting with "_" are
 * settings (assets/journal-data.js). Derived fields follow assets/journal-calc.js so a trade added in the app reads
 * the same on the website.
 */
data class JournalTrade(
    val id: String,
    val instrument: String,
    val direction: String,          // long | short
    val date: String,               // yyyy-MM-dd
    val time: String?,
    val positionSize: Double?,
    val pnl: Double?,
    val tags: List<String> = emptyList(),
)

private fun Any?.toD(): Double? = when (this) { is Number -> toDouble(); is String -> toDoubleOrNull(); else -> null }

/** Firestore map -> trade; null for reserved docs and anything without a date. */
fun journalTradeFrom(id: String, d: Map<String, Any?>): JournalTrade? {
    if (id.startsWith("_")) return null
    val date = d["date"] as? String ?: return null
    return JournalTrade(
        id, (d["instrument"] as? String).orEmpty(), (d["direction"] as? String) ?: "long", date, d["time"] as? String,
        d["positionSize"].toD(), d["pnl"].toD() ?: journalPnl(d["direction"] as? String, d["entryPrice"].toD(), d["exitPrice"].toD(), d["positionSize"].toD(), d["fees"].toD()),
        (d["tags"] as? List<*>)?.filterIsInstance<String>().orEmpty(),
    )
}

/** journalCalcPnl: (exit - entry) x size (reversed for short) - fees. */
fun journalPnl(direction: String?, entry: Double?, exit: Double?, size: Double?, fees: Double?): Double? {
    if (entry == null || exit == null || size == null) return null
    val raw = if (direction == "short") (entry - exit) * size else (exit - entry) * size
    return raw - (fees ?: 0.0)
}

fun journalResult(pnl: Double?): String? = when { pnl == null -> null; pnl > 0 -> "Win"; pnl < 0 -> "Loss"; else -> "Breakeven" }

/** One calendar day: net P&L of its closed trades (null = no trades). */
data class DayCell(val date: LocalDate, val pnl: Double?, val trades: Int)

data class MonthStats(val winDays: Int, val tradedDays: Int, val avgTrade: Double?, val net: Double, val closed: Int)

/** Weekdays (Mon-Fri) of the month, as in the mock; weekend trades still count in the stats. */
fun monthCells(month: YearMonth, trades: List<JournalTrade>): List<DayCell?> {
    val byDay = trades.filter { it.date.startsWith(month.toString()) }.groupBy { it.date }
    val days = (1..month.lengthOfMonth()).map { month.atDay(it) }.filter { it.dayOfWeek.value <= 5 }
    if (days.isEmpty()) return emptyList()
    val lead = days.first().dayOfWeek.value - DayOfWeek.MONDAY.value
    return List<DayCell?>(lead) { null } + days.map { d ->
        val list = byDay[d.toString()].orEmpty()
        val closed = list.mapNotNull { it.pnl }
        DayCell(d, if (closed.isEmpty()) null else closed.sum(), list.size)
    }
}

fun monthStats(month: YearMonth, trades: List<JournalTrade>): MonthStats {
    val inMonth = trades.filter { it.date.startsWith(month.toString()) }
    val closed = inMonth.mapNotNull { it.pnl }
    val perDay = inMonth.filter { it.pnl != null }.groupBy { it.date }.mapValues { (_, l) -> l.sumOf { it.pnl!! } }
    return MonthStats(perDay.count { it.value > 0 }, perDay.size, if (closed.isEmpty()) null else closed.average(), closed.sum(), closed.size)
}

/** "+$21.40" / "−$42.50" (journalFormatCurrency, USD; true minus sign). */
fun formatUsd(v: Double): String = (if (v < 0) "\u2212" else "+") + "$" + formatPrice(kotlin.math.abs(v), 2)

/** Raw form values -> the document the site's saveTrade writes (raw fields as strings, like the form, + derived).
 *  No stop loss in the quick-add form, so the risk fields are null, as on the site without a stop. */
fun newTradeDoc(instrument: String, direction: String, date: String, time: String?, entry: Double, exit: Double, size: Double, fees: Double): Map<String, Any?> {
    val pnl = journalPnl(direction, entry, exit, size, fees)
    return mapOf(
        "instrument" to instrument, "direction" to direction, "date" to date, "time" to time,
        "entryPrice" to entry.toString(), "exitPrice" to exit.toString(), "positionSize" to size.toString(), "fees" to fees.toString(),
        "stopLoss" to null, "takeProfit" to null, "session" to "", "setup" to "", "account" to "", "tags" to emptyList<String>(),
        "playbookId" to null, "rulesMet" to null, "notes" to "", "screenshotDataUrl" to null,
        "pnl" to pnl, "riskAmount" to null, "riskPercent" to null, "rMultiple" to null, "plannedRR" to null,
        "result" to journalResult(pnl),
    )
}
