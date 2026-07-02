package com.estancia.photos

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Persisted settings: which team this device publishes as, and the access token. */
object Prefs {
    private const val NAME = "estancia"
    private const val KEY_TEAM = "team"
    private const val KEY_TOKEN = "token"
    private const val KEY_POSTED_DATE = "postedDate"   // yyyy-MM-dd of last daily photo post
    private const val KEY_REMINDERS = "remindersEnabled"

    private fun sp(c: Context) = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    private fun today(): String =
        SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

    fun team(c: Context): Team =
        Teams.byKey(sp(c).getString(KEY_TEAM, null)) ?: Teams.DEFAULT

    fun setTeam(c: Context, key: String) {
        sp(c).edit().putString(KEY_TEAM, key).apply()
    }

    fun token(c: Context): String = sp(c).getString(KEY_TOKEN, "") ?: ""

    fun setToken(c: Context, token: String) {
        sp(c).edit().putString(KEY_TOKEN, token).apply()
    }

    fun isConfigured(c: Context): Boolean = token(c).isNotBlank()

    /** Record that today's daily photo collage has been posted (silences reminders). */
    fun markPostedToday(c: Context) {
        sp(c).edit().putString(KEY_POSTED_DATE, today()).apply()
    }

    /** True if a daily photo collage has already been posted today. */
    fun postedToday(c: Context): Boolean = sp(c).getString(KEY_POSTED_DATE, "") == today()

    /** Whether the daily "post the photos" reminder is on (default true). */
    fun remindersEnabled(c: Context): Boolean = sp(c).getBoolean(KEY_REMINDERS, true)

    fun setRemindersEnabled(c: Context, enabled: Boolean) {
        sp(c).edit().putBoolean(KEY_REMINDERS, enabled).apply()
    }
}
