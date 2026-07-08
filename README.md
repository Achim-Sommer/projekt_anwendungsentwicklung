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
| Deployment | Nixpacks (`nixpacks.toml`), Backend liefert im Produktivbetrieb auch das gebaute Frontend aus |

## Projektstruktur

```
projekt_anwendungsentwicklung/
├── package.json                  # Root-Monorepo (Workspaces, dev/build/start-Skripte)
├── nixpacks.toml                 # Deployment-Konfiguration
└── packages/
    ├── shared/
    │   └── src/index.ts          # Gemeinsame Typen: Snapshots, Payloads, Pickups, Events, Skins
    ├── backend/
    │   └── src/
    │       ├── config.ts         # Alle Spiel-Konstanten, kommentiert (Balancing, Bots, Events, …)
    │       └── server.ts         # Autoritative Simulation, Bot-KI, HTTP-Server, Socket.IO
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
