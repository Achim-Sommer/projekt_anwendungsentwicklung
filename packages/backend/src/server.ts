import { createServer, type ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  ArenaState,
  GameSnapshot,
  MagnetMode,
  PlayerInputPayload,
  PlayerSnapshot,
} from "@projekt/shared";

const PORT = process.env.PORT ?? 3000;
const TICK_RATE = 30;
const SNAPSHOT_RATE = 15;
const DT = 1 / TICK_RATE;

const PLAYER_RADIUS = 18;
const PLAYER_ACCELERATION = 1450;
const PLAYER_MAX_SPEED = 360;
const PLAYER_DRAG = 0.89;
const MOVEMENT_ENERGY_DRAIN = 16;
const MOVEMENT_EXHAUST_THRESHOLD = 14;

const MAGNET_RANGE = 300;
const MAGNET_POWER = 920;
const MAGNET_ENERGY_DRAIN = 30;
const ENERGY_MAX = 100;
const ENERGY_REGEN = 28;
const KILL_ENERGY_BOOST = 35;
const MAGNET_SPEED_DAMPING = 0.985;
const CONTROL_SUPPRESSION_RECOVERY = 2.8;
const CONTROL_SUPPRESSION_ON_HIT = 0.12;

const RESPAWN_TIME_MS = 1800;
const TARGET_TOTAL_PLAYERS = 8;

// KI-Tuning: weniger Bot-Klumpen, mehr aktive Kills ueber Gefahrenzonen.
const AI_TARGET_RETHINK_BASE_MS = 300;
const AI_TARGET_RETHINK_RANDOM_MS = 350;
const AI_SEPARATION_RADIUS = 170;
const AI_HAZARD_INTEREST_RANGE = 280;
const AI_HAZARD_TRAP_DISTANCE = 120;
const AI_PUSH_ALIGNMENT_THRESHOLD = 0.55;
const AI_ENERGY_SAVE_THRESHOLD = 26;
const AI_ENERGY_REENGAGE_THRESHOLD = 62;
const AI_ENERGY_CRITICAL_THRESHOLD = 12;

// Das gebaute Frontend wird im Produktivbetrieb vom Backend auf derselben Domain ausgeliefert.
const FRONTEND_DIST_PATH = path.resolve(__dirname, "../../frontend/dist");
const FRONTEND_INDEX_PATH = path.join(FRONTEND_DIST_PATH, "index.html");

const MIME_BY_EXTENSION: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

interface ServerPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  energy: number;
  mode: MagnetMode;
  score: number;
  isBot: boolean;
  alive: boolean;
  respawnAt: number;
  lastInput: PlayerInputPayload;
  lastThreatBy?: string;
  aiTargetId?: string;
  aiDecisionAt: number;
  controlSuppression: number;
  aiConserveEnergy: boolean;
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function tryServeFrontend(requestPath: string, method: string, res: ServerResponse): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  // Socket.IO-Endpunkte niemals als statische Datei behandeln.
  if (requestPath.startsWith("/socket.io/")) {
    return false;
  }

  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const absoluteFilePath = path.normalize(path.join(FRONTEND_DIST_PATH, normalized));

  // Schutz gegen Pfad-Traversal ausserhalb von dist.
  if (!absoluteFilePath.startsWith(FRONTEND_DIST_PATH)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return true;
  }

  // Wenn eine Datei existiert, wird sie direkt ausgeliefert (z. B. JS/CSS/Assets).
  if (existsSync(absoluteFilePath) && statSync(absoluteFilePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentTypeFor(absoluteFilePath) });
    if (method === "HEAD") {
      res.end();
    } else {
      createReadStream(absoluteFilePath).pipe(res);
    }
    return true;
  }

  // SPA-Fallback: unbekannte Routen liefern index.html.
  if (existsSync(FRONTEND_INDEX_PATH)) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (method === "HEAD") {
      res.end();
    } else {
      createReadStream(FRONTEND_INDEX_PATH).pipe(res);
    }
    return true;
  }

  return false;
}

