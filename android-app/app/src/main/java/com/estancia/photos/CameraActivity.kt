package com.estancia.photos

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File
import java.util.concurrent.Executors

/**
 * In-app camera with a framing grid + centred person guide ([CameraOverlayView]).
 * Lets the user take several shots in one session, saves each to the gallery
 * (album = today's date), and returns the cache file paths to [MainActivity].
 */
class CameraActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_PATHS = "paths"
    }

    private lateinit var previewView: PreviewView
    private lateinit var shotCount: TextView
    private var imageCapture: ImageCapture? = null
    private val captured = ArrayList<String>()
    private val bgExecutor = Executors.newSingleThreadExecutor()

    private val requestPerms = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { result ->
        if (result[Manifest.permission.CAMERA] == true) startCamera()
        else {
            Toast.makeText(this, R.string.camera_denied, Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_camera)

        previewView = findViewById(R.id.previewView)
        shotCount = findViewById(R.id.shotCount)
        findViewById<ImageButton>(R.id.captureBtn).setOnClickListener { takePhoto() }
        findViewById<Button>(R.id.doneBtn).setOnClickListener { finishWithResult() }

        ensurePermissions()
    }

    private fun ensurePermissions() {
        val needed = mutableListOf(Manifest.permission.CAMERA)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        val missing = needed.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) startCamera() else requestPerms.launch(missing.toTypedArray())
    }

    private fun startCamera() {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(previewView.surfaceProvider)
            }
            imageCapture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                .build()
            try {
                provider.unbindAll()
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
            } catch (e: Exception) {
                Toast.makeText(this, R.string.camera_error, Toast.LENGTH_LONG).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun takePhoto() {
        val capture = imageCapture ?: return
        val file = File(cacheDir, "shot_${System.nanoTime()}.jpg")
        val options = ImageCapture.OutputFileOptions.Builder(file).build()
        capture.takePicture(options, bgExecutor, object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) {
                try { GallerySaver.save(this@CameraActivity, file) } catch (_: Exception) {}
                captured.add(file.absolutePath)
                runOnUiThread {
                    shotCount.text = resources.getQuantityString(R.plurals.shots, captured.size, captured.size)
                }
            }
            override fun onError(exception: ImageCaptureException) {
                runOnUiThread { Toast.makeText(this@CameraActivity, R.string.camera_error, Toast.LENGTH_SHORT).show() }
            }
        })
    }

    private fun finishWithResult() {
        val data = Intent().putStringArrayListExtra(EXTRA_PATHS, captured)
        setResult(Activity.RESULT_OK, data)
        finish()
    }

    override fun onBackPressed() {
        finishWithResult()
    }
}
