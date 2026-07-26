# OrbRush

FOM — Projekt: Anwendungsentwicklung

Ein browserbasiertes Multiplayer-Arena-Spiel im Stil von agar.io: Spieler sammeln Orbs, wachsen, fressen kleinere Gegner und weichen Gruben, Lava und Elektrofeldern aus. Der Server simuliert das komplette Spielgeschehen (server-authoritative), die Clients senden nur Eingaben und rendern Snapshots.

---

## Features

- **Echtzeit-Multiplayer** über Socket.IO, Simulation mit 60 Ticks/s auf dem Server
- **Orbs & Pickups**: Masse-Orbs, Speed, Schild, Tarnung, Raketen- und Chain-Munition
- **Fähigkeiten**: Blitz (Space, stunt Gegner in der Nähe), Rakete (R), Chain-Schuss
- **Hazards**: Gruben, Lava und Elektrofelder — wer zu tief hineingerät, stirbt
- **Score-Drops**: Gestorbene Spieler hinterlassen ihre Punkte als einsammelbare Orbs
- **Kopfgeld-System**: Rotierendes Bounty-Ziel mit dynamischer Belohnung, gelegentlich Spezial-Kopfgeld auf den größten Spieler
- **Match-Events**: Double Orbs, Haste und Bounty Rush im regelmäßigen Wechsel
- **Skins & Leaderboard**, Qualitätsstufen im Client umschaltbar (F8)
- **Fairer Neustart**: Ist länger als 10 Minuten kein echter Spieler online, werden Bots und liegengebliebene Score-Drops beim nächsten Join zurückgesetzt

## Technik-Stack

| Bereich | Technologie |
|---|---|
| Monorepo | npm workspaces + concurrently |
| Backend | Node.js, Socket.IO, TypeScript (strict) |
| Frontend | Phaser 3, Vite, socket.io-client |
| Shared | Gemeinsame TypeScript-Typen für alle Socket.IO-Events/Payloads |
| Tests | Vitest (Unit-Tests der Spiellogik in `packages/backend/src/game/`) |
| Deployment | Nixpacks (`nixpacks.toml`), Backend liefert im Produktivbetrieb auch das gebaute Frontend aus |

## Projektstruktur

```
projekt_anwendungsentwicklung/
├── package.json                  # Root-Monorepo (Workspaces, dev/build/start/test-Skripte)
├── vitest.config.ts              # Test-Konfiguration für das gesamte Monorepo
├── nixpacks.toml                 # Deployment-Konfiguration
└── packages/
    ├── shared/
    │   └── src/index.ts          # Gemeinsame Typen: Snapshots, Payloads, Pickups, Events, Skins
    ├── backend/
    │   └── src/
    │       ├── config.ts         # Alle Spiel-Konstanten, kommentiert (Balancing, Bots, Events, …)
    │       ├── server.ts         # Autoritative Simulation, Bot-KI, HTTP-Server, Socket.IO
    │       └── game/             # Reine Spiellogik ohne Server-Abhängigkeiten + Unit-Tests
    │           ├── bounty.ts     # Kopfgeld-Berechnung
    │           ├── combat.ts     # Fress-, Blitz- und Trefferregeln
    │           ├── hazards.ts    # Arena-Geometrie, Gruben, Randabstoßung
    │           ├── leaderboard.ts# Top-10 und Tarnungs-Filter
    │           ├── math.ts       # Masse ↔ Radius, Tempo, Vektoren
    │           ├── names.ts      # Namensprüfung, Bot-Namensvergabe
    │           ├── orbGrid.ts    # Spatial Grid für Orb-Kollisionen
    │           ├── pickups.ts    # Orb-Arten, -Werte, Score-Drop-Aufteilung
    │           ├── snapshot.ts   # Diff-Snapshots pro Client
    │           └── types.ts      # ServerPlayer und schmale Sichten darauf
    └── frontend/
        └── src/main.ts           # Phaser-3-Client: Rendering, Input, HUD, Scoreboard
```

## Entwicklung

```bash
# Abhängigkeiten installieren (im Repo-Root)
npm install

# Backend + Frontend parallel starten
npm run dev

# Oder einzeln:
npm run dev --workspace=packages/backend   # http://localhost:3000
npm run dev --workspace=packages/frontend  # http://localhost:8080
```

Im Dev-Modus verbindet sich das Frontend (Port 8080) mit dem Backend auf Port 3000. Der Backend-Server startet bei Codeänderungen automatisch neu (`ts-node-dev --respawn`).

## Tests

```bash
npm test              # alle Unit-Tests einmal ausführen
npm run test:watch    # Watch-Modus während der Entwicklung
npm run test:coverage # Coverage-Report (Text + HTML unter coverage/)
```