const httpServer = createServer((req, res) => {
  const rawUrl = req.url ?? "/";
  const requestPath = rawUrl.split("?")[0] ?? "/";

  // Diese Route wird in Coolify oft fuer Health-Checks verwendet.
  if (requestPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, tick }));
    return;
  }

  if (tryServeFrontend(requestPath, req.method ?? "GET", res)) {
    return;
  }

  // Falls kein Frontend-Build vorhanden ist, eine klare Meldung statt leerem 404.
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found - Frontend build is missing. Run npm run build first.");
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
  },
});

const arena: ArenaState = {
  width: 1600,
  height: 900,
  hazards: [
    { id: "pit-mid", type: "pit", x: 735, y: 380, width: 130, height: 140 },
    { id: "lava-left", type: "lava", x: 220, y: 640, width: 220, height: 110 },
    {
      id: "electric-right",
      type: "electric",
      x: 1160,
      y: 190,
      width: 250,
      height: 130,
    },
  ],
};

const players = new Map<string, ServerPlayer>();
const socketsByPlayer = new Map<string, string>();

let tick = 0;
let lastSnapshotAt = 0;
let botCounter = 1;

function randomSpawn() {
  return {
    x: 180 + Math.random() * (arena.width - 360),
    y: 140 + Math.random() * (arena.height - 280),
  };
}

function randomColor() {
  return 0x44aaff + Math.floor(Math.random() * 0x884400);
}

function randomMode(): MagnetMode {
  const modes: MagnetMode[] = [
    "balanced",
    "strong-push",
    "long-pull",
    "aoe",
    "sticky",
  ];
  return modes[Math.floor(Math.random() * modes.length)] ?? "balanced";
}

function sanitizePlayerName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}_\- .]/gu, "")
    .slice(0, 16);
}

function createPlayer(id: string, name: string, isBot: boolean): ServerPlayer {
  const spawn = randomSpawn();
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: PLAYER_RADIUS,
    color: randomColor(),
    energy: ENERGY_MAX,
    mode: randomMode(),
    score: 0,
    isBot,
    alive: true,
    respawnAt: 0,
    lastInput: {
      seq: 0,
      up: false,
      down: false,
      left: false,
      right: false,
      push: false,
      pull: false,
      aimX: spawn.x,
      aimY: spawn.y,
    },
    aiDecisionAt: 0,
    controlSuppression: 0,
    aiConserveEnergy: false,
  };
}

