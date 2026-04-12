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
  SkinId,
} from "@projekt/shared";

const PORT = process.env.PORT ?? 3000;
const TICK_RATE = 60;
const SNAPSHOT_RATE = 40;
const DT = 1 / TICK_RATE;

const PLAYER_START_MASS = 20;
const PLAYER_ACCELERATION_BASE = 1850;
const PLAYER_MAX_SPEED_BASE = 420;
const PLAYER_DRAG = 0.92;
const RESPAWN_TIME_MS = 1800;
const SPAWN_PROTECTION_MS = 2400;
const SPAWN_SAFE_PLAYER_DISTANCE = 250;
const SPAWN_SAFE_HAZARD_DISTANCE = 120;
const SPAWN_ATTEMPTS = 40;
const TARGET_TOTAL_PLAYERS = 4;

const ORB_SPAWN_INTERVAL_MS = 420;
const ORB_MAX_COUNT = 140;
const ORB_RADIUS = 6;
const ORB_VALUE_MIN = 4;
const ORB_VALUE_MAX = 8;
const KILL_MASS_BONUS = 12;
const CONSUME_MIN_RATIO = 1.22;
const CONSUME_MASS_GAIN = 0.22;
const HAZARD_DEATH_OVERLAP_RATIO = 0.55;
const HAZARD_DEATH_OVERLAP_MIN = 10;
const HAZARD_DEATH_OVERLAP_MAX = 24;

const AI_TARGET_RETHINK_BASE_MS = 320;
const AI_TARGET_RETHINK_RANDOM_MS = 420;
const AI_SEPARATION_RADIUS = 170;
const AI_SEPARATION_RADIUS_SQ = AI_SEPARATION_RADIUS * AI_SEPARATION_RADIUS;

const SKIN_TIERS: Array<{
  id: SkinId;
  minScore: number;
  minPlayMs: number;
  color: number;
}> = [
  { id: "starter", minScore: 0, minPlayMs: 0, color: 0x38bdf8 },
  { id: "mint", minScore: 24, minPlayMs: 90_000, color: 0x34d399 },
  { id: "sunset", minScore: 54, minPlayMs: 210_000, color: 0xfb923c },
  { id: "rose", minScore: 94, minPlayMs: 360_000, color: 0xfb7185 },
  { id: "gold", minScore: 140, minPlayMs: 540_000, color: 0xfacc15 },
];

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
  skinId: SkinId;
  mass: number;
  score: number;
  isBot: boolean;
  alive: boolean;
  respawnAt: number;
  connectedAt: number;
  spawnedAt: number;
  spawnProtectedUntil: number;
  lastInput: PlayerInputPayload;
  lastThreatBy?: string;
  aiTargetId?: string;
  aiTargetKind?: "player" | "orb";
  aiDecisionAt: number;
  aiTickPhase: number;
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

// --- Spatial grid for orb lookups ---
const GRID_CELL = 100;
const GRID_COLS = Math.ceil(arena.width / GRID_CELL);
const GRID_ROWS = Math.ceil(arena.height / GRID_CELL);
const orbGrid: Set<string>[] = [];
for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) orbGrid.push(new Set());

function orbGridIndex(x: number, y: number): number {
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x / GRID_CELL)));
  const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(y / GRID_CELL)));
  return row * GRID_COLS + col;
}

function orbGridInsert(orb: ForceOrb): void {
  orbGrid[orbGridIndex(orb.x, orb.y)].add(orb.id);
}

function orbGridRemove(orb: ForceOrb): void {
  orbGrid[orbGridIndex(orb.x, orb.y)].delete(orb.id);
}

const players = new Map<string, ServerPlayer>();
const pickups = new Map<string, ForceOrb>();

let tick = 0;
let lastSnapshotAt = 0;
let botCounter = 1;
let orbCounter = 1;
let lastOrbSpawnAt = 0;
let lastTickMs = Date.now();

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
  return clamp(speed, 150, PLAYER_MAX_SPEED_BASE);
}

