package com.estancia.photos

import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Display status view: shows every display (tower/core + clubhouse + gate) and
 * whether it's online, offline, or has never reported, from the heartbeat backend.
 * Re-polls every 30s while open, mirroring the web admin's Displays panel.
 */
class DisplayStatusActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var summary: TextView
    private lateinit var status: TextView
    private lateinit var list: LinearLayout
    private lateinit var foot: TextView
    private lateinit var refreshBtn: Button

    private var heartbeatUrl: String? = null
    private var loading = false
    private val poller = object : Runnable {
        override fun run() {
            refresh(showLoading = false)
            ui.postDelayed(this, 30_000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_status)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = getString(R.string.status_title)

        summary = findViewById(R.id.summary)
        status = findViewById(R.id.status)
        list = findViewById(R.id.list)
        foot = findViewById(R.id.foot)
        refreshBtn = findViewById(R.id.refreshBtn)
        refreshBtn.setOnClickListener { refresh(showLoading = true) }
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    override fun onResume() {
        super.onResume()
        ui.post(poller)          // refresh now + every 30s while visible
    }

    override fun onPause() {
        super.onPause()
        ui.removeCallbacks(poller)
    }

    private fun refresh(showLoading: Boolean) {
        val token = Prefs.token(this)
        if (token.isBlank()) { setStatus(getString(R.string.no_token_hint), true); return }
        if (loading) return
        loading = true
        if (showLoading) setStatus(getString(R.string.loading), false)
        io.execute {
            try {
                val url = heartbeatUrl ?: GithubUploader.fetchHeartbeatUrl(token).also { heartbeatUrl = it }
                val result = Heartbeat.fetch(url)
                ui.post { loading = false; render(result); setStatus("", false) }
            } catch (e: Exception) {
                ui.post { loading = false; setStatus("❌ ${e.message}", true) }
            }
        }
    }

    private fun render(r: Heartbeat.Result) {
        val allOk = r.onlineCount == r.total
        summary.text = getString(R.string.status_summary, r.onlineCount, r.total)
        summary.setTextColor(getColor(if (allOk) R.color.green_dark else R.color.red))

        list.removeAllViews()
        r.states.forEach { list.addView(card(it)) }

        val time = SimpleDateFormat("h:mm a", Locale.US).format(Date(r.nowMs))
        foot.text = getString(R.string.status_foot, time)
    }

    private fun dp(v: Float) = (v * resources.displayMetrics.density).toInt()

    private fun dotColor(state: String): Int = when (state) {
        "online" -> Color.parseColor("#16A34A")
        "offline" -> Color.parseColor("#DC2626")
        else -> Color.parseColor("#9CA3AF")
    }

    private fun card(d: Heartbeat.DisplayState): android.view.View {
        val dot = TextView(this).apply {
            text = "●"
            textSize = 16f
            setTextColor(dotColor(d.state))
            layoutParams = LinearLayout.LayoutParams(dp(24f), LinearLayout.LayoutParams.WRAP_CONTENT)
            gravity = Gravity.CENTER
        }

        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        texts.addView(TextView(this).apply {
            text = "${d.label}  ·  ${d.id}"
            setTextColor(Color.parseColor("#111827"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        val bits = ArrayList<String>()
        if (d.version.isNotBlank()) bits.add("v${d.version}")
        if (d.slides >= 0) bits.add("${d.slides} slide${if (d.slides == 1) "" else "s"}")
        val metaLine = Heartbeat.relativeTime(d.ageMs) + if (bits.isNotEmpty()) "  ·  " + bits.joinToString(" · ") else ""
        texts.addView(TextView(this).apply {
            text = metaLine
            setTextColor(getColor(R.color.muted))
            textSize = 12f
        })

        val label = when (d.state) {
            "online" -> getString(R.string.status_online)
            "offline" -> getString(R.string.status_offline)
            else -> getString(R.string.status_never)
        }
        val badge = TextView(this).apply {
            text = label
            setTextColor(dotColor(d.state))
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundResource(R.drawable.card_bg)
            setPadding(dp(12f), dp(12f), dp(14f), dp(12f))
            addView(dot); addView(texts); addView(badge)
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            lp.topMargin = dp(8f)
            layoutParams = lp
            addView(row)
        }
    }

    private fun setStatus(msg: String, error: Boolean) {
        status.text = msg
        status.visibility = if (msg.isBlank()) android.view.View.GONE else android.view.View.VISIBLE
        status.setTextColor(getColor(if (error) R.color.red else R.color.muted))
    }
}
