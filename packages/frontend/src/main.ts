import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type {
  ArenaState,
  ClientToServerEvents,
  ForceOrb,
  GameSnapshot,
  HazardZone,
  PlayerInputPayload,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@projekt/shared";

// In Produktion verwenden wir standardmaessig dieselbe Origin wie die Seite selbst.
// Optional kann die URL fuer Sonderfaelle ueber VITE_SERVER_URL gesetzt werden.
function resolveServerUrl(): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured && configured.trim().length > 0) {
    return configured;
  }

  const { protocol, hostname, port } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  // Dev-Fallback: Vite laeuft meist auf 5173/8080, Backend auf 3000.
  if (isLocalHost && port !== "3000") {
    return `${protocol}//${hostname}:3000`;
  }

  return window.location.origin;
}

const SERVER_URL = resolveServerUrl();

const nameOverlay = document.getElementById("name-overlay") as HTMLDivElement | null;
const nameInput = document.getElementById("name-input") as HTMLInputElement | null;
const nameError = document.getElementById("name-error") as HTMLDivElement | null;
const startButton = document.getElementById("start-button") as HTMLButtonElement | null;

if (!nameOverlay || !nameInput || !nameError || !startButton) {
  throw new Error("Start UI elements are missing in index.html.");
}

const nameOverlayElement = nameOverlay;
const nameInputElement = nameInput;
const nameErrorElement = nameError;
const startButtonElement = startButton;

const hudStatus = document.getElementById("hud-status") as HTMLDivElement | null;
const hudPlayer = document.getElementById("hud-player") as HTMLDivElement | null;
const hudScoreboard = document.getElementById("hud-scoreboard") as HTMLPreElement | null;

if (!hudStatus || !hudPlayer || !hudScoreboard) {
  throw new Error("HUD elements are missing in index.html.");
}

const hudStatusElement = hudStatus;
const hudPlayerElement = hudPlayer;
const hudScoreboardElement = hudScoreboard;

let playerName = "";

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
});

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizePlayerName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 16);
}

function startGameWithName(): void {
  const normalizedName = normalizePlayerName(nameInputElement.value);
  if (normalizedName.length < 2) {
    nameErrorElement.textContent = "Bitte mindestens 2 Zeichen für deinen Namen eingeben.";
    return;
  }

  playerName = normalizedName;
  nameInputElement.value = normalizedName;
  nameErrorElement.textContent = "";
  startButtonElement.disabled = true;

  socket.auth = { playerName: normalizedName };
  if (!socket.connected) {
    socket.connect();
  }
}

nameInputElement.focus();

startButtonElement.addEventListener("click", startGameWithName);
nameInputElement.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    startGameWithName();
  }
});

socket.on("connect", () => {
  nameOverlayElement.classList.add("hidden");
  console.log(`[Client] Connected to server. Socket id: ${socket.id}`);
});

socket.on("disconnect", () => {
  startButtonElement.disabled = false;
  if (!nameOverlayElement.classList.contains("hidden")) {
    nameErrorElement.textContent = "";
  }
  console.log("[Client] Disconnected from server.");
});

socket.on("connect_error", (error) => {
  startButtonElement.disabled = false;
  nameOverlayElement.classList.remove("hidden");
  nameErrorElement.textContent = `Verbindung fehlgeschlagen: ${error.message}`;
  nameInputElement.focus();
  console.error("[Client] Connection error:", error.message);
});

class GameScene extends Phaser.Scene {
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private hazardGraphics!: Phaser.GameObjects.Graphics;
  private decorGraphics!: Phaser.GameObjects.Graphics;
  private pickupGraphics!: Phaser.GameObjects.Graphics;
  private playerGraphics!: Phaser.GameObjects.Graphics;
  private cameraTarget!: Phaser.GameObjects.Zone;
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private hazardLabels: Phaser.GameObjects.Text[] = [];
  private renderPlayers = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private lastLabelText = new Map<string, string>();

