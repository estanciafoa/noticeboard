package com.estancia.photos

/**
 * A field team and the single notice-board slide it publishes to.
 *
 * [file] must byte-match the slide filename in the board's config.json
 * (case-sensitive) so an upload overwrites that slide instead of creating a
 * new one. Gardening and pest control already exist in config.json; the other
 * two require a one-time admin entry before they will appear on the displays.
 */
data class Team(
    val key: String,
    val label: String,
    val file: String,
    val title: String,
    /** Brand color + a darker shade (status bar / pressed) as hex strings. */
    val colorHex: String,
    val darkHex: String,
)

object Teams {
    val ALL: List<Team> = listOf(
        Team("gardening", "Gardening", "gardening-estancia.jpg", "Gardening @ Estancia", "#0B7A3B", "#095F2E"),
        Team("pest", "Pest Control", "pest-control-estancia.jpg", "Pest Control @ Estancia", "#C0392B", "#97291D"),
        Team("housekeeping", "Housekeeping", "housekeeping-estancia.jpg", "Housekeeping @ Estancia", "#00897B", "#00675B"),
        Team("maintenance", "Maintenance", "maintenance-estancia.jpg", "Maintenance @ Estancia", "#1565C0", "#0D47A1"),
    )

    fun byKey(key: String?): Team? = ALL.firstOrNull { it.key == key }

    val DEFAULT: Team = ALL.first()
}