Getestet wird mit **Vitest**. Die Tests liegen direkt neben dem geprüften Modul
(`packages/backend/src/game/combat.ts` → `combat.test.ts`) und sind vom
Produktions-Build ausgeschlossen.

**Was getestet wird — und warum dort:** Die Spiellogik in `packages/backend/src/game/`
besteht aus reinen Funktionen ohne Server, Socket oder Timer. Genau deshalb ist
sie testbar: Eine Regel wie „ab welchem Massenverhältnis darf gefressen werden"
lässt sich in drei Zeilen prüfen, während dieselbe Frage im laufenden Spiel kaum
reproduzierbar ist. Schwerpunkte:

| Modul | Geprüft wird u. a. |
|---|---|
| `combat` | Fress-Verhältnis, Spawnschutz/Schild/Tarnung, Reichweite von Rand zu Rand, Raketen-Trefferberechnung |
| `hazards` | Wann ein Spieler in einer Grube stirbt (Anecken ≠ Tod), Arena-Strahlen, Ausweich-Vektoren der KI |
| `pickups` | Wahrscheinlichkeits-Grenzen der Orb-Arten, **Punkte-Erhalt beim Score-Drop** |
| `snapshot` | Diff-Logik: nur Geändertes senden, Entferntes melden, Voll-Resync nach 8 s |
| `bounty` | Belohnungsgrenzen, Event-Multiplikator, Spezial-Kopfgeld |
| `leaderboard` | Sortierung, Top-10-Grenze, Ausblenden getarnter Spieler |
| `orbGrid` | Nachbarzellen-Suche, Rand der Arena, Einfügen/Entfernen |
| `names` | Filtern unerlaubter Zeichen, Längenbegrenzung, keine doppelten Bot-Namen |
| `math` | Masse ↔ Radius/Tempo, Division durch Null bei Nullvektoren |

**Nicht per Unit-Test abgedeckt** sind bewusst `server.ts` (Socket.IO-Handler,
Tick-Loop) und der Phaser-Client — beides ist stark an Framework und Zeit
gekoppelt und wäre nur mit Integrationstests sinnvoll prüfbar.

## Produktion / Deployment

```bash
# Build in Reihenfolge shared → backend → frontend
npm run build

# Server starten (liefert auch das gebaute Frontend aus)
npm start
```

Der Backend-Server serviert im Produktivbetrieb `packages/frontend/dist` selbst — es wird also nur ein Prozess deployt. Der Port ist über die Umgebungsvariable `PORT` konfigurierbar (Standard: 3000). Das Deployment läuft über Nixpacks (`nixpacks.toml`).

## Konfiguration & Balancing

Alle Stellschrauben des Spiels liegen kommentiert in [`packages/backend/src/config.ts`](packages/backend/src/config.ts), gruppiert nach Themen:

- **Server & Simulation** — Tickrate, Snapshot-Raten, Resync-Intervall
- **Spieler & Spawning** — Startmasse, Geschwindigkeit, Respawn- und Schutzzeiten
- **Bots** — Anzahl (`TARGET_BOT_COUNT`), Reset-Schwelle, Namenspool
- **Orbs & Pickups** — Spawnraten, Wahrscheinlichkeiten, Wirkdauern
- **Fähigkeiten** — Reichweiten, Stun-Dauern, Cooldowns
- **Kampf & Hazards** — Fress-Verhältnis, Massegewinn, Todes-Schwellen
- **Kopfgeld & Events** — Rotations-Intervalle, Belohnungen, Event-Multiplikatoren
- **Bot-KI** — Scan-Radien, Fluchtverhalten, Zielpriorisierung

## Architektur-Notizen

- **Server-authoritative**: Clients senden ausschließlich Eingaben (Richtung, Fähigkeiten); Position, Kollisionen und Punkte berechnet nur der Server.
- **Diff-Snapshots**: Clients erhalten standardmäßig nur Änderungen (geänderte/entfernte Spieler und Pickups); alle 8 Sekunden gibt es ein volles Snapshot zur Resynchronisation. Die Snapshot-Rate steigt bei Kampfgeschehen automatisch.
- **Adaptives Orb-Limit**: Die Anzahl der Orbs auf der Karte skaliert mit der Zahl aktiver Spieler.
- **Spatial Grid**: Orbs liegen in einem Zellen-Grid für schnelle Kollisionsabfragen.
- **Trennung von Logik und Infrastruktur**: `server.ts` hält Zustand, Sockets und Tick-Loop; die eigentlichen Spielregeln liegen als reine Funktionen in `src/game/` und sind dadurch einzeln testbar.
