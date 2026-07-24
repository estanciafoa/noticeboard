package com.estancia.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Admin board manager: a full-screen, swipeable preview of the notice-board deck
 * (config.json slides[]) with floating controls. Swipe between slides; the overlay
 * lets you hide/show a slide, change where it shows, move it, or add a slide at a
 * chosen position (an existing repo image or a fresh upload from the phone).
 *
 * Reached from Admin (behind the admin password). All GitHub writes happen off the
 * main thread; each one re-reads config.json first so concurrent edits from the web
 * admin or another phone don't clobber each other.
 */
class SlidesActivity : AppCompatActivity() {

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var pager: ViewPager2
    private lateinit var positionText: TextView
    private lateinit var captionName: TextView
    private lateinit var captionInfo: TextView
    private lateinit var actionRow: LinearLayout
    private lateinit var status: TextView
    private lateinit var empty: TextView
    private lateinit var refreshBtn: View
    private lateinit var uploadNewBtn: View

    private val adapter = SlideAdapter()
    private var pages: List<Page> = emptyList()
    private var deck: List<GithubUploader.DeckSlide> = emptyList()
    private var busy = false

    /** JPEG bytes of a picked image awaiting a filename + placement (upload-new flow). */
    private var pendingUpload: ByteArray? = null

    /** One page in the pager: a board slide (onBoard) or an available-to-add image. */
    private data class Page(
        val name: String,
        val hidden: Boolean,
        val onBoard: Boolean,
        val position: Int,
        val boardTotal: Int,
        val towers: String,
        val slide: GithubUploader.DeckSlide?,
    )

