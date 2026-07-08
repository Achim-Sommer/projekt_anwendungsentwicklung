// Zentrale Spiel- und Server-Konfiguration.

// ── Server & Simulation ─────────────────────────────────────────────────────

// HTTP-/Socket.IO-Port; per Umgebungsvariable PORT überschreibbar
export const PORT = process.env.PORT ?? 3000;
// Simulationsschritte pro Sekunde (Tickrate der Physik)
export const TICK_RATE = 60;
// Snapshots pro Sekunde an die Clients, wenn kein Kampf stattfindet
export const SNAPSHOT_RATE_IDLE = 30;
// Snapshots pro Sekunde bei aktivem Kampfgeschehen
export const SNAPSHOT_RATE_COMBAT = 40;
// Leaderboard-Updates pro Sekunde im Ruhezustand
export const LEADERBOARD_RATE_IDLE = 2;
// Leaderboard-Updates pro Sekunde bei aktivem Kampf
export const LEADERBOARD_RATE_COMBAT = 4;
// Dauer eines Simulationsschritts in Sekunden (abgeleitet aus TICK_RATE)
export const DT = 1 / TICK_RATE;
// Dauer eines Simulationsschritts in Millisekunden
export const FIXED_STEP_MS = 1000 / TICK_RATE;
// Intervall, in dem der Simulations-Loop aufgerufen wird
export const SIM_LOOP_INTERVAL_MS = FIXED_STEP_MS;
// Max. Nachhol-Schritte pro Loop-Durchlauf (verhindert Aufschaukeln nach Lag-Spitzen)
export const MAX_SIM_STEPS_PER_FRAME = 4;
// Abstand, nach dem jeder Client statt eines Diffs wieder ein volles Snapshot bekommt
export const STREAM_FULL_RESYNC_MS = 8000;

// ── Spieler & Spawning ──────────────────────────────────────────────────────

// Masse, mit der jeder Spieler (und Bot) startet bzw. respawnt
export const PLAYER_START_MASS = 10;
// Grundbeschleunigung (Welt-Einheiten pro Sekunde²)
export const PLAYER_ACCELERATION_BASE = 2050;
// Grund-Höchstgeschwindigkeit (Welt-Einheiten pro Sekunde)
export const PLAYER_MAX_SPEED_BASE = 450;
// Dämpfungsfaktor pro Tick — kleiner = stärkeres Abbremsen ohne Input
export const PLAYER_DRAG = 0.92;
// Beschleunigungs-Multiplikator während eines Speed-Boosts
export const SPEED_BOOST_MULTIPLIER = 1.45;
// Höchstgeschwindigkeits-Multiplikator während eines Speed-Boosts
export const SPEED_BOOST_TOP_SPEED_MULTIPLIER = 1.3;
// Wartezeit nach dem Tod bis zum Respawn
export const RESPAWN_TIME_MS = 1800;
// Schutzzeit (unangreifbar) direkt nach dem Spawn
export const SPAWN_PROTECTION_MS = 2400;
// Mindestabstand des Spawnpunkts zu anderen Spielern
export const SPAWN_SAFE_PLAYER_DISTANCE = 250;
// Mindestabstand des Spawnpunkts zu Hazards (Gruben)
export const SPAWN_SAFE_HAZARD_DISTANCE = 120;
// Max. Versuche, einen sicheren Spawnpunkt zu finden, bevor irgendeiner genommen wird
export const SPAWN_ATTEMPTS = 40;

// ── Bots ────────────────────────────────────────────────────────────────────

