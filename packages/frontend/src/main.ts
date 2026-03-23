import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  GameSnapshot,
  HazardZone,
  PlayerInputPayload,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@projekt/shared";

// In Produktion verwenden wir standardmaessig dieselbe Origin wie die Seite selbst.
// Optional kann die URL fuer Sonderfaelle ueber VITE_SERVER_URL gesetzt werden.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? window.location.origin;

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

let playerName = "";

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL, {
  autoConnect: false,
});

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
  socket.connect();
}

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

class GameScene extends Phaser.Scene {
  private hudPanel!: Phaser.GameObjects.Graphics;
  private statusText!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private controlsTitle!: Phaser.GameObjects.Text;
  private controlsText!: Phaser.GameObjects.Text;
  private arenaGraphics!: Phaser.GameObjects.Graphics;
  private hazardGraphics!: Phaser.GameObjects.Graphics;
  private decorGraphics!: Phaser.GameObjects.Graphics;
  private playerGraphics!: Phaser.GameObjects.Graphics;
  private aimLine!: Phaser.GameObjects.Graphics;
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private hazardLabels: Phaser.GameObjects.Text[] = [];

  private snapshot: GameSnapshot | null = null;
  private localPlayerId = "";
  private inputSeq = 0;
  private smoothedDeltaMs = 16.67;
  private hazardFrameCounter = 0;
  private hazardFrameSkip = 1;
  private hazardDetailLevel: "high" | "medium" | "low" = "high";

