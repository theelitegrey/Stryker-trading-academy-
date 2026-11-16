package com.tradezoro.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Mentis (the curriculum). Catalog = chapters/{num} (signed-in read) with the site's bundled catalog as fallback
 * (assets/chapters-index.js -> app/src/main/assets/chapters-seed.json, regenerate with the node one-liner in
 * reports/workers/w-android.md). Progress = students/{uid}.completedLessons ("NN-i") as written by the site's reader.
 */
@Serializable
data class Chapter(val num: String, val title: String, val track: String = "core", val lessons: List<String> = emptyList())

/** Same order and names as assets/chapters-store.js TRACKS. */
val TRACK_NAMES = linkedMapOf("core" to "Core curriculum", "vp" to "Volume Profile & Order Flow", "pf" to "Prop Firm Mastery")

private val seedJson = Json { ignoreUnknownKeys = true }
fun parseSeed(body: String): List<Chapter> = seedJson.decodeFromString(body)

data class ChapterProgress(val chapter: Chapter, val done: Int) {
    val total get() = chapter.lessons.size
    val pct get() = if (total == 0) 0 else Math.round(done * 100f / total)
    /** First lesson not yet done (index), or null when complete. */
    fun nextLesson(doneIds: Set<String>): Int? = chapter.lessons.indices.firstOrNull { "${chapter.num}-$it" !in doneIds }
}

data class Continue(val chapter: Chapter, val lessonIndex: Int, val lessonTitle: String, val done: Int, val total: Int)

data class LearnModel(val sections: List<Pair<String, List<ChapterProgress>>>, val cont: Continue?, val doneLessons: Int, val totalLessons: Int)

/** Site rules (assets/courses.js): sort core by num, tracks in TRACKS order; continue = first unfinished core chapter, only once started. */
fun learnModel(chapters: List<Chapter>, done: Set<String>): LearnModel {
    val prog = chapters.map { c -> ChapterProgress(c, c.lessons.indices.count { "${c.num}-$it" in done }) }
    val sections = TRACK_NAMES.mapNotNull { (id, name) ->
        prog.filter { (it.chapter.track.ifBlank { "core" }) == id }.sortedBy { it.chapter.num }.takeIf { it.isNotEmpty() }?.let { name to it }
    }
    val core = sections.firstOrNull()?.second.orEmpty()
    val total = core.sumOf { it.total }
    val doneN = core.sumOf { it.done }
    val target = core.firstOrNull { it.done < it.total }
    val cont = if (doneN == 0 || target == null) null else {
        val i = target.nextLesson(done) ?: 0
        Continue(target.chapter, i, target.chapter.lessons.getOrElse(i) { "" }, target.done, target.total)
    }
    return LearnModel(sections, cont, doneN, total)
}