// Anzahl Bots, die der Server dauerhaft in der Arena hält, werden ausgetauscht nach und nach mit echten Spielern
export const TARGET_BOT_COUNT = 10;
// Nach so langer Zeit ohne echten Spieler werden Bots + Score-Drops beim nächsten Join zurückgesetzt
export const BOT_ONLY_RESET_THRESHOLD_MS = 10 * 60 * 1000; // 10 Minuten
// Namenspool für Bots — Vergabe zufällig und ohne Doppelungen als "Bot <Name>"
export const BOT_NAMES = [
  "Alex", "Karla", "Finn", "Mia", "Jonas", "Lena", "Paul", "Emma",
  "Ben", "Sofia", "Luca", "Marie", "Noah", "Clara", "Elias", "Lina",
  "Felix", "Nora", "Max", "Ida", "Leon", "Greta", "Tom", "Zoe",
  "Erik", "Maja", "Henry", "Luisa", "Oskar", "Frieda", "Anton", "Ella",
  "Theo", "Romy", "Emil", "Tilda", "Jakob", "Selma", "Milan", "Juna",
  "Aaron", "Adam", "Adrian", "Alina", "Amelie", "Anja", "Annika", "Arne",
  "Arthur", "Bianca", "Bruno", "Carla", "Cedric", "Charlotte", "Chris", "Daniel",
  "David", "Dennis", "Dominik", "Elena", "Elisa", "Fabian", "Florian", "Franz",
  "Gabriel", "Hannah", "Helena", "Isabel", "Jan", "Jana", "Jannis", "Joel",
  "Johanna", "Jonathan", "Juli", "Julia", "Julian", "Kai", "Kilian", "Kim",
  "Konrad", "Laura", "Lea", "Leonie", "Liam", "Linda", "Lisa", "Lorenz",
  "Louis", "Luis", "Malte", "Manuel", "Marvin", "Matteo", "Melissa", "Moritz",
  "Nele", "Nico", "Niklas", "Oliver", "Patrick", "Philip", "Pia", "Robin",
  "Samuel", "Sarah", "Simon", "Sven", "Tamara", "Theresa", "Timo", "Tim",
  "Valentin", "Vanessa", "Vincent", "Viola", "Walter", "Yannik", "Yasmin", "Yvonne",
  "Aiden", "Alicia", "Amanda", "Amber", "Amy", "Andrew", "Angela", "Ava",
];

// ── Orbs & Pickups ──────────────────────────────────────────────────────────

// Standard-Spawnintervall für Orbs (aktuell ungenutzt — es gilt ORB_SPAWN_INTERVAL_MS_FAST)
export const ORB_SPAWN_INTERVAL_MS = 420;
// Mindestabstand zwischen zwei Orb-Spawns in Millisekunden
export const ORB_SPAWN_INTERVAL_MS_FAST = 180;
// Basiszahl an Orbs für das adaptive Orb-Limit
export const ORB_BASE_COUNT = 100;
// Zusätzliche Orbs pro aktivem Spieler (fließt ins adaptive Limit ein)
export const ORB_PER_ACTIVE_PLAYER = 40;
// Untergrenze des adaptiven Orb-Limits
export const ORB_MIN_COUNT = 140;
// Obergrenze des adaptiven Orb-Limits
export const ORB_MAX_COUNT = 260;
// Radius normaler Mass-Orbs
export const ORB_RADIUS = 6;
// Kleinster Wert eines normalen Orbs
export const ORB_VALUE_MIN = 8;
// Größter Wert eines normalen Orbs
export const ORB_VALUE_MAX = 14;
// Radius der Score-Drop-Orbs, die gestorbene Spieler hinterlassen
export const SCORE_DROP_ORB_RADIUS = 7;
// Mindestanzahl Orbs, in die ein Score-Drop zerfällt
export const SCORE_DROP_ORB_MIN = 6;
// Höchstanzahl Orbs, in die ein Score-Drop zerfällt
export const SCORE_DROP_ORB_MAX = 28;
// Streuradius der Score-Drops um die Todesstelle
export const SCORE_DROP_SPREAD_RADIUS = 92;
// Wahrscheinlichkeit, dass ein Orb-Spawn ein Special (Speed/Shield/Stealth) ist
export const SPECIAL_PICKUP_CHANCE = 0.07;
// Radius von Special-Pickups
export const SPECIAL_PICKUP_RADIUS = 9;
// Wahrscheinlichkeit, dass ein Orb-Spawn ein Raketen-Pickup ist
export const ROCKET_PICKUP_CHANCE = 0.04;
// Radius von Raketen-Pickups
export const ROCKET_PICKUP_RADIUS = 10;
// Zusätzlicher Trefferradius bei Raketentreffern - Fürs leichtere Treffen von Spielern
export const ROCKET_HIT_PADDING = 10;
// Wahrscheinlichkeit, dass ein Orb-Spawn ein Chain-Pickup ist
export const CHAIN_PICKUP_CHANCE = 0.07;
// Radius von Chain-Pickups
export const CHAIN_PICKUP_RADIUS = 10;
// Dauer des Speed-Boosts nach Einsammeln des Speed-Specials
export const SPECIAL_SPEED_DURATION_MS = 5000;
// Dauer der Unverwundbarkeit nach Einsammeln des Shield-Specials
export const SPECIAL_SHIELD_DURATION_MS = 7000;
// Dauer der Tarnung nach Einsammeln des Stealth-Specials
export const SPECIAL_STEALTH_DURATION_MS = 8500;

