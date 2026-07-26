import { createServer, type ServerResponse } from "http";
import { createReadStream, existsSync, statSync } from "fs";
import path from "path";
import { Server } from "socket.io";
import type {
  ActiveMatchEventSnapshot,
  ArenaState,
  ChainShotPayload,
  ClientToServerEvents,
  DebugPongPayload,
  ForceOrb,
  GameSnapshot,
  LeaderboardEntry,
  MatchEventKind,
  PlayerSnapshot,
  RocketShotPayload,
  SnapshotDebugInfo,
  ServerToClientEvents,
} from "@projekt/shared";

import {
  PORT,
  TICK_RATE,
  SNAPSHOT_RATE_IDLE,
  SNAPSHOT_RATE_COMBAT,
  LEADERBOARD_RATE_IDLE,
  LEADERBOARD_RATE_COMBAT,
  DT,
  FIXED_STEP_MS,
  SIM_LOOP_INTERVAL_MS,
  MAX_SIM_STEPS_PER_FRAME,
  PLAYER_START_MASS,
  PLAYER_DRAG,
  SPEED_BOOST_MULTIPLIER,
  SPEED_BOOST_TOP_SPEED_MULTIPLIER,
  RESPAWN_TIME_MS,
  SPAWN_PROTECTION_MS,
  SPAWN_SAFE_PLAYER_DISTANCE,
  SPAWN_SAFE_HAZARD_DISTANCE,
  SPAWN_ATTEMPTS,
  TARGET_BOT_COUNT,
  BOT_ONLY_RESET_THRESHOLD_MS,
  ORB_SPAWN_INTERVAL_MS_FAST,
  ORB_BASE_COUNT,
  ORB_PER_ACTIVE_PLAYER,
  ORB_MIN_COUNT,
  ORB_MAX_COUNT,
  ORB_RADIUS,
  SCORE_DROP_ORB_RADIUS,
  SCORE_DROP_SPREAD_RADIUS,
  SPECIAL_PICKUP_RADIUS,
  ROCKET_PICKUP_RADIUS,
  ROCKET_HIT_PADDING,
  SPECIAL_SPEED_DURATION_MS,
  SPECIAL_SHIELD_DURATION_MS,
  SPECIAL_STEALTH_DURATION_MS,
  SHOCK_EDGE_RANGE,
  SHOCK_STUN_MS,
  SHOCK_COOLDOWN_MS,
  CHAIN_EDGE_RANGE,
  CHAIN_STUN_MS,
  CHAIN_SCORE_BONUS,
  BOT_SHOCK_COOLDOWN_MULTIPLIER,
  SHOCK_SCORE_BONUS,
  KILL_MASS_BONUS,
  CONSUME_MASS_GAIN,
  PASSIVE_MASS_GAIN_PER_SEC,
  BOUNTY_ROTATE_INTERVAL_MS,
  BOUNTY_MIN_PLAYERS,
  BOUNTY_BONUS_POINTS_BASE,
  BOUNTY_BONUS_REFRESH_MS,
  BOUNTY_BONUS_MASS,
  SPECIAL_BOUNTY_CHANCE,
  SPECIAL_BOUNTY_MIN_INTERVAL_MS,
  SPECIAL_BOUNTY_INITIAL_DELAY_MS,
  MATCH_EVENT_INTERVAL_MS,
  MATCH_EVENT_DURATION_MS,
  EVENT_HASTE_SPEED_MULTIPLIER,
  EVENT_DOUBLE_ORB_MULTIPLIER,
  AI_SEPARATION_RADIUS,
  AI_SEPARATION_RADIUS_SQ,
  AI_DANGER_SCAN_RADIUS,
  AI_DANGER_MASS_RATIO,
  AI_RETREAT_DURATION_MS,
  AI_LOOKAHEAD_MAX_SECONDS,
  AI_BOT_TARGET_BONUS,
  AI_HUMAN_TARGET_BONUS,
  AI_PREY_PULL_RANGE_BASE,
  DEFAULT_PLAYER_COLOR,
  BOT_PLAYER_COLOR,
} from "./config";

// Reine Spiellogik liegt in ./game — dort ohne Server-, Socket- oder
// Timer-Abhaengigkeiten und damit direkt per Unit-Test pruefbar.
import {
  clampBountyReward,
  computeSpecialBountyReward,
  computeStandardBountyReward,
} from "./game/bounty";
import {
  canChainTarget,
  canConsumeTarget,
  canShockTarget,
  findProjectileHit,
  hasSpeedBoost,
  hasStealth,
  isProtectedFromKnockOut,
  isWithinConsumeRange,
  isWithinShockEdgeRange,
} from "./game/combat";
import {
  distanceToNearestHazard,
  edgeRepulsion,
  findDeadlyHazard,
  hazardCenter,
  hazardRepulsion,
  isPointInHazard,
  nearestHazardCenter,
  rayDistanceToArenaEdge,
} from "./game/hazards";
import { buildLeaderboardEntries, filterLeaderboardForClient } from "./game/leaderboard";
import { accelerationForMass, clamp, massToRadius, maxSpeedForMass, normalize } from "./game/math";
import { MIN_PLAYER_NAME_LENGTH, pickBotName, sanitizePlayerName } from "./game/names";
import { OrbGrid } from "./game/orbGrid";
import {
  radiusForPickupKind,
  rollOrbValue,
  rollPickupKind,
  splitScoreIntoOrbValues,
} from "./game/pickups";
import { createStreamState, diffSnapshot, type StreamState } from "./game/snapshot";
import type { ServerPlayer } from "./game/types";

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

interface ActiveMatchEventState {
  kind: MatchEventKind;
  title: string;
  description: string;
  endsAt: number;
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
  width: 4200,
  height: 2600,
  hazards: [
    { id: "pit-central", type: "pit", x: 1875, y: 1120, width: 300, height: 220 },
    { id: "pit-north-west", type: "pit", x: 760, y: 370, width: 250, height: 190 },
    { id: "pit-south-east", type: "pit", x: 3000, y: 1820, width: 260, height: 200 },
  ],
};

// --- Spatial grid for orb lookups ---
const GRID_CELL = 100;
const orbGrid = new OrbGrid(arena.width, arena.height, GRID_CELL);

function orbGridInsert(orb: ForceOrb): void {
  orbGrid.insert(orb.id, orb.x, orb.y);
}

function orbGridRemove(orb: ForceOrb): void {
  orbGrid.remove(orb.id, orb.x, orb.y);
}

const players = new Map<string, ServerPlayer>();
const pickups = new Map<string, ForceOrb>();
const streamStates = new Map<string, StreamState>();

let tick = 0;
let lastSnapshotAt = 0;
let lastLeaderboardAt = 0;
let leaderboardCache: LeaderboardEntry[] = [];
let botCounter = 1;

