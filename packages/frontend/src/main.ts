import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type {
  ArenaState,
  ClientToServerEvents,
  DebugPongPayload,
  ForceOrb,
  GameSnapshot,
  HazardZone,
  PickupKind,
  PlayerInputPayload,
  PlayerSnapshot,
  SnapshotDebugInfo,
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

const existingDebugOverlay = document.getElementById("hud-debug");
const debugOverlayElement =
  existingDebugOverlay instanceof HTMLPreElement
    ? existingDebugOverlay
    : document.createElement("pre");
if (!(existingDebugOverlay instanceof HTMLPreElement)) {
  debugOverlayElement.id = "hud-debug";
  debugOverlayElement.style.position = "fixed";
  debugOverlayElement.style.left = "12px";
  debugOverlayElement.style.bottom = "12px";
  debugOverlayElement.style.margin = "0";
  debugOverlayElement.style.padding = "8px 10px";
  debugOverlayElement.style.borderRadius = "8px";
  debugOverlayElement.style.background = "rgba(2, 6, 23, 0.8)";
  debugOverlayElement.style.color = "#dbeafe";
  debugOverlayElement.style.font = "12px/1.4 Consolas, Menlo, monospace";
  debugOverlayElement.style.pointerEvents = "none";
  debugOverlayElement.style.zIndex = "24";
  debugOverlayElement.style.display = "none";
  document.body.appendChild(debugOverlayElement);
}

type QualityMode = "low" | "normal" | "high";

interface QualityProfile {
  inputIntervalMs: number;
  hudIntervalMs: number;
  pickupRedrawIntervalMs: number;
  pickupCameraMoveThreshold: number;
  pickupMargin: number;
  pickupDetail: "low" | "normal" | "high";
  maxNameLabels: number;
  nameLabelDistance: number;
  debugIntervalMs: number;
}

const QUALITY_PROFILES: Record<QualityMode, QualityProfile> = {
  low: {
    inputIntervalMs: 34,
    hudIntervalMs: 125,
    pickupRedrawIntervalMs: 220,
    pickupCameraMoveThreshold: 36,
    pickupMargin: 28,
    pickupDetail: "low",
    maxNameLabels: 8,
    nameLabelDistance: 380,
    debugIntervalMs: 250,
  },
  normal: {
    inputIntervalMs: 33,
    hudIntervalMs: 110,
    pickupRedrawIntervalMs: 150,
    pickupCameraMoveThreshold: 26,
    pickupMargin: 42,
    pickupDetail: "normal",
    maxNameLabels: 14,
    nameLabelDistance: 520,
    debugIntervalMs: 220,
  },
  high: {
    inputIntervalMs: 33,
    hudIntervalMs: 95,
    pickupRedrawIntervalMs: 95,
    pickupCameraMoveThreshold: 20,
    pickupMargin: 56,
    pickupDetail: "high",
    maxNameLabels: 22,
    nameLabelDistance: 700,
    debugIntervalMs: 180,
  },
};

const QUALITY_STORAGE_KEY = "arena-quality-mode";

function loadQualityMode(): QualityMode {
  const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
  if (stored === "low" || stored === "high" || stored === "normal") {
    return stored;
  }
  return "normal";
}

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
  private snapshotPlayers = new Map<string, PlayerSnapshot>();
  private snapshotPickups = new Map<string, ForceOrb>();

  private snapshot: GameSnapshot | null = null;
  private arena: ArenaState | null = null;
  private localPlayerId = "";
  private inputSeq = 0;
  private lastInputSentAt = 0;
  private lastSentInput: { up: boolean; down: boolean; left: boolean; right: boolean } | null = null;
  private pendingInput: { up: boolean; down: boolean; left: boolean; right: boolean } | null = null;
  private hudCompact = false;
  private leaderboardLines = 8;
  private hudDirty = true;
  private lastHudUpdateAt = 0;
  private pickupsDirty = true;
  private lastPickupDrawAt = 0;
  private lastPickupCameraState = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN };
  private qualityMode: QualityMode = loadQualityMode();
  private qualityProfile: QualityProfile = QUALITY_PROFILES[this.qualityMode];
  private debugEnabled = false;
  private lastDebugUpdateAt = 0;
  private latestSnapshotBytes = 0;
  private latestRttMs: number | null = null;
  private lastPingSentAt = 0;
  private latestServerDebug: SnapshotDebugInfo | null = null;

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
  private readonly onDebugPong: (payload: DebugPongPayload) => void;

  constructor() {
    super({ key: "GameScene" });
    this.onConnect = () => {
      this.updateStatus();
      this.hudDirty = true;
    };
    this.onDisconnect = () => {
      this.updateStatus();
      this.hudDirty = true;
    };
    this.onConnectError = () => {
      this.updateStatus();
      this.hudDirty = true;
    };
    this.onWelcome = (payload) => {
      this.localPlayerId = payload.yourId;
      this.arena = payload.arena;
      this.applyIncomingSnapshot(payload.snapshot);
      this.syncRenderPlayersFromSnapshot(true);
      this.lastSentInput = null;
      this.pendingInput = null;
      this.resizeToArena();
      this.updateStatus();
      this.drawArena();
      this.drawHazards();
      this.pickupsDirty = true;
      this.drawPlayers();
      this.hudDirty = true;
      this.maybeRedrawPickups(true);
      this.maybeUpdateHud(true);
      this.maybeUpdateDebugOverlay(true);
    };
    this.onSnapshot = (payload) => {
      this.latestServerDebug = payload.debug ?? this.latestServerDebug;
      if (this.debugEnabled) {
        this.latestSnapshotBytes = JSON.stringify(payload).length;
      }
      this.applyIncomingSnapshot(payload);
      this.syncRenderPlayersFromSnapshot(false);
      this.resizeToArena();
      this.pickupsDirty = true;
      this.hudDirty = true;
    };
    this.onPlayerLeft = () => {
      this.drawPlayers();
      this.hudDirty = true;
    };
    this.onDebugPong = (payload) => {
      this.latestRttMs = Math.max(0, Date.now() - payload.clientSentAt);
    };
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1e293b);
    this.cameras.main.roundPixels = false;
    this.applyQualityProfile();

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
      this.hudDirty = true;
      this.pickupsDirty = true;
      this.maybeUpdateHud(true);
    });
    window.addEventListener("resize", this.handleWindowResize);

    this.updateStatus();
    this.hudDirty = true;
    this.maybeUpdateHud(true);

    const camera = this.cameras.main;
    camera.startFollow(this.cameraTarget, true, 0.12, 0.12);
    camera.setDeadzone(130, 90);

    keyboard.on("keydown-F8", (event: KeyboardEvent) => {
      event.preventDefault();
      this.cycleQualityMode();
    });
    keyboard.on("keydown-F3", (event: KeyboardEvent) => {
      event.preventDefault();
      this.debugEnabled = !this.debugEnabled;
      debugOverlayElement.style.display = this.debugEnabled ? "block" : "none";
      if (!this.debugEnabled) {
        debugOverlayElement.textContent = "";
      }
    });

    socket.on("connect", this.onConnect);
    socket.on("disconnect", this.onDisconnect);
    socket.on("connect_error", this.onConnectError);
    socket.on("welcome", this.onWelcome);
    socket.on("snapshot", this.onSnapshot);
    socket.on("playerLeft", this.onPlayerLeft);
    socket.on("debugPong", this.onDebugPong);
  }

  update(): void {
    const now = this.time.now;

    if (socket.connected && now - this.lastPingSentAt >= 1000) {
      socket.emit("debugPing", { clientSentAt: Date.now() });
      this.lastPingSentAt = now;
    }

    this.maybeUpdateHud();
    this.maybeUpdateDebugOverlay();

    if (!socket.connected) {
      return;
    }

    const player = this.getLocalPlayer();
    if (!player) {
      this.maybeRedrawPickups();
      return;
    }

    const moveInput = this.getMovementInput(player);
    this.scheduleInputSend(moveInput);
    this.flushPendingInput();

    this.updateRenderPlayers();
    this.updateCamera(player);
    this.maybeRedrawPickups();
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

  private inputStatesEqual(
    a: { up: boolean; down: boolean; left: boolean; right: boolean },
    b: { up: boolean; down: boolean; left: boolean; right: boolean },
  ): boolean {
    return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right;
  }

  private scheduleInputSend(input: { up: boolean; down: boolean; left: boolean; right: boolean }): void {
    if (this.lastSentInput && this.inputStatesEqual(input, this.lastSentInput)) {
      this.pendingInput = null;
      return;
    }

    if (!this.pendingInput || !this.inputStatesEqual(input, this.pendingInput)) {
      this.pendingInput = { ...input };
    }
  }

  private flushPendingInput(): void {
    if (!this.pendingInput) {
      return;
    }
    if (this.time.now - this.lastInputSentAt < this.qualityProfile.inputIntervalMs) {
      return;
    }

    const payload: PlayerInputPayload = {
      seq: this.inputSeq++,
      up: this.pendingInput.up,
      down: this.pendingInput.down,
      left: this.pendingInput.left,
      right: this.pendingInput.right,
    };
    socket.emit("input", payload);
    this.lastInputSentAt = this.time.now;
    this.lastSentInput = this.pendingInput;
    this.pendingInput = null;
  }

  private applyQualityProfile(): void {
    this.qualityProfile = QUALITY_PROFILES[this.qualityMode];
    this.hudDirty = true;
    this.pickupsDirty = true;
    this.updateStatus();
  }

  private cycleQualityMode(): void {
    this.qualityMode =
      this.qualityMode === "low"
        ? "normal"
        : this.qualityMode === "normal"
          ? "high"
          : "low";
    window.localStorage.setItem(QUALITY_STORAGE_KEY, this.qualityMode);
    this.applyQualityProfile();
    this.maybeRedrawPickups(true);
    this.maybeUpdateHud(true);
    this.maybeUpdateDebugOverlay(true);
  }

  private maybeUpdateHud(force = false): void {
    if (!this.hudDirty && !force) {
      return;
    }

    const now = this.time.now;
    if (!force && now - this.lastHudUpdateAt < this.qualityProfile.hudIntervalMs) {
      return;
    }

    this.updateHud();
    this.lastHudUpdateAt = now;
    this.hudDirty = false;
  }

  private maybeRedrawPickups(force = false): void {
    if (!this.snapshot) {
      return;
    }

    const camera = this.cameras.main;
    const cameraMoved =
      !Number.isFinite(this.lastPickupCameraState.x) ||
      Math.abs(camera.scrollX - this.lastPickupCameraState.x) >= this.qualityProfile.pickupCameraMoveThreshold ||
      Math.abs(camera.scrollY - this.lastPickupCameraState.y) >= this.qualityProfile.pickupCameraMoveThreshold ||
      Math.abs(camera.zoom - this.lastPickupCameraState.zoom) >= 0.02;

    const now = this.time.now;
    const due = now - this.lastPickupDrawAt >= this.qualityProfile.pickupRedrawIntervalMs;
    if (!force && (!due || (!this.pickupsDirty && !cameraMoved))) {
      return;
    }

    this.drawPickups();
    this.lastPickupDrawAt = now;
    this.pickupsDirty = false;
    this.lastPickupCameraState.x = camera.scrollX;
    this.lastPickupCameraState.y = camera.scrollY;
    this.lastPickupCameraState.zoom = camera.zoom;
  }

  private maybeUpdateDebugOverlay(force = false): void {
    if (!this.debugEnabled) {
      return;
    }

    const now = this.time.now;
    if (!force && now - this.lastDebugUpdateAt < this.qualityProfile.debugIntervalMs) {
      return;
    }

    const fps = this.game.loop.actualFps;
    const frameMs = this.game.loop.delta;
    const rttText = this.latestRttMs == null ? "-" : `${Math.round(this.latestRttMs)} ms`;
    const snapshotKb = (this.latestSnapshotBytes / 1024).toFixed(1);
    const serverTick = this.latestServerDebug?.serverTickMs ?? 0;
    const snapshotRate = this.latestServerDebug?.snapshotRate ?? 0;
    const leaderboardRate = this.latestServerDebug?.leaderboardRate ?? 0;
    const combat = this.latestServerDebug?.combatActive ? "yes" : "no";
    const orbInfo = this.latestServerDebug
      ? `${this.latestServerDebug.orbCount}/${this.latestServerDebug.orbCap}`
      : "-";

    debugOverlayElement.textContent = [
      `Q:${this.qualityMode.toUpperCase()}  FPS:${fps.toFixed(1)}  Frame:${frameMs.toFixed(1)}ms`,
      `RTT:${rttText}  Snapshot:${snapshotKb} KB`,
      `SrvTick:${serverTick}ms  SnapRate:${snapshotRate}  LB:${leaderboardRate}`,
      `Combat:${combat}  Orbs:${orbInfo}`,
      "F8: Quality  F3: Debug",
    ].join("\n");

    this.lastDebugUpdateAt = now;
  }

  private updateCamera(localPlayer: PlayerSnapshot): void {
    const camera = this.cameras.main;
    const render = this.renderPlayers.get(localPlayer.id);
    const px = render?.x ?? localPlayer.x;
    const py = render?.y ?? localPlayer.y;
    this.cameraTarget.setPosition(px, py);

    const massZoom = clamp(1.08 * Math.pow(24 / Math.max(12, localPlayer.mass), 0.2), 0.58, 1.24);
    const viewportFactor = clamp(Math.min(this.scale.width, this.scale.height) / 920, 0.8, 1.32);
    const desiredZoom = clamp(massZoom * viewportFactor, 0.6, 1.28);
    camera.setZoom(Phaser.Math.Linear(camera.zoom, desiredZoom, 0.075));
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

  private applyIncomingSnapshot(payload: GameSnapshot): void {
    if (payload.full || !this.snapshot) {
      this.snapshotPlayers.clear();
      this.snapshotPickups.clear();
      for (const player of payload.players) {
        this.snapshotPlayers.set(player.id, player);
      }
      for (const pickup of payload.pickups) {
        this.snapshotPickups.set(pickup.id, pickup);
      }
    } else {
      for (const removedPlayerId of payload.removedPlayerIds ?? []) {
        this.snapshotPlayers.delete(removedPlayerId);
      }
      for (const removedPickupId of payload.removedPickupIds ?? []) {
        this.snapshotPickups.delete(removedPickupId);
      }
      for (const player of payload.players) {
        this.snapshotPlayers.set(player.id, player);
      }
      for (const pickup of payload.pickups) {
        this.snapshotPickups.set(pickup.id, pickup);
      }
    }

    this.snapshot = {
      tick: payload.tick,
      serverTime: payload.serverTime,
      players: Array.from(this.snapshotPlayers.values()),
      pickups: Array.from(this.snapshotPickups.values()),
      leaderboard: payload.leaderboard ?? this.snapshot?.leaderboard,
      debug: payload.debug ?? this.snapshot?.debug,
    };
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

      const blend = clamp(0.24 + dt * 6.2, 0.24, 0.5);
      state.x = Phaser.Math.Linear(state.x, player.x, blend);
      state.y = Phaser.Math.Linear(state.y, player.y, blend);
      state.vx = Phaser.Math.Linear(state.vx, player.vx, 0.42);
      state.vy = Phaser.Math.Linear(state.vy, player.vy, 0.42);

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
    this.arenaGraphics.fillStyle(0x172236, 1);
    this.arenaGraphics.fillRect(0, 0, this.arena.width, this.arena.height);
    this.arenaGraphics.fillStyle(0x22344d, 0.96);
    this.arenaGraphics.fillRoundedRect(10, 10, this.arena.width - 20, this.arena.height - 20, 24);

    // Panel-Tiles geben Struktur, ohne vom Gameplay abzulenken.
    const drawFullDecor = this.scale.width >= 1100 && this.scale.height >= 700;
    const tileSize = drawFullDecor ? 72 : 120;
    for (let y = 24; y < this.arena.height - 24; y += tileSize) {
      for (let x = 24; x < this.arena.width - 24; x += tileSize) {
        const isAlt = ((x / tileSize) + (y / tileSize)) % 2 === 0;
        this.decorGraphics.fillStyle(isAlt ? 0x2a4362 : 0x314d70, drawFullDecor ? 0.48 : 0.32);
        this.decorGraphics.fillRoundedRect(x, y, tileSize - 10, tileSize - 10, 8);
      }
    }

    if (drawFullDecor) {
      this.decorGraphics.lineStyle(1, 0x6f8aa8, 0.3);
      for (let x = 24; x < this.arena.width - 20; x += tileSize) {
        this.decorGraphics.lineBetween(x, 20, x, this.arena.height - 20);
      }
      for (let y = 24; y < this.arena.height - 20; y += tileSize) {
        this.decorGraphics.lineBetween(20, y, this.arena.width - 20, y);
      }
    }

    if (drawFullDecor) {
      this.decorGraphics.lineStyle(2, 0x22d3ee, 0.32);
      this.decorGraphics.strokeCircle(this.arena.width / 2, this.arena.height / 2, 120);
      this.decorGraphics.lineStyle(1, 0x38bdf8, 0.26);
      this.decorGraphics.strokeCircle(this.arena.width / 2, this.arena.height / 2, 190);
    }

    this.arenaGraphics.lineStyle(3, 0x5aa8d8, 0.52);
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
    const margin = this.qualityProfile.pickupMargin;
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
    const styleByKind: Record<PickupKind, { core: number; ring: number; alpha: number }> = {
      mass: { core: 0xfde047, ring: 0x84cc16, alpha: 0.9 },
      speed: { core: 0x22d3ee, ring: 0x0369a1, alpha: 0.88 },
      shield: { core: 0x60a5fa, ring: 0x1d4ed8, alpha: 0.88 },
      stealth: { core: 0xc4b5fd, ring: 0x7c3aed, alpha: 0.86 },
    };

    const style = styleByKind[orb.kind] ?? styleByKind.mass;
    const detail = this.qualityProfile.pickupDetail;

    if (detail === "low") {
      this.pickupGraphics.fillStyle(style.core, style.alpha * 0.9);
      this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 0.3);
      return;
    }

    this.pickupGraphics.fillStyle(style.core, style.alpha);
    this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 0.7);
    this.pickupGraphics.lineStyle(1, style.ring, 0.62);
    this.pickupGraphics.strokeCircle(orb.x, orb.y, orb.radius + 3.2);

    if (detail === "high") {
      this.pickupGraphics.lineStyle(1, 0xffffff, 0.22);
      this.pickupGraphics.strokeCircle(orb.x, orb.y, orb.radius + 1.4);
    }
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
      this.hazardGraphics.fillStyle(0xfca5a5, 0.58);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0xf97316, 0.62);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 4,
        hazard.y + 5,
        hazard.width - 8,
        hazard.height - 10,
        8
      );
      this.hazardGraphics.lineStyle(3, 0xdc2626, 0.74);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      return;
    }

    if (hazard.type === "electric") {
      this.hazardGraphics.fillStyle(0xfde68a, 0.54);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0xfacc15, 0.62);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 3,
        hazard.y + 3,
        hazard.width - 6,
        hazard.height - 6,
        9
      );
      this.hazardGraphics.lineStyle(3, 0xd97706, 0.76);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      return;
    }

    this.hazardGraphics.fillStyle(0x1e293b, 0.76);
    this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
    this.hazardGraphics.fillStyle(0x334155, 0.8);
    this.hazardGraphics.fillRoundedRect(
      hazard.x + 6,
      hazard.y + 6,
      hazard.width - 12,
      hazard.height - 12,
      8
    );
    this.hazardGraphics.lineStyle(3, 0x0f172a, 0.72);
    this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);

    const centerX = hazard.x + hazard.width / 2;
    const centerY = hazard.y + hazard.height / 2;
    this.hazardGraphics.fillStyle(0x0b1322, 0.88);
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
        color: "#0f172a",
        fontStyle: "bold",
        backgroundColor: "#f8fafccc",
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

    const showNameLabels = visiblePlayers.length <= this.qualityProfile.maxNameLabels + 6;
    const localRender = this.localPlayerId ? this.renderPlayers.get(this.localPlayerId) : undefined;
    const localPlayer = this.getLocalPlayer();
    const localX = localRender?.x ?? localPlayer?.x ?? 0;
    const localY = localRender?.y ?? localPlayer?.y ?? 0;
    const nameDistanceSq = this.qualityProfile.nameLabelDistance * this.qualityProfile.nameLabelDistance;
    let shownLabels = 0;
    const drawnIds = new Set<string>();

    for (const player of visiblePlayers) {
      const hasSpawnProtection = player.spawnProtectionMsLeft > 0;
      const protectionPulse = hasSpawnProtection
        ? 0.72 + 0.2 * (0.5 + 0.5 * Math.sin(this.time.now / 130))
        : 1;
      this.playerGraphics.fillStyle(player.color, protectionPulse);
      const render = this.renderPlayers.get(player.id);
      const px = render?.x ?? player.x;
      const py = render?.y ?? player.y;

      // Agar.io-aehnlicher Look: ein einzelner Kreis, der mit der Masse waechst.
      this.playerGraphics.fillCircle(px, py, player.radius);

      let label = this.nameLabels.get(player.id);
      if (!label) {
        label = this.add
          .text(px, py - 42, "", {
            fontFamily: "Segoe UI, Tahoma, sans-serif",
            fontSize: "12px",
            fontStyle: "normal",
            color: "#f8fafc",
            backgroundColor: "#0f172ab3",
            padding: { left: 6, right: 6, top: 2, bottom: 2 },
          })
          .setOrigin(0.5)
          .setDepth(5);
        label.setResolution(Math.min(2, window.devicePixelRatio || 1));
        this.nameLabels.set(player.id, label);
      }

      const labelOffsetY = Math.max(20, player.radius + 13);
      label.setPosition(px, py - labelOffsetY);
      const dxToLocal = px - localX;
      const dyToLocal = py - localY;
      const withinDistance = dxToLocal * dxToLocal + dyToLocal * dyToLocal <= nameDistanceSq;
      const canShowLabel =
        player.id === this.localPlayerId ||
        (showNameLabels && withinDistance && shownLabels < this.qualityProfile.maxNameLabels);
      label.setVisible(canShowLabel);
      if (canShowLabel && player.id !== this.localPlayerId) {
        shownLabels += 1;
      }
      const botMarker = player.isBot ? " [BOT]" : "";
      const shieldMarker = hasSpawnProtection ? " [SAFE]" : "";
      const invulnMarker = player.invulnerableMsLeft > 0 ? " [INV]" : "";
      const stealthMarker = player.stealthMsLeft > 0 ? " [STL]" : "";
      const labelText = `${player.name}${botMarker}${shieldMarker}${invulnMarker}${stealthMarker}`;
      if (this.lastLabelText.get(player.id) !== labelText) {
        label.setText(labelText);
        this.lastLabelText.set(player.id, labelText);
      }
      drawnIds.add(player.id);
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
      } else if (!drawnIds.has(playerId)) {
        label.setVisible(false);
      } else if (!showNameLabels && playerId !== this.localPlayerId) {
        label.setVisible(false);
      }
    }
  }

  private getLocalPlayer(): PlayerSnapshot | undefined {
    return this.snapshot?.players.find((player) => player.id === this.localPlayerId);
  }

  private formatEffectLabel(prefix: string, msLeft: number): string | null {
    if (msLeft <= 0) {
      return null;
    }
    return `${prefix} ${(msLeft / 1000).toFixed(1)}s`;
  }

  private updateHud(): void {
    const local = this.getLocalPlayer();
    if (local) {
      const protectionText =
        local.spawnProtectionMsLeft > 0
          ? ` | Schutz: ${(local.spawnProtectionMsLeft / 1000).toFixed(1)}s`
          : "";
      const effects = [
        this.formatEffectLabel("Speed", local.speedBoostMsLeft),
        this.formatEffectLabel("Unverwundbar", local.invulnerableMsLeft),
        this.formatEffectLabel("Unsichtbar", local.stealthMsLeft),
      ].filter((entry): entry is string => Boolean(entry));
      const effectText = effects.length > 0 ? ` | Effekte: ${effects.join(" • ")}` : "";
      hudPlayerElement.textContent = `ID ${local.id.slice(0, 6)} | Punkte: ${local.score}${protectionText}${effectText}`;
    } else {
      hudPlayerElement.textContent = "Warte auf Spawn…";
    }

    const rankingSource =
      this.snapshot?.leaderboard && this.snapshot.leaderboard.length > 0
        ? this.snapshot.leaderboard
        : [...(this.snapshot?.players ?? [])].sort((a, b) => b.score - a.score);

    const ranking = rankingSource
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
    const qualityText = `Qualitaet: ${this.qualityMode.toUpperCase()} (F8)`;
    if (socket.connected) {
      hudStatusElement.textContent = `Online als ${playerName || "Spieler"} | ${qualityText}`;
    } else {
      hudStatusElement.textContent = `Warte auf Lobby-Start… | ${qualityText}`;
    }
  }

  shutdown(): void {
    socket.off("connect", this.onConnect);
    socket.off("disconnect", this.onDisconnect);
    socket.off("connect_error", this.onConnectError);
    socket.off("welcome", this.onWelcome);
    socket.off("snapshot", this.onSnapshot);
    socket.off("playerLeft", this.onPlayerLeft);
    socket.off("debugPong", this.onDebugPong);
    for (const label of this.hazardLabels) {
      label.destroy();
    }
    this.hazardLabels = [];
    for (const label of this.nameLabels.values()) {
      label.destroy();
    }
    this.nameLabels.clear();
    this.lastLabelText.clear();
    this.debugEnabled = false;
    debugOverlayElement.style.display = "none";
    debugOverlayElement.textContent = "";
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
  backgroundColor: "#1e293b",
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
