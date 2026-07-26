// Typen der Server-Simulation.
//
// Neben dem vollstaendigen ServerPlayer gibt es hier bewusst schmale
// "Sichten" (CombatActor, LeaderboardCandidate, …): Die reinen Funktionen in
// game/ verlangen nur die Felder, die sie wirklich lesen. Dadurch bleibt der
// Code ehrlich und Unit-Tests muessen keinen kompletten Spieler bauen.

import type { PlayerInputPayload, SkinId } from "@projekt/shared";

export interface Point {
  x: number;
  y: number;
}

export interface Circle extends Point {
  radius: number;
}

/** Minimale Sicht auf einen Spieler fuer Kampf-/Ziel-Regeln. */
export interface CombatActor extends Circle {
  id: string;
  alive: boolean;
  mass: number;
  spawnProtectedUntil: number;
  invulnerableUntil: number;
  stealthUntil: number;
}

/** Minimale Sicht auf einen Spieler fuer das Leaderboard. */
export interface LeaderboardCandidate {
  id: string;
  name: string;
  score: number;
  isBot: boolean;
}

export interface ServerPlayer {
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
  speedBoostUntil: number;
  invulnerableUntil: number;
  stealthUntil: number;
  stunnedUntil: number;
  shockCooldownUntil: number;
  rocketAmmo: number;
  chainAmmo: number;
  shockInputHeld: boolean;
  rocketInputHeld: boolean;
  chainInputHeld: boolean;
  lastInput: PlayerInputPayload;
  lastThreatBy?: string;
  aiTargetId?: string;
  aiTargetKind?: "player" | "orb";
  aiDecisionAt: number;
  aiTickPhase: number;
  aiAggression: number;
  aiGreed: number;
  aiCaution: number;
  aiRetreatUntil: number;
}