function nextBotName(): string {
  const usedNames = new Set(
    Array.from(players.values())
      .filter((p) => p.isBot)
      .map((p) => p.name),
  );
  return pickBotName(usedNames, botCounter);
}
let orbCounter = 1;
let lastOrbSpawnAt = 0;
let lastTickDurationMs = 0;
let currentSnapshotRate = SNAPSHOT_RATE_IDLE;
let currentLeaderboardRate = LEADERBOARD_RATE_IDLE;
let combatBoostUntil = 0;
let loopAccumulatorMs = 0;
let lastLoopAt = Date.now();
let bountyTargetId: string | null = null;
let bountyBonusPoints = BOUNTY_BONUS_POINTS_BASE;
let bountyVolatility = 0;
let lastBountyBonusRefreshAt = Date.now();
let bountyNextRotateAt = Date.now() + 8_000;
let lastRealPlayerAt = Date.now(); // Serverstart zählt als letzter Real-Player-Zeitpunkt, sonst greift der Bot-Reset nach einem Neustart nie
let specialBountyActive = false;
let specialBountyNextEligibleAt = Date.now() + SPECIAL_BOUNTY_INITIAL_DELAY_MS;
let currentEvent: ActiveMatchEventState = {
  kind: "none",
  title: "Kein Event",
  description: "",
  endsAt: 0,
};
let nextEventAt = Date.now() + 28_000;

function randomSpawn() {
  return {
    x: 180 + Math.random() * (arena.width - 360),
    y: 140 + Math.random() * (arena.height - 280),
  };
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
    if (isPointInHazard(arena.hazards, candidate.x, candidate.y)) {
      continue;
    }

    const playerDistance = distanceToNearestAlivePlayer(candidate.x, candidate.y, excludeId);
    const hazardDistance = distanceToNearestHazard(arena.hazards, candidate.x, candidate.y);

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

function baseColorForPlayer(player: ServerPlayer): number {
  return player.isBot ? BOT_PLAYER_COLOR : DEFAULT_PLAYER_COLOR;
}

function toPlayerSnapshot(player: ServerPlayer, now: number): PlayerSnapshot {
  return {
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
    speedBoostMsLeft: Math.max(0, player.speedBoostUntil - now),
    invulnerableMsLeft: Math.max(0, player.invulnerableUntil - now),
    stealthMsLeft: Math.max(0, player.stealthUntil - now),
    stunnedMsLeft: Math.max(0, player.stunnedUntil - now),
    shockCooldownMsLeft: Math.max(0, player.shockCooldownUntil - now),
    rocketAmmo: player.rocketAmmo,
    chainAmmo: player.chainAmmo,
    mass: player.mass,
    score: player.score,
    isBot: player.isBot,
    alive: player.alive,
  };
}

function adaptiveOrbCap(): number {
  let activePlayers = 0;
  for (const player of players.values()) {
    if (player.alive) {
      activePlayers += 1;
    }
  }

  const target = ORB_BASE_COUNT + activePlayers * ORB_PER_ACTIVE_PLAYER;
  return clamp(target, ORB_MIN_COUNT, ORB_MAX_COUNT);
}

function hasActiveCombat(playersList: ServerPlayer[], now: number): boolean {
  if (combatBoostUntil > now) {
    return true;
  }

  for (let i = 0; i < playersList.length; i += 1) {
    const a = playersList[i];
    if (!a.alive) {
      continue;
    }

    for (let j = i + 1; j < playersList.length; j += 1) {
      const b = playersList[j];
      if (!b.alive) {
        continue;
      }
      if (a.spawnProtectedUntil > now || b.spawnProtectedUntil > now) {
        continue;
      }

      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const engageRadius = a.radius + b.radius + 130;
      if (dx * dx + dy * dy > engageRadius * engageRadius) {
        continue;
      }

      const bigger = Math.max(a.mass, b.mass);
      const smaller = Math.max(1, Math.min(a.mass, b.mass));
      if (bigger / smaller >= 1.08) {
        return true;
      }
    }
  }

  return false;
}

function currentEventOrbMultiplier(): number {
  return currentEvent.kind === "double_orbs" ? EVENT_DOUBLE_ORB_MULTIPLIER : 1;
}

function currentEventSpeedMultiplier(): number {
  return currentEvent.kind === "haste" ? EVENT_HASTE_SPEED_MULTIPLIER : 1;
}

function currentBountyRewardPoints(): number {
  return clampBountyReward(bountyBonusPoints, specialBountyActive);
}

function largestAlivePlayerByMass(): ServerPlayer | null {
  let best: ServerPlayer | null = null;
  for (const player of players.values()) {
    if (!player.alive) {
      continue;
    }
    if (!best || player.mass > best.mass || (player.mass === best.mass && player.score > best.score)) {
      best = player;
    }
  }
  return best;
}

function specialBountyRewardPointsFromLargestPlayer(): number {
  return computeSpecialBountyReward(largestAlivePlayerByMass()?.score ?? null);
}

function activeAlivePlayerCount(): number {
  let count = 0;
  for (const player of players.values()) {
    if (player.alive) {
      count += 1;
    }
  }
  return count;
}

function computeDynamicBountyRewardPoints(target: ServerPlayer | null): number {
  if (specialBountyActive) {
    return specialBountyRewardPointsFromLargestPlayer();
  }

  return computeStandardBountyReward({
    alivePlayerCount: activeAlivePlayerCount(),
    targetMass: target?.mass ?? null,
    targetScore: target?.score ?? null,
    volatility: bountyVolatility,
    bountyRushActive: currentEvent.kind === "bounty_rush",
  });
}

function refreshBountyRewardPoints(target: ServerPlayer | null, now: number): void {
  bountyBonusPoints = computeDynamicBountyRewardPoints(target);
  lastBountyBonusRefreshAt = now;
}

function bountyRotateIntervalMs(): number {
  return currentEvent.kind === "bounty_rush" ? 12_000 : BOUNTY_ROTATE_INTERVAL_MS;
}

function currentEventSnapshot(now: number): ActiveMatchEventSnapshot {
  if (currentEvent.kind === "none") {
    return {
      kind: "none",
      title: "Kein Event",
      description: "",
      msLeft: 0,
    };
  }

  return {
    kind: currentEvent.kind,
    title: currentEvent.title,
    description: currentEvent.description,
    msLeft: Math.max(0, currentEvent.endsAt - now),
  };
}

function chooseRandomEventKind(): MatchEventKind {
  const pool: MatchEventKind[] = ["double_orbs", "haste", "bounty_rush"];
  return pool[Math.floor(Math.random() * pool.length)] ?? "double_orbs";
}

function startMatchEvent(kind: MatchEventKind, now: number): void {
  if (kind === "double_orbs") {
    currentEvent = {
      kind,
      title: "ORB-SCHUB",
      description: "Mass-Orbs bringen doppelte Masse.",
      endsAt: now + MATCH_EVENT_DURATION_MS,
    };
  } else if (kind === "haste") {
    currentEvent = {
      kind,
      title: "HASTE",
      description: "Alle bewegen sich schneller.",
      endsAt: now + MATCH_EVENT_DURATION_MS,
    };
  } else {
    currentEvent = {
      kind: "bounty_rush",
      title: "BOUNTY RUSH",
      description: "Kopfgeld-Kills geben mehr Punkte.",
      endsAt: now + MATCH_EVENT_DURATION_MS,
    };
  }

  const currentTarget = bountyTargetId ? players.get(bountyTargetId) ?? null : null;
  if (currentTarget && currentTarget.alive) {
    refreshBountyRewardPoints(currentTarget, now);
  }
}

function clearMatchEvent(now: number): void {
  currentEvent = {
    kind: "none",
    title: "Kein Event",
    description: "",
    endsAt: 0,
  };
  const currentTarget = bountyTargetId ? players.get(bountyTargetId) ?? null : null;
  if (currentTarget && currentTarget.alive) {
    refreshBountyRewardPoints(currentTarget, now);
  } else {
    bountyBonusPoints = BOUNTY_BONUS_POINTS_BASE;
  }
  nextEventAt = now + MATCH_EVENT_INTERVAL_MS;
}

function updateMatchEventState(now: number): void {
  if (currentEvent.kind !== "none" && now >= currentEvent.endsAt) {
    clearMatchEvent(now);
  }

  if (currentEvent.kind === "none" && now >= nextEventAt) {
    startMatchEvent(chooseRandomEventKind(), now);
  }
}

function chooseRandomBountyTarget(excludeId?: string): ServerPlayer | null {
  const alivePlayers = Array.from(players.values()).filter((player) => player.alive);
  if (alivePlayers.length < BOUNTY_MIN_PLAYERS) {
    return null;
  }

  const eligiblePlayers = alivePlayers.filter((player) => !excludeId || player.id !== excludeId);
  if (eligiblePlayers.length === 0) {
    return null;
  }

  return eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)] ?? null;
}

