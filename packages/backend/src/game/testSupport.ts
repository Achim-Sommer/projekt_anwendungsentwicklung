// Hilfsfabriken fuer Tests.
//
// Damit ein Test nur die Felder nennt, um die es ihm geht ("ein Spieler mit
// Masse 30"), und alles andere sinnvolle Standardwerte bekommt.
// Diese Datei ist vom Produktions-Build ausgeschlossen (siehe tsconfig.json).

import type { ForceOrb, PlayerSnapshot } from "@projekt/shared";
import type { CombatActor, LeaderboardCandidate } from "./types";

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function makeActor(overrides: Partial<CombatActor> = {}): CombatActor {
  return {
    id: nextId("player"),
    x: 0,
    y: 0,
    radius: 20,
    alive: true,
    mass: 10,
    spawnProtectedUntil: 0,
    invulnerableUntil: 0,
    stealthUntil: 0,
    ...overrides,
  };
}

export function makeLeaderboardCandidate(
  overrides: Partial<LeaderboardCandidate> = {},
): LeaderboardCandidate {
  return {
    id: nextId("player"),
    name: "Spieler",
    score: 0,
    isBot: false,
    ...overrides,
  };
}

export function makeSnapshotPlayer(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    id: nextId("player"),
    name: "Spieler",
    x: 100,
    y: 100,
    vx: 0,
    vy: 0,
    radius: 20,
    color: 0x38bdf8,
    skinId: "starter",
    spawnProtectionMsLeft: 0,
    speedBoostMsLeft: 0,
    invulnerableMsLeft: 0,
    stealthMsLeft: 0,
    stunnedMsLeft: 0,
    shockCooldownMsLeft: 0,
    rocketAmmo: 0,
    chainAmmo: 0,
    mass: 10,
    score: 0,
    isBot: false,
    alive: true,
    ...overrides,
  };
}

export function makeOrb(overrides: Partial<ForceOrb> = {}): ForceOrb {
  return {
    id: nextId("orb"),
    kind: "mass",
    x: 50,
    y: 50,
    value: 10,
    radius: 6,
    ...overrides,
  };
}

/** Deterministischer Ersatz fuer Math.random: gibt die Werte der Reihe nach aus. */
export function sequenceRandom(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value;
  };
}
