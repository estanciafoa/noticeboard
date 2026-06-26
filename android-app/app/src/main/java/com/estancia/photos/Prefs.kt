package com.estancia.photos

import android.content.Context

/** Persisted settings: which team this device publishes as, and the access token. */
object Prefs {
    private const val NAME = "estancia"
    private const val KEY_TEAM = "team"
    private const val KEY_TOKEN = "token"

    private fun sp(c: Context) = c.getSharedPreferences(NAME, Context.MODE_PRIVATE)

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
}