function shouldActivateSpecialBounty(now: number): boolean {
  if (now < specialBountyNextEligibleAt) {
    return false;
  }
  return Math.random() < SPECIAL_BOUNTY_CHANCE;
}

function rotateRandomBounty(now: number, force = false): void {
  const currentTarget = bountyTargetId ? players.get(bountyTargetId) : undefined;
  const currentValid = Boolean(currentTarget?.alive);

  if (!force && currentValid && now < bountyNextRotateAt) {
    return;
  }

  const nextTarget = chooseRandomBountyTarget(force ? bountyTargetId ?? undefined : undefined);
  if (!nextTarget) {
    bountyTargetId = null;
    specialBountyActive = false;
    bountyVolatility = 0;
    bountyBonusPoints = BOUNTY_BONUS_POINTS_BASE;
    lastBountyBonusRefreshAt = now;
    bountyNextRotateAt = now + bountyRotateIntervalMs();
    return;
  }

  bountyTargetId = nextTarget.id;
  specialBountyActive = shouldActivateSpecialBounty(now);
  if (specialBountyActive) {
    specialBountyNextEligibleAt = now + SPECIAL_BOUNTY_MIN_INTERVAL_MS;
  }
  bountyVolatility = Math.floor(Math.random() * 11) - 5;
  refreshBountyRewardPoints(nextTarget, now);
  bountyNextRotateAt = now + bountyRotateIntervalMs();
}

function updateBountyState(now: number): void {
  const currentTarget = bountyTargetId ? players.get(bountyTargetId) : undefined;
  const targetValid = Boolean(currentTarget?.alive);

  if (!targetValid) {
    rotateRandomBounty(now, true);
    return;
  }

  if (now - lastBountyBonusRefreshAt >= BOUNTY_BONUS_REFRESH_MS) {
    refreshBountyRewardPoints(currentTarget ?? null, now);
  }

  rotateRandomBounty(now, false);
}

function visiblePlayersForClient(localPlayer: ServerPlayer, now: number): PlayerSnapshot[] {
  const result: PlayerSnapshot[] = [];

  for (const candidate of players.values()) {
    if (!candidate.alive && candidate.id !== localPlayer.id) {
      continue;
    }

    if (candidate.id !== localPlayer.id && hasStealth(candidate, now)) {
      continue;
    }

    result.push(toPlayerSnapshot(candidate, now));
  }

  return result;
}

function visiblePickupsForClient(localPlayer: ServerPlayer): ForceOrb[] {
  void localPlayer;
  return Array.from(pickups.values());
}

function buildClientSnapshot(
  localPlayer: ServerPlayer,
  now: number,
  leaderboard: LeaderboardEntry[],
  debug: SnapshotDebugInfo,
  streamState: StreamState,
  forceFull = false,
): GameSnapshot | null {
  const visiblePlayers = visiblePlayersForClient(localPlayer, now);
  const visiblePickups = visiblePickupsForClient(localPlayer);
  const activeEvent = currentEventSnapshot(now);
  const metaSignature = [
    bountyTargetId ?? "",
    currentBountyRewardPoints(),
    specialBountyActive ? 1 : 0,
    activeEvent.kind,
    Math.ceil(activeEvent.msLeft / 1000),
  ].join("|");

  const diff = diffSnapshot(streamState, visiblePlayers, visiblePickups, metaSignature, now, forceFull);
  if (!diff) {
    return null;
  }

  return {
    tick,
    serverTime: now,
    full: diff.full,
    players: diff.players,
    pickups: diff.pickups,
    removedPlayerIds: diff.removedPlayerIds,
    removedPickupIds: diff.removedPickupIds,
    leaderboard,
    bountyTargetId,
    bountyBonus: currentBountyRewardPoints(),
    specialBountyActive,
    activeEvent,
    debug,
  };
}

function emitSnapshots(now: number, leaderboard: LeaderboardEntry[], debug: SnapshotDebugInfo): void {

  for (const [socketId, socket] of io.sockets.sockets) {
    const localPlayer = players.get(socketId);
    if (!localPlayer) {
      continue;
    }

    let streamState = streamStates.get(socketId);
    if (!streamState) {
      streamState = createStreamState();
      streamStates.set(socketId, streamState);
    }

    const filteredLeaderboard = filterLeaderboardForClient(localPlayer.id, leaderboard, players, now);
    const snapshot = buildClientSnapshot(localPlayer, now, filteredLeaderboard, debug, streamState);
    if (snapshot) {
      socket.emit("snapshot", snapshot);
    }
  }
}

function createPlayer(id: string, name: string, isBot: boolean): ServerPlayer {
  const now = Date.now();
  const spawn = findSafeSpawn(id);
  const baseColor = isBot ? BOT_PLAYER_COLOR : DEFAULT_PLAYER_COLOR;
  const aiAggression = isBot ? 0.72 + Math.random() * 0.7 : 1;
  const aiGreed = isBot ? 0.75 + Math.random() * 0.6 : 1;
  const aiCaution = isBot ? 0.78 + Math.random() * 0.7 : 1;
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: massToRadius(PLAYER_START_MASS),
    color: baseColor,
    skinId: "starter",
    mass: PLAYER_START_MASS,
    score: 0,
    isBot,
    alive: true,
    respawnAt: 0,
    connectedAt: now,
    spawnedAt: now,
    spawnProtectedUntil: now + SPAWN_PROTECTION_MS,
    speedBoostUntil: 0,
    invulnerableUntil: 0,
    stealthUntil: 0,
    stunnedUntil: 0,
    shockCooldownUntil: 0,
    rocketAmmo: 0,
    chainAmmo: 0,
    shockInputHeld: false,
    rocketInputHeld: false,
    chainInputHeld: false,
    lastInput: {
      seq: 0,
      up: false,
      down: false,
      left: false,
      right: false,
      ability: false,
      rocketFire: false,
      chainFire: false,
      aimX: 1,
      aimY: 0,
    },
    aiDecisionAt: 0,
    aiTickPhase: Math.floor(Math.random() * 3),
    aiAggression,
    aiGreed,
    aiCaution,
    aiRetreatUntil: 0,
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
    speedBoostMsLeft: Math.max(0, player.speedBoostUntil - now),
    invulnerableMsLeft: Math.max(0, player.invulnerableUntil - now),
    stealthMsLeft: Math.max(0, player.stealthUntil - now),
    stunnedMsLeft: Math.max(0, player.stunnedUntil - now),
    shockCooldownMsLeft: Math.max(0, player.shockCooldownUntil - now),
    rocketAmmo: player.rocketAmmo,
    chainAmmo: player.chainAmmo,
    mass: player.mass,
    score: player.score,
    isBot: player.isBot,
    alive: player.alive,
  }));

  return {
    tick,
    serverTime: now,
    players: playerSnapshots,
    pickups: Array.from(pickups.values()),
    leaderboard: buildLeaderboardEntries(players.values()),
    bountyTargetId,
    bountyBonus: currentBountyRewardPoints(),
    specialBountyActive,
    activeEvent: currentEventSnapshot(now),
  };
}

