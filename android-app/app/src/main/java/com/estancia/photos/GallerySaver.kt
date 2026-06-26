package com.estancia.photos

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Saves a captured photo into the device gallery, inside an album (folder)
 * named for today's date (e.g. "2026-06-26").
 *
 * On Android 10+ this uses scoped MediaStore (no permission needed). On older
 * versions it falls back to a legacy file under Pictures/<date> and registers
 * it with MediaStore (needs WRITE_EXTERNAL_STORAGE, declared maxSdk 28).
 */
object GallerySaver {

    fun albumName(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    fun save(context: Context, source: File) {
        val album = albumName()
        val displayName = "EST_${System.currentTimeMillis()}.jpg"

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$album")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return
            resolver.openOutputStream(uri)?.use { out -> source.inputStream().use { it.copyTo(out) } }
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), album)
            if (!dir.exists()) dir.mkdirs()
            val dest = File(dir, displayName)
            source.inputStream().use { input -> dest.outputStream().use { input.copyTo(it) } }
            @Suppress("DEPRECATION")
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DATA, dest.absolutePath)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
            }
            context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
        }
    }
}
