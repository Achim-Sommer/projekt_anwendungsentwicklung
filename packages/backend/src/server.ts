import { createServer, type ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Server } from "socket.io";
import type {
  ArenaState,
  ClientToServerEvents,
  ForceOrb,
  GameSnapshot,
  PlayerInputPayload,
  PlayerSnapshot,
  ServerToClientEvents,
} from "@projekt/shared";

const PORT = process.env.PORT ?? 3000;
const TICK_RATE = 24;
const SNAPSHOT_RATE = 10;
const DT = 1 / TICK_RATE;

const PLAYER_START_MASS = 20;
const PLAYER_ACCELERATION_BASE = 1700;
const PLAYER_MAX_SPEED_BASE = 370;
const PLAYER_DRAG = 0.83;
const PUSH_RANGE = 175;
const PUSH_MIN_MASS_RATIO = 1.15;
const PUSH_CHARGE_MIN = 20;
const PUSH_FORCE_BASE = 190;
const PUSH_RECOIL_FACTOR = 0.3;
const CHARGE_MAX = 100;
const CHARGE_GAIN_RATE = 126;
const CHARGE_DECAY_RATE = 30;
const RESPAWN_TIME_MS = 1800;
const TARGET_TOTAL_PLAYERS = 4;

const ORB_SPAWN_INTERVAL_MS = 420;
const ORB_MAX_COUNT = 140;
const ORB_RADIUS = 6;
const ORB_VALUE_MIN = 4;
const ORB_VALUE_MAX = 8;
const KILL_MASS_BONUS = 12;
const CONSUME_MIN_RATIO = 1.22;
const CONSUME_MASS_GAIN = 0.22;

const AI_TARGET_RETHINK_BASE_MS = 320;
const AI_TARGET_RETHINK_RANDOM_MS = 420;
const AI_SEPARATION_RADIUS = 170;

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
  mass: number;
  charge: number;
  score: number;
  isBot: boolean;
  alive: boolean;
  respawnAt: number;
  lastInput: PlayerInputPayload;
  lastChargePressed: boolean;
  lastThreatBy?: string;
  aiTargetId?: string;
  aiTargetKind?: "player" | "orb";
  aiDecisionAt: number;
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function tryServeFrontend(requestPath: string, method: string, res: ServerResponse): boolean {
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }

  if (requestPath.startsWith("/socket.io/")) {
    return false;
  }

  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const absoluteFilePath = path.normalize(path.join(FRONTEND_DIST_PATH, normalized));

  if (!absoluteFilePath.startsWith(FRONTEND_DIST_PATH)) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return true;
  }

  if (existsSync(absoluteFilePath) && statSync(absoluteFilePath).isFile()) {
    res.writeHead(200, { "Content-Type": contentTypeFor(absoluteFilePath) });
    if (method === "HEAD") {
      res.end();
    } else {
      createReadStream(absoluteFilePath).pipe(res);
    }
    return true;
  }

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

  if (requestPath === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, tick }));
    return;
  }

  if (tryServeFrontend(requestPath, req.method ?? "GET", res)) {
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found - Frontend build is missing. Run npm run build first.");
});

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
  },
});

const arena: ArenaState = {
  width: 3000,
  height: 1800,
  hazards: [
    { id: "pit-mid", type: "pit", x: 1435, y: 830, width: 170, height: 170 },
    { id: "pit-north", type: "pit", x: 1400, y: 210, width: 220, height: 120 },
    { id: "pit-south", type: "pit", x: 1380, y: 1450, width: 250, height: 120 },
    { id: "pit-west", type: "pit", x: 360, y: 760, width: 150, height: 210 },
    { id: "pit-east", type: "pit", x: 2480, y: 730, width: 150, height: 210 },
    { id: "lava-left", type: "lava", x: 420, y: 1260, width: 300, height: 140 },
    {
      id: "electric-right",
      type: "electric",
      x: 2160,
      y: 350,
      width: 340,
      height: 170,
    },
  ],
};

const players = new Map<string, ServerPlayer>();
const pickups = new Map<string, ForceOrb>();

