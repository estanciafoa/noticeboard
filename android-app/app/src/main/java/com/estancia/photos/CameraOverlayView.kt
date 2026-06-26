package com.estancia.photos

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View

/**
 * Framing overlay drawn on top of the camera preview: a rule-of-thirds grid
 * plus a red "person" guide in the centre, so the subject is positioned in the
 * middle of every shot and stays centred after the collage center-crop.
 */
class CameraOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null, defStyle: Int = 0
) : View(context, attrs, defStyle) {

    private val grid = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(110, 255, 255, 255)
        strokeWidth = 2f
        style = Paint.Style.STROKE
    }
    private val centerFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(48, 255, 255, 255)
        style = Paint.Style.FILL
    }
    private val centerStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 255, 255, 255)
        strokeWidth = 3f
        style = Paint.Style.STROKE
    }
    private val person = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(70, 255, 255, 255)
        style = Paint.Style.FILL
    }

    private val cols = 3
    private val rows = 6

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()

        // 6 x 3 grid
        for (i in 1 until cols) {
            val x = w * i / cols
            canvas.drawLine(x, 0f, x, h, grid)
        }
        for (j in 1 until rows) {
            val y = h * j / rows
            canvas.drawLine(0f, y, w, y, grid)
        }

        // Center zone: middle column x middle 2 rows (where the subject should sit).
        val left = w * 1f / cols
        val right = w * 2f / cols
        val top = h * 2f / rows
        val bottom = h * 4f / rows
        val rect = RectF(left, top, right, bottom)
        canvas.drawRect(rect, centerFill)
        canvas.drawRect(rect, centerStroke)

        // Translucent person silhouette inside the box.
        val cx = (left + right) / 2f
        val boxW = right - left
        val boxH = bottom - top

        val headR = boxW * 0.17f
        val headCy = top + boxH * 0.22f
        canvas.drawCircle(cx, headCy, headR, person)

        val torsoTop = headCy + headR * 1.1f
        val torsoHalf = boxW * 0.33f
        val torso = RectF(cx - torsoHalf, torsoTop, cx + torsoHalf, bottom - boxH * 0.05f)
        // Round only the top (shoulders); square at the bottom of the box.
        val radii = floatArrayOf(torsoHalf, torsoHalf, torsoHalf, torsoHalf, 0f, 0f, 0f, 0f)
        val torsoPath = Path().apply { addRoundRect(torso, radii, Path.Direction.CW) }
        canvas.drawPath(torsoPath, person)
    }
}