  private snapshot: GameSnapshot | null = null;
  private arena: ArenaState | null = null;
  private localPlayerId = "";
  private inputSeq = 0;
  private lastInputSentAt = 0;
  private hudCompact = false;
  private leaderboardLines = 8;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  private pointerWorld = new Phaser.Math.Vector2();

  private readonly onConnect: () => void;
  private readonly onDisconnect: () => void;
  private readonly onConnectError: (error: Error) => void;
  private readonly onWelcome: (payload: {
    yourId: string;
    arena: ArenaState;
    snapshot: GameSnapshot;
  }) => void;
  private readonly onSnapshot: (payload: GameSnapshot) => void;
  private readonly onPlayerLeft: () => void;

  constructor() {
    super({ key: "GameScene" });
    this.onConnect = () => this.updateStatus();
    this.onDisconnect = () => {
      this.updateStatus();
    };
    this.onConnectError = () => {
      this.updateStatus();
    };
    this.onWelcome = (payload) => {
      this.localPlayerId = payload.yourId;
      this.arena = payload.arena;
      this.snapshot = payload.snapshot;
      this.syncRenderPlayersFromSnapshot(true);
      this.resizeToArena();
      this.updateStatus();
      this.drawArena();
      this.drawHazards();
      this.drawPickups();
      this.drawPlayers();
      this.updateHud();
    };
    this.onSnapshot = (payload) => {
      this.snapshot = payload;
      this.syncRenderPlayersFromSnapshot(false);
      this.resizeToArena();
      this.drawPickups();
      this.updateHud();
    };
    this.onPlayerLeft = () => {
      this.drawPlayers();
      this.updateHud();
    };
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);
    this.cameras.main.roundPixels = true;