// ── Fähigkeiten (Blitz / Rakete / Chain) ────────────────────────────────────

// Reichweite des Blitzes, gemessen von Rand zu Rand der Spieler
export const SHOCK_EDGE_RANGE = 195;
// Stun-Dauer eines Blitz-Treffers
export const SHOCK_STUN_MS = 1700;
// Abklingzeit des Blitzes
export const SHOCK_COOLDOWN_MS = 7200;
// Reichweite des Chain-Schusses (Rand zu Rand; dient auch als Basis der Trefferbreite)
export const CHAIN_EDGE_RANGE = 320;
// Stun-Dauer eines Chain-Treffers
export const CHAIN_STUN_MS = 1200;
// Punkte pro Chain-Treffer
export const CHAIN_SCORE_BONUS = 5;
// Bots haben einen um diesen Faktor längeren Blitz-Cooldown als Menschen
export const BOT_SHOCK_COOLDOWN_MULTIPLIER = 2;
// Punkte pro Blitz-Treffer
export const SHOCK_SCORE_BONUS = 4;

// ── Kampf, Masse & Hazards ──────────────────────────────────────────────────

// Feste Bonusmasse für einen Kill (zusätzlich gibt es einen kleinen Anteil der Opfermasse)
export const KILL_MASS_BONUS = 20;
// Massenverhältnis, ab dem ein Spieler einen anderen fressen kann (22 % größer)
export const CONSUME_MIN_RATIO = 1.22;
// Anteil der Opfermasse, den der Fresser beim Verschlingen erhält
export const CONSUME_MASS_GAIN = 0.42;
// Passiver Massezuwachs pro Sekunde für alle lebenden Spieler
export const PASSIVE_MASS_GAIN_PER_SEC = 0.55;
// Anteil des Spielerradius, der in eine Grube ragen muss, damit der Spieler stirbt
export const HAZARD_DEATH_OVERLAP_RATIO = 0.55;
// Untergrenze dieser Eintauchtiefe in Welt-Einheiten
export const HAZARD_DEATH_OVERLAP_MIN = 10;
// Obergrenze dieser Eintauchtiefe in Welt-Einheiten
export const HAZARD_DEATH_OVERLAP_MAX = 24;

// ── Kopfgeld (Bounty) ───────────────────────────────────────────────────────

