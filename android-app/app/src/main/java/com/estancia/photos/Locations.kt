package com.estancia.photos

/**
 * Display locations (tower/core, plus clubhouse and gate) a slide can be shown
 * on. [id] must match the tower keys used in the board's config.json `towers`
 * field and the `?t=` viewer URL parameter.
 */
object Locations {
    data class Loc(val id: String, val label: String)

    val ALL: List<Loc> = listOf(
        Loc("t1c1", "Tower 1 Core 1"),
        Loc("t1c2", "Tower 1 Core 2"),
        Loc("t2c1", "Tower 2 Core 1"),
        Loc("t2c2", "Tower 2 Core 2"),
        Loc("t3c1", "Tower 3 Core 1"),
        Loc("t3c2", "Tower 3 Core 2"),
        Loc("t4c1", "Tower 4 Core 1"),
        Loc("t4c2", "Tower 4 Core 2"),
        Loc("t5c1", "Tower 5 Core 1"),
        Loc("t5c2", "Tower 5 Core 2"),
        Loc("club", "Clubhouse"),
        Loc("gate", "Main Gate"),
    )
}