function buildSnapshot(): GameSnapshot {
  const playerSnapshots: PlayerSnapshot[] = Array.from(players.values()).map(
    (player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      vx: player.vx,
      vy: player.vy,
      radius: player.radius,
      color: player.color,
      energy: player.energy,
      mode: player.mode,
      score: player.score,
      isBot: player.isBot,
      alive: player.alive,
    })
  );

  return {
    tick,
    serverTime: Date.now(),
    arena,
    players: playerSnapshots,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

function magnetModeMultiplier(mode: MagnetMode, action: "push" | "pull"): {
  power: number;
  range: number;
  energy: number;
} {
  switch (mode) {
    case "strong-push":
      return action === "push"
        ? { power: 1.7, range: 0.85, energy: 1.4 }
        : { power: 0.8, range: 0.9, energy: 1.0 };
    case "long-pull":
      return action === "pull"
        ? { power: 1.2, range: 1.45, energy: 1.25 }
        : { power: 0.8, range: 1.0, energy: 1.0 };
    case "aoe":
      return { power: 0.95, range: 1.2, energy: 1.25 };
    case "sticky":
      return action === "pull"
        ? { power: 1.05, range: 1.1, energy: 1.2 }
        : { power: 0.85, range: 1.0, energy: 1.0 };
    case "balanced":
    default:
      return { power: 1, range: 1, energy: 1 };
  }
}

function knockOut(victim: ServerPlayer, actorId?: string): void {
  if (!victim.alive) {
    return;
  }

  victim.alive = false;
  victim.vx = 0;
  victim.vy = 0;
  victim.respawnAt = Date.now() + RESPAWN_TIME_MS;

  const scorerId = actorId ?? victim.lastThreatBy;
  if (scorerId && scorerId !== victim.id) {
    const scorer = players.get(scorerId);
    if (scorer) {
      scorer.score += 1;
      scorer.energy = clamp(scorer.energy + KILL_ENERGY_BOOST, 0, ENERGY_MAX);
    }
  }
}

function handleRespawns(now: number): void {
  for (const player of players.values()) {
    if (player.alive || now < player.respawnAt) {
      continue;
    }

    const spawn = randomSpawn();
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.energy = ENERGY_MAX;
    player.alive = true;
    player.lastThreatBy = undefined;
    player.controlSuppression = 0;
    player.aiConserveEnergy = false;
  }
}

function edgeDanger(player: ServerPlayer): number {
  const margin = 170;
  const left = clamp((margin - player.x) / margin, 0, 1);
  const right = clamp((player.x - (arena.width - margin)) / margin, 0, 1);
  const top = clamp((margin - player.y) / margin, 0, 1);
  const bottom = clamp((player.y - (arena.height - margin)) / margin, 0, 1);
  return left + right + top + bottom;
}

function edgeRepulsion(player: ServerPlayer): { x: number; y: number } {
  const margin = 180;
  const left = clamp((margin - player.x) / margin, 0, 1);
  const right = clamp((player.x - (arena.width - margin)) / margin, 0, 1);
  const top = clamp((margin - player.y) / margin, 0, 1);
  const bottom = clamp((player.y - (arena.height - margin)) / margin, 0, 1);

  return {
    x: left - right,
    y: top - bottom,
  };
}

function hazardRepulsion(player: ServerPlayer): { x: number; y: number; danger: number } {
  let sumX = 0;
  let sumY = 0;
  let danger = 0;

  for (const hazard of arena.hazards) {
    const nearestX = clamp(player.x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(player.y, hazard.y, hazard.y + hazard.height);
    const dx = player.x - nearestX;
    const dy = player.y - nearestY;
    const distance = Math.hypot(dx, dy);
    const avoidRange = 130;

    if (distance >= avoidRange || distance < 0.0001) {
      continue;
    }

    const push = 1 - distance / avoidRange;
    const n = normalize(dx, dy);
    const weight = push * push;
    sumX += n.x * weight;
    sumY += n.y * weight;
    danger += weight;
  }

  return { x: sumX, y: sumY, danger };
}

function isInHazard(player: ServerPlayer): boolean {
  return arena.hazards.some((hazard) => {
    return (
      player.x + player.radius > hazard.x &&
      player.x - player.radius < hazard.x + hazard.width &&
      player.y + player.radius > hazard.y &&
      player.y - player.radius < hazard.y + hazard.height
    );
  });
}

function hazardCenter(hazard: ArenaState["hazards"][number]): { x: number; y: number } {
  return {
    x: hazard.x + hazard.width / 2,
    y: hazard.y + hazard.height / 2,
  };
}

function hazardPressureAt(x: number, y: number): number {
  // Liefert einen Wert von 0..1+, wie "gefaehrlich" diese Position ist.
  let pressure = 0;
  for (const hazard of arena.hazards) {
    const nearestX = clamp(x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(y, hazard.y, hazard.y + hazard.height);
    const distance = Math.hypot(x - nearestX, y - nearestY);
    if (distance >= AI_HAZARD_INTEREST_RANGE) {
      continue;
    }
    const influence = 1 - distance / AI_HAZARD_INTEREST_RANGE;
    pressure += influence * influence;
  }
  return pressure;
}

function chooseTrapHazard(bot: ServerPlayer, target: ServerPlayer) {
  let best:
    | {
        hazard: ArenaState["hazards"][number];
        centerX: number;
        centerY: number;
        score: number;
      }
    | undefined;

  for (const hazard of arena.hazards) {
    const center = hazardCenter(hazard);
    const distTargetToHazard = Math.hypot(target.x - center.x, target.y - center.y);
    const distBotToHazard = Math.hypot(bot.x - center.x, bot.y - center.y);

    // Ziel nahe am Hazard = gute Kill-Chance.
    const targetFactor = clamp((AI_HAZARD_INTEREST_RANGE - distTargetToHazard) / AI_HAZARD_INTEREST_RANGE, 0, 1);
    const botFactor = clamp((460 - distBotToHazard) / 460, 0, 1);
    const score = targetFactor * 0.78 + botFactor * 0.22;

    if (!best || score > best.score) {
      best = {
        hazard,
        centerX: center.x,
        centerY: center.y,
        score,
      };
    }
  }

  if (!best || best.score < 0.14) {
    return undefined;
  }
  return best;
}

function runAi(now: number): void {
  const list = Array.from(players.values());
  const arenaCenter = { x: arena.width / 2, y: arena.height / 2 };

  for (const bot of list) {
    if (!bot.isBot || !bot.alive) {
      continue;
    }

    // Energie-Hysterese: Der Bot wechselt in den Sparmodus wenn Energie niedrig ist,
    // und verlaesst ihn erst wieder bei deutlich hoeherem Wert.
    // Dadurch wird ein staendiges Ein/Aus um einen Grenzwert verhindert.
    if (bot.energy <= AI_ENERGY_SAVE_THRESHOLD) {
      bot.aiConserveEnergy = true;
    } else if (bot.energy >= AI_ENERGY_REENGAGE_THRESHOLD) {
      bot.aiConserveEnergy = false;
    }

    if (now >= bot.aiDecisionAt) {
      const options = list.filter((item) => item.id !== bot.id && item.alive);
      if (options.length > 0) {
        options.sort((a, b) => {
          const distA = Math.hypot(a.x - bot.x, a.y - bot.y);
          const distB = Math.hypot(b.x - bot.x, b.y - bot.y);
          const aEdge = edgeDanger(a) * 95;
          const bEdge = edgeDanger(b) * 95;
          const aHazard = hazardPressureAt(a.x, a.y) * 180;
          const bHazard = hazardPressureAt(b.x, b.y) * 180;
          const aCrowd = list.filter((p) => p.isBot && p.aiTargetId === a.id).length * 140;
          const bCrowd = list.filter((p) => p.isBot && p.aiTargetId === b.id).length * 140;
          const scorePriority = (b.score - a.score) * 20;
          return distA + aEdge + aCrowd - aHazard - (distB + bEdge + bCrowd - bHazard) + scorePriority;
        });

        const spreadPool = Math.min(3, options.length);
        const spreadIndex = Math.floor(Math.random() * spreadPool);
        bot.aiTargetId = options[spreadIndex]?.id;
      }
      bot.aiDecisionAt = now + AI_TARGET_RETHINK_BASE_MS + Math.random() * AI_TARGET_RETHINK_RANDOM_MS;
    }

    const target = bot.aiTargetId ? players.get(bot.aiTargetId) : undefined;
    if (!target || !target.alive) {
      bot.lastInput = {
        ...bot.lastInput,
        up: false,
        down: false,
        left: false,
        right: false,
        push: false,
        pull: false,
      };
      continue;
    }

    const dx = target.x - bot.x;
    const dy = target.y - bot.y;
    const distance = Math.hypot(dx, dy);

    const toTarget = normalize(dx, dy);
    const toCenter = normalize(arenaCenter.x - bot.x, arenaCenter.y - bot.y);
    const edgeAvoid = edgeRepulsion(bot);
    const hazardAvoid = hazardRepulsion(bot);
    const trap = chooseTrapHazard(bot, target);

    // Trap-Position: Bot geht auf die Gegenseite des Ziels, um in Richtung Hazard zu pushen.
    let trapX = 0;
    let trapY = 0;
    if (trap) {
      const fromTargetToHazard = normalize(trap.centerX - target.x, trap.centerY - target.y);
      trapX = target.x - fromTargetToHazard.x * AI_HAZARD_TRAP_DISTANCE;
      trapY = target.y - fromTargetToHazard.y * AI_HAZARD_TRAP_DISTANCE;
    }

    const toTrap = trap ? normalize(trapX - bot.x, trapY - bot.y) : { x: 0, y: 0, length: 0 };
    let separationX = 0;
    let separationY = 0;

    for (const other of list) {
      if (other.id === bot.id || !other.alive) {
        continue;
      }

      const ox = bot.x - other.x;
      const oy = bot.y - other.y;
      const distance = Math.hypot(ox, oy);
      if (distance < 0.01 || distance > AI_SEPARATION_RADIUS) {
        continue;
      }

      const away = 1 - distance / AI_SEPARATION_RADIUS;
      const dir = normalize(ox, oy);
      const botWeight = other.isBot ? 1.35 : 0.85;
      separationX += dir.x * away * away * botWeight;
      separationY += dir.y * away * away * botWeight;
    }

    const hazardAvoidWeight = trap ? 1.05 : 2.75;
    const targetWeight = trap ? 0.7 : 1.05;
    const trapWeight = trap ? 1.8 : 0;

    const desiredX =
      toTarget.x * targetWeight +
      toTrap.x * trapWeight +
      edgeAvoid.x * 2.35 +
      hazardAvoid.x * hazardAvoidWeight +
      toCenter.x * 0.35 +
      separationX * 2.7;
    const desiredY =
      toTarget.y * targetWeight +
      toTrap.y * trapWeight +
      edgeAvoid.y * 2.35 +
      hazardAvoid.y * hazardAvoidWeight +
      toCenter.y * 0.35 +
      separationY * 2.7;
    const desiredMove = normalize(desiredX, desiredY);

    const avoidDanger = edgeDanger(bot) + hazardAvoid.danger;
    const panic = avoidDanger > 0.55;

    // Bei kritischer Energie priorisiert der Bot nur Sicherheit und Regeneration.
    // Er bewegt sich weg von Kanten/Gefahren und nutzt in dieser Phase keinen Magnet.
    const criticalEnergy = bot.energy <= AI_ENERGY_CRITICAL_THRESHOLD;
    let finalMove = desiredMove;
    if (criticalEnergy) {
      const safeX = edgeAvoid.x * 3.2 + hazardAvoid.x * 3.4 + toCenter.x * 0.8 + separationX * 2.2;
      const safeY = edgeAvoid.y * 3.2 + hazardAvoid.y * 3.4 + toCenter.y * 0.8 + separationY * 2.2;
      finalMove = normalize(safeX, safeY);
    }

    // Push nur wenn Bot, Ziel und Hazard gut ausgerichtet sind.
    const targetToHazard = trap
      ? normalize(trap.centerX - target.x, trap.centerY - target.y)
      : { x: 0, y: 0, length: 0 };
    const alignment = trap
      ? clamp(toTarget.x * targetToHazard.x + toTarget.y * targetToHazard.y, -1, 1)
      : 0;
    const canExecuteTrapPush = Boolean(
      trap && distance < 260 && alignment >= AI_PUSH_ALIGNMENT_THRESHOLD
    );
    const shouldPullToSetTrap = Boolean(trap && !canExecuteTrapPush && distance > 160 && distance < 320);

    // Magnet-Nutzung wird im Sparmodus streng begrenzt:
    // - kein Dauerspammen bei leerem Tank
    // - nur bei sicherem Vorteil (Trap-Push) noch erlaubt
    const conserveEnergy = bot.aiConserveEnergy || criticalEnergy;
    const allowPush = !conserveEnergy || canExecuteTrapPush;
    const allowPull = !conserveEnergy;

    bot.lastInput = {
      ...bot.lastInput,
      up: finalMove.y < -0.2,
      down: finalMove.y > 0.2,
      left: finalMove.x < -0.2,
      right: finalMove.x > 0.2,
      push: allowPush && !panic && (canExecuteTrapPush || distance < 170),
      pull: allowPull && (panic ? distance < 210 : shouldPullToSetTrap),
      aimX: trap ? trap.centerX : target.x,
      aimY: trap ? trap.centerY : target.y,
    };
  }
}

function maintainBots(): void {
  const humans = Array.from(players.values()).filter((player) => !player.isBot).length;
  const bots = Array.from(players.values()).filter((player) => player.isBot);
  const targetBots = Math.max(0, TARGET_TOTAL_PLAYERS - humans);

  if (bots.length < targetBots) {
    for (let i = bots.length; i < targetBots; i += 1) {
      const id = `bot-${botCounter++}`;
      players.set(id, createPlayer(id, `BOT ${botCounter - 1}`, true));
    }
  } else if (bots.length > targetBots) {
    const removable = bots.slice(0, bots.length - targetBots);
    for (const bot of removable) {
      players.delete(bot.id);
      io.emit("playerLeft", { id: bot.id });
    }
  }
}

function tickSimulation(): void {
  tick += 1;
  const now = Date.now();

  maintainBots();
  runAi(now);
  handleRespawns(now);

  const activePlayers = Array.from(players.values()).filter((player) => player.alive);

  for (const player of activePlayers) {
    player.controlSuppression = clamp(
      player.controlSuppression - CONTROL_SUPPRESSION_RECOVERY * DT,
      0,
      1
    );

    const input = player.lastInput;
    let inputX = 0;
    let inputY = 0;
    if (input.left) inputX -= 1;
    if (input.right) inputX += 1;
    if (input.up) inputY -= 1;
    if (input.down) inputY += 1;

    const direction = normalize(inputX, inputY);
    const exhaustion = clamp(
      (MOVEMENT_EXHAUST_THRESHOLD - player.energy) / MOVEMENT_EXHAUST_THRESHOLD,
      0,
      1
    );
    const accelerationMultiplier =
      1 - exhaustion * 0.35 - clamp(player.controlSuppression, 0, 1) * 0.2;
    const effectiveAcceleration = PLAYER_ACCELERATION * Math.max(0.5, accelerationMultiplier);

    player.vx += direction.x * effectiveAcceleration * DT;
    player.vy += direction.y * effectiveAcceleration * DT;

    const effectiveDrag = clamp(PLAYER_DRAG - exhaustion * 0.09, 0.72, 0.92);
    player.vx *= effectiveDrag;
    player.vy *= effectiveDrag;

    const speed = Math.hypot(player.vx, player.vy);
    const exhaustedSpeedMultiplier = 1 - exhaustion * 0.25;
    const effectiveMaxSpeed = PLAYER_MAX_SPEED * Math.max(0.72, exhaustedSpeedMultiplier);
    if (speed > effectiveMaxSpeed) {
      const scaled = effectiveMaxSpeed / speed;
      player.vx *= scaled;
      player.vy *= scaled;
    }
  }

  for (const source of activePlayers) {
    const wantsPush = source.lastInput.push;
    const wantsPull = source.lastInput.pull;
    const action = wantsPush ? "push" : wantsPull ? "pull" : undefined;
    if (!action) {
      continue;
    }

    const mode = magnetModeMultiplier(source.mode, action);
    const currentRange = MAGNET_RANGE * mode.range;
    const energyCost = MAGNET_ENERGY_DRAIN * mode.energy * DT;

    if (source.energy < energyCost) {
      continue;
    }

    source.energy = clamp(source.energy - energyCost, 0, ENERGY_MAX);
    const aim = normalize(source.lastInput.aimX - source.x, source.lastInput.aimY - source.y);

    for (const target of activePlayers) {
      if (target.id === source.id) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const direction = normalize(dx, dy);
      if (direction.length > currentRange || direction.length < 0.01) {
        continue;
      }

      const directionalWeight = Math.max(0, direction.x * aim.x + direction.y * aim.y);
      const aoeBonus = source.mode === "aoe" ? 0.45 : 0;
      const influence = clamp(directionalWeight + aoeBonus, 0, 1);
      if (influence <= 0.05) {
        continue;
      }

      const falloff = 1 - direction.length / currentRange;
      const baseForce = MAGNET_POWER * mode.power * falloff * falloff * influence;
      const signedForce = action === "push" ? baseForce : -baseForce;

      target.vx += direction.x * signedForce * DT;
      target.vy += direction.y * signedForce * DT;
      target.vx *= MAGNET_SPEED_DAMPING;
      target.vy *= MAGNET_SPEED_DAMPING;
      target.controlSuppression = clamp(
        target.controlSuppression + CONTROL_SUPPRESSION_ON_HIT * influence,
        0,
        1
      );
      target.lastThreatBy = source.id;

      if (source.mode === "sticky" && action === "pull") {
        target.vx *= 0.96;
        target.vy *= 0.96;
        target.controlSuppression = clamp(target.controlSuppression + 0.14, 0, 1);
      }
    }
  }

  for (const player of activePlayers) {
    const input = player.lastInput;
    const isMoving = input.up || input.down || input.left || input.right;
    const isUsingMagnet = input.push || input.pull;

    let energyDelta = ENERGY_REGEN * DT;
    if (isMoving) {
      energyDelta -= MOVEMENT_ENERGY_DRAIN * DT;
    }
    if (isUsingMagnet) {
      energyDelta -= 4 * DT;
    }
    player.energy = clamp(player.energy + energyDelta, 0, ENERGY_MAX);
  }

  for (const player of activePlayers) {
    player.x += player.vx * DT;
    player.y += player.vy * DT;

    if (
      player.x < -60 ||
      player.x > arena.width + 60 ||
      player.y < -60 ||
      player.y > arena.height + 60
    ) {
      knockOut(player);
      continue;
    }

    player.x = clamp(player.x, player.radius, arena.width - player.radius);
    player.y = clamp(player.y, player.radius, arena.height - player.radius);

    if (isInHazard(player)) {
      knockOut(player);
    }
  }

  if (now - lastSnapshotAt >= 1000 / SNAPSHOT_RATE) {
    io.emit("snapshot", buildSnapshot());
    lastSnapshotAt = now;
  }
}

io.on("connection", (socket) => {
  const requestedName = sanitizePlayerName(socket.handshake.auth?.playerName);
  if (requestedName.length < 2) {
    console.log(`[Server] Connection rejected (missing name): id=${socket.id}`);
    socket.disconnect(true);
    return;
  }

  console.log(`[Server] Player connected:    id=${socket.id}, name=${requestedName}`);

  const player = createPlayer(socket.id, requestedName, false);
  players.set(player.id, player);
  socketsByPlayer.set(player.id, socket.id);
  maintainBots();

  socket.emit("welcome", {
    yourId: player.id,
    snapshot: buildSnapshot(),
  });

  socket.on("input", (payload) => {
    const current = players.get(player.id);
    if (!current) {
      return;
    }
    current.lastInput = payload;
  });

  socket.on("disconnect", () => {
    console.log(`[Server] Player disconnected: id=${socket.id}`);
    players.delete(player.id);
    socketsByPlayer.delete(player.id);
    io.emit("playerLeft", { id: player.id });
    maintainBots();
  });
});

setInterval(tickSimulation, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