function applyMass(player: ServerPlayer, amount: number): void {
  player.mass = Math.max(8, player.mass + amount);
  player.radius = massToRadius(player.mass);
}

function dropScoreOrbsAroundPoint(
  centerX: number,
  centerY: number,
  totalPoints: number,
  shellRadius: number,
): void {
  if (totalPoints <= 0) {
    return;
  }

  for (const value of splitScoreIntoOrbValues(totalPoints)) {
    const angle = Math.random() * Math.PI * 2;
    let distance = shellRadius + Math.random() * SCORE_DROP_SPREAD_RADIUS;
    let x = centerX + Math.cos(angle) * distance;
    let y = centerY + Math.sin(angle) * distance;
    let guard = 0;

    while (isPointInHazard(arena.hazards, x, y) && guard < 6) {
      distance += 22;
      x = centerX + Math.cos(angle) * distance;
      y = centerY + Math.sin(angle) * distance;
      guard += 1;
    }

    x = clamp(x, SCORE_DROP_ORB_RADIUS + 4, arena.width - SCORE_DROP_ORB_RADIUS - 4);
    y = clamp(y, SCORE_DROP_ORB_RADIUS + 4, arena.height - SCORE_DROP_ORB_RADIUS - 4);

    const orb: ForceOrb = {
      id: `orb-${orbCounter++}`,
      kind: "score",
      x,
      y,
      radius: SCORE_DROP_ORB_RADIUS,
      value,
    };
    pickups.set(orb.id, orb);
    orbGridInsert(orb);
  }
}

function dropScoreOrbsFromPit(hazard: ArenaState["hazards"][number], totalPoints: number): void {
  const center = hazardCenter(hazard);
  const shellRadius = Math.max(hazard.width, hazard.height) * 0.5 + 16;
  dropScoreOrbsAroundPoint(center.x, center.y, totalPoints, shellRadius);
}

function dropScoreOrbsFromRocketKill(victim: ServerPlayer, totalPoints: number): void {
  const shellRadius = Math.max(victim.radius + 18, 42);
  dropScoreOrbsAroundPoint(victim.x, victim.y, totalPoints, shellRadius);
}

function clearScoreDropOrbs(): void {
  for (const orb of Array.from(pickups.values())) {
    if (orb.kind === "score") {
      orbGridRemove(orb);
      pickups.delete(orb.id);
    }
  }
}

function tryShockNearestTarget(source: ServerPlayer, now: number): void {
  if (!source.alive || source.stunnedUntil > now || source.shockCooldownUntil > now) {
    return;
  }

  let bestTarget: ServerPlayer | undefined;
  let bestEdgeDistance = Number.POSITIVE_INFINITY;

  for (const candidate of players.values()) {
    if (!canShockTarget(source, candidate, now)) {
      continue;
    }

    const dx = candidate.x - source.x;
    const dy = candidate.y - source.y;
    const centerDistance = Math.hypot(dx, dy);
    const edgeDistance = centerDistance - (source.radius + candidate.radius);
    if (edgeDistance > SHOCK_EDGE_RANGE || edgeDistance >= bestEdgeDistance) {
      continue;
    }

    bestTarget = candidate;
    bestEdgeDistance = edgeDistance;
  }

  if (!bestTarget) {
    return;
  }

  bestTarget.stunnedUntil = Math.max(bestTarget.stunnedUntil, now + SHOCK_STUN_MS);
  bestTarget.vx = 0;
  bestTarget.vy = 0;
  bestTarget.lastThreatBy = source.id;

  const shockCooldownMs = source.isBot
    ? SHOCK_COOLDOWN_MS * BOT_SHOCK_COOLDOWN_MULTIPLIER
    : SHOCK_COOLDOWN_MS;
  source.shockCooldownUntil = now + shockCooldownMs;
  source.score += SHOCK_SCORE_BONUS;
  combatBoostUntil = Math.max(combatBoostUntil, now + 1800);
}

function canRocketTarget(source: ServerPlayer, target: ServerPlayer): boolean {
  if (source.id === target.id || !source.alive || !target.alive) {
    return false;
  }
  return true;
}

function rocketAimDirection(source: ServerPlayer): { x: number; y: number } {
  const aimDirection = normalize(source.lastInput.aimX, source.lastInput.aimY);
  if (aimDirection.length > 0) {
    return { x: aimDirection.x, y: aimDirection.y };
  }

  const inputX = (source.lastInput.right ? 1 : 0) - (source.lastInput.left ? 1 : 0);
  const inputY = (source.lastInput.down ? 1 : 0) - (source.lastInput.up ? 1 : 0);
  const inputDirection = normalize(inputX, inputY);
  if (inputDirection.length > 0) {
    return { x: inputDirection.x, y: inputDirection.y };
  }

  const velocityDirection = normalize(source.vx, source.vy);
  if (velocityDirection.length > 0) {
    return { x: velocityDirection.x, y: velocityDirection.y };
  }

  return { x: 1, y: 0 };
}

function tryFireRocketAtNearestTarget(source: ServerPlayer, now: number): void {
  if (!source.alive || source.rocketAmmo <= 0 || source.stunnedUntil > now) {
    return;
  }

  const direction = rocketAimDirection(source);
  const maxDistance = rayDistanceToArenaEdge(
    arena.width,
    arena.height,
    source.x,
    source.y,
    direction.x,
    direction.y,
  );

  const hit = findProjectileHit(
    source,
    players.values(),
    direction,
    maxDistance,
    ROCKET_HIT_PADDING,
    (candidate) => canRocketTarget(source, candidate),
  );
  const bestTarget = hit?.target;

  source.rocketAmmo = Math.max(0, source.rocketAmmo - 1);

  const shotDistance = hit ? Math.max(0, hit.distance) : Math.max(0, maxDistance);
  const rocketShotPayload: RocketShotPayload = {
    shooterId: source.id,
    fromX: source.x,
    fromY: source.y,
    toX: clamp(source.x + direction.x * shotDistance, 0, arena.width),
    toY: clamp(source.y + direction.y * shotDistance, 0, arena.height),
    hitPlayerId: bestTarget?.id,
    serverTime: now,
  };
  io.emit("rocketShot", rocketShotPayload);

  if (!bestTarget) {
    return;
  }

  bestTarget.lastThreatBy = source.id;
  knockOut(bestTarget, source.id, "rocket");
  combatBoostUntil = Math.max(combatBoostUntil, now + 2400);
}