    this.arenaGraphics = this.add.graphics();
    this.hazardGraphics = this.add.graphics();
    this.decorGraphics = this.add.graphics();
    this.pickupGraphics = this.add.graphics();
    this.playerGraphics = this.add.graphics();
    this.cameraTarget = this.add.zone(0, 0, 1, 1);
    this.updateHudDensity();

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is not available.");
    }
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W, false),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S, false),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A, false),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D, false),
    };
    // Verhindert, dass Phaser globale WASD-Events schluckt, solange das DOM-Input aktiv ist.
    keyboard.disableGlobalCapture();

    this.input.mouse?.disableContextMenu();
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.pointerWorld.set(worldPoint.x, worldPoint.y);
    });

    this.scale.on("resize", () => {
      this.updateHudDensity();
      this.updateHud();
    });
    window.addEventListener("resize", this.handleWindowResize);

    this.updateStatus();
    this.updateHud();

    const camera = this.cameras.main;
    camera.startFollow(this.cameraTarget, true, 0.12, 0.12);
    camera.setDeadzone(130, 90);

    socket.on("connect", this.onConnect);
    socket.on("disconnect", this.onDisconnect);
    socket.on("connect_error", this.onConnectError);
    socket.on("welcome", this.onWelcome);
    socket.on("snapshot", this.onSnapshot);
    socket.on("playerLeft", this.onPlayerLeft);
  }

  update(): void {
    if (!socket.connected) {
      return;
    }

    const player = this.getLocalPlayer();
    if (!player) {
      return;
    }

    const moveInput = this.getMovementInput(player);
    const payload: PlayerInputPayload = {
      seq: this.inputSeq++,
      up: moveInput.up,
      down: moveInput.down,
      left: moveInput.left,
      right: moveInput.right,
    };

    if (this.time.now - this.lastInputSentAt >= 16) {
      socket.emit("input", payload);
      this.lastInputSentAt = this.time.now;
    }

    this.updateRenderPlayers();
    this.updateCamera(player);
    this.drawPlayers();
  }

  private getMovementInput(player: PlayerSnapshot): {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
  } {
    // Agar.io-Gefuehl: Mausposition steuert die Bewegungsrichtung.
    const render = this.renderPlayers.get(player.id);
    const px = render?.x ?? player.x;
    const py = render?.y ?? player.y;
    const dx = this.pointerWorld.x - px;
    const dy = this.pointerWorld.y - py;
    const distance = Math.hypot(dx, dy);
    const deadzone = Math.max(16, player.radius * 1.15);

    const keyboardActive =
      this.keys.up.isDown || this.keys.down.isDown || this.keys.left.isDown || this.keys.right.isDown;

    if (keyboardActive) {
      return {
        up: this.keys.up.isDown,
        down: this.keys.down.isDown,
        left: this.keys.left.isDown,
        right: this.keys.right.isDown,
      };
    }

    if (distance <= deadzone) {
      return { up: false, down: false, left: false, right: false };
    }

    const nx = dx / Math.max(distance, 0.0001);
    const ny = dy / Math.max(distance, 0.0001);
    return {
      up: ny < -0.28,
      down: ny > 0.28,
      left: nx < -0.28,
      right: nx > 0.28,
    };
  }

  private updateCamera(localPlayer: PlayerSnapshot): void {
    const camera = this.cameras.main;
    const render = this.renderPlayers.get(localPlayer.id);
    const px = render?.x ?? localPlayer.x;
    const py = render?.y ?? localPlayer.y;
    this.cameraTarget.setPosition(px, py);

    const massZoom = clamp(1.32 * Math.pow(22 / Math.max(12, localPlayer.mass), 0.2), 0.72, 1.55);
    const viewportFactor = clamp(Math.min(this.scale.width, this.scale.height) / 900, 0.82, 1.35);
    const desiredZoom = clamp(massZoom * viewportFactor, 0.72, 1.62);
    camera.setZoom(Phaser.Math.Linear(camera.zoom, desiredZoom, 0.09));
  }

  private syncRenderPlayersFromSnapshot(force: boolean): void {
    if (!this.snapshot) {
      return;
    }

    const aliveIds = new Set<string>();
    for (const player of this.snapshot.players) {
      if (!player.alive) {
        continue;
      }
      aliveIds.add(player.id);
      const existing = this.renderPlayers.get(player.id);
      if (!existing || force) {
        this.renderPlayers.set(player.id, {
          x: player.x,
          y: player.y,
          vx: player.vx,
          vy: player.vy,
        });
      }
    }

    for (const id of Array.from(this.renderPlayers.keys())) {
      if (!aliveIds.has(id)) {
        this.renderPlayers.delete(id);
      }
    }
  }

  private updateRenderPlayers(): void {
    if (!this.snapshot) {
      return;
    }

    const dt = Math.max(0.001, this.game.loop.delta / 1000);

    for (const player of this.snapshot.players) {
      if (!player.alive) {
        continue;
      }

      const state = this.renderPlayers.get(player.id);
      if (!state) {
        this.renderPlayers.set(player.id, {
          x: player.x,
          y: player.y,
          vx: player.vx,
          vy: player.vy,
        });
        continue;
      }

      // Leichte Extrapolation + Korrektur ergibt sichtbar fluessigere Bewegung.
      state.x += state.vx * dt;
      state.y += state.vy * dt;

      const blend = clamp(0.3 + dt * 7.5, 0.3, 0.62);
      state.x = Phaser.Math.Linear(state.x, player.x, blend);
      state.y = Phaser.Math.Linear(state.y, player.y, blend);
      state.vx = Phaser.Math.Linear(state.vx, player.vx, 0.52);
      state.vy = Phaser.Math.Linear(state.vy, player.vy, 0.52);

      const errorX = player.x - state.x;
      const errorY = player.y - state.y;
      const error = Math.hypot(errorX, errorY);
      if (error > 240) {
        state.x = player.x;
        state.y = player.y;
        state.vx = player.vx;
        state.vy = player.vy;
      }
    }
  }

  private resizeToArena(): void {
    if (!this.arena) {
      return;
    }

    const { width, height } = this.arena;
    this.fitArenaToViewport(width, height);
  }

  private readonly handleWindowResize = (): void => {
    if (!this.arena) {
      return;
    }
    this.fitArenaToViewport(this.arena.width, this.arena.height);
  };

  private fitArenaToViewport(arenaWidth: number, arenaHeight: number): void {
    const viewportWidth = Math.max(320, Math.floor(window.innerWidth));
    const viewportHeight = Math.max(240, Math.floor(window.innerHeight));
    const gameSize = this.scale.gameSize;

    if (gameSize.width !== viewportWidth || gameSize.height !== viewportHeight) {
      this.scale.resize(viewportWidth, viewportHeight);
    }

    const camera = this.cameras.main;
    camera.setBounds(0, 0, arenaWidth, arenaHeight);
    if (!this.getLocalPlayer()) {
      camera.centerOn(arenaWidth / 2, arenaHeight / 2);
    }
  }

  private updateHudDensity(): void {
    const ultraCompact = this.scale.width < 720 || this.scale.height < 520;
    this.hudCompact = this.scale.height < 760 || this.scale.width < 1180;
    this.leaderboardLines = ultraCompact ? 6 : this.hudCompact ? 8 : 10;
  }

  private drawArena(): void {
    if (!this.arena) {
      return;
    }

    for (const label of this.hazardLabels) {
      label.destroy();
    }
    this.hazardLabels = [];

    // Statische Ebene: Hintergrund und Bodenmuster. Diese Ebene wird nur bei Arena-Updates neu gezeichnet.
    this.decorGraphics.clear();
    this.arenaGraphics.clear();
    this.hazardGraphics.clear();
    this.pickupGraphics.clear();
    this.arenaGraphics.fillStyle(0x050814, 1);
    this.arenaGraphics.fillRect(0, 0, this.arena.width, this.arena.height);
    this.arenaGraphics.fillStyle(0x0b1223, 0.9);
    this.arenaGraphics.fillRoundedRect(10, 10, this.arena.width - 20, this.arena.height - 20, 24);

    // Panel-Tiles geben Struktur, ohne vom Gameplay abzulenken.
    const drawFullDecor = this.scale.width >= 1100 && this.scale.height >= 700;
    const tileSize = drawFullDecor ? 72 : 120;
    for (let y = 24; y < this.arena.height - 24; y += tileSize) {
      for (let x = 24; x < this.arena.width - 24; x += tileSize) {
        const isAlt = ((x / tileSize) + (y / tileSize)) % 2 === 0;
        this.decorGraphics.fillStyle(isAlt ? 0x111f38 : 0x0f1a2f, drawFullDecor ? 0.36 : 0.2);
        this.decorGraphics.fillRoundedRect(x, y, tileSize - 10, tileSize - 10, 8);
      }
    }

    if (drawFullDecor) {
      this.decorGraphics.lineStyle(1, 0x1e293b, 0.28);
      for (let x = 24; x < this.arena.width - 20; x += tileSize) {
        this.decorGraphics.lineBetween(x, 20, x, this.arena.height - 20);
      }
      for (let y = 24; y < this.arena.height - 20; y += tileSize) {
        this.decorGraphics.lineBetween(20, y, this.arena.width - 20, y);
      }
    }

    if (drawFullDecor) {
      this.decorGraphics.lineStyle(2, 0x0ea5e9, 0.35);
      this.decorGraphics.strokeCircle(this.arena.width / 2, this.arena.height / 2, 120);
      this.decorGraphics.lineStyle(1, 0x38bdf8, 0.25);
      this.decorGraphics.strokeCircle(this.arena.width / 2, this.arena.height / 2, 190);
    }

    this.arenaGraphics.lineStyle(3, 0x22d3ee, 0.6);
    this.arenaGraphics.strokeRect(0, 0, this.arena.width, this.arena.height);

    for (const hazard of this.arena.hazards) {
      this.createHazardLabel(hazard);
    }
  }

  private drawPickups(): void {
    if (!this.snapshot) {
      return;
    }

    const view = this.cameras.main.worldView;
    const margin = 50;
    this.pickupGraphics.clear();
    for (const orb of this.snapshot.pickups) {
      if (
        orb.x < view.x - margin ||
        orb.x > view.right + margin ||
        orb.y < view.y - margin ||
        orb.y > view.bottom + margin
      ) {
        continue;
      }
      this.drawOrb(orb);
    }
  }

  private drawOrb(orb: ForceOrb): void {
    this.pickupGraphics.fillStyle(0x0f172a, 0.82);
    this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 4);
    this.pickupGraphics.fillStyle(0xfacc15, 0.86);
    this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 1.2);
    this.pickupGraphics.lineStyle(1, 0xfef08a, 0.52);
    this.pickupGraphics.strokeCircle(orb.x, orb.y, orb.radius + 4.8);
  }

  private drawHazards(): void {
    if (!this.arena) {
      return;
    }

    // Nur auf Snapshot-Updates zeichnen reduziert Zeichenaufwand deutlich.
    this.hazardGraphics.clear();
    for (const hazard of this.arena.hazards) {
      this.drawHazard(hazard);
    }
  }

  private drawHazard(hazard: HazardZone): void {

    if (hazard.type === "lava") {
      this.hazardGraphics.fillStyle(0x7f1d1d, 0.8);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0xdc2626, 0.62);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 4,
        hazard.y + 5,
        hazard.width - 8,
        hazard.height - 10,
        8
      );
      this.hazardGraphics.lineStyle(3, 0xfda4af, 0.62);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      return;
    }

    if (hazard.type === "electric") {
      this.hazardGraphics.fillStyle(0x3f2a06, 0.82);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0x92400e, 0.6);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 3,
        hazard.y + 3,
        hazard.width - 6,
        hazard.height - 6,
        9
      );
      this.hazardGraphics.lineStyle(3, 0xfacc15, 0.68);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      return;
    }

    this.hazardGraphics.fillStyle(0x020617, 0.96);
    this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
    this.hazardGraphics.fillStyle(0x0f172a, 0.9);
    this.hazardGraphics.fillRoundedRect(
      hazard.x + 6,
      hazard.y + 6,
      hazard.width - 12,
      hazard.height - 12,
      8
    );
    this.hazardGraphics.lineStyle(3, 0x64748b, 0.66);
    this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);

    const centerX = hazard.x + hazard.width / 2;
    const centerY = hazard.y + hazard.height / 2;
    this.hazardGraphics.fillStyle(0x020617, 0.92);
    this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 0.64, hazard.height * 0.42);
  }

  private createHazardLabel(hazard: HazardZone): void {
    if (this.scale.width < 980 || this.scale.height < 620) {
      return;
    }

    let title = "ZONE";
    let icon = "◼";
    if (hazard.type === "lava") {
      title = "LAVA";
      icon = "🔥";
    } else if (hazard.type === "electric") {
      title = "ELEKTROFELD";
      icon = "⚡";
    } else if (hazard.type === "pit") {
      title = "ABGRUND";
      icon = "🌀";
    }

    // Kleine Label-Box mit Icon verbessert Lesbarkeit in hektischen Situationen.
    const label = this.add
      .text(hazard.x + 10, hazard.y + 8, `${icon} ${title}`, {
        fontSize: "12px",
        color: "#f8fafc",
        fontStyle: "bold",
        backgroundColor: "#0f172acc",
        padding: { left: 8, right: 8, top: 4, bottom: 4 },
      })
      .setDepth(4);
    this.hazardLabels.push(label);
  }

  private drawPlayers(): void {
    if (!this.snapshot) {
      return;
    }

    this.playerGraphics.clear();

    const view = this.cameras.main.worldView;
    const margin = 140;
    const visiblePlayers: PlayerSnapshot[] = [];

    for (const player of this.snapshot.players) {
      if (!player.alive) {
        continue;
      }

      const render = this.renderPlayers.get(player.id);
      const px = render?.x ?? player.x;
      const py = render?.y ?? player.y;
      const radiusPad = player.radius + margin;

      if (
        px + radiusPad < view.x ||
        px - radiusPad > view.right ||
        py + radiusPad < view.y ||
        py - radiusPad > view.bottom
      ) {
        continue;
      }

      visiblePlayers.push(player);
    }

    const showNameLabels = visiblePlayers.length <= 28;

    for (const player of visiblePlayers) {
      this.playerGraphics.fillStyle(player.color, 1);
      const render = this.renderPlayers.get(player.id);
      const px = render?.x ?? player.x;
      const py = render?.y ?? player.y;

      // Agar.io-aehnlicher Look: ein einzelner Kreis, der mit der Masse waechst.
      this.playerGraphics.fillCircle(px, py, player.radius);

      let label = this.nameLabels.get(player.id);
      if (!label) {
        label = this.add
          .text(px, py - 42, "", {
            fontSize: "11px",
            color: "#ffffff",
          })
          .setOrigin(0.5)
          .setDepth(5);
        this.nameLabels.set(player.id, label);
      }

      label.setPosition(px, py - 42);
      label.setVisible(showNameLabels || player.id === this.localPlayerId);
      const labelText = `${player.name}${player.isBot ? " 🤖" : ""}`;
      if (this.lastLabelText.get(player.id) !== labelText) {
        label.setText(labelText);
        this.lastLabelText.set(player.id, labelText);
      }
    }

    const aliveIds = new Set<string>();
    for (const player of this.snapshot.players) {
      if (player.alive) {
        aliveIds.add(player.id);
      }
    }

    for (const [playerId, label] of this.nameLabels) {
      if (!aliveIds.has(playerId)) {
        label.destroy();
        this.nameLabels.delete(playerId);
        this.lastLabelText.delete(playerId);
      } else if (!showNameLabels && playerId !== this.localPlayerId) {
        label.setVisible(false);
      }
    }
  }

  private getLocalPlayer(): PlayerSnapshot | undefined {
    return this.snapshot?.players.find((player) => player.id === this.localPlayerId);
  }

  private updateHud(): void {
    const local = this.getLocalPlayer();
    if (local) {
      hudPlayerElement.textContent = `ID ${local.id.slice(0, 6)} | Punkte: ${local.score}`;
    } else {
      hudPlayerElement.textContent = "Warte auf Spawn…";
    }

    const ranking = [...(this.snapshot?.players ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, this.leaderboardLines)
      .map((player, index) => {
        const rankBadge = index === 0 ? "#1" : index === 1 ? "#2" : index === 2 ? "#3" : `#${index + 1}`;
        const shortName = player.name.slice(0, this.hudCompact ? 8 : 10);
        const role = player.isBot ? "BOT" : "PLY";
        return `${rankBadge} ${shortName} ${role}  ${player.score} P`;
      })
      .join("\n");

    hudScoreboardElement.textContent = ranking || "• Noch keine Punkte";
  }

  private updateStatus(): void {
    if (socket.connected) {
      hudStatusElement.textContent = `Online als ${playerName || "Spieler"}`;
    } else {
      hudStatusElement.textContent = "Warte auf Lobby-Start…";
    }
  }

  shutdown(): void {
    socket.off("connect", this.onConnect);
    socket.off("disconnect", this.onDisconnect);
    socket.off("connect_error", this.onConnectError);
    socket.off("welcome", this.onWelcome);
    socket.off("snapshot", this.onSnapshot);
    socket.off("playerLeft", this.onPlayerLeft);
    for (const label of this.hazardLabels) {
      label.destroy();
    }
    this.hazardLabels = [];
    for (const label of this.nameLabels.values()) {
      label.destroy();
    }
    this.nameLabels.clear();
    this.lastLabelText.clear();
    window.removeEventListener("resize", this.handleWindowResize);
  }
}

// ---------------------------------------------------------------------------
// Phaser game config
// ---------------------------------------------------------------------------
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1280,
  height: 720,
  backgroundColor: "#111827",
  antialias: false,
  powerPreference: "high-performance",
  fps: {
    target: 60,
    min: 30,
  },
  scene: [GameScene],
  parent: document.body,
};

new Phaser.Game(config);
