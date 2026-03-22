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

const SERVER_URL = "http://localhost:3000";

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
  private decorGraphics!: Phaser.GameObjects.Graphics;
  private playerGraphics!: Phaser.GameObjects.Graphics;
  private aimLine!: Phaser.GameObjects.Graphics;
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private hazardLabels: Phaser.GameObjects.Text[] = [];

  private snapshot: GameSnapshot | null = null;
  private localPlayerId = "";
  private inputSeq = 0;

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
      this.drawPlayers();
      this.updateHud();
    };
    this.onSnapshot = (payload) => {
      this.snapshot = payload;
      this.resizeToArena();
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

    this.decorGraphics.clear();
    this.arenaGraphics.clear();
    this.arenaGraphics.fillStyle(0x050814, 1);
    this.arenaGraphics.fillRect(0, 0, this.snapshot.arena.width, this.snapshot.arena.height);
    this.arenaGraphics.fillStyle(0x0b1223, 0.9);
    this.arenaGraphics.fillRoundedRect(10, 10, this.snapshot.arena.width - 20, this.snapshot.arena.height - 20, 24);

    this.decorGraphics.lineStyle(1, 0x1e293b, 0.55);
    for (let x = 70; x < this.snapshot.arena.width; x += 80) {
      this.decorGraphics.lineBetween(x, 20, x, this.snapshot.arena.height - 20);
    }
    for (let y = 70; y < this.snapshot.arena.height; y += 80) {
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
      this.drawHazard(hazard);
    }
  }

  private drawHazard(hazard: HazardZone): void {
    let color = 0x4b5563;
    let edgeColor = 0x94a3b8;
    let title = "ZONE";
    if (hazard.type === "lava") {
      color = 0xef4444;
      edgeColor = 0xfb7185;
      title = "LAVA";
    } else if (hazard.type === "electric") {
      color = 0xf59e0b;
      edgeColor = 0xfacc15;
      title = "ELEKTRO";
    } else if (hazard.type === "pit") {
      color = 0x111827;
      edgeColor = 0x64748b;
      title = "ABGRUND";
    }

    this.arenaGraphics.fillStyle(color, hazard.type === "pit" ? 0.97 : 0.84);
    this.arenaGraphics.fillRect(hazard.x, hazard.y, hazard.width, hazard.height);
    this.arenaGraphics.lineStyle(3, edgeColor, 0.45);
    this.arenaGraphics.strokeRect(hazard.x, hazard.y, hazard.width, hazard.height);

    this.decorGraphics.lineStyle(1, edgeColor, 0.3);
    for (let i = 10; i < hazard.width; i += 18) {
      this.decorGraphics.lineBetween(hazard.x + i, hazard.y, hazard.x, hazard.y + i);
    }

    const label = this.add
      .text(hazard.x + 10, hazard.y + 8, title, {
        fontSize: "12px",
        color: "#e2e8f0",
        fontStyle: "bold",
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
  scene: [GameScene],
  parent: document.body,
};

new Phaser.Game(config);