function tryFireChainAtNearestTarget(source: ServerPlayer, now: number): void {
  if (!source.alive || source.chainAmmo <= 0 || source.stunnedUntil > now) {
    return;
  }

  const direction = rocketAimDirection(source);
  const maxDistance = rayDistanceToArenaEdge(
    arena.width,
    arena.height,
    source.x,
    source.y,
    direction.x,
    direction.y,
  );

  const hit = findProjectileHit(
    source,
    players.values(),
    direction,
    maxDistance,
    CHAIN_EDGE_RANGE * 0.02,
    (candidate) => canChainTarget(source, candidate, now),
  );
  const bestTarget = hit?.target;

  source.chainAmmo = Math.max(0, source.chainAmmo - 1);

  const shotDistance = hit ? Math.max(0, hit.distance) : Math.max(0, maxDistance);
  const chainShotPayload: ChainShotPayload = {
    shooterId: source.id,
    fromX: source.x,
    fromY: source.y,
    toX: clamp(source.x + direction.x * shotDistance, 0, arena.width),
    toY: clamp(source.y + direction.y * shotDistance, 0, arena.height),
    hitPlayerId: bestTarget?.id,
    serverTime: now,
  };
  io.emit("chainShot", chainShotPayload);

  if (!bestTarget) {
    return;
  }

  bestTarget.stunnedUntil = Math.max(bestTarget.stunnedUntil, now + CHAIN_STUN_MS);
  bestTarget.vx = 0;
  bestTarget.vy = 0;
  bestTarget.lastThreatBy = source.id;
  source.score += CHAIN_SCORE_BONUS;
  combatBoostUntil = Math.max(combatBoostUntil, now + 1600);
}

function knockOut(
  victim: ServerPlayer,
  actorId?: string,
  reason: "ringout" | "consume" | "pit" | "rocket" = "ringout",
  sourceHazard?: ArenaState["hazards"][number],
): void {
  if (!victim.alive) {
    return;
  }

  const victimPoints = Math.max(0, victim.score);
  victim.score = 0;

  victim.alive = false;
  victim.vx = 0;
  victim.vy = 0;
  victim.speedBoostUntil = 0;
  victim.invulnerableUntil = 0;
  victim.stealthUntil = 0;
  victim.stunnedUntil = 0;
  victim.rocketAmmo = 0;
  victim.chainAmmo = 0;
  victim.shockInputHeld = false;
  victim.rocketInputHeld = false;
  victim.chainInputHeld = false;
  victim.respawnAt = Date.now() + RESPAWN_TIME_MS;

  applyMass(victim, -Math.max(0.6, victim.mass * 0.05));

  const scorerId = reason === "pit" || reason === "rocket" ? undefined : actorId ?? victim.lastThreatBy;
  let scorer: ServerPlayer | undefined;
  if (scorerId && scorerId !== victim.id) {
    scorer = players.get(scorerId);
    if (scorer) {
      scorer.score += victimPoints;
      if (reason === "consume") {
        applyMass(scorer, Math.max(2, victim.mass * CONSUME_MASS_GAIN));
      } else {
        applyMass(scorer, KILL_MASS_BONUS + victim.mass * 0.05);
      }
    }
  }

  if (reason === "pit" && sourceHazard?.type === "pit") {
    dropScoreOrbsFromPit(sourceHazard, victimPoints);
  } else if (reason === "rocket") {
    dropScoreOrbsFromRocketKill(victim, victimPoints);
  }

  if (victim.id === bountyTargetId) {
    if (scorer && scorer.alive) {
      scorer.score += currentBountyRewardPoints();
      applyMass(scorer, BOUNTY_BONUS_MASS);
    }
    rotateRandomBounty(Date.now(), true);
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

      if (!isWithinConsumeRange(eater, victim)) {
        continue;
      }

      victim.lastThreatBy = eater.id;
      knockOut(victim, eater.id, "consume");
      combatBoostUntil = Math.max(combatBoostUntil, now + 2200);
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
    player.mass = PLAYER_START_MASS;
    player.radius = massToRadius(PLAYER_START_MASS);
    player.score = 0;
    player.alive = true;
    player.spawnedAt = now;
    player.spawnProtectedUntil = now + SPAWN_PROTECTION_MS;
    player.skinId = "starter";
    player.color = baseColorForPlayer(player);
    player.speedBoostUntil = 0;
    player.invulnerableUntil = 0;
    player.stealthUntil = 0;
    player.stunnedUntil = 0;
    player.rocketAmmo = 0;
    player.chainAmmo = 0;
    player.shockInputHeld = false;
    player.rocketInputHeld = false;
    player.chainInputHeld = false;
    player.lastThreatBy = undefined;
  }
}

function spawnOrb(now: number): void {
  if (pickups.size >= adaptiveOrbCap() || now - lastOrbSpawnAt < ORB_SPAWN_INTERVAL_MS_FAST) {
    return;
  }

  let spawn = randomSpawn();
  let safety = 0;
  while (isPointInHazard(arena.hazards, spawn.x, spawn.y) && safety < 20) {
    spawn = randomSpawn();
    safety += 1;
  }

  const id = `orb-${orbCounter++}`;
  const kind = rollPickupKind(Math.random(), Math.random());

  const orb: ForceOrb = {
    id,
    kind,
    x: spawn.x,
    y: spawn.y,
    radius: radiusForPickupKind(kind),
    value: rollOrbValue(kind),
  };
  pickups.set(id, orb);
  orbGridInsert(orb);
  lastOrbSpawnAt = now;
}

function collectOrbs(playersList: ServerPlayer[], now: number): void {
  const orbMultiplier = currentEventOrbMultiplier();

  for (const player of playersList) {
    const maxPickupDist = player.radius + Math.max(ORB_RADIUS, SPECIAL_PICKUP_RADIUS, ROCKET_PICKUP_RADIUS);

    for (const cell of orbGrid.cellsNear(player.x, player.y, maxPickupDist)) {
      for (const orbId of cell) {
        const orb = pickups.get(orbId);
        if (!orb) { cell.delete(orbId); continue; }
        const dx = player.x - orb.x;
        const dy = player.y - orb.y;
        const pickupDist = player.radius + orb.radius;
        if (dx * dx + dy * dy > pickupDist * pickupDist) continue;

        if (orb.kind === "mass") {
          const catchUpBonus = player.mass < 26 ? 1.3 : player.mass < 34 ? 1.15 : 1;
          applyMass(player, orb.value * catchUpBonus * orbMultiplier);
          player.score += Math.max(1, Math.round(orb.value * 1.4 * orbMultiplier));
        } else if (orb.kind === "score") {
          player.score += Math.max(1, Math.round(orb.value));
          applyMass(player, Math.max(0.8, orb.value * 0.12));
        } else if (orb.kind === "speed") {
          player.speedBoostUntil = Math.max(player.speedBoostUntil, now + SPECIAL_SPEED_DURATION_MS);
          player.score += 3;
        } else if (orb.kind === "shield") {
          player.invulnerableUntil = Math.max(
            player.invulnerableUntil,
            now + SPECIAL_SHIELD_DURATION_MS,
          );
          player.score += 3;
        } else if (orb.kind === "stealth") {
          player.stealthUntil = Math.max(player.stealthUntil, now + SPECIAL_STEALTH_DURATION_MS);
          player.score += 3;
        } else if (orb.kind === "rocket") {
          player.rocketAmmo = Math.min(1, player.rocketAmmo + 1);
          player.score += 6;
        } else if (orb.kind === "chain") {
          player.chainAmmo = Math.min(1, player.chainAmmo + 1);
          player.score += 5;
        }

        cell.delete(orbId);
        pickups.delete(orbId);
      }
    }
  }
}

