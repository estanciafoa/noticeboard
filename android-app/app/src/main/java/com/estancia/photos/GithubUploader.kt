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

    /** Recent commits that touched the slides/ folder (i.e. photo pushes), newest first. */
    fun fetchHistory(token: String, perPage: Int = 30): List<CommitInfo> {
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
