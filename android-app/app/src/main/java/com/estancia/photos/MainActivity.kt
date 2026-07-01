package com.estancia.photos

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.app.DatePickerDialog
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.util.Calendar
import java.util.concurrent.Executors
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    companion object {
        private const val ADMIN_PASSWORD = "Admin2026"

        // Dedicated slide published outside the normal team flow. Must
        // byte-match the slide name in the board's config.json.
        private const val MYGATE_FILE = "mygate-estancia.jpg"

        // The only two lift passenger capacities in the community.
        private val LIFT_CAPACITIES = listOf("13", "10")
    }

    private val photos = mutableListOf<Bitmap>()
    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var subtitle: TextView
    private lateinit var targetFile: TextView
    private lateinit var photoCount: TextView
    private lateinit var thumbs: LinearLayout
    private lateinit var preview: ImageView
    private lateinit var uploadBtn: Button
    private lateinit var mygateBtn: Button
    private lateinit var status: TextView

    // Lift portfolio (schedule-only) views
    private lateinit var photoCard: View
    private lateinit var liftCard: View
    private lateinit var liftLocationSpinner: Spinner
    private lateinit var liftCapacitySpinner: Spinner
    private lateinit var liftDateBtn: Button
    private lateinit var liftAddBtn: Button
    private lateinit var liftStatus: TextView
    private lateinit var liftRefreshBtn: Button
    private lateinit var liftListStatus: TextView
    private lateinit var liftScheduleList: LinearLayout
    private var liftDate: Calendar? = null
    private var tickerFile: GithubUploader.TickerFile? = null

    private var busy = false

    private val cameraLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val paths = result.data?.getStringArrayListExtra(CameraActivity.EXTRA_PATHS)
            if (!paths.isNullOrEmpty()) {
                addFromPaths(paths)
                Toast.makeText(
                    this, getString(R.string.saved_to_gallery, GallerySaver.albumName()), Toast.LENGTH_SHORT
                ).show()
            }
        }
    }
    private val pickPhotos = registerForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        if (!uris.isNullOrEmpty()) addFromUris(uris)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        subtitle = findViewById(R.id.subtitle)
        targetFile = findViewById(R.id.targetFile)
        photoCount = findViewById(R.id.photoCount)
        thumbs = findViewById(R.id.thumbs)
        preview = findViewById(R.id.preview)
        uploadBtn = findViewById(R.id.uploadBtn)
        mygateBtn = findViewById(R.id.mygateBtn)
        status = findViewById(R.id.status)

        photoCard = findViewById(R.id.photoCard)
        liftCard = findViewById(R.id.liftCard)
        liftLocationSpinner = findViewById(R.id.liftLocationSpinner)
        liftCapacitySpinner = findViewById(R.id.liftCapacitySpinner)
        liftDateBtn = findViewById(R.id.liftDateBtn)
        liftAddBtn = findViewById(R.id.liftAddBtn)
        liftStatus = findViewById(R.id.liftStatus)
        liftRefreshBtn = findViewById(R.id.liftRefreshBtn)
        liftListStatus = findViewById(R.id.liftListStatus)
        liftScheduleList = findViewById(R.id.liftScheduleList)
        liftLocationSpinner.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, Locations.ALL.map { it.label }
        )
        liftCapacitySpinner.adapter = ArrayAdapter(
            this, android.R.layout.simple_spinner_dropdown_item, LIFT_CAPACITIES.map { "$it passengers" }
        )
        liftDateBtn.setOnClickListener { pickLiftDate() }
        liftAddBtn.setOnClickListener { submitLift() }
        liftRefreshBtn.setOnClickListener { loadSchedules() }

        findViewById<View>(R.id.adminBtn).setOnClickListener { promptAdminPassword() }
        findViewById<View>(R.id.historyBtn).setOnClickListener {
            startActivity(Intent(this, HistoryActivity::class.java))
        }
        findViewById<Button>(R.id.takePhotoBtn).setOnClickListener { launchCamera() }
        findViewById<Button>(R.id.pickBtn).setOnClickListener { pickPhotos.launch("image/*") }
        findViewById<Button>(R.id.clearBtn).setOnClickListener { clearPhotos() }
        uploadBtn.setOnClickListener { doUpload() }

        // MyGate notice: pick display locations, then upload the first photo
        // as-is (no title) and point the slide at those towers/cores.
        mygateBtn.setOnClickListener { promptMygateLocations() }
    }

    override fun onResume() {
        super.onResume()
        val team = Prefs.team(this)
        applyTeamTheme(team)

        // Lift is schedule-only: swap the photo card for the lift-entry form.
        val lift = team.scheduleOnly
        photoCard.visibility = if (lift) View.GONE else View.VISIBLE
        liftCard.visibility = if (lift) View.VISIBLE else View.GONE

        if (lift) {
            subtitle.text = getString(R.string.lift_subtitle)
            if (Prefs.isConfigured(this)) loadSchedules()
        } else {
            subtitle.text = getString(R.string.team_updates, team.label)
            targetFile.text = getString(R.string.updates_slide, team.file)
        }
        if (!Prefs.isConfigured(this)) {
            setStatus(getString(R.string.no_token_hint), true)
            if (lift) setLiftStatus(getString(R.string.no_token_hint), true)
        }
    }

    /** Recolor header, status bar, and primary buttons to the selected team's color. */
    private fun applyTeamTheme(team: Team) {
        val color = Color.parseColor(team.colorHex)
        val dark = Color.parseColor(team.darkHex)
        findViewById<View>(R.id.header).setBackgroundColor(color)
        window.statusBarColor = dark

        // Team color when enabled, muted grey when disabled (so the upload button
        // still reads as disabled). Text stays white via @color/btn_text.
        val disabled = Color.parseColor("#C7CCD1")
        val states = arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf(-android.R.attr.state_enabled))
        val tint = ColorStateList(states, intArrayOf(color, disabled))
        findViewById<Button>(R.id.takePhotoBtn).backgroundTintList = tint
        uploadBtn.backgroundTintList = tint
        liftAddBtn.backgroundTintList = tint
    }

    // ---- Admin password gate ----
    private fun promptAdminPassword() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = getString(R.string.admin_password_hint)
        }
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(R.string.admin)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                if (input.text.toString() == ADMIN_PASSWORD) {
                    startActivity(Intent(this, AdminActivity::class.java))
                } else {
                    Toast.makeText(this, R.string.wrong_password, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    // ---- Photo input ----
    private fun launchCamera() {
        cameraLauncher.launch(Intent(this, CameraActivity::class.java))
    }

    private fun addFromPaths(paths: List<String>) {
        io.execute {
            val decoded = paths.mapNotNull { decodeBitmap(Uri.fromFile(File(it))) }
            ui.post { photos.addAll(decoded); onPhotosChanged() }
        }
    }

    private fun addFromUris(uris: List<Uri>) {
        io.execute {
            val decoded = uris.mapNotNull { decodeBitmap(it) }
            ui.post { photos.addAll(decoded); onPhotosChanged() }
        }
    }

    private fun clearPhotos() {
        photos.clear()
        onPhotosChanged()
        setStatus("", false)
    }

    private fun onPhotosChanged() {
        photoCount.text = if (photos.isEmpty()) getString(R.string.no_photos)
            else resources.getQuantityString(R.plurals.photo_count, photos.size, photos.size)
        renderThumbs()
        refreshPreview()
        updateActionButtons()
    }

    /** Enable the upload actions only when there's at least one photo and we're idle. */
    private fun updateActionButtons() {
        val ready = photos.isNotEmpty() && !busy
        uploadBtn.isEnabled = ready
        mygateBtn.isEnabled = ready
    }

    private fun renderThumbs() {
        thumbs.removeAllViews()
        val size = (96 * resources.displayMetrics.density).toInt()
        photos.forEachIndexed { i, bmp ->
            val iv = ImageView(this)
            val lp = LinearLayout.LayoutParams(size, size)
            lp.marginEnd = (8 * resources.displayMetrics.density).toInt()
            iv.layoutParams = lp
            iv.scaleType = ImageView.ScaleType.CENTER_CROP
            iv.setImageBitmap(bmp)
            iv.setOnClickListener {
                photos.removeAt(i)
                onPhotosChanged()
                Toast.makeText(this, R.string.photo_removed, Toast.LENGTH_SHORT).show()
            }
            thumbs.addView(iv)
        }
    }

    private fun refreshPreview() {
        if (photos.isEmpty()) { preview.visibility = View.GONE; return }
        val snapshot = photos.toList()
        val title = Prefs.team(this).title
        io.execute {
            val bmp = try { CollageRenderer.render(snapshot, title) } catch (_: Exception) { null }
            ui.post {
                if (bmp != null) { preview.setImageBitmap(bmp); preview.visibility = View.VISIBLE }
            }
        }
    }

    // ---- Upload ----
    /** Normal team update: a collage titled "<Team> @ Estancia" → the team's slide. */
    private fun doUpload() {
        val team = Prefs.team(this)
        publish(team.file, team.title, singleAsIs = false, message = "${team.label} collage update")
    }

    /** Ask which towers/cores the MyGate notice should appear on, then publish. */
    private fun promptMygateLocations() {
        if (photos.isEmpty() || busy) return
        val labels = Locations.ALL.map { it.label }.toTypedArray()
        val checked = BooleanArray(Locations.ALL.size)
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(R.string.mygate_pick_title)
            .setMultiChoiceItems(labels, checked) { _, which, isChecked -> checked[which] = isChecked }
            .setPositiveButton(R.string.upload) { _, _ ->
                val selected = Locations.ALL.filterIndexed { i, _ -> checked[i] }.map { it.id }
                if (selected.isEmpty()) {
                    Toast.makeText(this, R.string.mygate_pick_required, Toast.LENGTH_SHORT).show()
                    return@setPositiveButton
                }
                publish(MYGATE_FILE, title = "", singleAsIs = true, message = "MyGate notice update", towers = selected)
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    /**
     * Publish the current photos to [file] on the board.
     *
     * @param title banner text drawn on the collage; pass "" for no banner.
     * @param singleAsIs when true, upload the first photo as-is (no collage, no
     *   title) — used for MyGate notification screenshots.
     * @param towers when non-null, also point this slide at these location keys
     *   in config.json so it shows on exactly those towers/cores.
     */
    private fun publish(
        file: String,
        title: String,
        singleAsIs: Boolean,
        message: String,
        towers: List<String>? = null,
    ) {
        if (photos.isEmpty() || busy) return
        val token = Prefs.token(this)
        if (token.isBlank()) {
            setStatus(getString(R.string.no_token_hint), true)
            startActivity(Intent(this, AdminActivity::class.java))
            return
        }
        setBusy(true)
        setStatus(getString(R.string.building), false)
        val snapshot = photos.toList()
        io.execute {
            try {
                val bytes = if (singleAsIs) {
                    CollageRenderer.toJpegBytes(snapshot.first())
                } else {
                    CollageRenderer.toJpegBytes(CollageRenderer.render(snapshot, title))
                }
                ui.post { setStatus(getString(R.string.uploading), false) }
                GithubUploader.uploadSlide(token, file, bytes, message)
                if (towers != null) {
                    GithubUploader.setSlideTowers(token, file, towers.joinToString(","), "$message: set display locations")
                }
                ui.post {
                    // Clear first (clearPhotos resets the status), then show success.
                    clearPhotos()
                    setBusy(false)
                    setStatus(getString(R.string.upload_done), false)
                    Toast.makeText(this, R.string.upload_done, Toast.LENGTH_LONG).show()
                }
            } catch (e: Exception) {
                ui.post {
                    setStatus("❌ ${e.message}", true)
                    setBusy(false)
                }
            }
        }
    }

    private fun setBusy(b: Boolean) {
        busy = b
        updateActionButtons()
    }

    private fun setStatus(msg: String, error: Boolean) {
        status.text = msg
        status.setTextColor(getColor(if (error) R.color.red else R.color.green_dark))
    }

    // ---- Lift maintenance (schedule-only portfolio) ----
    private fun pickLiftDate() {
        val c = liftDate ?: Calendar.getInstance()
        DatePickerDialog(
            this,
            { _, y, m, d ->
                liftDate = Calendar.getInstance().apply { clear(); set(y, m, d) }
                val label = "%02d/%02d/%04d".format(d, m + 1, y)
                liftDateBtn.text = getString(R.string.lift_date_label, label)
            },
            c.get(Calendar.YEAR), c.get(Calendar.MONTH), c.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    /**
     * Add a lift-maintenance schedule row:
     *   <loc> | <date-1> 09:00 | <date-1> 09:00 +30h | LIFT MAINTENANCE |
     *   "<cap> Passenger Lift will be in maintenance on <DD/MM/YYYY>, 10:30am to 3pm"
     */
    private fun submitLift() {
        if (busy) return
        val capacity = LIFT_CAPACITIES[liftCapacitySpinner.selectedItemPosition]
        val maint = liftDate
        if (maint == null) { setLiftStatus(getString(R.string.lift_date_required), true); return }

        val location = Locations.ALL[liftLocationSpinner.selectedItemPosition].id
        val maintStr = "%02d/%02d/%04d".format(
            maint.get(Calendar.DAY_OF_MONTH), maint.get(Calendar.MONTH) + 1, maint.get(Calendar.YEAR)
        )
        // Start at 09:00 the day before the maintenance date.
        val start = (maint.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, -1); set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0) }
        val expiry = (start.clone() as Calendar).apply { add(Calendar.HOUR_OF_DAY, 30) }
        val fmt = { c: Calendar -> "%04d-%02d-%02d %02d:%02d".format(
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
            c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE)
        ) }
        // The board sits between the two lifts: 10P is on the left, 13P on the right.
        val side = when (capacity) { "10" -> " (left)"; "13" -> " (right)"; else -> "" }
        val row = GithubUploader.TickerRow(
            location, fmt(start), fmt(expiry), "LIFT MAINTENANCE",
            "$capacity Passenger Lift$side will be in maintenance on $maintStr, 10:30am to 3pm"
        )
        mutateSchedules("Lift maintenance: $location $maintStr", getString(R.string.lift_added),
            onSuccess = {
                liftCapacitySpinner.setSelection(0)
                liftDate = null
                liftDateBtn.text = getString(R.string.lift_select_date)
            }) { rows -> rows.add(row) }
    }

    /** Load all schedules from ticker.txt and render them. */
    private fun loadSchedules() {
        val token = Prefs.token(this)
        if (token.isBlank()) { setLiftStatus(getString(R.string.no_token_hint), true); return }
        liftListStatus.text = getString(R.string.lift_loading)
        liftScheduleList.removeAllViews()
        io.execute {
            try {
                val file = GithubUploader.fetchTickerFile(token)
                ui.post { tickerFile = file; renderScheduleList() }
            } catch (e: Exception) {
                ui.post { liftListStatus.text = getString(R.string.lift_load_error, e.message ?: "") }
            }
        }
    }

    private fun renderScheduleList() {
        val rows = tickerFile?.rows ?: mutableListOf()
        liftScheduleList.removeAllViews()
        liftListStatus.text =
            if (rows.isEmpty()) getString(R.string.lift_none) else getString(R.string.lift_count, rows.size)
        rows.forEach { row -> liftScheduleList.addView(buildScheduleRowView(row)) }
    }

    private fun buildScheduleRowView(row: GithubUploader.TickerRow): View {
        val dp = resources.displayMetrics.density
        fun pad(v: Float) = (v * dp).toInt()

        val texts = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        texts.addView(TextView(this).apply {
            text = row.location.ifBlank { "—" }
            setTextColor(Color.parseColor("#111827"))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        })
        texts.addView(TextView(this).apply {
            text = row.message
            setTextColor(getColor(R.color.muted))
            textSize = 13f
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
        })
        texts.addView(TextView(this).apply {
            val s = row.start.ifBlank { "now" }
            val e = row.expiry.ifBlank { "never" }
            text = "$s → $e" + if (row.attention.isNotBlank()) "  ·  ${row.attention}" else ""
            setTextColor(getColor(R.color.muted))
            textSize = 11f
        })

        fun action(label: String, color: Int, onClick: () -> Unit) = TextView(this).apply {
            text = label
            setTextColor(color)
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(pad(12f), pad(8f), pad(12f), pad(8f))
            isClickable = true
            setOnClickListener { onClick() }
        }

        val rowView = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, pad(8f), 0, pad(8f))
            addView(texts)
            addView(action(getString(R.string.lift_edit), Color.parseColor("#2563EB")) { editSchedule(row) })
            addView(action(getString(R.string.lift_delete), getColor(R.color.red)) { confirmDelete(row) })
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(rowView)
            addView(View(this@MainActivity).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1)
                setBackgroundColor(Color.parseColor("#EEF0F3"))
            })
        }
    }

    private fun editSchedule(row: GithubUploader.TickerRow) {
        val dp = resources.displayMetrics.density
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((20 * dp).toInt(), (8 * dp).toInt(), (20 * dp).toInt(), 0)
        }
        fun field(hint: String, value: String, multiline: Boolean = false): EditText {
            layout.addView(TextView(this).apply {
                text = hint; setTextColor(getColor(R.color.muted)); textSize = 12f
                setPadding(0, (10 * dp).toInt(), 0, 0)
            })
            val et = EditText(this).apply {
                setText(value)
                if (multiline) { setSingleLine(false); minLines = 2; maxLines = 4 }
            }
            layout.addView(et)
            return et
        }
        val loc = field(getString(R.string.lift_f_location), row.location)
        val start = field(getString(R.string.lift_f_start), row.start)
        val expiry = field(getString(R.string.lift_f_expiry), row.expiry)
        val attention = field(getString(R.string.lift_f_attention), row.attention)
        val message = field(getString(R.string.lift_f_message), row.message, multiline = true)

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(R.string.lift_edit_title)
            .setView(ScrollView(this).apply { addView(layout) })
            .setPositiveButton(android.R.string.ok) { _, _ ->
                val nLoc = loc.text.toString().trim()
                val nMsg = message.text.toString().trim()
                if (nLoc.isBlank() || nMsg.isBlank()) {
                    setLiftStatus(getString(R.string.lift_field_required), true)
                    return@setPositiveButton
                }
                val nStart = start.text.toString().trim()
                val nExpiry = expiry.text.toString().trim()
                val nAtt = attention.text.toString().trim()
                mutateSchedules("Edit ticker: $nLoc", getString(R.string.lift_saved)) { _ ->
                    row.location = nLoc; row.start = nStart; row.expiry = nExpiry
                    row.attention = nAtt; row.message = nMsg
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun confirmDelete(row: GithubUploader.TickerRow) {
        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle(R.string.lift_delete)
            .setMessage(R.string.lift_delete_confirm)
            .setPositiveButton(R.string.lift_delete) { _, _ ->
                mutateSchedules("Delete ticker: ${row.location}", getString(R.string.lift_deleted)) { rows ->
                    rows.remove(row)
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    /**
     * Apply [op] to the loaded schedule rows and save ticker.txt. Fetches the
     * file first if not already loaded. On a server-side change (stale sha) it
     * reloads and asks the user to redo. [op] runs off the UI thread, so it must
     * only touch the rows list (values captured beforehand).
     */
    private fun mutateSchedules(
        commitMsg: String,
        successMsg: String,
        onSuccess: (() -> Unit)? = null,
        op: (MutableList<GithubUploader.TickerRow>) -> Unit,
    ) {
        if (busy) return
        val token = Prefs.token(this)
        if (token.isBlank()) {
            setLiftStatus(getString(R.string.no_token_hint), true)
            startActivity(Intent(this, AdminActivity::class.java))
            return
        }
        setBusy(true)
        liftAddBtn.isEnabled = false
        liftRefreshBtn.isEnabled = false
        setLiftStatus(getString(R.string.lift_saving), false)
        io.execute {
            try {
                val file = tickerFile ?: GithubUploader.fetchTickerFile(token).also { tickerFile = it }
                op(file.rows)
                GithubUploader.saveTickerFile(token, file, commitMsg)
                ui.post {
                    setBusy(false)
                    liftAddBtn.isEnabled = true
                    liftRefreshBtn.isEnabled = true
                    renderScheduleList()
                    setLiftStatus(successMsg, false)
                    onSuccess?.invoke()
                }
            } catch (c: GithubUploader.ConflictException) {
                ui.post {
                    setBusy(false)
                    liftAddBtn.isEnabled = true
                    liftRefreshBtn.isEnabled = true
                    setLiftStatus(getString(R.string.lift_reloaded), true)
                    loadSchedules()
                }
            } catch (e: Exception) {
                ui.post {
                    setBusy(false)
                    liftAddBtn.isEnabled = true
                    liftRefreshBtn.isEnabled = true
                    setLiftStatus("❌ ${e.message}", true)
                }
            }
        }
    }

    private fun setLiftStatus(msg: String, error: Boolean) {
        liftStatus.text = msg
        liftStatus.setTextColor(getColor(if (error) R.color.red else R.color.green_dark))
    }

    // ---- Decoding (downsample + EXIF rotation) ----
    private fun decodeBitmap(uri: Uri): Bitmap? {
        return try {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
            val maxDim = 1280
            var sample = 1
            while (max(bounds.outWidth, bounds.outHeight) / sample > maxDim) sample *= 2
            val opts = BitmapFactory.Options().apply { inSampleSize = sample }
            val bmp = contentResolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, opts)
            } ?: return null
            rotateByExif(uri, bmp)
        } catch (_: Exception) {
            null
        }
    }

    private fun rotateByExif(uri: Uri, bmp: Bitmap): Bitmap {
        return try {
            val orientation = contentResolver.openInputStream(uri)?.use { stream ->
                ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
                )
            } ?: ExifInterface.ORIENTATION_NORMAL
            val m = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
                else -> return bmp
            }
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        } catch (_: Exception) {
            bmp
        }
    }
}
