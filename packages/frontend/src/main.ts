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

const existingAnnouncementOverlay = document.getElementById("hud-announcement");
const announcementOverlayElement =
  existingAnnouncementOverlay instanceof HTMLDivElement
    ? existingAnnouncementOverlay
    : document.createElement("div");
if (!(existingAnnouncementOverlay instanceof HTMLDivElement)) {
  announcementOverlayElement.id = "hud-announcement";
  announcementOverlayElement.style.position = "fixed";
  announcementOverlayElement.style.left = "50%";
  announcementOverlayElement.style.top = "12px";
  announcementOverlayElement.style.transform = "translate(-50%, -8px)";
  announcementOverlayElement.style.maxWidth = "min(92vw, 560px)";
  announcementOverlayElement.style.padding = "10px 14px";
  announcementOverlayElement.style.borderRadius = "12px";
  announcementOverlayElement.style.border = "1px solid rgba(56, 189, 248, 0.62)";
  announcementOverlayElement.style.background = "rgba(8, 24, 40, 0.9)";
  announcementOverlayElement.style.color = "#f8fafc";
  announcementOverlayElement.style.font = "700 13px/1.4 'Trebuchet MS', 'Segoe UI', sans-serif";
  announcementOverlayElement.style.letterSpacing = "0.01em";
  announcementOverlayElement.style.textAlign = "center";
  announcementOverlayElement.style.whiteSpace = "pre-line";
  announcementOverlayElement.style.pointerEvents = "none";
  announcementOverlayElement.style.zIndex = "26";
  announcementOverlayElement.style.boxShadow = "0 10px 24px rgba(2, 10, 22, 0.42)";
  announcementOverlayElement.style.transition = "opacity 180ms ease, transform 180ms ease";
  announcementOverlayElement.style.display = "none";
  announcementOverlayElement.style.opacity = "0";
  document.body.appendChild(announcementOverlayElement);
}

type QualityMode = "low" | "normal" | "high";

interface QualityProfile {
  inputIntervalMs: number;
  hudIntervalMs: number;
  pickupRedrawIntervalMs: number;
  pickupMargin: number;
  pickupDetail: "low" | "normal" | "high";
  maxNameLabels: number;
  nameLabelDistance: number;
  debugIntervalMs: number;
}

const QUALITY_PROFILES: Record<QualityMode, QualityProfile> = {
  low: {
    inputIntervalMs: 16,
    hudIntervalMs: 120,
    pickupRedrawIntervalMs: 80,
    pickupMargin: 18,
    pickupDetail: "low",
    maxNameLabels: 3,
    nameLabelDistance: 260,
    debugIntervalMs: 250,
  },
  normal: {
    inputIntervalMs: 12,
    hudIntervalMs: 90,
    pickupRedrawIntervalMs: 45,
    pickupMargin: 28,
    pickupDetail: "normal",
    maxNameLabels: 12,
    nameLabelDistance: 520,
    debugIntervalMs: 220,
  },
  high: {
    inputIntervalMs: 8,
    hudIntervalMs: 95,
    pickupRedrawIntervalMs: 25,
    pickupMargin: 56,
    pickupDetail: "high",
    maxNameLabels: 22,
    nameLabelDistance: 700,
    debugIntervalMs: 180,
  },
};

const QUALITY_STORAGE_KEY = "arena-quality-mode";
const STATIC_CAMERA_ZOOM = 0.86;
const SEMI_STATIC_CAMERA_LERP = 0.035;
const SEMI_STATIC_DEADZONE_X_RATIO = 0.42;
const SEMI_STATIC_DEADZONE_Y_RATIO = 0.36;
const ANNOUNCEMENT_HOLD_MS = 4200;
const ANNOUNCEMENT_FADE_MS = 260;
const ROCKET_TRAIL_MS = 360;

type StyledPickupKind = "speed" | "shield" | "stealth" | "score";

const STYLED_PICKUP_ICON_KEYS: Record<StyledPickupKind, string> = {
  speed: "speed-pickup-icon",
  shield: "shield-pickup-icon",
  stealth: "stealth-pickup-icon",
  score: "score-pickup-icon",
};

const STYLED_PICKUP_PHASE_OFFSETS: Record<StyledPickupKind, number> = {
  speed: 0,
  shield: 1.1,
  stealth: 2.2,
  score: 3.1,
};

function isStyledPickupKind(kind: PickupKind): kind is StyledPickupKind {
  return kind === "speed" || kind === "shield" || kind === "stealth" || kind === "score";
}