function accelerationForMass(mass: number): number {
  const acceleration = PLAYER_ACCELERATION_BASE * Math.pow(Math.max(1, mass), -0.2);
  return clamp(acceleration, 420, PLAYER_ACCELERATION_BASE);
}

function randomSpawn() {
  return {
    x: 180 + Math.random() * (arena.width - 360),
    y: 140 + Math.random() * (arena.height - 280),
  };
}

function distanceToNearestHazard(x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const hazard of arena.hazards) {
    const nearestX = clamp(x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(y, hazard.y, hazard.y + hazard.height);
    const dx = x - nearestX;
    const dy = y - nearestY;
    const dist = Math.hypot(dx, dy);
    if (dist < best) {
      best = dist;
    }
  }
  return best;
}

function distanceToNearestAlivePlayer(x: number, y: number, excludeId?: string): number {
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of players.values()) {
    if (!candidate.alive || candidate.id === excludeId) {
      continue;
    }
    const dist = Math.hypot(x - candidate.x, y - candidate.y) - candidate.radius;
    if (dist < best) {
      best = dist;
    }
  }
  return best;
}

function findSafeSpawn(excludeId?: string): { x: number; y: number } {
  let best = randomSpawn();
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < SPAWN_ATTEMPTS; i += 1) {
    const candidate = randomSpawn();
    if (isPointInHazard(candidate.x, candidate.y)) {
      continue;
    }

    const playerDistance = distanceToNearestAlivePlayer(candidate.x, candidate.y, excludeId);
    const hazardDistance = distanceToNearestHazard(candidate.x, candidate.y);

    if (
      playerDistance >= SPAWN_SAFE_PLAYER_DISTANCE &&
      hazardDistance >= SPAWN_SAFE_HAZARD_DISTANCE
    ) {
      return candidate;
    }

    const score = Math.min(playerDistance, 600) * 0.78 + Math.min(hazardDistance, 280) * 0.22;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function resolveSkinTierForPlayer(player: ServerPlayer, now: number): (typeof SKIN_TIERS)[number] {
  const playedMs = Math.max(0, now - player.connectedAt);
  let bestTier = SKIN_TIERS[0];
  for (const tier of SKIN_TIERS) {
    if (player.score >= tier.minScore || playedMs >= tier.minPlayMs) {
      bestTier = tier;
    }
  }
  return bestTier;
}

function refreshPlayerCosmetics(now: number): void {
  for (const player of players.values()) {
    const tier = resolveSkinTierForPlayer(player, now);
    player.skinId = tier.id;
    player.color = tier.color;
  }
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
  const now = Date.now();
  const spawn = findSafeSpawn(id);
  const starterSkin = SKIN_TIERS[0];
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: massToRadius(PLAYER_START_MASS),
    color: starterSkin.color,
    skinId: starterSkin.id,
    mass: PLAYER_START_MASS,
    score: 0,
    isBot,
    alive: true,
    respawnAt: 0,
    connectedAt: now,
    spawnedAt: now,
    spawnProtectedUntil: now + SPAWN_PROTECTION_MS,
    lastInput: {
      seq: 0,
      up: false,
      down: false,
      left: false,
      right: false,
    },
    aiDecisionAt: 0,
    aiTickPhase: Math.floor(Math.random() * 3),
  };
}

function buildSnapshot(): GameSnapshot {
  const now = Date.now();
  const playerSnapshots: PlayerSnapshot[] = Array.from(players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    radius: player.radius,
    color: player.color,
    skinId: player.skinId,
    spawnProtectionMsLeft: Math.max(0, player.spawnProtectedUntil - now),
    mass: player.mass,
    score: player.score,
    isBot: player.isBot,
    alive: player.alive,
  }));

  return {
    tick,
    serverTime: Date.now(),
    players: playerSnapshots,
    pickups: Array.from(pickups.values()),
  };
}

function applyMass(player: ServerPlayer, amount: number): void {
  player.mass = Math.max(8, player.mass + amount);
  player.radius = massToRadius(player.mass);
}