function runAi(now: number): void {
  const list = Array.from(players.values());
  const orbs = Array.from(pickups.values());
  const arenaCenter = { x: arena.width / 2, y: arena.height / 2 };
  const bountyTarget = bountyTargetId ? players.get(bountyTargetId) : undefined;

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
      if (!cached || !cached.alive || !canConsumeTarget(bot, cached, now)) {
        bot.aiTargetId = undefined;
        bot.aiTargetKind = undefined;
        bot.aiDecisionAt = 0;
      }
    }

    let nearestThreat: ServerPlayer | undefined;
    let nearestThreatDist = Number.POSITIVE_INFINITY;
    let bestPrey: ServerPlayer | undefined;
    let bestPreyScore = Number.NEGATIVE_INFINITY;
    let bestOrb: ForceOrb | undefined;
    let bestOrbScore = Number.NEGATIVE_INFINITY;

    if (now >= bot.aiDecisionAt) {
      for (const candidate of list) {
        if (candidate.id === bot.id || !candidate.alive) {
          continue;
        }

        const dx = candidate.x - bot.x;
        const dy = candidate.y - bot.y;
        const distance = Math.hypot(dx, dy);

        if (
          distance <= AI_DANGER_SCAN_RADIUS &&
          candidate.mass >= bot.mass * AI_DANGER_MASS_RATIO &&
          canConsumeTarget(candidate, bot, now)
        ) {
          if (distance < nearestThreatDist) {
            nearestThreat = candidate;
            nearestThreatDist = distance;
          }
        }

        if (!canConsumeTarget(bot, candidate, now)) {
          continue;
        }

        const massAdvantage = bot.mass / Math.max(1, candidate.mass);
        const bountyBoost = candidate.id === bountyTarget?.id ? 52 : 0;
        const targetTypeBoost = candidate.isBot ? AI_BOT_TARGET_BONUS : AI_HUMAN_TARGET_BONUS;
        const distancePenalty =
          distance * ((candidate.isBot ? 0.044 : 0.055) + 0.011 * bot.aiCaution);
        const preyScore =
          massAdvantage * 60 * bot.aiAggression +
          bountyBoost +
          targetTypeBoost -
          distancePenalty;

        if (preyScore > bestPreyScore) {
          bestPreyScore = preyScore;
          bestPrey = candidate;
        }
      }

      const dangerRadius = (170 + bot.radius * 2.5) * bot.aiCaution;
      const threatIsClose = Boolean(nearestThreat && nearestThreatDist <= dangerRadius);
      if (threatIsClose) {
        bot.aiRetreatUntil = now + AI_RETREAT_DURATION_MS + Math.random() * 260;
      }

      const retreating = bot.aiRetreatUntil > now;

      for (const orb of orbs) {
        const dx = orb.x - bot.x;
        const dy = orb.y - bot.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > AI_DANGER_SCAN_RADIUS * AI_DANGER_SCAN_RADIUS) {
          continue;
        }

        const distance = Math.sqrt(distSq);
        let utility = 0;
        if (orb.kind === "mass") {
          utility = (12 + orb.value * 1.9) * bot.aiGreed;
          if (bot.mass < 24) {
            utility *= 1.16;
          }
        } else if (orb.kind === "speed") {
          utility = retreating ? 88 : 34;
        } else if (orb.kind === "shield") {
          utility = retreating ? 96 : 38;
        } else if (orb.kind === "rocket") {
          const hasAmmo = bot.rocketAmmo > 0;
          utility = hasAmmo ? 10 : retreating ? 112 : 58;
        } else {
          utility = retreating ? 74 : 30;
        }

        const hazardDistance = distanceToNearestHazard(arena.hazards, orb.x, orb.y);
        const hazardPenalty = hazardDistance < 42 ? 0.62 : hazardDistance < 80 ? 0.82 : 1;
        const chasePenalty =
          retreating && nearestThreat
            ? clamp(Math.hypot(orb.x - nearestThreat.x, orb.y - nearestThreat.y) / 220, 0.5, 1.25)
            : 1;
        const orbScore = (utility * hazardPenalty * chasePenalty) / (0.4 + distance / 170);

        if (orbScore > bestOrbScore) {
          bestOrbScore = orbScore;
          bestOrb = orb;
        }
      }

      const shouldRetreat = retreating && Boolean(nearestThreat);
      const requiredPreyScore =
        bestPrey?.isBot
          ? 14 - 7 * bot.aiAggression
          : 20 - 8 * bot.aiAggression;
      const canPressurePrey = Boolean(bestPrey && bestPreyScore >= requiredPreyScore);

      if (shouldRetreat) {
        if (bestOrb && (bestOrb.kind !== "mass" || bestOrbScore > 26)) {
          bot.aiTargetKind = "orb";
          bot.aiTargetId = bestOrb.id;
        } else {
          bot.aiTargetId = undefined;
          bot.aiTargetKind = undefined;
        }
        bot.aiDecisionAt = now + 120 + Math.random() * 120;
      } else if (canPressurePrey && bestPrey) {
        bot.aiTargetKind = "player";
        bot.aiTargetId = bestPrey.id;
        bot.aiDecisionAt = now + 220 + Math.random() * 200;
      } else if (bestOrb) {
        bot.aiTargetKind = "orb";
        bot.aiTargetId = bestOrb.id;
        bot.aiDecisionAt = now + 260 + Math.random() * 260;
      } else {
        bot.aiTargetId = undefined;
        bot.aiTargetKind = undefined;
        bot.aiDecisionAt = now + 300 + Math.random() * 300;
      }
    }

    const currentlyRetreating = bot.aiRetreatUntil > now;
    let targetX = arenaCenter.x;
    let targetY = arenaCenter.y;

    if (currentlyRetreating && nearestThreat) {
      const away = normalize(bot.x - nearestThreat.x, bot.y - nearestThreat.y);
      const lateral = normalize(-away.y, away.x);
      const lateralSign = bot.aiAggression >= 1 ? 1 : -1;
      targetX = bot.x + away.x * 360 + lateral.x * lateralSign * 90;
      targetY = bot.y + away.y * 360 + lateral.y * lateralSign * 90;
    } else if (bot.aiTargetKind === "player" && bot.aiTargetId) {
      const target = players.get(bot.aiTargetId);
      if (target && target.alive) {
        const distance = Math.hypot(target.x - bot.x, target.y - bot.y);
        const leadTime = clamp(distance / 620, 0.08, AI_LOOKAHEAD_MAX_SECONDS);
        const predictedX = target.x + target.vx * leadTime;
        const predictedY = target.y + target.vy * leadTime;

        const hazard = nearestHazardCenter(arena.hazards, target.x, target.y);
        const hazardDir = normalize(hazard.x - target.x, hazard.y - target.y);
        const trapOffset = 86 + 48 * bot.aiAggression;
        const trapPoint = {
          x: predictedX - hazardDir.x * trapOffset,
          y: predictedY - hazardDir.y * trapOffset,
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

    targetX = clamp(targetX, 26, arena.width - 26);
    targetY = clamp(targetY, 26, arena.height - 26);

    const toTarget = normalize(targetX - bot.x, targetY - bot.y);
    const edgeAvoid = edgeRepulsion(arena.width, arena.height, bot.x, bot.y);
    const hazardAvoid = hazardRepulsion(arena.hazards, bot.x, bot.y);

    let separationX = 0;
    let separationY = 0;
    let preyAttractX = 0;
    let preyAttractY = 0;
    let predatorAvoidX = 0;
    let predatorAvoidY = 0;
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
      separationX += dir.x * away * away * (other.isBot ? 0.72 : 1.05);
      separationY += dir.y * away * away * (other.isBot ? 0.72 : 1.05);

      if (canConsumeTarget(bot, other, now)) {
        const engageRange = AI_PREY_PULL_RANGE_BASE + bot.radius * 1.4;
        if (distance < engageRange) {
          const engage = 1 - distance / engageRange;
          const pullStrength = other.isBot ? 1.8 : 1.3;
          preyAttractX -= dir.x * engage * engage * pullStrength;
          preyAttractY -= dir.y * engage * engage * pullStrength;
        }
      }

      if (canConsumeTarget(other, bot, now)) {
        const threatRange = 300 + other.radius * 1.4;
        if (distance < threatRange) {
          const threatWeight = 1 - distance / threatRange;
          predatorAvoidX += dir.x * threatWeight * threatWeight * (other.isBot ? 2.6 : 3.2);
          predatorAvoidY += dir.y * threatWeight * threatWeight * (other.isBot ? 2.6 : 3.2);
        }
      }
    }

    const targetWeight = currentlyRetreating ? 0.75 : 1.18 + (bot.aiAggression - 1) * 0.35;
    const edgeWeight = 2.3 * bot.aiCaution;
    const hazardWeight = 2.6 * bot.aiCaution;
    const separationWeight = currentlyRetreating ? 2.9 : 2.3;
    const preyPullWeight = currentlyRetreating ? 0.35 : 2.15 * bot.aiAggression;
    const predatorWeight = currentlyRetreating ? 4.4 : 2.6;
    const desiredX =
      toTarget.x * targetWeight +
      edgeAvoid.x * edgeWeight +
      hazardAvoid.x * hazardWeight +
      separationX * separationWeight +
      preyAttractX * preyPullWeight +
      predatorAvoidX * predatorWeight;
    const desiredY =
      toTarget.y * targetWeight +
      edgeAvoid.y * edgeWeight +
      hazardAvoid.y * hazardWeight +
      separationY * separationWeight +
      preyAttractY * preyPullWeight +
      predatorAvoidY * predatorWeight;
    const move = normalize(desiredX, desiredY);
    const moveThreshold = currentlyRetreating ? 0.12 : 0.2;

    let shockThreatInRange = false;
    let shockPreyInRange = false;
    if (bot.shockCooldownUntil <= now && bot.stunnedUntil <= now) {
      for (const candidate of list) {
        if (candidate.id === bot.id) {
          continue;
        }
        if (!canShockTarget(bot, candidate, now)) {
          continue;
        }

        if (!isWithinShockEdgeRange(bot, candidate)) {
          continue;
        }

        if (canConsumeTarget(candidate, bot, now)) {
          shockThreatInRange = true;
          break;
        }

        if (canConsumeTarget(bot, candidate, now)) {
          shockPreyInRange = true;
        }
      }
    }
    const shouldUseShock = shockThreatInRange || (!currentlyRetreating && shockPreyInRange);

    let rocketTargetAvailable = false;
    if (bot.rocketAmmo > 0 && bot.stunnedUntil <= now) {
      for (const candidate of list) {
        if (candidate.id === bot.id) {
          continue;
        }
        if (!canRocketTarget(bot, candidate)) {
          continue;
        }
        rocketTargetAvailable = true;
        if (canConsumeTarget(candidate, bot, now)) {
          // Priorisiere defensive Raketen bei unmittelbarer Gefahr.
          break;
        }
      }
    }

    bot.lastInput = {
      ...bot.lastInput,
      up: move.y < -moveThreshold,
      down: move.y > moveThreshold,
      left: move.x < -moveThreshold,
      right: move.x > moveThreshold,
      ability: shouldUseShock,
      rocketFire: rocketTargetAvailable,
      chainFire: false,
      aimX: move.length > 0 ? move.x : bot.lastInput.aimX,
      aimY: move.length > 0 ? move.y : bot.lastInput.aimY,
    };
  }
}

