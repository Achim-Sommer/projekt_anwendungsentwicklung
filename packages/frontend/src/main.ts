import Phaser from "phaser";
import { io, type Socket } from "socket.io-client";
import type { ServerToClientEvents, ClientToServerEvents } from "@projekt/shared";

// ---------------------------------------------------------------------------
// Socket connection
// ---------------------------------------------------------------------------
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  "http://localhost:3000"
);

socket.on("connect", () => {
  console.log(`[Client] Connected to server. Socket id: ${socket.id}`);
});

socket.on("disconnect", () => {
  console.log("[Client] Disconnected from server.");
});

// ---------------------------------------------------------------------------
// Phaser scene
// ---------------------------------------------------------------------------
class GameScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private idText!: Phaser.GameObjects.Text;
  private readonly onConnect: () => void;
  private readonly onDisconnect: () => void;

  constructor() {
    super({ key: "GameScene" });
    this.onConnect = () => this.updateStatus();
    this.onDisconnect = () => this.updateStatus();
  }

  create(): void {
    this.statusText = this.add
      .text(400, 300, "Verbinde mit Server…", {
        fontSize: "24px",
        color: "#ffffff",
      })
      .setOrigin(0.5);

    this.idText = this.add
      .text(400, 340, "", { fontSize: "16px", color: "#aaffaa" })
      .setOrigin(0.5);

    // Reflect current connection state immediately (socket may already be connected).
    this.updateStatus();

    socket.on("connect", this.onConnect);
    socket.on("disconnect", this.onDisconnect);
  }

  private updateStatus(): void {
    if (socket.connected) {
      this.statusText.setText("Verbunden!");
      this.idText.setText(`Socket-ID: ${socket.id ?? ""}`);
    } else {
      this.statusText.setText("Verbinde mit Server…");
      this.idText.setText("");
    }
  }

  shutdown(): void {
    socket.off("connect", this.onConnect);
    socket.off("disconnect", this.onDisconnect);
  }
}

// ---------------------------------------------------------------------------
// Phaser game config
// ---------------------------------------------------------------------------
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#16213e",
  scene: [GameScene],
  parent: document.body,
};

new Phaser.Game(config);
