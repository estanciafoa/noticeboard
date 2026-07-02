package com.estancia.photos

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

/**
 * Daily "post the photos" reminder.
 *
 * From [WINDOW_START_HOUR]:00 to [WINDOW_END_HOUR]:00 the app raises a
 * notification on the hour, every hour, until the day's photo collage is
 * uploaded. Uploading marks the day as done ([Prefs.markPostedToday]) and the
 * reminders re-arm for tomorrow noon.
 *
 * Uses AlarmManager re-armed on each fire (so it works with the app closed) with
 * an inexact allow-while-idle alarm, so no exact-alarm permission is needed.
 * Reminders are skipped when the app isn't configured (no token) or the current
 * team is the schedule-only Lift portfolio (which posts no photos).
 */
object Reminders {
    const val CHANNEL_ID = "post-reminders"
    private const val NOTIFICATION_ID = 4201
    private const val ALARM_REQUEST = 4202

    private const val WINDOW_START_HOUR = 12   // first reminder (noon)
    private const val WINDOW_END_HOUR = 21     // last reminder (9pm)

    /** Create the notification channel. Safe to call repeatedly. */
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Photo post reminders",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Hourly afternoon reminder to post the day's photos."
        }
        mgr.createNotificationChannel(channel)
    }

    private fun alarmPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getBroadcast(context, ALARM_REQUEST, intent, flags)
    }

    /** Compute the next fire time: the next on-the-hour slot inside the window,
     *  or tomorrow's start hour once the window has passed. */
    private fun nextTriggerMillis(now: Calendar): Long {
        val c = now.clone() as Calendar
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        val hour = now.get(Calendar.HOUR_OF_DAY)
        when {
            hour < WINDOW_START_HOUR -> c.set(Calendar.HOUR_OF_DAY, WINDOW_START_HOUR)
            hour < WINDOW_END_HOUR -> c.add(Calendar.HOUR_OF_DAY, 1)   // next top of the hour
            else -> {                                                  // window done for today
                c.add(Calendar.DAY_OF_YEAR, 1)
                c.set(Calendar.HOUR_OF_DAY, WINDOW_START_HOUR)
            }
        }
        return c.timeInMillis
    }

    /** Arm the next reminder alarm. */
    fun scheduleNext(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val trigger = nextTriggerMillis(Calendar.getInstance())
        val pi = alarmPendingIntent(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, trigger, pi)
        } else {
            am.set(AlarmManager.RTC_WAKEUP, trigger, pi)
        }
    }

    /** Cancel any pending reminder alarm and dismiss a showing notification. */
    fun cancel(context: Context) {
        val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        am?.cancel(alarmPendingIntent(context))
        clearNotification(context)
    }

    /** Arm or cancel the reminder to match the admin on/off setting. Call on app
     *  start and whenever the setting changes. */
    fun apply(context: Context) {
        if (Prefs.remindersEnabled(context)) scheduleNext(context) else cancel(context)
    }

    /** Should we actually notify right now? */
    private fun shouldNotify(context: Context): Boolean {
        if (!Prefs.remindersEnabled(context)) return false        // turned off in Admin
        if (!Prefs.isConfigured(context)) return false
        if (Prefs.team(context).scheduleOnly) return false        // Lift posts no photos
        if (Prefs.postedToday(context)) return false
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        return hour in WINDOW_START_HOUR..WINDOW_END_HOUR
    }

    private fun notify(context: Context) {
        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        var flags = PendingIntent.FLAG_UPDATE_CURRENT
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags = flags or PendingIntent.FLAG_IMMUTABLE
        val contentPi = PendingIntent.getActivity(context, 0, open, flags)

        val teamLabel = Prefs.team(context).label
        val notif = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_camera)
            .setContentTitle("Post today's photos")
            .setContentText("Reminder: upload the $teamLabel photos to the notice board.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(contentPi)
            .build()

        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notif)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS not granted (Android 13+) — nothing we can do here.
        }
    }

    /** Called each time the alarm fires: notify if due, then re-arm (unless off). */
    fun onAlarm(context: Context) {
        if (shouldNotify(context)) notify(context)
        if (Prefs.remindersEnabled(context)) scheduleNext(context)
    }

    /** Dismiss any showing reminder (e.g. once the photos are posted). */
    fun clearNotification(context: Context) {
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    /** Photos posted for today: silence the reminder and re-arm for tomorrow. */
    fun onPosted(context: Context) {
        Prefs.markPostedToday(context)
        clearNotification(context)
        scheduleNext(context)
    }
}

/** Fires on each scheduled reminder tick. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.onAlarm(context)
    }
}

/** Re-arm the reminder after a device reboot (alarms don't survive reboot). */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Reminders.ensureChannel(context)
            Reminders.scheduleNext(context)
        }
    }
}
