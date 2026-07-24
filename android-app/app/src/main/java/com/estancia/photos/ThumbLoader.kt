package com.estancia.photos

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.widget.ImageView
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * Loads slide images from the board's repo (GitHub Pages, with a raw fallback)
 * off the main thread, into an [ImageView], downsampled to a requested max edge
 * and cached in memory (keyed by name + size). Videos can't be decoded and simply
 * show no image.
 *
 * The target's tag is set to the requested key so a late-arriving async result
 * for a reused view (e.g. a recycled pager page) is discarded instead of showing
 * the wrong image.
 */
object ThumbLoader {
    private const val PAGES = "https://estanciafoa.github.io/noticeboard/slides/"
    private const val RAW = "https://raw.githubusercontent.com/estanciafoa/noticeboard/main/slides/"

    private val exec = Executors.newFixedThreadPool(3)
    private val ui = Handler(Looper.getMainLooper())
    private val cache = object : LruCache<String, Bitmap>(32 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }

    fun load(name: String, target: ImageView, maxDim: Int = 240) {
        val key = "$name@$maxDim"
        target.tag = key
        cache.get(key)?.let { target.setImageBitmap(it); return }
        target.setImageBitmap(null)
        exec.execute {
            val bmp = fetch(name, maxDim) ?: return@execute
            cache.put(key, bmp)
            ui.post { if (target.tag == key) target.setImageBitmap(bmp) }
        }
    }

    private fun fetch(name: String, maxDim: Int): Bitmap? {
        val enc = URLEncoder.encode(name, "UTF-8").replace("+", "%20")
        return download(PAGES + enc, maxDim) ?: download(RAW + enc, maxDim)
    }

    private fun download(url: String, maxDim: Int): Bitmap? = try {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10000
        c.readTimeout = 20000
        c.setRequestProperty("User-Agent", "EstanciaPhotos-Android")
        val ok = c.responseCode in 200..299
        val bytes = if (ok) c.inputStream.use { it.readBytes() } else null
        c.disconnect()
        bytes?.let { decodeSampled(it, maxDim) }
    } catch (_: Exception) {
        null
    }

    private fun decodeSampled(bytes: ByteArray, maxDim: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxDim) sample *= 2
        val opts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.RGB_565
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }
}