function isInHazard(player: ServerPlayer): boolean {
  const radiusSq = player.radius * player.radius;
  return arena.hazards.some((hazard) => {
    const nearestX = clamp(player.x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(player.y, hazard.y, hazard.y + hazard.height);
    const dx = player.x - nearestX;
    const dy = player.y - nearestY;
    const distSq = dx * dx + dy * dy;

    if (distSq >= radiusSq) {
      return false;
    }

    const distance = Math.sqrt(distSq);
    const overlapDepth = player.radius - distance;
    const requiredDepth = clamp(
      player.radius * HAZARD_DEATH_OVERLAP_RATIO,
      HAZARD_DEATH_OVERLAP_MIN,
      HAZARD_DEATH_OVERLAP_MAX,
    );

    return overlapDepth >= requiredDepth;
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
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const hazard of arena.hazards) {
    const center = hazardCenter(hazard);
    const dx = center.x - target.x;
    const dy = center.y - target.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      best = center;
      bestDistSq = distSq;
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
  const avoidRange = 140;
  const avoidRangeSq = avoidRange * avoidRange;

  for (const hazard of arena.hazards) {
    const nearestX = clamp(player.x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(player.y, hazard.y, hazard.y + hazard.height);
    const dx = player.x - nearestX;
    const dy = player.y - nearestY;
    const distSq = dx * dx + dy * dy;

    if (distSq >= avoidRangeSq || distSq < 0.00000001) {
      continue;
    }

    const distance = Math.sqrt(distSq);
    const push = 1 - distance / avoidRange;
    const weight = push * push;
    sumX += (dx / distance) * weight;
    sumY += (dy / distance) * weight;
  }

  return { x: sumX, y: sumY };
}

function canConsumeTarget(source: ServerPlayer, target: ServerPlayer, now: number): boolean {
  if (source.id === target.id || !source.alive || !target.alive) {
    return false;
  }
  if (source.spawnProtectedUntil > now || target.spawnProtectedUntil > now) {
    return false;
  }
  return source.mass >= target.mass * CONSUME_MIN_RATIO;
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

function resolveConsumptions(playersList: ServerPlayer[], now: number): void {
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

      if (canConsumeTarget(a, b, now)) {
        eater = a;
        victim = b;
      } else if (canConsumeTarget(b, a, now)) {
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

    const spawn = findSafeSpawn(player.id);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.alive = true;
    player.spawnedAt = now;
    player.spawnProtectedUntil = now + SPAWN_PROTECTION_MS;
    player.lastThreatBy = undefined;
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
  const orb: ForceOrb = {
    id,
    x: spawn.x,
    y: spawn.y,
    radius: ORB_RADIUS,
    value: ORB_VALUE_MIN + Math.floor(Math.random() * (ORB_VALUE_MAX - ORB_VALUE_MIN + 1)),
  };
  pickups.set(id, orb);
  orbGridInsert(orb);
  lastOrbSpawnAt = now;
}

function collectOrbs(playersList: ServerPlayer[]): void {
  for (const player of playersList) {
    const pickupDist = player.radius + ORB_RADIUS;
    const pickupDistSq = pickupDist * pickupDist;
    const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(player.x / GRID_CELL)));
    const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(player.y / GRID_CELL)));
    const range = Math.ceil(pickupDist / GRID_CELL) + 1;

    for (let dr = -range; dr <= range; dr++) {
      const r = row + dr;
      if (r < 0 || r >= GRID_ROWS) continue;
      for (let dc = -range; dc <= range; dc++) {
        const c = col + dc;
        if (c < 0 || c >= GRID_COLS) continue;
        const cell = orbGrid[r * GRID_COLS + c];
        for (const orbId of cell) {
          const orb = pickups.get(orbId);
          if (!orb) { cell.delete(orbId); continue; }
          const dx = player.x - orb.x;
          const dy = player.y - orb.y;
          if (dx * dx + dy * dy > pickupDistSq) continue;

          const catchUpBonus = player.mass < 26 ? 1.3 : player.mass < 34 ? 1.15 : 1;
          applyMass(player, orb.value * catchUpBonus);
          player.score += Math.max(1, Math.round(orb.value * 1.4));
          cell.delete(orbId);
          pickups.delete(orbId);
        }
      }
    }
  }
}

function runAi(now: number): void {
  const list = Array.from(players.values());
  const orbs = Array.from(pickups.values());
  const arenaCenter = { x: arena.width / 2, y: arena.height / 2 };

  for (const bot of list) {
    if (!bot.isBot || !bot.alive) {
      continue;
    }

    // Stagger: each bot only updates on its own tick phase
    if (tick % 3 !== bot.aiTickPhase) {
      continue;
    }

    // Validate cached target — force rethink if target disappeared
    if (bot.aiTargetKind === "orb" && bot.aiTargetId && !pickups.has(bot.aiTargetId)) {
      bot.aiTargetId = undefined;
      bot.aiTargetKind = undefined;
      bot.aiDecisionAt = 0;
    }
    if (bot.aiTargetKind === "player" && bot.aiTargetId) {
      const cached = players.get(bot.aiTargetId);
      if (!cached || !cached.alive) {
        bot.aiTargetId = undefined;
        bot.aiTargetKind = undefined;
        bot.aiDecisionAt = 0;
      }
    }

    if (now >= bot.aiDecisionAt) {
      let targetPlayer: ServerPlayer | undefined;
      let targetPlayerDistSq = Number.POSITIVE_INFINITY;
      for (const candidate of list) {
        if (candidate.id === bot.id || !candidate.alive || !canConsumeTarget(bot, candidate, now)) {
          continue;
        }
        const dx = candidate.x - bot.x;
        const dy = candidate.y - bot.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < targetPlayerDistSq) {
          targetPlayerDistSq = distSq;
          targetPlayer = candidate;
        }
      }

      let targetOrb: ForceOrb | undefined;
      let targetOrbDistSq = Number.POSITIVE_INFINITY;
      for (const orb of orbs) {
        const dx = orb.x - bot.x;
        const dy = orb.y - bot.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < targetOrbDistSq) {
          targetOrbDistSq = distSq;
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
      }
    } else if (bot.aiTargetKind === "orb" && bot.aiTargetId) {
      const orb = pickups.get(bot.aiTargetId);
      if (orb) {
        targetX = orb.x;
        targetY = orb.y;
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
      const distSq = ox * ox + oy * oy;
      if (distSq < 0.0001 || distSq > AI_SEPARATION_RADIUS_SQ) {
        continue;
      }
      const distance = Math.sqrt(distSq);
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
  const dt = Math.min((now - lastTickMs) / 1000, DT * 3);
  lastTickMs = now;
  const dragFactor = Math.pow(PLAYER_DRAG, dt / DT);

  maintainBots();
  spawnOrb(now);
  runAi(now);
  handleRespawns(now);
  refreshPlayerCosmetics(now);

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

    player.vx += direction.x * acceleration * dt;
    player.vy += direction.y * acceleration * dt;

    player.vx *= dragFactor;
    player.vy *= dragFactor;

    const speedSq = player.vx * player.vx + player.vy * player.vy;
    const maxSpeedSq = maxSpeed * maxSpeed;
    if (speedSq > maxSpeedSq) {
      const scaled = maxSpeed / Math.sqrt(speedSq);
      player.vx *= scaled;
      player.vy *= scaled;
    }
  }

  collectOrbs(activePlayers);

  for (const player of activePlayers) {
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const outsideArena =
      player.x < -60 || player.x > arena.width + 60 || player.y < -60 || player.y > arena.height + 60;
    if (outsideArena) {
      if (player.spawnProtectedUntil <= now) {
        knockOut(player);
        continue;
      }
      // Spawn-Schutz verzeiht aggressive Positionen kurz nach dem Respawn.
      player.vx *= 0.35;
      player.vy *= 0.35;
    }

    player.x = clamp(player.x, player.radius, arena.width - player.radius);
    player.y = clamp(player.y, player.radius, arena.height - player.radius);

  }

  resolveConsumptions(activePlayers, now);

  for (const player of activePlayers) {
    if (!player.alive) {
      continue;
    }
    if (player.spawnProtectedUntil > now) {
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
    arena,
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
