package com.estancia.photos

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import java.io.ByteArrayOutputStream
import kotlin.math.ceil
import kotlin.math.sqrt

/**
 * Renders a portrait collage (1080x1920) from a set of photos with a blurred
 * backdrop, an auto grid of rounded-corner cells, and a title banner.
 * Native re-implementation of the board's collage look.
 */
object CollageRenderer {

    private const val W = 1080
    private const val H = 1920
    private const val GAP = 20f
    private const val RADIUS = 30f
    private const val JPEG_QUALITY = 75

    fun render(images: List<Bitmap>, title: String): Bitmap {
        require(images.isNotEmpty()) { "Please add at least one photo." }

        val out = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.BLACK)

        drawBlurredBackdrop(canvas, images[0])
        drawGrid(canvas, images)
        if (title.isNotBlank()) drawTitle(canvas, title)

        return out
    }

    fun toJpegBytes(bmp: Bitmap, quality: Int = JPEG_QUALITY): ByteArray {
        val stream = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, stream)
        return stream.toByteArray()
    }

    /** Cheap blur: downscale the first image hard, then upscale with filtering, then darken. */
    private fun drawBlurredBackdrop(canvas: Canvas, first: Bitmap) {
        val small = Bitmap.createScaledBitmap(first, 32, 57, true)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(small, Rect(0, 0, small.width, small.height), RectF(0f, 0f, W.toFloat(), H.toFloat()), paint)
        small.recycle()
        // brightness 0.6 → dark scrim of ~40% black
        canvas.drawColor(Color.argb(102, 0, 0, 0))
    }

    private fun drawGrid(canvas: Canvas, imgs: List<Bitmap>) {
        val rows = ceil(sqrt(imgs.size.toDouble())).toInt()
        var imagesLeft = imgs.size
        var index = 0
        val rowHeight = H.toFloat() / rows

        for (row in 0 until rows) {
            val itemsInRow = ceil(imagesLeft.toDouble() / (rows - row)).toInt()
            val cellWidth = W.toFloat() / itemsInRow
            val y = row * rowHeight
            for (col in 0 until itemsInRow) {
                if (index >= imgs.size) break
                val img = imgs[index++]
                val inset = GAP / 2
                drawRoundedImage(
                    canvas, img,
                    col * cellWidth + inset, y + inset,
                    cellWidth - GAP, rowHeight - GAP, RADIUS
                )
            }
            imagesLeft -= itemsInRow
        }
    }

    /** Center-crops [img] to the cell aspect ratio and draws it with rounded corners. */
    private fun drawRoundedImage(
        canvas: Canvas, img: Bitmap,
        x: Float, y: Float, width: Float, height: Float, radius: Float
    ) {
        val imgRatio = img.width.toFloat() / img.height
        val boxRatio = width / height
        val sx: Float; val sy: Float; val sw: Float; val sh: Float
        if (imgRatio > boxRatio) {
            sh = img.height.toFloat()
            sw = sh * boxRatio
            sx = (img.width - sw) / 2f
            sy = 0f
        } else {
            sw = img.width.toFloat()
            sh = sw / boxRatio
            sx = 0f
            sy = (img.height - sh) / 2f
        }
        val src = Rect(sx.toInt(), sy.toInt(), (sx + sw).toInt(), (sy + sh).toInt())
        val dst = RectF(x, y, x + width, y + height)

        canvas.save()
        val clip = Path().apply { addRoundRect(dst, radius, radius, Path.Direction.CW) }
        canvas.clipPath(clip)
        canvas.drawBitmap(img, src, dst, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        canvas.restore()
    }

    private fun drawTitle(canvas: Canvas, title: String) {
        val titleH = 120f
        val titleY = 50f
        val rect = RectF(GAP, titleY, W - GAP, titleY + titleH)

        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(128, 0, 0, 0) }
        canvas.drawRoundRect(rect, 20f, 20f, bg)

        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            textSize = 58f
            setShadowLayer(25f, 0f, 4f, Color.argb(204, 0, 0, 0))
        }
        // Shrink to fit within the banner width.
        val maxWidth = W - 100f
        while (text.textSize > 24f && text.measureText(title) > maxWidth) {
            text.textSize -= 2f
        }
        val cy = titleY + titleH / 2f
        val baseline = cy - (text.fontMetrics.ascent + text.fontMetrics.descent) / 2f
        canvas.drawText(title, W / 2f, baseline, text)
    }
}
