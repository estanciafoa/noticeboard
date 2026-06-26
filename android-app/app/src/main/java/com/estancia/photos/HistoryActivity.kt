package com.estancia.photos

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/** Shows recent uploads (commits that touched the slides/ folder), newest first. */
class HistoryActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var list: ListView
    private lateinit var empty: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_history)
        title = getString(R.string.history_title)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        list = findViewById(R.id.historyList)
        empty = findViewById(R.id.historyEmpty)

        load()
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun load() {
        val token = Prefs.token(this)
        io.execute {
            try {
                val commits = GithubUploader.fetchHistory(token)
                val rows = commits.map { "${it.message}\n${formatDate(it.isoDate)}" }
                ui.post {
                    if (rows.isEmpty()) {
                        empty.text = getString(R.string.no_history)
                    } else {
                        empty.visibility = View.GONE
                        list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, rows)
                    }
                }
            } catch (e: Exception) {
                ui.post { empty.text = getString(R.string.history_load_error) }
            }
        }
    }

    /** ISO-8601 UTC → readable local time. */
    private fun formatDate(iso: String): String {
        return try {
            val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val d = parser.parse(iso) ?: return iso
            SimpleDateFormat("dd MMM yyyy, h:mm a", Locale.getDefault()).format(d)
        } catch (_: Exception) {
            iso
        }
    }
}