// Intervall, in dem das Kopfgeld-Ziel rotiert
export const BOUNTY_ROTATE_INTERVAL_MS = 26_000;
// Mindestanzahl Spieler, damit ein Kopfgeld aktiv ist
export const BOUNTY_MIN_PLAYERS = 2;
// Basiswert der Kopfgeld-Belohnung in Punkten
export const BOUNTY_BONUS_POINTS_BASE = 30;
// Untergrenze der Kopfgeld-Belohnung
export const BOUNTY_BONUS_POINTS_MIN = 20;
// Obergrenze der Kopfgeld-Belohnung
export const BOUNTY_BONUS_POINTS_MAX = 120;
// Intervall, in dem die Kopfgeld-Belohnung neu berechnet wird
export const BOUNTY_BONUS_REFRESH_MS = 1400;
// Bonusmasse für das Erlegen des Kopfgeld-Ziels
export const BOUNTY_BONUS_MASS = 14;
// Wahrscheinlichkeit, dass eine Rotation ein Spezial-Kopfgeld erzeugt
export const SPECIAL_BOUNTY_CHANCE = 0.16;
// Belohnung des Spezial-Kopfgelds als Anteil vom Score des größten Spielers
export const SPECIAL_BOUNTY_SCORE_RATIO = 0.8;
// Mindestabstand zwischen zwei Spezial-Kopfgeldern
export const SPECIAL_BOUNTY_MIN_INTERVAL_MS = 180_000;
// Wartezeit nach Serverstart bis zum ersten möglichen Spezial-Kopfgeld
export const SPECIAL_BOUNTY_INITIAL_DELAY_MS = 90_000;

// ── Match-Events ────────────────────────────────────────────────────────────

// Abstand zwischen zwei Match-Events
export const MATCH_EVENT_INTERVAL_MS = 62_000;
// Dauer eines Match-Events
export const MATCH_EVENT_DURATION_MS = 20_000;
// Tempo-Multiplikator während des Haste-Events
export const EVENT_HASTE_SPEED_MULTIPLIER = 1.16;
// Orb-Wert-Multiplikator während des Double-Orbs-Events
export const EVENT_DOUBLE_ORB_MULTIPLIER = 2;
// Kopfgeld-Multiplikator während des Bounty-Rush-Events
export const EVENT_BOUNTY_RUSH_MULTIPLIER = 1.55;

// ── Bot-KI ──────────────────────────────────────────────────────────────────

// Radius, in dem Bots Abstand zueinander halten (Separation)
export const AI_SEPARATION_RADIUS = 170;
// Quadrat des Separationsradius (vorberechnet für Distanzvergleiche)
export const AI_SEPARATION_RADIUS_SQ = AI_SEPARATION_RADIUS * AI_SEPARATION_RADIUS;
// Radius, in dem Bots nach gefährlichen Gegnern suchen
export const AI_DANGER_SCAN_RADIUS = 760;
// Ab diesem Massenverhältnis gilt ein Gegner für den Bot als Gefahr
export const AI_DANGER_MASS_RATIO = 1.1;
// Wie lange ein Bot nach erkannter Gefahr auf Fluchtkurs bleibt
export const AI_RETREAT_DURATION_MS = 900;
// Max. Zeitspanne, um die ein Bot die Bewegung seines Ziels vorausberechnet
export const AI_LOOKAHEAD_MAX_SECONDS = 0.34;
// Zielprioritäts-Bonus, wenn die potenzielle Beute ein Bot ist
export const AI_BOT_TARGET_BONUS = 16;
// Zielprioritäts-Bonus, wenn die potenzielle Beute ein Mensch ist
export const AI_HUMAN_TARGET_BONUS = 12;
// Basisreichweite, in der Beute (kleinere Spieler) den Bot anzieht
export const AI_PREY_PULL_RANGE_BASE = 300;

// ── Farben ──────────────────────────────────────────────────────────────────

// Standardfarbe echter Spieler (Hex-Farbwert)
export const DEFAULT_PLAYER_COLOR = 0x38bdf8;
// Farbe der Bots (Hex-Farbwert)
export const BOT_PLAYER_COLOR = 0x64748b;