let tick = 0;
let lastSnapshotAt = 0;
let botCounter = 1;
let orbCounter = 1;
let lastOrbSpawnAt = 0;

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

function massToRadius(mass: number): number {
  return 10 + 1.9 * Math.sqrt(Math.max(1, mass));
}

function maxSpeedForMass(mass: number): number {
  const speed = PLAYER_MAX_SPEED_BASE * Math.pow(Math.max(1, mass), -0.25);
  return clamp(speed, 120, PLAYER_MAX_SPEED_BASE);
}

function accelerationForMass(mass: number): number {
  const acceleration = PLAYER_ACCELERATION_BASE * Math.pow(Math.max(1, mass), -0.2);
  return clamp(acceleration, 340, PLAYER_ACCELERATION_BASE);
}

function randomSpawn() {
  return {
    x: 180 + Math.random() * (arena.width - 360),
    y: 140 + Math.random() * (arena.height - 280),
  };
}

function randomColor() {
  return 0x44aaff + Math.floor(Math.random() * 0x884400);
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
    radius: massToRadius(PLAYER_START_MASS),
    color: randomColor(),
    mass: PLAYER_START_MASS,
    charge: 0,
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
      charge: false,
      aimX: spawn.x,
      aimY: spawn.y,
    },
    lastChargePressed: false,
    aiDecisionAt: 0,
  };
}

function buildSnapshot(): GameSnapshot {
  const playerSnapshots: PlayerSnapshot[] = Array.from(players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    radius: player.radius,
    color: player.color,
    mass: player.mass,
    charge: player.charge,
    chargeMax: CHARGE_MAX,
    score: player.score,
    isBot: player.isBot,
    alive: player.alive,
  }));

  return {
    tick,
    serverTime: Date.now(),
    arena,
    players: playerSnapshots,
    pickups: Array.from(pickups.values()),
  };
}