function maintainBots(): void {
  const bots = Array.from(players.values()).filter((player) => player.isBot);
  const targetBots = TARGET_BOT_COUNT;

  if (bots.length < targetBots) {
    for (let i = bots.length; i < targetBots; i += 1) {
      const id = `bot-${botCounter++}`;
      players.set(id, createPlayer(id, nextBotName(), true));
    }
  } else if (bots.length > targetBots) {
    const removable = bots.slice(0, bots.length - targetBots);
    for (const bot of removable) {
      players.delete(bot.id);
      io.emit("playerLeft", { id: bot.id });
    }
  }
}

function tickSimulation(now: number, dt: number): void {
  tick += 1;
  const dragFactor = Math.pow(PLAYER_DRAG, dt / DT);

  maintainBots();
  updateMatchEventState(now);
  updateBountyState(now);
  spawnOrb(now);
  runAi(now);
  handleRespawns(now);

  const activePlayers = Array.from(players.values()).filter((player) => player.alive);

  for (const player of activePlayers) {
    const wantsShock = Boolean(player.lastInput.ability);
    if (wantsShock && !player.shockInputHeld) {
      tryShockNearestTarget(player, now);
    }
    player.shockInputHeld = wantsShock;

    const wantsRocket = Boolean(player.lastInput.rocketFire);
    if (wantsRocket && !player.rocketInputHeld) {
      tryFireRocketAtNearestTarget(player, now);
    }
    player.rocketInputHeld = wantsRocket;

    const wantsChain = Boolean(player.lastInput.chainFire);
    if (wantsChain && !player.chainInputHeld) {
      tryFireChainAtNearestTarget(player, now);
    }
    player.chainInputHeld = wantsChain;
  }

  const combatActive = hasActiveCombat(activePlayers, now);
  currentSnapshotRate = combatActive ? SNAPSHOT_RATE_COMBAT : SNAPSHOT_RATE_IDLE;
  currentLeaderboardRate = combatActive ? LEADERBOARD_RATE_COMBAT : LEADERBOARD_RATE_IDLE;

  if (
    leaderboardCache.length === 0 ||
    now - lastLeaderboardAt >= 1000 / currentLeaderboardRate
  ) {
    leaderboardCache = buildLeaderboardEntries(players.values());
    lastLeaderboardAt = now;
  }

  const eventSpeedMultiplier = currentEventSpeedMultiplier();
  for (const player of activePlayers) {
    const input = player.lastInput;
    const stunned = player.stunnedUntil > now;
    let inputX = 0;
    let inputY = 0;
    if (!stunned) {
      if (input.left) inputX -= 1;
      if (input.right) inputX += 1;
      if (input.up) inputY -= 1;
      if (input.down) inputY += 1;
    }

    const direction = normalize(inputX, inputY);
    const speedBoostActive = hasSpeedBoost(player, now);
    const boostAccelerationMultiplier = speedBoostActive ? SPEED_BOOST_MULTIPLIER : 1;
    const boostSpeedMultiplier = speedBoostActive ? SPEED_BOOST_TOP_SPEED_MULTIPLIER : 1;
    const acceleration =
      accelerationForMass(player.mass) * boostAccelerationMultiplier * eventSpeedMultiplier;
    const maxSpeed = maxSpeedForMass(player.mass) * boostSpeedMultiplier * eventSpeedMultiplier;

    player.vx += direction.x * acceleration * dt;
    player.vy += direction.y * acceleration * dt;

    player.vx *= dragFactor;
    player.vy *= dragFactor;

    if (stunned) {
      player.vx *= 0.2;
      player.vy *= 0.2;
    }

    const speedSq = player.vx * player.vx + player.vy * player.vy;
    const maxSpeedSq = maxSpeed * maxSpeed;
    if (speedSq > maxSpeedSq) {
      const scaled = maxSpeed / Math.sqrt(speedSq);
      player.vx *= scaled;
      player.vy *= scaled;
    }

    // Permanenter, sanfter Growth-Loop: Spieler werden auch ohne Orbs langsam groesser.
    applyMass(player, PASSIVE_MASS_GAIN_PER_SEC * dt);
  }

  collectOrbs(activePlayers, now);

  for (const player of activePlayers) {
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const outsideArena =
      player.x < -60 || player.x > arena.width + 60 || player.y < -60 || player.y > arena.height + 60;
    if (outsideArena) {
      if (!isProtectedFromKnockOut(player, now)) {
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
    if (isProtectedFromKnockOut(player, now)) {
      continue;
    }
    const hazard = findDeadlyHazard(arena.hazards, player.x, player.y, player.radius);
    if (hazard) {
      if (hazard.type === "pit") {
        knockOut(player, undefined, "pit", hazard);
      } else {
        knockOut(player);
      }
    }
  }

  lastTickDurationMs = Math.max(0, Date.now() - now);

  if (now - lastSnapshotAt >= 1000 / currentSnapshotRate) {
    const debugInfo: SnapshotDebugInfo = {
      serverTickMs: lastTickDurationMs,
      snapshotRate: currentSnapshotRate,
      leaderboardRate: currentLeaderboardRate,
      combatActive,
      orbCount: pickups.size,
      orbCap: adaptiveOrbCap(),
    };
    emitSnapshots(now, leaderboardCache, debugInfo);
    lastSnapshotAt = now;
  }
}

io.on("connection", (socket) => {
  const requestedName = sanitizePlayerName(socket.handshake.auth?.playerName);
  if (requestedName.length < MIN_PLAYER_NAME_LENGTH) {
    console.log(`[Server] Connection rejected (missing name): id=${socket.id}`);
    socket.disconnect(true);
    return;
  }

  console.log(`[Server] Player connected:    id=${socket.id}, name=${requestedName}`);

  const noRealPlayersActive = Array.from(players.values()).every((p) => p.isBot);
  if (
    noRealPlayersActive &&
    lastRealPlayerAt > 0 &&
    Date.now() - lastRealPlayerAt > BOT_ONLY_RESET_THRESHOLD_MS
  ) {
    console.log("[Server] Lange kein echter Spieler — resette alle Bots und Score-Drops.");
    for (const bot of Array.from(players.values()).filter((p) => p.isBot)) {
      players.delete(bot.id);
      io.emit("playerLeft", { id: bot.id });
    }
    clearScoreDropOrbs();
  }

  const player = createPlayer(socket.id, requestedName, false);
  players.set(player.id, player);
  streamStates.set(socket.id, createStreamState());
  maintainBots();

  const initialSnapshot = buildClientSnapshot(
    player,
    Date.now(),
    buildLeaderboardEntries(players.values()),
    {
      serverTickMs: lastTickDurationMs,
      snapshotRate: currentSnapshotRate,
      leaderboardRate: currentLeaderboardRate,
      combatActive: false,
      orbCount: pickups.size,
      orbCap: adaptiveOrbCap(),
    },
    streamStates.get(socket.id) ?? createStreamState(),
    true,
  ) ?? buildSnapshot();

  socket.emit("welcome", {
    yourId: player.id,
    arena,
    snapshot: initialSnapshot,
  });

  socket.on("input", (payload) => {
    const current = players.get(player.id);
    if (!current) {
      return;
    }

    const rawAimX = Number(payload.aimX);
    const rawAimY = Number(payload.aimY);
    const normalizedAim = normalize(
      Number.isFinite(rawAimX) ? rawAimX : 0,
      Number.isFinite(rawAimY) ? rawAimY : 0,
    );

    current.lastInput = {
      seq: Number.isFinite(payload.seq) ? payload.seq : current.lastInput.seq + 1,
      up: Boolean(payload.up),
      down: Boolean(payload.down),
      left: Boolean(payload.left),
      right: Boolean(payload.right),
      ability: Boolean(payload.ability),
      rocketFire: Boolean(payload.rocketFire),
      chainFire: Boolean(payload.chainFire),
      aimX: normalizedAim.length > 0 ? normalizedAim.x : current.lastInput.aimX,
      aimY: normalizedAim.length > 0 ? normalizedAim.y : current.lastInput.aimY,
    };
  });

  socket.on("debugPing", (payload) => {
    const pongPayload: DebugPongPayload = {
      clientSentAt: payload.clientSentAt,
      serverTime: Date.now(),
    };
    socket.emit("debugPong", pongPayload);
  });

  socket.on("disconnect", () => {
    console.log(`[Server] Player disconnected: id=${socket.id}`);
    players.delete(player.id);
    streamStates.delete(socket.id);
    io.emit("playerLeft", { id: player.id });
    const remainingRealPlayers = Array.from(players.values()).filter((p) => !p.isBot).length;
    if (remainingRealPlayers === 0) {
      lastRealPlayerAt = Date.now();
      console.log("[Server] Letzter echter Spieler hat das Spiel verlassen.");
    }
    maintainBots();
  });
});

function runSimulationLoop(): void {
  const loopNow = Date.now();
  const elapsedMs = Math.min(250, Math.max(0, loopNow - lastLoopAt));
  lastLoopAt = loopNow;
  loopAccumulatorMs += elapsedMs;

  let steps = 0;
  while (loopAccumulatorMs >= FIXED_STEP_MS && steps < MAX_SIM_STEPS_PER_FRAME) {
    const tickNow = Date.now();
    tickSimulation(tickNow, DT);
    loopAccumulatorMs -= FIXED_STEP_MS;
    steps += 1;
  }

  if (steps >= MAX_SIM_STEPS_PER_FRAME) {
    // Verhindert einen Spiral-of-Death bei kurzfristigen Lastspitzen.
    loopAccumulatorMs = Math.min(loopAccumulatorMs, FIXED_STEP_MS * 2);
  }
}

setInterval(runSimulationLoop, SIM_LOOP_INTERVAL_MS);

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
