package com.estancia.photos

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
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
        color = Color.argb(120, 255, 255, 255)
        strokeWidth = 2f
        style = Paint.Style.STROKE
    }
    private val personFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(60, 220, 40, 40)
        style = Paint.Style.FILL
    }
    private val personStroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 220, 40, 40)
        strokeWidth = 5f
        style = Paint.Style.STROKE
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()

        // Rule-of-thirds grid
        canvas.drawLine(w / 3f, 0f, w / 3f, h, grid)
        canvas.drawLine(2f * w / 3f, 0f, 2f * w / 3f, h, grid)
        canvas.drawLine(0f, h / 3f, w, h / 3f, grid)
        canvas.drawLine(0f, 2f * h / 3f, w, 2f * h / 3f, grid)

        // Centered person guide (head circle + body capsule)
        val cx = w / 2f
        val headR = w * 0.085f
        val headCy = h * 0.34f
        canvas.drawCircle(cx, headCy, headR, personFill)
        canvas.drawCircle(cx, headCy, headR, personStroke)

        val bodyTop = headCy + headR * 1.1f
        val bodyBottom = h * 0.82f
        val bodyHalf = w * 0.16f
        val body = RectF(cx - bodyHalf, bodyTop, cx + bodyHalf, bodyBottom)
        val r = w * 0.10f
        canvas.drawRoundRect(body, r, r, personFill)
        canvas.drawRoundRect(body, r, r, personStroke)
    }
}
