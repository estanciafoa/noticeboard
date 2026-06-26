package com.estancia.photos

import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

/** Shows the last 10 uploads (commits touching slides/), newest first, with the latest highlighted. */
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
                val commits = GithubUploader.fetchHistory(token, 10)
                ui.post {
                    if (commits.isEmpty()) {
                        empty.text = getString(R.string.no_history)
                    } else {
                        empty.visibility = View.GONE
                        list.adapter = HistoryAdapter(commits)
                    }
                }
            } catch (e: Exception) {
                ui.post { empty.text = getString(R.string.history_load_error) }
            }
        }
    }

    /** Row 0 (the most recent upload) is highlighted with a "Latest" tag and tinted background. */
    private inner class HistoryAdapter(val items: List<GithubUploader.CommitInfo>) : BaseAdapter() {
        override fun getCount() = items.size
        override fun getItem(position: Int) = items[position]
        override fun getItemId(position: Int) = position.toLong()

        override fun getView(position: Int, convertView: View?, parent: ViewGroup?): View {
            val c = items[position]
            val pad = (14 * resources.displayMetrics.density).toInt()
            val tv = (convertView as? TextView) ?: TextView(this@HistoryActivity).apply {
                setPadding(pad, pad, pad, pad)
            }
            val latest = position == 0
            val prefix = if (latest) "🟢 LATEST\n" else ""
            tv.text = "$prefix${c.message}\n${formatDate(c.isoDate)}"
            tv.setTextColor(if (latest) Color.parseColor("#1B5E20") else ContextCompat.getColor(this@HistoryActivity, R.color.muted))
            tv.setTypeface(null, if (latest) Typeface.BOLD else Typeface.NORMAL)
            tv.setBackgroundColor(if (latest) ContextCompat.getColor(this@HistoryActivity, R.color.highlight) else Color.TRANSPARENT)
            tv.gravity = Gravity.START
            return tv
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