  private keys!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };

  private pointerWorld = new Phaser.Math.Vector2();
  private pushPressed = false;
  private pullPressed = false;

  private readonly onConnect: () => void;
  private readonly onDisconnect: () => void;
  private readonly onWelcome: (payload: {
    yourId: string;
    snapshot: GameSnapshot;
  }) => void;
  private readonly onSnapshot: (payload: GameSnapshot) => void;
  private readonly onPlayerLeft: () => void;

  constructor() {
    super({ key: "GameScene" });
    this.onConnect = () => this.updateStatus();
    this.onDisconnect = () => {
      this.updateStatus();
      this.aimLine.clear();
    };
    this.onWelcome = (payload) => {
      this.localPlayerId = payload.yourId;
      this.snapshot = payload.snapshot;
      this.resizeToArena();
      this.updateStatus();
      this.drawArena();
      this.drawHazards(this.time.now / 1000);
      this.drawPlayers();
      this.updateHud();
    };
    this.onSnapshot = (payload) => {
      this.snapshot = payload;
      this.resizeToArena();
      this.drawHazards(this.time.now / 1000);
      this.drawPlayers();
      this.updateHud();
    };
    this.onPlayerLeft = () => {
      this.drawPlayers();
      this.updateHud();
    };
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x111827);

    this.hudPanel = this.add.graphics().setDepth(19).setScrollFactor(0);
    this.arenaGraphics = this.add.graphics();
    this.hazardGraphics = this.add.graphics();
    this.decorGraphics = this.add.graphics();
    this.playerGraphics = this.add.graphics();
    this.aimLine = this.add.graphics();

    this.statusText = this.add
      .text(0, 0, "Bitte Namen eingeben…", {
        fontSize: "16px",
        color: "#ffffff",
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.hudText = this.add
      .text(0, 0, "", {
        fontSize: "14px",
        color: "#a7f3d0",
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.scoreText = this.add
      .text(0, 0, "", {
        fontSize: "13px",
        color: "#f8fafc",
        fontFamily: "Consolas, 'Courier New', monospace",
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.controlsTitle = this.add
      .text(0, 0, "Steuerung", {
        fontSize: "14px",
        color: "#93c5fd",
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.controlsText = this.add
      .text(0, 0, "W A S D  → Bewegung\nMaus      → Zielen\nLMB       → Push\nRMB       → Pull\nLow Energy = langsamer", {
        fontSize: "13px",
        color: "#cbd5e1",
        lineSpacing: 4,
      })
      .setDepth(20)
      .setScrollFactor(0);

    this.layoutHud();
    this.renderHudPanel();

    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is not available.");
    }
    this.keys = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.input.mouse?.disableContextMenu();
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.pointerWorld.set(worldPoint.x, worldPoint.y);
    });
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) {
        this.pushPressed = true;
      }
      if (pointer.button === 2) {
        this.pullPressed = true;
      }
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.button === 0) {
        this.pushPressed = false;
      }
      if (pointer.button === 2) {
        this.pullPressed = false;
      }
    });

    this.updateStatus();

    socket.on("connect", this.onConnect);
    socket.on("disconnect", this.onDisconnect);
    socket.on("welcome", this.onWelcome);
    socket.on("snapshot", this.onSnapshot);
    socket.on("playerLeft", this.onPlayerLeft);
  }

  update(): void {
    if (!socket.connected) {
      return;
    }

    this.updatePerformanceProfile();

    // Animierte Gefahren laufen dauerhaft mit, auch wenn sich Snapshot-Daten nicht aendern.
    if (this.snapshot) {
      this.hazardFrameCounter += 1;
      if (this.hazardFrameCounter % this.hazardFrameSkip === 0) {
        this.drawHazards(this.time.now / 1000);
      }
    }

    const player = this.getLocalPlayer();
    if (!player) {
      return;
    }

    const payload: PlayerInputPayload = {
      seq: this.inputSeq++,
      up: this.keys.up.isDown,
      down: this.keys.down.isDown,
      left: this.keys.left.isDown,
      right: this.keys.right.isDown,
      push: this.pushPressed,
      pull: this.pullPressed,
      aimX: this.pointerWorld.x || player.x,
      aimY: this.pointerWorld.y || player.y,
    };

    socket.emit("input", payload);
    this.drawAim(player, payload);
  }

  private updatePerformanceProfile(): void {
    const delta = this.game.loop.delta;
    this.smoothedDeltaMs = Phaser.Math.Linear(this.smoothedDeltaMs, delta, 0.08);

    if (this.smoothedDeltaMs > 28) {
      this.hazardDetailLevel = "low";
      this.hazardFrameSkip = 3;
      return;
    }

    if (this.smoothedDeltaMs > 20) {
      this.hazardDetailLevel = "medium";
      this.hazardFrameSkip = 2;
      return;
    }

    this.hazardDetailLevel = "high";
    this.hazardFrameSkip = 1;
  }

  private resizeToArena(): void {
    if (!this.snapshot) {
      return;
    }

    const { width, height } = this.snapshot.arena;
    const gameSize = this.scale.gameSize;
    if (gameSize.width !== width || gameSize.height !== height) {
      this.scale.resize(width, height);
      this.cameras.main.setBounds(0, 0, width, height);
      this.layoutHud();
      this.renderHudPanel();
    }
  }

  private layoutHud(): void {
    const panelWidth = 360;
    const panelX = this.scale.width - panelWidth - 18;

    this.statusText.setPosition(panelX + 16, 16);
    this.hudText.setPosition(panelX + 16, 40);
    this.scoreText.setPosition(panelX + 16, 72);
    this.controlsTitle.setPosition(panelX + 16, 178);
    this.controlsText.setPosition(panelX + 16, 200);
  }

  private renderHudPanel(): void {
    const panelWidth = 360;
    const panelHeight = 320;
    const panelX = this.scale.width - panelWidth - 18;
    const panelY = 10;

    this.hudPanel.clear();
    this.hudPanel.fillStyle(0x0b1120, 0.7);
    this.hudPanel.fillRoundedRect(panelX, panelY, panelWidth, panelHeight, 14);
    this.hudPanel.lineStyle(2, 0x38bdf8, 0.38);
    this.hudPanel.strokeRoundedRect(panelX, panelY, panelWidth, panelHeight, 14);
    this.hudPanel.lineStyle(1, 0x94a3b8, 0.2);
    this.hudPanel.lineBetween(panelX + 14, 62, panelX + panelWidth - 14, 62);
    this.hudPanel.lineBetween(panelX + 14, 168, panelX + panelWidth - 14, 168);
  }

  private drawArena(): void {
    if (!this.snapshot) {
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
    this.arenaGraphics.fillStyle(0x050814, 1);
    this.arenaGraphics.fillRect(0, 0, this.snapshot.arena.width, this.snapshot.arena.height);
    this.arenaGraphics.fillStyle(0x0b1223, 0.9);
    this.arenaGraphics.fillRoundedRect(10, 10, this.snapshot.arena.width - 20, this.snapshot.arena.height - 20, 24);

    // Panel-Tiles geben Struktur, ohne vom Gameplay abzulenken.
    const tileSize = 56;
    for (let y = 24; y < this.snapshot.arena.height - 24; y += tileSize) {
      for (let x = 24; x < this.snapshot.arena.width - 24; x += tileSize) {
        const isAlt = ((x / tileSize) + (y / tileSize)) % 2 === 0;
        this.decorGraphics.fillStyle(isAlt ? 0x111f38 : 0x0f1a2f, isAlt ? 0.44 : 0.28);
        this.decorGraphics.fillRoundedRect(x, y, tileSize - 8, tileSize - 8, 8);
        this.decorGraphics.lineStyle(1, 0x3b82f6, isAlt ? 0.16 : 0.1);
        this.decorGraphics.strokeRoundedRect(x, y, tileSize - 8, tileSize - 8, 8);
      }
    }

    this.decorGraphics.lineStyle(1, 0x1e293b, 0.35);
    for (let x = 24; x < this.snapshot.arena.width - 20; x += tileSize) {
      this.decorGraphics.lineBetween(x, 20, x, this.snapshot.arena.height - 20);
    }
    for (let y = 24; y < this.snapshot.arena.height - 20; y += tileSize) {
      this.decorGraphics.lineBetween(20, y, this.snapshot.arena.width - 20, y);
    }

    this.decorGraphics.lineStyle(2, 0x0ea5e9, 0.35);
    this.decorGraphics.strokeCircle(this.snapshot.arena.width / 2, this.snapshot.arena.height / 2, 120);
    this.decorGraphics.lineStyle(1, 0x38bdf8, 0.25);
    this.decorGraphics.strokeCircle(this.snapshot.arena.width / 2, this.snapshot.arena.height / 2, 190);

    const beacons = [
      { x: 40, y: 40 },
      { x: this.snapshot.arena.width - 40, y: 40 },
      { x: 40, y: this.snapshot.arena.height - 40 },
      { x: this.snapshot.arena.width - 40, y: this.snapshot.arena.height - 40 },
    ];
    for (const beacon of beacons) {
      this.decorGraphics.fillStyle(0x22d3ee, 0.75);
      this.decorGraphics.fillCircle(beacon.x, beacon.y, 6);
      this.decorGraphics.lineStyle(2, 0x67e8f9, 0.35);
      this.decorGraphics.strokeCircle(beacon.x, beacon.y, 16);
    }

    this.arenaGraphics.lineStyle(3, 0x22d3ee, 0.6);
    this.arenaGraphics.strokeRect(0, 0, this.snapshot.arena.width, this.snapshot.arena.height);

    for (const hazard of this.snapshot.arena.hazards) {
      this.createHazardLabel(hazard);
    }
  }

  private drawHazards(timeSeconds: number): void {
    if (!this.snapshot) {
      return;
    }

    // Dynamische Ebene: Hazards werden pro Frame neu gezeichnet, damit Animationen fluessig wirken.
    this.hazardGraphics.clear();
    for (const hazard of this.snapshot.arena.hazards) {
      this.drawHazard(hazard, timeSeconds, this.hazardDetailLevel);
    }
  }

  private drawHazard(
    hazard: HazardZone,
    timeSeconds: number,
    detailLevel: "high" | "medium" | "low"
  ): void {
    // localTime verschiebt Animationen pro Zone leicht, damit nicht alles synchron "blinkt".
    const localTime = timeSeconds + hazard.x * 0.003 + hazard.y * 0.002;

    if (hazard.type === "lava") {
      const pulse = 0.62 + Math.sin(localTime * 2.4) * 0.16;
      this.hazardGraphics.fillStyle(0x7f1d1d, 0.78);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0xdc2626, 0.48 + pulse * 0.22);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 4,
        hazard.y + 5,
        hazard.width - 8,
        hazard.height - 10,
        8
      );
      this.hazardGraphics.fillStyle(0xfb923c, 0.2 + pulse * 0.18);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 10,
        hazard.y + 12,
        hazard.width - 20,
        hazard.height - 24,
        6
      );
      this.hazardGraphics.lineStyle(3, 0xfda4af, 0.56 + pulse * 0.25);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);

      this.hazardGraphics.lineStyle(2, 0xfdba74, 0.34 + pulse * 0.14);
      const waveStep = detailLevel === "high" ? 12 : detailLevel === "medium" ? 16 : 22;
      for (let y = hazard.y + 8; y < hazard.y + hazard.height - 6; y += waveStep) {
        const sway = Math.sin(localTime * 3 + y * 0.08) * 3;
        this.hazardGraphics.beginPath();
        this.hazardGraphics.moveTo(hazard.x + 8, y);
        this.hazardGraphics.lineTo(hazard.x + hazard.width * 0.34, y - 3 + sway);
        this.hazardGraphics.lineTo(hazard.x + hazard.width * 0.62, y + 3 - sway);
        this.hazardGraphics.lineTo(hazard.x + hazard.width - 8, y);
        this.hazardGraphics.strokePath();
      }

      const bubbleCount = detailLevel === "high" ? 8 : detailLevel === "medium" ? 5 : 3;
      for (let i = 0; i < bubbleCount; i += 1) {
        const phase = localTime * (1.6 + i * 0.1) + i * 0.7;
        const bubbleX = hazard.x + 14 + ((i + 1) / (bubbleCount + 1)) * (hazard.width - 28);
        const bubbleY = hazard.y + 16 + ((Math.sin(phase) + 1) * 0.5) * (hazard.height - 32);
        const bubbleR = 1.8 + ((Math.cos(phase * 1.3) + 1) * 0.5) * 2.2;
        this.hazardGraphics.fillStyle(0xfef08a, 0.25 + ((Math.sin(phase * 2) + 1) * 0.5) * 0.3);
        this.hazardGraphics.fillCircle(bubbleX, bubbleY, bubbleR);
      }
      return;
    }

    if (hazard.type === "electric") {
      const pulse = 0.5 + (Math.sin(localTime * 4.3) + 1) * 0.25;
      // Elektro bewusst in Gelb/Orange (Wunsch), ohne diagonale Linien fuer ein ruhigeres Bild.
      this.hazardGraphics.fillStyle(0x3f2a06, 0.82);
      this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
      this.hazardGraphics.fillStyle(0x92400e, 0.45 + pulse * 0.24);
      this.hazardGraphics.fillRoundedRect(
        hazard.x + 3,
        hazard.y + 3,
        hazard.width - 6,
        hazard.height - 6,
        9
      );
      this.hazardGraphics.lineStyle(3, 0xfacc15, 0.56 + pulse * 0.32);
      this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);

      const sparkStep = detailLevel === "high" ? 18 : detailLevel === "medium" ? 24 : 30;
      for (let x = hazard.x + 12; x < hazard.x + hazard.width - 6; x += sparkStep) {
        for (let y = hazard.y + 12; y < hazard.y + hazard.height - 6; y += sparkStep) {
          const flicker = (Math.sin(localTime * 6 + x * 0.11 + y * 0.17) + 1) * 0.5;
          this.hazardGraphics.fillStyle(0xfde047, 0.2 + flicker * 0.62);
          this.hazardGraphics.fillCircle(x, y, 1.5 + flicker * 1.5);
        }
      }
      return;
    }

    const pulse = 0.45 + (Math.sin(localTime * 1.6) + 1) * 0.2;
    this.hazardGraphics.fillStyle(0x020617, 0.96);
    this.hazardGraphics.fillRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);
    this.hazardGraphics.fillStyle(0x0f172a, 0.78 + pulse * 0.18);
    this.hazardGraphics.fillRoundedRect(
      hazard.x + 6,
      hazard.y + 6,
      hazard.width - 12,
      hazard.height - 12,
      8
    );
    this.hazardGraphics.lineStyle(3, 0x64748b, 0.48 + pulse * 0.32);
    this.hazardGraphics.strokeRoundedRect(hazard.x, hazard.y, hazard.width, hazard.height, 10);

    const centerX = hazard.x + hazard.width / 2;
    const centerY = hazard.y + hazard.height / 2;
    const maxRadius = Math.min(hazard.width, hazard.height) / 2 - 10;
    this.hazardGraphics.lineStyle(2, 0x334155, 0.36 + pulse * 0.28);
    const swirl = localTime * 0.9;
    const radiusStep = detailLevel === "high" ? 10 : detailLevel === "medium" ? 14 : 18;
    for (let radius = maxRadius; radius > 8; radius -= radiusStep) {
      const wobbleX = Math.cos(swirl + radius * 0.09) * 2;
      const wobbleY = Math.sin(swirl + radius * 0.11) * 2;
      this.hazardGraphics.strokeEllipse(centerX + wobbleX, centerY + wobbleY, radius * 2, radius * 1.2);
    }
    this.hazardGraphics.fillStyle(0x020617, 0.95);
    this.hazardGraphics.fillEllipse(centerX, centerY, maxRadius * 1.3, maxRadius * 0.75);

    this.hazardGraphics.lineStyle(2, 0x475569, 0.38);
    const arcCount = detailLevel === "high" ? 5 : detailLevel === "medium" ? 3 : 2;
    for (let arc = 0; arc < arcCount; arc += 1) {
      const start = swirl + arc * 1.2;
      const end = start + 0.75;
      this.hazardGraphics.beginPath();
      this.hazardGraphics.arc(centerX, centerY, maxRadius * 0.72 + arc * 2, start, end, false);
      this.hazardGraphics.strokePath();
    }
  }

  private createHazardLabel(hazard: HazardZone): void {
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

    for (const player of this.snapshot.players) {
      if (!player.alive) {
        continue;
      }

      const isLocal = player.id === this.localPlayerId;
      this.playerGraphics.fillStyle(player.color, 1);
      this.playerGraphics.fillCircle(player.x, player.y, player.radius);

      this.playerGraphics.lineStyle(isLocal ? 4 : 2, isLocal ? 0xffffff : 0x111827, 0.9);
      this.playerGraphics.strokeCircle(player.x, player.y, player.radius + (isLocal ? 3 : 1));

      const energyWidth = 36;
      const ratio = Phaser.Math.Clamp(player.energy / 100, 0, 1);
      this.playerGraphics.fillStyle(0x111827, 0.8);
      this.playerGraphics.fillRect(player.x - energyWidth / 2, player.y - 30, energyWidth, 5);
      this.playerGraphics.fillStyle(0x34d399, 0.95);
      this.playerGraphics.fillRect(
        player.x - energyWidth / 2,
        player.y - 30,
        energyWidth * ratio,
        5
      );
      let label = this.nameLabels.get(player.id);
      if (!label) {
        label = this.add
          .text(player.x, player.y - 42, "", {
            fontSize: "11px",
            color: "#ffffff",
          })
          .setOrigin(0.5)
          .setDepth(5);
        this.nameLabels.set(player.id, label);
      }

      label.setPosition(player.x, player.y - 42);
      label.setText(`${player.name}${player.isBot ? " 🤖" : ""}`);
    }

    for (const [playerId, label] of this.nameLabels) {
      const exists = this.snapshot.players.some((player) => player.id === playerId && player.alive);
      if (!exists) {
        label.destroy();
        this.nameLabels.delete(playerId);
      }
    }
  }

  private drawAim(player: PlayerSnapshot, input: PlayerInputPayload): void {
    this.aimLine.clear();
    const color = input.push ? 0xf97316 : input.pull ? 0x60a5fa : 0x94a3b8;
    this.aimLine.lineStyle(2, color, 0.85);
    this.aimLine.beginPath();
    this.aimLine.moveTo(player.x, player.y);
    this.aimLine.lineTo(input.aimX, input.aimY);
    this.aimLine.strokePath();
  }

  private getLocalPlayer(): PlayerSnapshot | undefined {
    return this.snapshot?.players.find((player) => player.id === this.localPlayerId);
  }

  private updateHud(): void {
    const local = this.getLocalPlayer();
    if (local) {
      this.hudText.setText(
        `ID ${local.id.slice(0, 6)} | Modus: ${local.mode} | Energie: ${local.energy.toFixed(0)}`
      );
    } else {
      this.hudText.setText("Warte auf Spawn…");
    }

    const ranking = [...(this.snapshot?.players ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, 7)
      .map((player, index) => {
        const rankBadge = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "•";
        const suffix = player.isBot ? "🤖" : "🧲";
        return `${rankBadge} ${String(index + 1).padStart(2, "0")}  ${player.name.padEnd(12, " ").slice(0, 12)} ${suffix}  ${String(player.score).padStart(2, "0")} KO`;
      })
      .join("\n");

    this.scoreText.setText(ranking || "• Noch keine Punkte");
  }

  private updateStatus(): void {
    if (socket.connected) {
      this.statusText.setText(`Online als ${playerName || "Spieler"}`);
    } else {
      this.statusText.setText("Warte auf Lobby-Start…");
    }
  }

  shutdown(): void {
    socket.off("connect", this.onConnect);
    socket.off("disconnect", this.onDisconnect);
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