function applyMass(player: ServerPlayer, amount: number): void {
  player.mass = Math.max(8, player.mass + amount);
  player.radius = massToRadius(player.mass);
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

function isPointInHazard(x: number, y: number): boolean {
  return arena.hazards.some((hazard) => {
    return x >= hazard.x && x <= hazard.x + hazard.width && y >= hazard.y && y <= hazard.y + hazard.height;
  });
}

function hazardCenter(hazard: ArenaState["hazards"][number]): { x: number; y: number } {
  return {
    x: hazard.x + hazard.width / 2,
    y: hazard.y + hazard.height / 2,
  };
}

function nearestHazardCenter(target: ServerPlayer): { x: number; y: number } {
  let best = hazardCenter(arena.hazards[0]);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const hazard of arena.hazards) {
    const center = hazardCenter(hazard);
    const distance = Math.hypot(center.x - target.x, center.y - target.y);
    if (distance < bestDistance) {
      best = center;
      bestDistance = distance;
    }
  }

  return best;
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

function hazardRepulsion(player: ServerPlayer): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;

  for (const hazard of arena.hazards) {
    const nearestX = clamp(player.x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(player.y, hazard.y, hazard.y + hazard.height);
    const dx = player.x - nearestX;
    const dy = player.y - nearestY;
    const distance = Math.hypot(dx, dy);
    const avoidRange = 140;

    if (distance >= avoidRange || distance < 0.0001) {
      continue;
    }

    const push = 1 - distance / avoidRange;
    const n = normalize(dx, dy);
    const weight = push * push;
    sumX += n.x * weight;
    sumY += n.y * weight;
  }

  return { x: sumX, y: sumY };
}

function canPush(source: ServerPlayer, target: ServerPlayer): boolean {
  if (source.id === target.id || !source.alive || !target.alive) {
    return false;
  }
  return source.mass / Math.max(1, target.mass) >= PUSH_MIN_MASS_RATIO;
}

function knockOut(victim: ServerPlayer, actorId?: string, reason: "ringout" | "consume" = "ringout"): void {
  if (!victim.alive) {
    return;
  }

  const victimPoints = Math.max(0, victim.score);
  victim.score = 0;

  victim.alive = false;
  victim.vx = 0;
  victim.vy = 0;
  victim.charge = 0;
  victim.lastChargePressed = false;
  victim.respawnAt = Date.now() + RESPAWN_TIME_MS;

  applyMass(victim, -Math.max(2, victim.mass * 0.18));

  const scorerId = actorId ?? victim.lastThreatBy;
  if (scorerId && scorerId !== victim.id) {
    const scorer = players.get(scorerId);
    if (scorer) {
      scorer.score += victimPoints;
      if (reason === "consume") {
        applyMass(scorer, Math.max(2, victim.mass * CONSUME_MASS_GAIN));
      } else {
        applyMass(scorer, KILL_MASS_BONUS + victim.mass * 0.05);
      }
    }
  }
}

function resolveConsumptions(playersList: ServerPlayer[]): void {
  for (let i = 0; i < playersList.length; i += 1) {
    const a = playersList[i];
    if (!a || !a.alive) {
      continue;
    }

    for (let j = i + 1; j < playersList.length; j += 1) {
      const b = playersList[j];
      if (!b || !b.alive) {
        continue;
      }

      let eater: ServerPlayer | undefined;
      let victim: ServerPlayer | undefined;

      if (a.mass >= b.mass * CONSUME_MIN_RATIO) {
        eater = a;
        victim = b;
      } else if (b.mass >= a.mass * CONSUME_MIN_RATIO) {
        eater = b;
        victim = a;
      }

      if (!eater || !victim) {
        continue;
      }

      const dx = eater.x - victim.x;
      const dy = eater.y - victim.y;
      const consumeRadius = Math.max(8, eater.radius - victim.radius * 0.32);
      if (dx * dx + dy * dy > consumeRadius * consumeRadius) {
        continue;
      }

      victim.lastThreatBy = eater.id;
      knockOut(victim, eater.id, "consume");
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
    player.alive = true;
    player.charge = 0;
    player.lastThreatBy = undefined;
    player.lastChargePressed = false;
  }
}

function spawnOrb(now: number): void {
  if (pickups.size >= ORB_MAX_COUNT || now - lastOrbSpawnAt < ORB_SPAWN_INTERVAL_MS) {
    return;
  }

  let spawn = randomSpawn();
  let safety = 0;
  while (isPointInHazard(spawn.x, spawn.y) && safety < 20) {
    spawn = randomSpawn();
    safety += 1;
  }

  const id = `orb-${orbCounter++}`;
  pickups.set(id, {
    id,
    x: spawn.x,
    y: spawn.y,
    radius: ORB_RADIUS,
    value: ORB_VALUE_MIN + Math.floor(Math.random() * (ORB_VALUE_MAX - ORB_VALUE_MIN + 1)),
  });
  lastOrbSpawnAt = now;
}

function collectOrbs(playersList: ServerPlayer[]): void {
  for (const player of playersList) {
    for (const [orbId, orb] of pickups) {
      const dx = player.x - orb.x;
      const dy = player.y - orb.y;
      const pickupDistance = player.radius + orb.radius;
      if (Math.abs(dx) > pickupDistance || Math.abs(dy) > pickupDistance) {
        continue;
      }
      if (dx * dx + dy * dy > pickupDistance * pickupDistance) {
        continue;
      }

      const catchUpBonus = player.mass < 26 ? 1.3 : player.mass < 34 ? 1.15 : 1;
      applyMass(player, orb.value * catchUpBonus);
      player.score += Math.max(1, Math.round(orb.value * 1.4));
      pickups.delete(orbId);
    }
  }
}

function findPushTarget(source: ServerPlayer, candidates: ServerPlayer[]): ServerPlayer | undefined {
  const aim = normalize(source.lastInput.aimX - source.x, source.lastInput.aimY - source.y);
  if (aim.length < 0.0001) {
    return undefined;
  }

  let bestScore = 0;
  let bestTarget: ServerPlayer | undefined;

  for (const target of candidates) {
    if (!canPush(source, target)) {
      continue;
    }

    const dir = normalize(target.x - source.x, target.y - source.y);
    const cone = dir.x * aim.x + dir.y * aim.y;
    if (cone < 0.55) {
      continue;
    }

    const distanceCap = PUSH_RANGE + source.radius + target.radius;
    if (dir.length > distanceCap) {
      continue;
    }

    const distanceWeight = 1 - dir.length / distanceCap;
    const score = cone * 0.65 + distanceWeight * 0.35;
    if (!bestTarget || score > bestScore) {
      bestScore = score;
      bestTarget = target;
    }
  }

  return bestTarget;
}

function executePush(source: ServerPlayer, releasedCharge: number, candidates: ServerPlayer[]): void {
  if (releasedCharge < PUSH_CHARGE_MIN) {
    return;
  }

  const target = findPushTarget(source, candidates);
  if (!target) {
    return;
  }

  const aim = normalize(source.lastInput.aimX - source.x, source.lastInput.aimY - source.y);
  const massAdvantage = Math.pow(clamp(source.mass / Math.max(1, target.mass), 1, 3), 0.35);
  const chargeRatio = clamp(releasedCharge / CHARGE_MAX, 0, 1);
  const deltaV = PUSH_FORCE_BASE * (0.6 + chargeRatio * 1.1) * massAdvantage;

  target.vx += aim.x * deltaV;
  target.vy += aim.y * deltaV;

  const recoil = deltaV * PUSH_RECOIL_FACTOR * clamp(target.mass / Math.max(1, source.mass), 0.3, 1.3);
  source.vx -= aim.x * recoil;
  source.vy -= aim.y * recoil;

  target.lastThreatBy = source.id;
}

function runAi(now: number): void {
  const list = Array.from(players.values());
  const orbs = Array.from(pickups.values());
  const arenaCenter = { x: arena.width / 2, y: arena.height / 2 };

  for (const bot of list) {
    if (!bot.isBot || !bot.alive) {
      continue;
    }

    if (now >= bot.aiDecisionAt) {
      let targetPlayer: ServerPlayer | undefined;
      let targetPlayerDistance = Number.POSITIVE_INFINITY;
      for (const candidate of list) {
        if (candidate.id === bot.id || !candidate.alive || !canPush(bot, candidate)) {
          continue;
        }
        const distance = Math.hypot(candidate.x - bot.x, candidate.y - bot.y);
        if (distance < targetPlayerDistance) {
          targetPlayerDistance = distance;
          targetPlayer = candidate;
        }
      }

      let targetOrb: ForceOrb | undefined;
      let targetOrbDistance = Number.POSITIVE_INFINITY;
      for (const orb of orbs) {
        const distance = Math.hypot(orb.x - bot.x, orb.y - bot.y);
        if (distance < targetOrbDistance) {
          targetOrbDistance = distance;
          targetOrb = orb;
        }
      }

      const shouldFarm = bot.mass < 25 || (!targetPlayer && Boolean(targetOrb));

      if (shouldFarm && targetOrb) {
        bot.aiTargetKind = "orb";
        bot.aiTargetId = targetOrb.id;
      } else if (targetPlayer) {
        bot.aiTargetKind = "player";
        bot.aiTargetId = targetPlayer.id;
      } else if (targetOrb) {
        bot.aiTargetKind = "orb";
        bot.aiTargetId = targetOrb.id;
      } else {
        bot.aiTargetId = undefined;
        bot.aiTargetKind = undefined;
      }

      bot.aiDecisionAt = now + AI_TARGET_RETHINK_BASE_MS + Math.random() * AI_TARGET_RETHINK_RANDOM_MS;
    }

    let targetX = arenaCenter.x;
    let targetY = arenaCenter.y;
    let charge = false;

    if (bot.aiTargetKind === "player" && bot.aiTargetId) {
      const target = players.get(bot.aiTargetId);
      if (target && target.alive) {
        const hazard = nearestHazardCenter(target);
        const hazardDir = normalize(hazard.x - target.x, hazard.y - target.y);
        const trapPoint = {
          x: target.x - hazardDir.x * 105,
          y: target.y - hazardDir.y * 105,
        };

        targetX = trapPoint.x;
        targetY = trapPoint.y;

        const toTarget = normalize(target.x - bot.x, target.y - bot.y);
        const toHazard = normalize(hazard.x - target.x, hazard.y - target.y);
        const alignment = clamp(toTarget.x * toHazard.x + toTarget.y * toHazard.y, -1, 1);
        const distance = Math.hypot(target.x - bot.x, target.y - bot.y);

        bot.lastInput.aimX = target.x;
        bot.lastInput.aimY = target.y;

        if (canPush(bot, target)) {
          if (bot.charge < 62 || distance > 195) {
            charge = true;
          } else if (alignment > 0.8 && distance < 210) {
            charge = false;
          } else {
            charge = true;
          }
        }
      }
    } else if (bot.aiTargetKind === "orb" && bot.aiTargetId) {
      const orb = pickups.get(bot.aiTargetId);
      if (orb) {
        targetX = orb.x;
        targetY = orb.y;
        bot.lastInput.aimX = orb.x;
        bot.lastInput.aimY = orb.y;
      }
    }

    const toTarget = normalize(targetX - bot.x, targetY - bot.y);
    const edgeAvoid = edgeRepulsion(bot);
    const hazardAvoid = hazardRepulsion(bot);

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
      separationX += dir.x * away * away * (other.isBot ? 1.2 : 0.8);
      separationY += dir.y * away * away * (other.isBot ? 1.2 : 0.8);
    }

    const desiredX = toTarget.x * 1.2 + edgeAvoid.x * 2.4 + hazardAvoid.x * 2.6 + separationX * 2.5;
    const desiredY = toTarget.y * 1.2 + edgeAvoid.y * 2.4 + hazardAvoid.y * 2.6 + separationY * 2.5;
    const move = normalize(desiredX, desiredY);

    bot.lastInput = {
      ...bot.lastInput,
      up: move.y < -0.2,
      down: move.y > 0.2,
      left: move.x < -0.2,
      right: move.x > 0.2,
      charge,
      aimX: bot.lastInput.aimX || targetX,
      aimY: bot.lastInput.aimY || targetY,
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
  spawnOrb(now);
  if (tick % 3 === 0) {
    runAi(now);
  }
  handleRespawns(now);

  const activePlayers = Array.from(players.values()).filter((player) => player.alive);

  for (const player of activePlayers) {
    const input = player.lastInput;
    let inputX = 0;
    let inputY = 0;
    if (input.left) inputX -= 1;
    if (input.right) inputX += 1;
    if (input.up) inputY -= 1;
    if (input.down) inputY += 1;

    const direction = normalize(inputX, inputY);
    const acceleration = accelerationForMass(player.mass);
    const maxSpeed = maxSpeedForMass(player.mass);

    player.vx += direction.x * acceleration * DT;
    player.vy += direction.y * acceleration * DT;

    player.vx *= PLAYER_DRAG;
    player.vy *= PLAYER_DRAG;

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > maxSpeed) {
      const scaled = maxSpeed / speed;
      player.vx *= scaled;
      player.vy *= scaled;
    }

    const isCharging = Boolean(input.charge);
    const releasedCharge = !isCharging && player.lastChargePressed ? player.charge : 0;

    if (isCharging) {
      player.charge = clamp(player.charge + CHARGE_GAIN_RATE * DT, 0, CHARGE_MAX);
    } else {
      player.charge = clamp(player.charge - CHARGE_DECAY_RATE * DT, 0, CHARGE_MAX);
    }

    if (releasedCharge >= PUSH_CHARGE_MIN) {
      executePush(player, releasedCharge, activePlayers);
      player.charge = 0;
    }

    player.lastChargePressed = isCharging;
  }

  collectOrbs(activePlayers);

  for (const player of activePlayers) {
    player.x += player.vx * DT;
    player.y += player.vy * DT;

    if (player.x < -60 || player.x > arena.width + 60 || player.y < -60 || player.y > arena.height + 60) {
      knockOut(player);
      continue;
    }

    player.x = clamp(player.x, player.radius, arena.width - player.radius);
    player.y = clamp(player.y, player.radius, arena.height - player.radius);

  }

  resolveConsumptions(activePlayers);

  for (const player of activePlayers) {
    if (!player.alive) {
      continue;
    }
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
    io.emit("playerLeft", { id: player.id });
    maintainBots();
  });
});

setInterval(tickSimulation, 1000 / TICK_RATE);

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
