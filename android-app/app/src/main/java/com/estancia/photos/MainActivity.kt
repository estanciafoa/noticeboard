package com.estancia.photos

import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.max

class MainActivity : AppCompatActivity() {

    companion object {
        private const val ADMIN_PASSWORD = "Admin2026"
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
    private lateinit var status: TextView

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
        status = findViewById(R.id.status)

        findViewById<View>(R.id.adminBtn).setOnClickListener { promptAdminPassword() }
        findViewById<View>(R.id.historyBtn).setOnClickListener {
            startActivity(Intent(this, HistoryActivity::class.java))
        }
        findViewById<Button>(R.id.takePhotoBtn).setOnClickListener { launchCamera() }
        findViewById<Button>(R.id.pickBtn).setOnClickListener { pickPhotos.launch("image/*") }
        findViewById<Button>(R.id.clearBtn).setOnClickListener { clearPhotos() }
        uploadBtn.setOnClickListener { doUpload() }
    }

    override fun onResume() {
        super.onResume()
        val team = Prefs.team(this)
        subtitle.text = getString(R.string.team_updates, team.label)
        targetFile.text = getString(R.string.updates_slide, team.file)
        applyTeamTheme(team)
        if (!Prefs.isConfigured(this)) {
            setStatus(getString(R.string.no_token_hint), true)
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
        uploadBtn.isEnabled = photos.isNotEmpty() && !busy
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
    private fun doUpload() {
        if (photos.isEmpty() || busy) return
        val team = Prefs.team(this)
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
                val collage = CollageRenderer.render(snapshot, team.title)
                val bytes = CollageRenderer.toJpegBytes(collage)
                ui.post { setStatus(getString(R.string.uploading), false) }
                GithubUploader.uploadSlide(token, team.file, bytes, "${team.label} collage update")
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
        uploadBtn.isEnabled = !b && photos.isNotEmpty()
    }

    private fun setStatus(msg: String, error: Boolean) {
        status.text = msg
        status.setTextColor(getColor(if (error) R.color.red else R.color.green_dark))
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
