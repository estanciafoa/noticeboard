package com.estancia.photos

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * GitHub Contents API client. Overwrites a slide atomically by fetching its
 * current sha first and sending it with the PUT (so re-uploading the same
 * filename replaces it cleanly, no delete step).
 *
 * All methods block — call them off the main thread.
 */
object GithubUploader {

    private const val OWNER = "estanciafoa"
    private const val REPO = "noticeboard"
    private const val BRANCH = "main"
    private const val API = "https://api.github.com/repos/$OWNER/$REPO"
    private const val UA = "EstanciaPhotos-Android"

    class UploadException(message: String) : Exception(message)

    /** One row in the push history. */
    data class CommitInfo(val message: String, val isoDate: String, val author: String)

    private fun open(url: String, token: String, method: String): HttpURLConnection {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 15000
        conn.readTimeout = 30000
        if (token.isNotBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.setRequestProperty("User-Agent", UA)
        conn.setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
        return conn
    }

    private fun HttpURLConnection.bodyText(): String {
        val stream = if (responseCode in 200..299) inputStream else (errorStream ?: inputStream)
        return stream?.bufferedReader()?.use(BufferedReader::readText) ?: ""
    }

    /** True if the token can read this repo. */
    fun validateToken(token: String): Boolean {
        if (token.isBlank()) return false
        return try {
            val conn = open(API, token, "GET")
            val code = conn.responseCode
            conn.disconnect()
            code == 200
        } catch (_: Exception) {
            false
        }
    }

    /** Current sha of slides/<file>, or null if it doesn't exist yet (404). */
    private fun fetchSha(token: String, file: String): String? {
        val enc = URLEncoder.encode(file, "UTF-8").replace("+", "%20")
        val conn = open("$API/contents/slides/$enc?ref=$BRANCH", token, "GET")
        val code = conn.responseCode
        if (code == 404) { conn.disconnect(); return null }
        val text = conn.bodyText()
        conn.disconnect()
        if (code != 200) throw UploadException("Could not read existing slide (HTTP $code).")
        return JSONObject(text).optString("sha").ifBlank { null }
    }

    private fun put(token: String, file: String, base64: String, message: String, sha: String?): Int {
        val enc = URLEncoder.encode(file, "UTF-8").replace("+", "%20")
        val conn = open("$API/contents/slides/$enc", token, "PUT")
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val payload = JSONObject().apply {
            put("message", message)
            put("content", base64)
            put("branch", BRANCH)
            if (sha != null) put("sha", sha)
        }
        conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        if (code !in 200..299) {
            val detail = try { JSONObject(conn.bodyText()).optString("message") } catch (_: Exception) { "" }
            conn.disconnect()
            throw UploadException("Upload failed (HTTP $code)${if (detail.isNotBlank()) ": $detail" else ""}")
        }
        conn.disconnect()
        return code
    }

    /** Upload [jpegBytes] to slides/<file>, overwriting if present. Retries once on sha conflict. */
    fun uploadSlide(token: String, file: String, jpegBytes: ByteArray, message: String) {
        if (token.isBlank()) throw UploadException("No access token. Open Admin and paste your token.")
        val base64 = Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
        var sha = fetchSha(token, file)
        try {
            put(token, file, base64, message, sha)
        } catch (e: UploadException) {
            // Stale/missing sha (409/422) — re-read once and retry.
            sha = fetchSha(token, file)
            put(token, file, base64, message, sha)
        }
    }

    // ---- config.json (slide → tower mapping) --------------------------------

    private const val CONFIG_PATH = "config.json"

    /** The parsed config.json object and the blob sha needed to update it. */
    private fun fetchConfig(token: String): Pair<JSONObject, String> {
        val conn = open("$API/contents/$CONFIG_PATH?ref=$BRANCH", token, "GET")
        val code = conn.responseCode
        val text = conn.bodyText()
        conn.disconnect()
        if (code != 200) throw UploadException("Could not read config.json (HTTP $code).")
        val meta = JSONObject(text)
        val sha = meta.optString("sha")
        val decoded = String(Base64.decode(meta.optString("content"), Base64.DEFAULT), Charsets.UTF_8)
        return Pair(JSONObject(decoded), sha)
    }

    private fun putConfig(token: String, config: JSONObject, sha: String, message: String) {
        val conn = open("$API/contents/$CONFIG_PATH", token, "PUT")
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        val content = Base64.encodeToString(config.toString(2).toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val payload = JSONObject().apply {
            put("message", message)
            put("content", content)
            put("branch", BRANCH)
            put("sha", sha)
        }
        conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        if (code !in 200..299) {
            val detail = try { JSONObject(conn.bodyText()).optString("message") } catch (_: Exception) { "" }
            conn.disconnect()
            throw UploadException("Config update failed (HTTP $code)${if (detail.isNotBlank()) ": $detail" else ""}")
        }
        conn.disconnect()
    }

    /**
     * Set the `towers` (display locations) of the config.json slide named [file],
     * adding the slide entry if it's missing. Retries once on a sha conflict.
     */
    fun setSlideTowers(token: String, file: String, towers: String, message: String) {
        if (token.isBlank()) throw UploadException("No access token.")
        try {
            applyTowers(token, file, towers, message)
        } catch (e: UploadException) {
            // Stale sha (someone else saved config) — re-read once and retry.
            applyTowers(token, file, towers, message)
        }
    }

    private fun applyTowers(token: String, file: String, towers: String, message: String) {
        val (config, sha) = fetchConfig(token)
        val slides = config.optJSONArray("slides") ?: JSONArray().also { config.put("slides", it) }
        var found = false
        for (i in 0 until slides.length()) {
            val s = slides.optJSONObject(i) ?: continue
            if (s.optString("name") == file) {
                s.put("towers", towers)
                found = true
                break
            }
        }
        if (!found) {
            slides.put(JSONObject().apply {
                put("name", file)
                put("duration", "")
                put("times", JSONArray())
                put("dates", JSONArray())
                put("expiry", "")
                put("towers", towers)
            })
        }
        putConfig(token, config, sha, message)
    }

    // ---- board deck management (config.json slides[]) -----------------------

    /**
     * One slide in the board deck, in display order.
     *
     * [towers] is the comma-separated list of display locations the slide shows
     * on; an empty string means the slide is hidden (shows nowhere). [savedTowers]
     * holds the locations to restore when un-hiding — set by [hideSlide], cleared
     * once restored. Both are ignored by the displays except for [towers].
     */
    data class DeckSlide(val name: String, val towers: String, val savedTowers: String) {
        val hidden: Boolean get() = towers.isBlank()
    }

    private val MEDIA_EXT = Regex("\\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|m4v)$", RegexOption.IGNORE_CASE)

    /** The board deck (config.json slides[]) in display order. */
    fun fetchDeck(token: String): List<DeckSlide> {
        if (token.isBlank()) throw UploadException("No access token.")
        val (config, _) = fetchConfig(token)
        val slides = config.optJSONArray("slides") ?: JSONArray()
        val out = ArrayList<DeckSlide>(slides.length())
        for (i in 0 until slides.length()) {
            val s = slides.optJSONObject(i) ?: continue
            val name = s.optString("name")
            if (name.isBlank()) continue
            out.add(DeckSlide(name, s.optString("towers"), s.optString("savedTowers")))
        }
        return out
    }

    /** The display-heartbeat backend URL from config.json (empty if unset). */
    fun fetchHeartbeatUrl(token: String): String {
        if (token.isBlank()) throw UploadException("No access token.")
        val (config, _) = fetchConfig(token)
        return config.optString("heartbeatUrl").trim()
    }

    /** All media files in the slides/ folder (case-sensitive), for the "add" picker. */
    fun fetchSlideFiles(token: String): List<String> {
        val conn = open("$API/contents/slides?ref=$BRANCH", token, "GET")
        val code = conn.responseCode
        val text = conn.bodyText()
        conn.disconnect()
        if (code != 200) throw UploadException("Could not list slides/ (HTTP $code).")
        val arr = JSONArray(text)
        val out = ArrayList<String>(arr.length())
        for (i in 0 until arr.length()) {
            val f = arr.optJSONObject(i) ?: continue
            if (f.optString("type") != "file") continue
            val name = f.optString("name")
            if (name.isNotBlank() && MEDIA_EXT.containsMatchIn(name)) out.add(name)
        }
        return out
    }

    /** Index of the slide named [name] in [slides], or -1. */
    private fun findSlide(slides: JSONArray, name: String): Int {
        for (i in 0 until slides.length()) {
            if (slides.optJSONObject(i)?.optString("name") == name) return i
        }
        return -1
    }

    private fun newSlideEntry(name: String) = JSONObject().apply {
        put("name", name)
        put("duration", "")
        put("times", JSONArray())
        put("dates", JSONArray())
        put("expiry", "")
        put("towers", "")
    }

    /**
     * Fetch config.json, apply [op] to its slides[] array, and write it back.
     * Retries once on a sha conflict (someone else saved in between).
     */
    private fun mutateDeck(token: String, message: String, op: (JSONArray) -> Unit) {
        if (token.isBlank()) throw UploadException("No access token.")
        fun apply() {
            val (config, sha) = fetchConfig(token)
            val slides = config.optJSONArray("slides") ?: JSONArray().also { config.put("slides", it) }
            op(slides)
            putConfig(token, config, sha, message)
        }
        try { apply() } catch (e: UploadException) { apply() }
    }

    /**
     * Insert (or move) the slide [name] to [index] (0-based, clamped to the deck
     * size) with the given [towers]. Creates the config entry if it's new, else
     * moves the existing entry, preserving its other settings.
     */
    fun placeSlideAt(token: String, name: String, index: Int, towers: String, message: String) {
        mutateDeck(token, message) { slides ->
            val existing = findSlide(slides, name)
            val obj = if (existing >= 0) slides.getJSONObject(existing) else newSlideEntry(name)
            obj.put("towers", towers)
            // Keep the remembered hidden-state when moving a hidden slide (towers
            // still blank); otherwise the slide is now visible, so drop it.
            if (towers.isNotBlank()) obj.remove("savedTowers")
            val kept = ArrayList<JSONObject>(slides.length())
            for (i in 0 until slides.length()) {
                if (i == existing) continue
                slides.optJSONObject(i)?.let { kept.add(it) }
            }
            val at = index.coerceIn(0, kept.size)
            kept.add(at, obj)
            while (slides.length() > 0) slides.remove(slides.length() - 1)
            kept.forEach { slides.put(it) }
        }
    }

    /**
     * Set the display locations of the existing slide [name] without moving it,
     * clearing any remembered hidden-state. Adds the entry if missing.
     */
    fun updateSlideLocations(token: String, name: String, towers: String, message: String) {
        mutateDeck(token, message) { slides ->
            val i = findSlide(slides, name)
            val obj = if (i >= 0) slides.getJSONObject(i) else newSlideEntry(name).also { slides.put(it) }
            obj.put("towers", towers)
            obj.remove("savedTowers")
        }
    }

    /** Hide [name]: clear its locations (shows nowhere), remembering them to restore later. */
    fun hideSlide(token: String, name: String, message: String) {
        mutateDeck(token, message) { slides ->
            val i = findSlide(slides, name)
            if (i >= 0) {
                val o = slides.getJSONObject(i)
                val cur = o.optString("towers")
                if (cur.isNotBlank()) o.put("savedTowers", cur)
                o.put("towers", "")
            }
        }
    }

    /** Un-hide [name]: restore its remembered locations, or [fallbackTowers] if none were saved. */
    fun showSlide(token: String, name: String, fallbackTowers: String, message: String) {
        mutateDeck(token, message) { slides ->
            val i = findSlide(slides, name)
            if (i >= 0) {
                val o = slides.getJSONObject(i)
                val saved = o.optString("savedTowers")
                o.put("towers", if (saved.isNotBlank()) saved else fallbackTowers)
                o.remove("savedTowers")
            }
        }
    }

    // ---- ticker.txt (scheduled ticker) --------------------------------------

    private const val TICKER_PATH = "ticker.txt"

    private val DEFAULT_TICKER_HEADER = listOf(
        "# ESTANCIA NOTICEBOARD — SCHEDULED TICKER",
        "# location | start | expiry | attention | message",
        "#   location : t1c1..t5c2, club, gate, or 'all' (comma-separate several)",
        "#   start/expiry : YYYY-MM-DD HH:MM (blank start = now, blank expiry = never)",
        "#   message : use | for line breaks. # lines and blanks are ignored."
    )

    /** One scheduled ticker line. Mutable so the editor can modify it in place. */
    data class TickerRow(
        var location: String,
        var start: String,
        var expiry: String,
        var attention: String,
        var message: String
    )

    /** Parsed ticker.txt: preserved header comments, the rows, and the blob sha. */
    class TickerFile(var sha: String?, val header: MutableList<String>, val rows: MutableList<TickerRow>)

    /** Thrown when a save is rejected because ticker.txt changed on the server. */
    class ConflictException(message: String) : Exception(message)

    /** Read and parse ticker.txt. Returns an empty file (default header) if absent. */
    fun fetchTickerFile(token: String): TickerFile {
        if (token.isBlank()) throw UploadException("No access token.")
        val get = open("$API/contents/$TICKER_PATH?ref=$BRANCH", token, "GET")
        val code = get.responseCode
        val text = get.bodyText()
        get.disconnect()
        if (code == 404) return TickerFile(null, DEFAULT_TICKER_HEADER.toMutableList(), mutableListOf())
        if (code != 200) throw UploadException("Could not read ticker.txt (HTTP $code).")
        val meta = JSONObject(text)
        val sha = meta.optString("sha").ifBlank { null }
        val content = String(Base64.decode(meta.optString("content"), Base64.DEFAULT), Charsets.UTF_8)

        val header = mutableListOf<String>()
        val rows = mutableListOf<TickerRow>()
        content.split("\n").forEach { line ->
            val t = line.trim()
            if (t.startsWith("#")) { header.add(line); return@forEach }
            if (t.isEmpty()) return@forEach
            val parts = line.split("|")
            val loc = parts.getOrElse(0) { "" }.trim()
            if (loc.isEmpty()) return@forEach
            rows.add(TickerRow(
                loc,
                parts.getOrElse(1) { "" }.trim(),
                parts.getOrElse(2) { "" }.trim(),
                parts.getOrElse(3) { "" }.trim(),
                parts.drop(4).joinToString("|").trim()
            ))
        }
        if (header.isEmpty()) header.addAll(DEFAULT_TICKER_HEADER)
        return TickerFile(sha, header, rows)
    }

    /**
     * Write [file] back to ticker.txt using its held sha. On success the sha is
     * updated in place. Throws [ConflictException] if the file changed on the
     * server (held sha stale) so the caller can reload before retrying.
     */
    fun saveTickerFile(token: String, file: TickerFile, message: String) {
        if (token.isBlank()) throw UploadException("No access token.")

        val sb = StringBuilder()
        file.header.forEach { sb.append(it).append("\n") }
        if (file.header.isNotEmpty() && file.header.last().trim().isNotEmpty()) sb.append("\n")
        file.rows.forEach { r ->
            if (r.location.isBlank() || r.message.isBlank()) return@forEach
            sb.append("${r.location} | ${r.start} | ${r.expiry} | ${r.attention} | ${r.message}\n")
        }

        val putConn = open("$API/contents/$TICKER_PATH", token, "PUT")
        putConn.doOutput = true
        putConn.setRequestProperty("Content-Type", "application/json")
        val payload = JSONObject().apply {
            put("message", message)
            put("content", Base64.encodeToString(sb.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP))
            put("branch", BRANCH)
            if (file.sha != null) put("sha", file.sha)
        }
        putConn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
        val pcode = putConn.responseCode
        val body = putConn.bodyText()
        putConn.disconnect()
        if (pcode == 409 || pcode == 422) {
            throw ConflictException("ticker.txt changed on the server. Reload and try again.")
        }
        if (pcode !in 200..299) {
            val detail = try { JSONObject(body).optString("message") } catch (_: Exception) { "" }
            throw UploadException("Schedule update failed (HTTP $pcode)${if (detail.isNotBlank()) ": $detail" else ""}")
        }
        file.sha = try { JSONObject(body).getJSONObject("content").optString("sha").ifBlank { null } } catch (_: Exception) { null }
    }

    /** Recent commits that touched the slides/ folder (i.e. photo pushes), newest first. */
    fun fetchHistory(token: String, perPage: Int = 10): List<CommitInfo> {
        val conn = open("$API/commits?path=slides&per_page=$perPage", token, "GET")
        val code = conn.responseCode
        val text = conn.bodyText()
        conn.disconnect()
        if (code != 200) throw UploadException("Could not load history (HTTP $code).")
        val arr = JSONArray(text)
        val list = ArrayList<CommitInfo>(arr.length())
        for (i in 0 until arr.length()) {
            val commit = arr.getJSONObject(i).getJSONObject("commit")
            val author = commit.optJSONObject("author")
            list.add(
                CommitInfo(
                    message = commit.optString("message").substringBefore("\n"),
                    isoDate = author?.optString("date") ?: "",
                    author = author?.optString("name") ?: ""
                )
            )
        }
        return list
    }
}
