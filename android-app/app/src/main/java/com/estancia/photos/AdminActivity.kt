package com.estancia.photos

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.google.android.material.switchmaterial.SwitchMaterial
import java.util.concurrent.Executors

/** Admin view: choose which team this device publishes as, and store the access token. */
class AdminActivity : AppCompatActivity() {

    companion object {
        /** Extra password gate in front of the noticeboard-control (board slides) screen. */
        private const val CONTROL_PASSWORD = "EM@2026"
    }

    private val io = Executors.newSingleThreadExecutor()
    private val ui = Handler(Looper.getMainLooper())

    private lateinit var spinner: Spinner
    private lateinit var tokenInput: EditText
    private lateinit var status: TextView
    private lateinit var saveBtn: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_admin)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)

        spinner = findViewById(R.id.teamSpinner)
        tokenInput = findViewById(R.id.tokenInput)
        status = findViewById(R.id.adminStatus)
        saveBtn = findViewById(R.id.saveBtn)

        val labels = Teams.ALL.map { it.label }
        spinner.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, labels)
        spinner.setSelection(Teams.ALL.indexOf(Prefs.team(this)).coerceAtLeast(0))

        tokenInput.setText(Prefs.token(this))

        // Daily photo reminder on/off — applied immediately (independent of the token).
        val reminderSwitch = findViewById<SwitchMaterial>(R.id.reminderSwitch)
        reminderSwitch.isChecked = Prefs.remindersEnabled(this)
        reminderSwitch.setOnCheckedChangeListener { _, checked ->
            Prefs.setRemindersEnabled(this, checked)
            Reminders.apply(this)
        }

        saveBtn.setOnClickListener { save() }

        findViewById<Button>(R.id.manageSlidesBtn).setOnClickListener {
            if (Prefs.token(this).isBlank()) {
                setStatus(getString(R.string.slides_need_token), true)
            } else {
                promptControlPassword()
            }
        }
    }

    /** Ask for the noticeboard-control password before opening the board slides screen. */
    private fun promptControlPassword() {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            hint = getString(R.string.slides_lock_hint)
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.slides_lock_title)
            .setView(input)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                if (input.text.toString() == CONTROL_PASSWORD) {
                    startActivity(Intent(this, SlidesActivity::class.java))
                } else {
                    Toast.makeText(this, R.string.wrong_password, Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    private fun save() {
        val team = Teams.ALL[spinner.selectedItemPosition]
        val token = tokenInput.text.toString().trim()
        if (token.isBlank()) {
            setStatus(getString(R.string.token_required), true)
            return
        }
        saveBtn.isEnabled = false
        setStatus(getString(R.string.checking_token), false)
        io.execute {
            val ok = GithubUploader.validateToken(token)
            ui.post {
                saveBtn.isEnabled = true
                if (!ok) {
                    setStatus(getString(R.string.token_rejected), true)
                    return@post
                }
                Prefs.setTeam(this, team.key)
                Prefs.setToken(this, token)
                setStatus(getString(R.string.saved), false)
                finish()
            }
        }
    }

    private fun setStatus(msg: String, error: Boolean) {
        status.text = msg
        status.setTextColor(getColor(if (error) R.color.red else R.color.green_dark))
    }
}
