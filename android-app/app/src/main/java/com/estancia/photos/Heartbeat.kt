package com.estancia.photos

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max

/**
 * Reads per-display heartbeats from the Google Apps Script backend (the
 * `heartbeatUrl` in config.json) and derives each display's online state.
 *
 * A display POSTs a heartbeat on boot and every config refresh (~15 min). If we
 * haven't heard from one in [STALE_MS] it's treated as offline. Mirrors the web
 * admin's status panel (js/status.js). All methods block — call off the main thread.
 */
object Heartbeat {

    /** No heartbeat for this long → offline. Matches STALE_MS in js/status.js. */
    private const val STALE_MS = 35L * 60 * 1000
    private const val UA = "EstanciaPhotos-Android"

    class HeartbeatException(message: String) : Exception(message)

    /** One display's derived state. [state] is "online" | "offline" | "never". */
    data class DisplayState(
        val id: String,
        val label: String,
        val state: String,
        val lastSeenMs: Long,
        val ageMs: Long,
        val version: String,
        val slides: Int,
    )

    /** now (server clock), all displays worst-state-first, and the online count. */
    data class Result(val nowMs: Long, val states: List<DisplayState>, val onlineCount: Int, val total: Int)

    fun fetch(url: String): Result {
        if (url.isBlank()) throw HeartbeatException("No backend URL set in config.json.")
        val full = url + (if (url.contains("?")) "&" else "?") + "t=" + System.currentTimeMillis()
        val conn = URL(full).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 15000
        conn.readTimeout = 20000
        conn.instanceFollowRedirects = true   // Apps Script /exec 302s to googleusercontent
        conn.setRequestProperty("User-Agent", UA)
        val code = conn.responseCode
        val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        conn.disconnect()
        if (code !in 200..299) throw HeartbeatException("Backend returned HTTP $code.")

        val json = try { JSONObject(text) } catch (_: Exception) {
            throw HeartbeatException("Backend didn't return JSON. Check the /exec URL and that access is \"Anyone\".")
        }
        val now = json.optLong("now", System.currentTimeMillis())
        val arr = json.optJSONArray("displays") ?: JSONArray()
        val byTv = HashMap<String, JSONObject>()
        for (i in 0 until arr.length()) {
            val d = arr.optJSONObject(i) ?: continue
            byTv[d.optString("tv").lowercase()] = d
        }

        val states = Locations.ALL.map { loc ->
            val hb = byTv[loc.id]
            val lastSeen = hb?.optLong("lastSeen", 0L) ?: 0L
            val age = if (lastSeen > 0) now - lastSeen else Long.MAX_VALUE
            val state = when {
                hb == null || lastSeen <= 0 -> "never"
                age > STALE_MS -> "offline"
                else -> "online"
            }
            DisplayState(loc.id, loc.label, state, lastSeen, age,
                hb?.optString("version") ?: "", hb?.optInt("slides", -1) ?: -1)
        }

        val rank = mapOf("offline" to 0, "never" to 1, "online" to 2)
        val sorted = states.sortedWith(compareBy({ rank[it.state] ?: 3 }, { -it.lastSeenMs }))
        val online = sorted.count { it.state == "online" }
        return Result(now, sorted, online, sorted.size)
    }

    /** Human-readable "last seen" from an age in ms. */
    fun relativeTime(ageMs: Long): String {
        if (ageMs == Long.MAX_VALUE) return "never reported"
        val s = max(0L, ageMs / 1000)
        if (s < 60) return "${s}s ago"
        val m = s / 60
        if (m < 60) return "$m min ago"
        val h = m / 60
        val rem = m % 60
        if (h < 24) return if (rem > 0) "${h}h ${rem}m ago" else "${h}h ago"
        val d = h / 24
        return "$d day${if (d == 1L) "" else "s"} ago"
    }
}