    private val pickImage = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) prepareUpload(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        setContentView(R.layout.activity_slides)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        pager = findViewById(R.id.pager)
        positionText = findViewById(R.id.positionText)
        captionName = findViewById(R.id.captionName)
        captionInfo = findViewById(R.id.captionInfo)
        actionRow = findViewById(R.id.actionRow)
        status = findViewById(R.id.status)
        empty = findViewById(R.id.empty)
        refreshBtn = findViewById(R.id.refreshBtn)
        uploadNewBtn = findViewById(R.id.uploadNewBtn)

        pager.adapter = adapter
        pager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) = updateOverlay(position)
        })

        findViewById<View>(R.id.backBtn).setOnClickListener { finish() }
        findViewById<View>(R.id.statusBtn).setOnClickListener {
            startActivity(android.content.Intent(this, DisplayStatusActivity::class.java))
        }
        refreshBtn.setOnClickListener { load() }
        uploadNewBtn.setOnClickListener { if (requireToken()) pickImage.launch("image/*") }

        load()
    }

    // ---- Load & render ------------------------------------------------------

    private fun load(showLoading: Boolean = true) {
        val token = Prefs.token(this)
        if (token.isBlank()) { setStatus(getString(R.string.no_token_hint), true); return }
        if (showLoading) setStatus(getString(R.string.loading), false)
        io.execute {
            try {
                val d = GithubUploader.fetchDeck(token)
                val files = GithubUploader.fetchSlideFiles(token)
                val inDeck = d.map { it.name }.toSet()
                val available = files.filter { it !in inDeck }
                val built = buildPages(d, available)
                ui.post {
                    deck = d
                    setBusy(false)
                    if (showLoading) setStatus("", false)
                    applyPages(built)
                }
            } catch (e: Exception) {
                ui.post { setBusy(false); setStatus("❌ ${e.message}", true) }
            }
        }
    }

    private fun buildPages(d: List<GithubUploader.DeckSlide>, available: List<String>): List<Page> {
        val board = d.mapIndexed { i, s -> Page(s.name, s.hidden, true, i + 1, d.size, s.towers, s) }
        val add = available.map { Page(it, false, false, 0, d.size, "", null) }
        return board + add
    }

    private fun applyPages(newPages: List<Page>) {
        val keep = if (pages.isNotEmpty()) pager.currentItem else 0
        pages = newPages
        adapter.items = newPages
        adapter.notifyDataSetChanged()

        empty.visibility = if (newPages.isEmpty()) View.VISIBLE else View.GONE
        actionRow.visibility = if (newPages.isEmpty()) View.GONE else View.VISIBLE
        if (newPages.isEmpty()) {
            empty.text = getString(R.string.slides_board_empty)
            positionText.text = ""
            captionName.text = ""
            captionInfo.text = ""
            return
        }
        val idx = keep.coerceIn(0, newPages.size - 1)
        pager.setCurrentItem(idx, false)
        updateOverlay(idx)
    }

    private fun updateOverlay(index: Int) {
        val p = pages.getOrNull(index) ?: return
        positionText.text = if (p.onBoard)
            getString(R.string.slides_pos_onboard, p.position, p.boardTotal)
        else
            getString(R.string.slides_pos_available)

        captionName.text = p.name
        val (info, warn) = if (p.onBoard) locationSummary(p.towers, p.hidden)
                           else getString(R.string.slides_not_on_board) to false
        captionInfo.text = info
        captionInfo.setTextColor(Color.parseColor(if (warn) "#FCA5A5" else "#E5E7EB"))

        actionRow.removeAllViews()
        if (p.onBoard && p.slide != null) {
            actionRow.addView(iconBtn("↕") { promptMove(p.slide, p.position, p.boardTotal) })
            actionRow.addView(iconBtn("📍") { promptChangeLocations(p.slide) })
            actionRow.addView(iconBtn(if (p.hidden) "👁" else "🙈") { toggleHide(p.slide) })
        } else {
            actionRow.addView(iconBtn("＋") { promptAddExisting(p.name) })
        }
    }

    // ---- Pager adapter ------------------------------------------------------

    private inner class SlideAdapter : RecyclerView.Adapter<SlideAdapter.VH>() {
        var items: List<Page> = emptyList()

        inner class VH(val root: FrameLayout, val image: ImageView, val dim: View, val tag: TextView) :
            RecyclerView.ViewHolder(root)

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val root = FrameLayout(this@SlidesActivity).apply {
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(Color.BLACK)
            }
            val image = ImageView(this@SlidesActivity).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                scaleType = ImageView.ScaleType.FIT_CENTER
            }
            val dim = View(this@SlidesActivity).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
                )
                setBackgroundColor(Color.parseColor("#99000000"))
                visibility = View.GONE
            }
            val tag = TextView(this@SlidesActivity).apply {
                layoutParams = FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
                ).apply { gravity = Gravity.CENTER }
                text = getString(R.string.slides_hidden_badge)
                setTextColor(Color.WHITE)
                textSize = 18f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                visibility = View.GONE
            }
            root.addView(image); root.addView(dim); root.addView(tag)
            return VH(root, image, dim, tag)
        }

        override fun onBindViewHolder(holder: VH, position: Int) {
            val p = items[position]
            ThumbLoader.load(p.name, holder.image, 1080)
            holder.dim.visibility = if (p.hidden) View.VISIBLE else View.GONE
            holder.tag.visibility = if (p.hidden) View.VISIBLE else View.GONE
        }

        override fun getItemCount(): Int = items.size
    }

    // ---- Shared UI bits -----------------------------------------------------

    private fun dp(v: Float) = (v * resources.displayMetrics.density).toInt()

    /** Location summary line + whether it should read as a warning (hidden). */
    private fun locationSummary(towers: String, hidden: Boolean): Pair<String, Boolean> {
        if (hidden) return getString(R.string.slides_hidden_note) to true
        val ids = towers.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        if (ids.isEmpty()) return getString(R.string.slides_hidden_note) to true
        if (ids.size == Locations.ALL.size) return getString(R.string.slides_all_locations) to false
        return ids.joinToString(" · ") { it.uppercase() } to false
    }

    /** A round icon button (emoji glyph) for the floating overlay. */
    private fun iconBtn(glyph: String, onClick: () -> Unit) = TextView(this).apply {
        text = glyph
        textSize = 17f
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        setBackgroundResource(R.drawable.icon_circle_bg)
        layoutParams = LinearLayout.LayoutParams(dp(44f), dp(44f)).apply { marginEnd = dp(12f) }
        isClickable = true
        setOnClickListener { onClick() }
    }

    // ---- Actions ------------------------------------------------------------

    private fun toggleHide(s: GithubUploader.DeckSlide) {
        if (s.hidden) {
            runMutation(getString(R.string.slides_shown)) {
                GithubUploader.showSlide(Prefs.token(this), s.name, defaultTowers(), "Show slide: ${s.name}")
            }
        } else {
            runMutation(getString(R.string.slides_hidden_done)) {
                GithubUploader.hideSlide(Prefs.token(this), s.name, "Hide slide: ${s.name}")
            }
        }
    }

    private fun promptChangeLocations(s: GithubUploader.DeckSlide) {
        val current = s.towers.split(",").map { it.trim() }.filter { it.isNotEmpty() }.toSet()
        pickLocations(getString(R.string.slides_pick_locations), current) { ids ->
            runMutation(getString(R.string.slides_locations_saved)) {
                GithubUploader.updateSlideLocations(
                    Prefs.token(this), s.name, ids.joinToString(","), "Set locations for ${s.name}"
                )
            }
        }
    }

    private fun promptMove(s: GithubUploader.DeckSlide, position: Int, total: Int) {
        promptPosition(getString(R.string.slides_move_title, s.name), position, total) { pos ->
            if (pos == position) return@promptPosition
            runMutation(getString(R.string.slides_moved)) {
                GithubUploader.placeSlideAt(
                    Prefs.token(this), s.name, pos - 1, s.towers, "Move ${s.name} to position $pos"
                )
            }
        }
    }

    private fun promptAddExisting(name: String) {
        val max = deck.size + 1
        promptPosition(getString(R.string.slides_add_title, name), max, max) { pos ->
            pickLocations(getString(R.string.slides_pick_locations), defaultTowerIds()) { ids ->
                runMutation(getString(R.string.slides_added)) {
                    GithubUploader.placeSlideAt(
                        Prefs.token(this), name, pos - 1, ids.joinToString(","), "Add $name to board at position $pos"
                    )
                }
            }
        }
    }

    // ---- Upload-new flow ----------------------------------------------------

    private fun prepareUpload(uri: Uri) {
        setStatus(getString(R.string.slides_preparing), false)
        io.execute {
            val bmp = decodeBitmap(uri)
            val bytes = if (bmp != null) try { CollageRenderer.toJpegBytes(bmp) } catch (_: Exception) { null } else null
            ui.post {
                setStatus("", false)
                if (bytes == null) {
                    Toast.makeText(this, R.string.slides_image_error, Toast.LENGTH_SHORT).show()
                    return@post
                }
                pendingUpload = bytes
                promptNewSlide()
            }
        }
    }

    private fun promptNewSlide() {
        val max = deck.size + 1
        val fileInput = labeledEdit(getString(R.string.slides_filename_label), "", InputType.TYPE_CLASS_TEXT)
        val posInput = labeledEdit(getString(R.string.slides_position_label), max.toString(), InputType.TYPE_CLASS_NUMBER)
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20f), dp(4f), dp(20f), 0)
            addView(fileInput.first); addView(fileInput.second)
            addView(posInput.first); addView(posInput.second)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.slides_new_title)
            .setView(ScrollView(this).apply { addView(layout) })
            .setPositiveButton(android.R.string.ok, null)   // set below to control dismissal
            .setNegativeButton(android.R.string.cancel) { _, _ -> pendingUpload = null }
            .show()
            .also { dlg ->
                dlg.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val name = sanitizeFilename(fileInput.second.text.toString())
                    if (name == null) {
                        Toast.makeText(this, R.string.slides_filename_required, Toast.LENGTH_SHORT).show(); return@setOnClickListener
                    }
                    if (name in deck.map { it.name }) {
                        Toast.makeText(this, R.string.slides_filename_exists, Toast.LENGTH_LONG).show(); return@setOnClickListener
                    }
                    val pos = (posInput.second.text.toString().toIntOrNull() ?: max).coerceIn(1, max)
                    dlg.dismiss()
                    pickLocations(getString(R.string.slides_pick_locations), defaultTowerIds()) { ids ->
                        val bytes = pendingUpload ?: return@pickLocations
                        runMutation(getString(R.string.slides_added)) {
                            val token = Prefs.token(this)
                            GithubUploader.uploadSlide(token, name, bytes, "Add new slide file: $name")
                            GithubUploader.placeSlideAt(token, name, pos - 1, ids.joinToString(","), "Add $name to board at position $pos")
                            pendingUpload = null
                        }
                    }
                }
            }
    }

    /** Returns a sanitized slide filename (with an image extension), or null if blank. */
    private fun sanitizeFilename(raw: String): String? {
        var n = raw.trim().replace(Regex("[\\\\/:*?\"<>|]"), "_")
        if (n.isBlank()) return null
        if (!Regex("\\.(jpg|jpeg|png|gif|webp)$", RegexOption.IGNORE_CASE).containsMatchIn(n)) n += ".jpg"
        return n
    }

    // ---- Shared dialogs -----------------------------------------------------

    private fun defaultTowerIds(): Set<String> = Locations.ALL.map { it.id }.filter { it != "gate" }.toSet()
    private fun defaultTowers(): String = defaultTowerIds().joinToString(",")

    private fun pickLocations(title: String, preselected: Set<String>, onDone: (List<String>) -> Unit) {
        val labels = Locations.ALL.map { it.label }.toTypedArray()
        val checked = Locations.ALL.map { preselected.contains(it.id) }.toBooleanArray()
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMultiChoiceItems(labels, checked) { _, which, isChecked -> checked[which] = isChecked }
            .setPositiveButton(android.R.string.ok) { _, _ ->
                onDone(Locations.ALL.filterIndexed { i, _ -> checked[i] }.map { it.id })
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun promptPosition(title: String, default: Int, maxPos: Int, onOk: (Int) -> Unit) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            setText(default.toString())
        }
        val wrap = FrameLayout(this).apply { setPadding(dp(20f), dp(4f), dp(20f), 0); addView(input) }
        AlertDialog.Builder(this)
            .setTitle(title)
            .setMessage(getString(R.string.slides_position_range, maxPos))
            .setView(wrap)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val n = (input.text.toString().toIntOrNull() ?: default).coerceIn(1, maxPos)
                onOk(n)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun labeledEdit(label: String, value: String, type: Int): Pair<TextView, EditText> {
        val tv = TextView(this).apply {
            text = label; setTextColor(getColor(R.color.muted)); textSize = 12f
            setPadding(0, dp(10f), 0, 0)
        }
        val et = EditText(this).apply { setText(value); inputType = type }
        return tv to et
    }

    // ---- Plumbing -----------------------------------------------------------

    private fun requireToken(): Boolean {
        if (Prefs.token(this).isBlank()) { setStatus(getString(R.string.no_token_hint), true); return false }
        return true
    }

    /** Run a config-mutating network [op] off the main thread, then reload the deck. */
    private fun runMutation(successMsg: String, op: () -> Unit) {
        if (busy) return
        if (!requireToken()) return
        setBusy(true)
        setStatus(getString(R.string.slides_saving), false)
        io.execute {
            try {
                op()
                ui.post { setStatus(successMsg, false); load(showLoading = false) }
            } catch (e: Exception) {
                ui.post { setBusy(false); setStatus("❌ ${e.message}", true) }
            }
        }
    }

    private fun setBusy(b: Boolean) {
        busy = b
        refreshBtn.isEnabled = !b
        uploadNewBtn.isEnabled = !b
        refreshBtn.alpha = if (b) 0.5f else 1f
        uploadNewBtn.alpha = if (b) 0.5f else 1f
    }

    private fun setStatus(msg: String, error: Boolean) {
        status.text = msg
        status.visibility = if (msg.isBlank()) View.GONE else View.VISIBLE
        status.setTextColor(Color.parseColor(if (error) "#FCA5A5" else "#86EFAC"))
    }

    private fun decodeBitmap(uri: Uri): Bitmap? = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
    } catch (_: Exception) {
        null
    }
}