function loadQualityMode(): QualityMode {
  const stored = window.localStorage.getItem(QUALITY_STORAGE_KEY);
  if (stored === "low") {
    return "normal";
  }
  if (stored === "normal" || stored === "high") {
    return "high";
  }
  return "high";
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
  private rocketTrailGraphics!: Phaser.GameObjects.Graphics;
  private rocketPickupSprites = new Map<string, Phaser.GameObjects.Image>();
  private styledPickupSprites = new Map<string, Phaser.GameObjects.Image>();
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private hazardLabels: Phaser.GameObjects.Text[] = [];
  private renderPlayers = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  private lastLabelText = new Map<string, string>();
  private snapshotPlayers = new Map<string, PlayerSnapshot>();
  private snapshotPickups = new Map<string, ForceOrb>();
  private rocketTrails: Array<{
    id: number;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    startedAt: number;
    expiresAt: number;
  }> = [];
  private rocketTrailCounter = 1;

  private snapshot: GameSnapshot | null = null;
  private arena: ArenaState | null = null;
  private localPlayerId = "";
  private inputSeq = 0;
  private lastInputSentAt = 0;
  private lastSentInput: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    ability: boolean;
    rocketFire: boolean;
  } | null = null;
  private pendingInput: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    ability: boolean;
    rocketFire: boolean;
  } | null = null;
  private hudCompact = false;
  private leaderboardLines = 8;
  private hudDirty = true;
  private lastHudUpdateAt = 0;
  private pickupsDirty = true;
  private lastPickupDrawAt = 0;
  private cameraCenter = { x: Number.NaN, y: Number.NaN };
  private qualityMode: QualityMode = loadQualityMode();
  private qualityProfile: QualityProfile = QUALITY_PROFILES[this.qualityMode];
  private debugEnabled = false;
  private lastDebugUpdateAt = 0;
  private latestSnapshotBytes = 0;
  private latestRttMs: number | null = null;
  private lastPingSentAt = 0;
  private latestServerDebug: SnapshotDebugInfo | null = null;
  private announcementQueue: Array<{
    title: string;
    detail: string;
    tone: "event" | "bounty";
  }> = [];
  private announcementActive = false;
  private announcementHoldTimerId: number | null = null;
  private announcementFadeTimerId: number | null = null;

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
    ability: Phaser.Input.Keyboard.Key;
    rocket: Phaser.Input.Keyboard.Key;
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
      this.clearAnnouncementQueue();
      this.clearRocketPickupSprites();
      this.clearStyledPickupSprites();
    };
    this.onConnectError = () => {
      this.updateStatus();
      this.hudDirty = true;
    };
    this.onWelcome = (payload) => {
      this.localPlayerId = payload.yourId;
      this.arena = payload.arena;
      this.clearAnnouncementQueue();
      this.clearRocketPickupSprites();
      this.clearStyledPickupSprites();
      this.rocketTrails = [];
      this.rocketTrailCounter = 1;
      if (this.rocketTrailGraphics) {
        this.rocketTrailGraphics.clear();
      }
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
      const previousSnapshot = this.snapshot;
      this.latestServerDebug = payload.debug ?? this.latestServerDebug;
      if (this.debugEnabled) {
        this.latestSnapshotBytes = this.estimateSnapshotBytes(payload);
      }
      this.applyIncomingSnapshot(payload);
      this.detectSnapshotAnnouncements(previousSnapshot);
      this.detectRocketShotVisuals(previousSnapshot);
      this.syncRenderPlayersFromSnapshot(false);
      this.resizeToArena();
      const pickupChanged =
        payload.full === true ||
        (payload.pickups?.length ?? 0) > 0 ||
        (payload.removedPickupIds?.length ?? 0) > 0;
      if (pickupChanged) {
        this.pickupsDirty = true;
      }
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

  preload(): void {
    this.load.image("rocket-pickup-icon", "/rocket-pickup.svg");
    this.load.image("speed-pickup-icon", "/speed-pickup.svg");
    this.load.image("shield-pickup-icon", "/shield-pickup.svg");
    this.load.image("stealth-pickup-icon", "/stealth-pickup.svg");
    this.load.image("score-pickup-icon", "/score-pickup.svg");
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
    this.rocketTrailGraphics = this.add.graphics();
    this.rocketTrailGraphics.setDepth(4);
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
      ability: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE, false),
      rocket: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R, false),
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
    camera.stopFollow();
    camera.setZoom(STATIC_CAMERA_ZOOM);
    this.cameraCenter.x = camera.midPoint.x;
    this.cameraCenter.y = camera.midPoint.y;

    keyboard.on("keydown-F8", (event: KeyboardEvent) => {
      event.preventDefault();
      this.cycleQualityMode();
    });
    keyboard.on("keydown-SPACE", (event: KeyboardEvent) => {
      event.preventDefault();
    });
    keyboard.on("keydown-R", (event: KeyboardEvent) => {
      event.preventDefault();
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
    this.scheduleInputSend({
      ...moveInput,
      ability: this.keys.ability.isDown,
      rocketFire: this.keys.rocket.isDown,
    });
    this.flushPendingInput();

    this.updateRenderPlayers();
    this.updateCamera();
    this.maybeRedrawPickups();
    this.drawRocketTrails(now);
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
    const deadzone = Math.max(8, player.radius * 0.45);

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
      up: ny < -0.16,
      down: ny > 0.16,
      left: nx < -0.16,
      right: nx > 0.16,
    };
  }

  private estimateSnapshotBytes(payload: GameSnapshot): number {
    const playersBytes = payload.players.length * 68;
    const pickupsBytes = payload.pickups.length * 32;
    const removedBytes =
      (payload.removedPlayerIds?.length ?? 0) * 12 +
      (payload.removedPickupIds?.length ?? 0) * 12;
    const leaderboardBytes = (payload.leaderboard?.length ?? 0) * 24;
    return 96 + playersBytes + pickupsBytes + removedBytes + leaderboardBytes;
  }

  private inputStatesEqual(
    a: {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      ability: boolean;
      rocketFire: boolean;
    },
    b: {
      up: boolean;
      down: boolean;
      left: boolean;
      right: boolean;
      ability: boolean;
      rocketFire: boolean;
    },
  ): boolean {
    return (
      a.up === b.up &&
      a.down === b.down &&
      a.left === b.left &&
      a.right === b.right &&
      a.ability === b.ability &&
      a.rocketFire === b.rocketFire
    );
  }

  private scheduleInputSend(input: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    ability: boolean;
    rocketFire: boolean;
  }): void {
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
      ability: this.pendingInput.ability,
      rocketFire: this.pendingInput.rocketFire,
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

    const now = this.time.now;
    const due = now - this.lastPickupDrawAt >= this.qualityProfile.pickupRedrawIntervalMs;
    if (!force && !this.pickupsDirty && !due) {
      return;
    }

    this.drawPickups();
    this.lastPickupDrawAt = now;
    this.pickupsDirty = false;
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

  private enqueueAnnouncement(title: string, detail: string, tone: "event" | "bounty"): void {
    this.announcementQueue.push({ title, detail, tone });
    this.processAnnouncementQueue();
  }

  private processAnnouncementQueue(): void {
    if (this.announcementActive) {
      return;
    }

    const next = this.announcementQueue.shift();
    if (!next) {
      return;
    }

    this.announcementActive = true;
    const isEvent = next.tone === "event";
    announcementOverlayElement.style.borderColor = isEvent
      ? "rgba(56, 189, 248, 0.72)"
      : "rgba(245, 158, 11, 0.8)";
    announcementOverlayElement.style.background = isEvent
      ? "rgba(8, 24, 40, 0.9)"
      : "rgba(44, 25, 6, 0.9)";
    announcementOverlayElement.style.color = isEvent ? "#dbeafe" : "#fef3c7";
    announcementOverlayElement.textContent = next.detail.length > 0
      ? `${next.title}\n${next.detail}`
      : next.title;
    announcementOverlayElement.style.display = "block";

    requestAnimationFrame(() => {
      announcementOverlayElement.style.opacity = "1";
      announcementOverlayElement.style.transform = "translate(-50%, 0)";
    });

    this.announcementHoldTimerId = window.setTimeout(() => {
      this.announcementHoldTimerId = null;
      announcementOverlayElement.style.opacity = "0";
      announcementOverlayElement.style.transform = "translate(-50%, -8px)";
      this.announcementFadeTimerId = window.setTimeout(() => {
        this.announcementFadeTimerId = null;
        announcementOverlayElement.style.display = "none";
        this.announcementActive = false;
        this.processAnnouncementQueue();
      }, ANNOUNCEMENT_FADE_MS);
    }, ANNOUNCEMENT_HOLD_MS);
  }

  private clearAnnouncementQueue(): void {
    this.announcementQueue = [];
    this.announcementActive = false;
    if (this.announcementHoldTimerId != null) {
      window.clearTimeout(this.announcementHoldTimerId);
      this.announcementHoldTimerId = null;
    }
    if (this.announcementFadeTimerId != null) {
      window.clearTimeout(this.announcementFadeTimerId);
      this.announcementFadeTimerId = null;
    }
    announcementOverlayElement.style.display = "none";
    announcementOverlayElement.style.opacity = "0";
    announcementOverlayElement.style.transform = "translate(-50%, -8px)";
  }

  private detectSnapshotAnnouncements(previousSnapshot: GameSnapshot | null): void {
    const nextSnapshot = this.snapshot;
    if (!previousSnapshot || !nextSnapshot) {
      return;
    }

    const previousEventKind = previousSnapshot.activeEvent?.kind ?? "none";
    const nextEvent = nextSnapshot.activeEvent;
    const nextEventKind = nextEvent?.kind ?? "none";
    if (previousEventKind !== nextEventKind && nextEvent && nextEvent.kind !== "none") {
      this.enqueueAnnouncement(`Event gestartet: ${nextEvent.title}`, nextEvent.description, "event");
    }

    const previousBountyTargetId = previousSnapshot.bountyTargetId ?? null;
    const nextBountyTargetId = nextSnapshot.bountyTargetId ?? null;
    const previousSpecialBounty = Boolean(previousSnapshot.specialBountyActive);
    const nextSpecialBounty = Boolean(nextSnapshot.specialBountyActive);
    if (previousBountyTargetId !== nextBountyTargetId) {
      if (nextBountyTargetId) {
        const targetName =
          nextSnapshot.players.find((player) => player.id === nextBountyTargetId)?.name ?? "Unbekannt";
        const bonus = Math.max(0, Math.round(nextSnapshot.bountyBonus ?? 0));
        const title = nextSpecialBounty ? "SPEZIAL-Kopfgeld" : "Neues Kopfgeld";
        const detail = nextSpecialBounty
          ? `${targetName} | Spezialbonus +${bonus} P (80% vom groessten Spieler)`
          : `${targetName} | Bonus +${bonus} P`;
        this.enqueueAnnouncement(title, detail, "bounty");
      } else if (previousBountyTargetId) {
        this.enqueueAnnouncement("Kopfgeld pausiert", "Zu wenig aktive Spieler.", "bounty");
      }
    }

    if (!previousSpecialBounty && nextSpecialBounty && previousBountyTargetId === nextBountyTargetId && nextBountyTargetId) {
      const targetName =
        nextSnapshot.players.find((player) => player.id === nextBountyTargetId)?.name ?? "Unbekannt";
      const bonus = Math.max(0, Math.round(nextSnapshot.bountyBonus ?? 0));
      this.enqueueAnnouncement(
        "SPEZIAL-Kopfgeld aktiv",
        `${targetName} | +${bonus} P (80% vom groessten Spieler)`,
        "bounty",
      );
    }
  }

  private clampCameraCenterToArena(centerX: number, centerY: number): { x: number; y: number } {
    if (!this.arena) {
      return { x: centerX, y: centerY };
    }

    const camera = this.cameras.main;
    const halfW = camera.width / (2 * Math.max(0.0001, camera.zoom));
    const halfH = camera.height / (2 * Math.max(0.0001, camera.zoom));

    const minX = halfW;
    const maxX = this.arena.width - halfW;
    const minY = halfH;
    const maxY = this.arena.height - halfH;

    const safeX = minX > maxX ? this.arena.width / 2 : clamp(centerX, minX, maxX);
    const safeY = minY > maxY ? this.arena.height / 2 : clamp(centerY, minY, maxY);
    return { x: safeX, y: safeY };
  }

  private updateCamera(): void {
    if (!this.arena) {
      return;
    }

    const camera = this.cameras.main;
    camera.stopFollow();
    camera.setZoom(STATIC_CAMERA_ZOOM);

    if (!Number.isFinite(this.cameraCenter.x) || !Number.isFinite(this.cameraCenter.y)) {
      this.cameraCenter.x = this.arena.width / 2;
      this.cameraCenter.y = this.arena.height / 2;
    }

    let targetX = this.cameraCenter.x;
    let targetY = this.cameraCenter.y;

    const localPlayer = this.getLocalPlayer();
    if (localPlayer) {
      const render = this.renderPlayers.get(localPlayer.id);
      const px = render?.x ?? localPlayer.x;
      const py = render?.y ?? localPlayer.y;

      const halfW = camera.width / (2 * Math.max(0.0001, camera.zoom));
      const halfH = camera.height / (2 * Math.max(0.0001, camera.zoom));
      const deadzoneX = halfW * SEMI_STATIC_DEADZONE_X_RATIO;
      const deadzoneY = halfH * SEMI_STATIC_DEADZONE_Y_RATIO;

      if (px < targetX - deadzoneX) {
        targetX = px + deadzoneX;
      } else if (px > targetX + deadzoneX) {
        targetX = px - deadzoneX;
      }

      if (py < targetY - deadzoneY) {
        targetY = py + deadzoneY;
      } else if (py > targetY + deadzoneY) {
        targetY = py - deadzoneY;
      }
    }

    const clampedTarget = this.clampCameraCenterToArena(targetX, targetY);
    this.cameraCenter.x = Phaser.Math.Linear(this.cameraCenter.x, clampedTarget.x, SEMI_STATIC_CAMERA_LERP);
    this.cameraCenter.y = Phaser.Math.Linear(this.cameraCenter.y, clampedTarget.y, SEMI_STATIC_CAMERA_LERP);

    const clampedCenter = this.clampCameraCenterToArena(this.cameraCenter.x, this.cameraCenter.y);
    this.cameraCenter.x = clampedCenter.x;
    this.cameraCenter.y = clampedCenter.y;
    camera.centerOn(this.cameraCenter.x, this.cameraCenter.y);
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
      bountyTargetId:
        payload.bountyTargetId !== undefined
          ? payload.bountyTargetId
          : this.snapshot?.bountyTargetId,
      bountyBonus: payload.bountyBonus ?? this.snapshot?.bountyBonus,
      specialBountyActive:
        payload.specialBountyActive !== undefined
          ? payload.specialBountyActive
          : this.snapshot?.specialBountyActive,
      activeEvent: payload.activeEvent ?? this.snapshot?.activeEvent,
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

      const blend = clamp(0.16 + dt * 4.5, 0.16, 0.34);
      state.x = Phaser.Math.Linear(state.x, player.x, blend);
      state.y = Phaser.Math.Linear(state.y, player.y, blend);
      state.vx = Phaser.Math.Linear(state.vx, player.vx, 0.28);
      state.vy = Phaser.Math.Linear(state.vy, player.vy, 0.28);

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
    camera.stopFollow();
    camera.setZoom(STATIC_CAMERA_ZOOM);
    if (!Number.isFinite(this.cameraCenter.x) || !Number.isFinite(this.cameraCenter.y)) {
      this.cameraCenter.x = arenaWidth / 2;
      this.cameraCenter.y = arenaHeight / 2;
    }
    const clampedCenter = this.clampCameraCenterToArena(this.cameraCenter.x, this.cameraCenter.y);
    this.cameraCenter.x = clampedCenter.x;
    this.cameraCenter.y = clampedCenter.y;
    camera.centerOn(this.cameraCenter.x, this.cameraCenter.y);
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

    // Leichtgewichtiges Arena-Rendering fuer schwache Hardware.
    this.decorGraphics.clear();
    this.arenaGraphics.clear();
    this.hazardGraphics.clear();
    this.pickupGraphics.clear();
    this.arenaGraphics.fillStyle(0x172236, 1);
    this.arenaGraphics.fillRect(0, 0, this.arena.width, this.arena.height);
    this.arenaGraphics.fillStyle(0x22344d, 0.94);
    this.arenaGraphics.fillRoundedRect(10, 10, this.arena.width - 20, this.arena.height - 20, 24);

    const minimalDecor = this.qualityMode === "low" || this.qualityMode === "normal";
    if (!minimalDecor) {
      this.decorGraphics.lineStyle(1, 0x456383, 0.22);
      const step = 260;
      for (let x = 40; x < this.arena.width - 20; x += step) {
        this.decorGraphics.lineBetween(x, 20, x, this.arena.height - 20);
      }
      for (let y = 40; y < this.arena.height - 20; y += step) {
        this.decorGraphics.lineBetween(20, y, this.arena.width - 20, y);
      }
    }

    this.arenaGraphics.lineStyle(3, 0x5aa8d8, 0.52);
    this.arenaGraphics.strokeRect(0, 0, this.arena.width, this.arena.height);

    for (const hazard of this.arena.hazards) {
      this.createHazardLabel(hazard);
    }
  }

  private drawPickups(): void {
    if (!this.snapshot) {
      this.clearRocketPickupSprites();
      this.clearStyledPickupSprites();
      return;
    }

    const view = this.cameras.main.worldView;
    const margin = this.qualityProfile.pickupMargin;
    this.pickupGraphics.clear();
    const visibleRocketOrbs: ForceOrb[] = [];
    const visibleStyledOrbs: ForceOrb[] = [];

    for (const orb of this.snapshot.pickups) {
      if (
        orb.x < view.x - margin ||
        orb.x > view.right + margin ||
        orb.y < view.y - margin ||
        orb.y > view.bottom + margin
      ) {
        continue;
      }

      if (orb.kind === "rocket") {
        visibleRocketOrbs.push(orb);
        continue;
      }

      if (isStyledPickupKind(orb.kind)) {
        visibleStyledOrbs.push(orb);
        continue;
      }

      this.drawOrb(orb);
    }

    this.updateRocketPickupSprites(visibleRocketOrbs);
    this.updateStyledPickupSprites(visibleStyledOrbs);
  }

  private clearRocketPickupSprites(): void {
    for (const sprite of this.rocketPickupSprites.values()) {
      sprite.destroy();
    }
    this.rocketPickupSprites.clear();
  }

  private clearStyledPickupSprites(): void {
    for (const sprite of this.styledPickupSprites.values()) {
      sprite.destroy();
    }
    this.styledPickupSprites.clear();
  }

  private updateRocketPickupSprites(visibleRocketOrbs: ForceOrb[]): void {
    const visibleIds = new Set<string>();

    for (const orb of visibleRocketOrbs) {
      visibleIds.add(orb.id);

      let sprite = this.rocketPickupSprites.get(orb.id);
      if (!sprite) {
        sprite = this.add.image(orb.x, orb.y, "rocket-pickup-icon");
        sprite.setDepth(0);
        this.children.moveBelow(sprite, this.playerGraphics);
        this.rocketPickupSprites.set(orb.id, sprite);
      }

      const phase = this.time.now * 0.004 + orb.x * 0.011 + orb.y * 0.008;
      const pulse = 0.92 + 0.08 * Math.sin(phase);
      const targetSize = (orb.radius * 2 + 12) * pulse;
      const scale = targetSize / 64;

      sprite.setPosition(orb.x, orb.y);
      sprite.setScale(scale);
      sprite.setRotation(-Math.PI / 4 + Math.sin(phase * 0.75) * 0.08);
      sprite.setAlpha(0.9 + 0.1 * Math.sin(phase + 0.8));
      sprite.setVisible(true);
    }

    for (const [orbId, sprite] of this.rocketPickupSprites) {
      if (visibleIds.has(orbId)) {
        continue;
      }
      sprite.destroy();
      this.rocketPickupSprites.delete(orbId);
    }
  }

  private updateStyledPickupSprites(visibleStyledOrbs: ForceOrb[]): void {
    const visibleIds = new Set<string>();

    for (const orb of visibleStyledOrbs) {
      if (!isStyledPickupKind(orb.kind)) {
        continue;
      }

      visibleIds.add(orb.id);
      const textureKey = STYLED_PICKUP_ICON_KEYS[orb.kind];

      let sprite = this.styledPickupSprites.get(orb.id);
      if (!sprite) {
        sprite = this.add.image(orb.x, orb.y, textureKey);
        sprite.setDepth(0);
        this.children.moveBelow(sprite, this.playerGraphics);
        this.styledPickupSprites.set(orb.id, sprite);
      }

      if (sprite.texture.key !== textureKey) {
        sprite.setTexture(textureKey);
      }

      const phaseOffset = STYLED_PICKUP_PHASE_OFFSETS[orb.kind];
      const phase = this.time.now * 0.0048 + orb.x * 0.01 + orb.y * 0.006 + phaseOffset;
      const pulse = 0.92 + 0.1 * Math.sin(phase);
      const targetSize = (orb.radius * 2 + 11) * pulse;
      const scale = targetSize / 64;

      let rotation = Math.sin(phase * 0.9) * 0.04;
      if (orb.kind === "speed") {
        rotation = -0.12 + Math.sin(phase * 1.35) * 0.18;
      } else if (orb.kind === "score") {
        rotation = (this.time.now * 0.0012 + phaseOffset) % (Math.PI * 2);
      } else if (orb.kind === "stealth") {
        rotation = Math.sin(phase * 0.7) * 0.08;
      }

      let alpha = 0.9 + 0.1 * Math.sin(phase + 0.6);
      if (orb.kind === "stealth") {
        alpha = 0.76 + 0.16 * (0.5 + 0.5 * Math.sin(phase * 1.2));
      }

      sprite.setPosition(orb.x, orb.y);
      sprite.setScale(scale);
      sprite.setRotation(rotation);
      sprite.setAlpha(alpha);
      sprite.setVisible(true);
    }

    for (const [orbId, sprite] of this.styledPickupSprites) {
      if (visibleIds.has(orbId)) {
        continue;
      }
      sprite.destroy();
      this.styledPickupSprites.delete(orbId);
    }
  }

  private drawOrb(orb: ForceOrb): void {
    const detail = this.qualityProfile.pickupDetail;
    const phase = this.time.now * 0.0058 + orb.x * 0.013 + orb.y * 0.007;
    const pulse = 0.92 + 0.08 * Math.sin(phase);

    if (detail === "low") {
      this.pickupGraphics.fillStyle(0xfde047, 0.88);
      this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 0.35);
      this.pickupGraphics.fillStyle(0xffffff, 0.5);
      this.pickupGraphics.fillCircle(orb.x - orb.radius * 0.26, orb.y - orb.radius * 0.24, 1.1);
      return;
    }

    this.pickupGraphics.fillStyle(0x84cc16, 0.16);
    this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 4 + pulse * 0.8);

    this.pickupGraphics.fillStyle(0xfde047, 0.9);
    this.pickupGraphics.fillCircle(orb.x, orb.y, orb.radius + 0.7 + pulse * 0.2);
    this.pickupGraphics.lineStyle(1, 0x84cc16, 0.62);
    this.pickupGraphics.strokeCircle(orb.x, orb.y, orb.radius + 3.2);

    if (detail === "high") {
      this.pickupGraphics.lineStyle(1, 0xffffff, 0.22);
      this.pickupGraphics.strokeCircle(orb.x, orb.y, orb.radius + 1.4);
      this.pickupGraphics.fillStyle(0xffffff, 0.16);
      this.pickupGraphics.fillCircle(orb.x - orb.radius * 0.28, orb.y - orb.radius * 0.32, 1.5);
    }
  }

  private detectRocketShotVisuals(previousSnapshot: GameSnapshot | null): void {
    const nextSnapshot = this.snapshot;
    if (!previousSnapshot || !nextSnapshot) {
      return;
    }

    const previousById = new Map(previousSnapshot.players.map((player) => [player.id, player]));
    for (const shooter of nextSnapshot.players) {
      const previous = previousById.get(shooter.id);
      if (!previous) {
        continue;
      }
      if (!previous.alive || !shooter.alive) {
        continue;
      }
      if (previous.rocketAmmo <= shooter.rocketAmmo) {
        continue;
      }

      this.spawnRocketTrailForShooter(shooter, nextSnapshot.players);
    }
  }

  private spawnRocketTrailForShooter(shooter: PlayerSnapshot, players: PlayerSnapshot[]): void {
    const sourceRender = this.renderPlayers.get(shooter.id);
    const fromX = sourceRender?.x ?? shooter.x;
    const fromY = sourceRender?.y ?? shooter.y;

    let targetX = Number.NaN;
    let targetY = Number.NaN;
    let bestDistSq = Number.POSITIVE_INFINITY;

    for (const candidate of players) {
      if (candidate.id === shooter.id || !candidate.alive) {
        continue;
      }

      const targetRender = this.renderPlayers.get(candidate.id);
      const cx = targetRender?.x ?? candidate.x;
      const cy = targetRender?.y ?? candidate.y;
      const dx = cx - fromX;
      const dy = cy - fromY;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        targetX = cx;
        targetY = cy;
      }
    }

    if (!Number.isFinite(targetX) || !Number.isFinite(targetY) || bestDistSq > 1_500 * 1_500) {
      const speed = Math.hypot(shooter.vx, shooter.vy);
      let dirX = 1;
      let dirY = 0;
      if (speed > 0.01) {
        dirX = shooter.vx / speed;
        dirY = shooter.vy / speed;
      }

      if (speed <= 0.01 && shooter.id === this.localPlayerId) {
        const lookDx = this.pointerWorld.x - fromX;
        const lookDy = this.pointerWorld.y - fromY;
        const lookLen = Math.hypot(lookDx, lookDy);
        if (lookLen > 0.01) {
          dirX = lookDx / lookLen;
          dirY = lookDy / lookLen;
        }
      }

      targetX = fromX + dirX * 280;
      targetY = fromY + dirY * 280;
    }

    if (this.arena) {
      targetX = clamp(targetX, 8, this.arena.width - 8);
      targetY = clamp(targetY, 8, this.arena.height - 8);
    }

    const now = this.time.now;
    this.rocketTrails.push({
      id: this.rocketTrailCounter++,
      fromX,
      fromY,
      toX: targetX,
      toY: targetY,
      startedAt: now,
      expiresAt: now + ROCKET_TRAIL_MS,
    });

    if (this.rocketTrails.length > 20) {
      this.rocketTrails.splice(0, this.rocketTrails.length - 20);
    }
  }

  private drawRocketTrails(now: number): void {
    this.rocketTrails = this.rocketTrails.filter((trail) => trail.expiresAt > now);
    this.rocketTrailGraphics.clear();

    for (const trail of this.rocketTrails) {
      const lifetime = Math.max(1, trail.expiresAt - trail.startedAt);
      const progress = clamp((now - trail.startedAt) / lifetime, 0, 1);
      const alpha = clamp(1 - progress, 0, 1);

      const headT = clamp(progress * 1.26, 0, 1);
      const tailT = clamp(headT - 0.34, 0, 1);

      const headX = Phaser.Math.Linear(trail.fromX, trail.toX, headT);
      const headY = Phaser.Math.Linear(trail.fromY, trail.toY, headT);
      const tailX = Phaser.Math.Linear(trail.fromX, trail.toX, tailT);
      const tailY = Phaser.Math.Linear(trail.fromY, trail.toY, tailT);

      this.rocketTrailGraphics.lineStyle(9, 0xfb7185, 0.18 * alpha);
      this.rocketTrailGraphics.lineBetween(tailX, tailY, headX, headY);
      this.rocketTrailGraphics.lineStyle(5, 0xf97316, 0.48 * alpha);
      this.rocketTrailGraphics.lineBetween(tailX, tailY, headX, headY);
      this.rocketTrailGraphics.lineStyle(2, 0xfef08a, 0.88 * alpha);
      this.rocketTrailGraphics.lineBetween(tailX, tailY, headX, headY);

      this.rocketTrailGraphics.fillStyle(0xfef08a, 0.9 * alpha);
      this.rocketTrailGraphics.fillCircle(headX, headY, 2.8 + (1 - progress) * 2.4);
      this.rocketTrailGraphics.fillStyle(0xfb923c, 0.55 * alpha);
      this.rocketTrailGraphics.fillCircle(headX, headY, 4.5 + (1 - progress) * 1.8);

      if (progress >= 0.68) {
        const impact = clamp((progress - 0.68) / 0.32, 0, 1);
        const pulse = 1 - impact;
        const radius = 12 + impact * 22;
        this.rocketTrailGraphics.lineStyle(2, 0xfca5a5, 0.42 * pulse);
        this.rocketTrailGraphics.strokeCircle(trail.toX, trail.toY, radius);
        this.rocketTrailGraphics.fillStyle(0xfb923c, 0.22 * pulse);
        this.rocketTrailGraphics.fillCircle(trail.toX, trail.toY, 9 + impact * 12);
      }
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

    if (hazard.type === "pit") {
      const centerX = hazard.x + hazard.width / 2;
      const centerY = hazard.y + hazard.height / 2;

      this.hazardGraphics.fillStyle(0x03060f, 0.36);
      this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 1.08, hazard.height * 0.86);

      this.hazardGraphics.fillStyle(0x060b16, 0.96);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 13);
      this.hazardGraphics.fillStyle(0x111c30, 0.84);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 3,
        hazard.y + 3,
        hazard.width - 6,
        hazard.height - 6,
        11
      );

      this.hazardGraphics.lineStyle(4, 0x64748b, 0.24);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 13);
      this.hazardGraphics.lineStyle(2, 0x0f172a, 0.88);
      this.hazardGraphics.strokeRoundedRect(
        hazard.x + 2,
        hazard.y + 2,
        hazard.width - 4,
        hazard.height - 4,
        11
      );

      this.hazardGraphics.fillStyle(0x22334e, 0.5);
      this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 0.9, hazard.height * 0.68);
      this.hazardGraphics.fillStyle(0x131d2f, 0.74);
      this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 0.72, hazard.height * 0.53);
      this.hazardGraphics.fillStyle(0x0a101b, 0.88);
      this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 0.54, hazard.height * 0.39);
      this.hazardGraphics.fillStyle(0x02050b, 0.96);
      this.hazardGraphics.fillEllipse(centerX, centerY, hazard.width * 0.38, hazard.height * 0.26);

      this.hazardGraphics.lineStyle(2, 0x93a9c3, 0.2);
      this.hazardGraphics.strokeEllipse(centerX, centerY, hazard.width * 0.92, hazard.height * 0.7);
      this.hazardGraphics.lineStyle(1, 0xffffff, 0.08);
      this.hazardGraphics.strokeEllipse(centerX, centerY - hazard.height * 0.045, hazard.width * 0.6, hazard.height * 0.2);

      const crackCount = 11;
      this.hazardGraphics.lineStyle(1, 0x334155, 0.32);
      for (let i = 0; i < crackCount; i += 1) {
        const angle = (Math.PI * 2 * i) / crackCount;
        const rimX = centerX + Math.cos(angle) * (hazard.width * 0.39);
        const rimY = centerY + Math.sin(angle) * (hazard.height * 0.29);
        const innerX = centerX + Math.cos(angle + 0.18) * (hazard.width * 0.2);
        const innerY = centerY + Math.sin(angle + 0.18) * (hazard.height * 0.14);
        this.hazardGraphics.lineBetween(rimX, rimY, innerX, innerY);
      }

      this.hazardGraphics.fillStyle(0xcbd5e1, 0.18);
      this.hazardGraphics.fillCircle(centerX - hazard.width * 0.31, centerY - hazard.height * 0.16, 2.4);
      this.hazardGraphics.fillCircle(centerX + hazard.width * 0.26, centerY - hazard.height * 0.21, 1.8);
      this.hazardGraphics.fillCircle(centerX + hazard.width * 0.18, centerY + hazard.height * 0.2, 1.6);

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

  private createHazardLabel(_hazard: HazardZone): void {
    // Beschriftung fuer Hazard-Zonen ist bewusst deaktiviert.
    return;
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
      const hasStun = player.stunnedMsLeft > 0;
      const isBountyTarget = this.snapshot?.bountyTargetId === player.id;
      const protectionPulse = hasSpawnProtection
        ? 0.72 + 0.2 * (0.5 + 0.5 * Math.sin(this.time.now / 130))
        : 1;
      this.playerGraphics.fillStyle(player.color, protectionPulse);
      const render = this.renderPlayers.get(player.id);
      const px = render?.x ?? player.x;
      const py = render?.y ?? player.y;

      // Agar.io-aehnlicher Look: ein einzelner Kreis, der mit der Masse waechst.
      this.playerGraphics.fillCircle(px, py, player.radius);

      if (isBountyTarget) {
        this.playerGraphics.lineStyle(3, 0xf59e0b, 0.9);
        this.playerGraphics.strokeCircle(px, py, player.radius + 5);
      }

      if (hasStun) {
        const stunPulse = 0.65 + 0.3 * (0.5 + 0.5 * Math.sin(this.time.now / 90));
        this.playerGraphics.lineStyle(2, 0xfacc15, stunPulse);
        this.playerGraphics.strokeCircle(px, py, player.radius + 9);
      }

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
      const bountyMarker = isBountyTarget ? " [BOUNTY]" : "";
      const shieldMarker = hasSpawnProtection ? " [SAFE]" : "";
      const invulnMarker = player.invulnerableMsLeft > 0 ? " [INV]" : "";
      const stealthMarker = player.stealthMsLeft > 0 ? " [STL]" : "";
      const stunMarker = hasStun ? " [STUN]" : "";
      const labelText = `${player.name}${botMarker}${bountyMarker}${shieldMarker}${invulnMarker}${stealthMarker}${stunMarker}`;
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
    this.updateStatus();

    const bountyTargetId = this.snapshot?.bountyTargetId ?? null;
    const bountyBonus = this.snapshot?.bountyBonus ?? 0;

    const local = this.getLocalPlayer();
    if (local) {
      const protectionText =
        local.spawnProtectionMsLeft > 0
          ? ` | Schutz: ${(local.spawnProtectionMsLeft / 1000).toFixed(1)}s`
          : "";
      const stunText =
        local.stunnedMsLeft > 0
          ? ` | Paralyse: ${(local.stunnedMsLeft / 1000).toFixed(1)}s`
          : "";
      const shockText =
        local.shockCooldownMsLeft > 0
          ? ` | Blitz-CD: ${(local.shockCooldownMsLeft / 1000).toFixed(1)}s`
          : " | Blitz: SPACE bereit";
      const rocketText =
        local.rocketAmmo > 0
          ? " | Rakete: R bereit"
          : " | Rakete: keine";
      const effects = [
        this.formatEffectLabel("Speed", local.speedBoostMsLeft),
        this.formatEffectLabel("Unverwundbar", local.invulnerableMsLeft),
        this.formatEffectLabel("Unsichtbar", local.stealthMsLeft),
      ].filter((entry): entry is string => Boolean(entry));
      const effectText = effects.length > 0 ? ` | Effekte: ${effects.join(" • ")}` : "";
      const localBountyText =
        bountyTargetId === local.id ? ` | Kopfgeld auf DIR: +${Math.max(0, Math.round(bountyBonus))} P` : "";
      hudPlayerElement.textContent =
        `ID ${local.id.slice(0, 6)} | Punkte: ${local.score}${protectionText}${stunText}${effectText}${shockText}${rocketText}${localBountyText}`;
    } else {
      hudPlayerElement.textContent = "Warte auf Spawn…";
    }

    const rankingSource =
      this.snapshot?.leaderboard && this.snapshot.leaderboard.length > 0
        ? this.snapshot.leaderboard
        : [...(this.snapshot?.players ?? [])].sort((a, b) => b.score - a.score);

    const nameWidth = this.hudCompact ? 10 : 12;
    const rankingRows = rankingSource
      .slice(0, this.leaderboardLines)
      .map((player, index) => {
        const rankToken = String(index + 1).padStart(2, " ");
        const nameToken = player.name.slice(0, nameWidth).padEnd(nameWidth, " ");
        const scoreToken = String(Math.max(0, Math.round(player.score))).padStart(5, " ");
        return `${rankToken} ${nameToken} ${scoreToken}`;
      });

    if (rankingRows.length === 0) {
      hudScoreboardElement.textContent = "   Noch keine Punkte";
      return;
    }

    const header = `RK ${"NAME".padEnd(nameWidth, " ")} PUNKTE`;
    const separator = "-".repeat(header.length);
    hudScoreboardElement.textContent = [header, separator, ...rankingRows].join("\n");
  }

  private updateStatus(): void {
    const qualityText = `Qualitaet: ${this.qualityMode.toUpperCase()} (F8)`;
    const activeEvent = this.snapshot?.activeEvent;
    const eventText =
      activeEvent && activeEvent.kind !== "none"
        ? ` | Event: ${activeEvent.title} (${Math.max(0, Math.ceil(activeEvent.msLeft / 1000))}s)`
        : "";
    const bountyTargetId = this.snapshot?.bountyTargetId;
    const bountyBonus = Math.max(0, Math.round(this.snapshot?.bountyBonus ?? 0));
    const specialBountyActive = Boolean(this.snapshot?.specialBountyActive);
    const bountyTarget = bountyTargetId
      ? this.snapshot?.players.find((player) => player.id === bountyTargetId)
      : undefined;
    const bountyText = bountyTarget
      ? ` | Kopfgeld${specialBountyActive ? " [SPEZIAL]" : ""}: ${bountyTarget.name.slice(0, 10)} (+${bountyBonus}P)`
      : "";

    if (socket.connected) {
      hudStatusElement.textContent =
        `Online als ${playerName || "Spieler"} | ${qualityText}${eventText}${bountyText}`;
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
    this.clearRocketPickupSprites();
    this.clearStyledPickupSprites();
    this.rocketTrails = [];
    if (this.rocketTrailGraphics) {
      this.rocketTrailGraphics.clear();
    }
    this.clearAnnouncementQueue();
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
    target: 120,
    min: 60,
  },
  scene: [GameScene],
  parent: document.body,
};

new Phaser.Game(config);
