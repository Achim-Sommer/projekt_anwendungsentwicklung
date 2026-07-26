// Orb-Erzeugung: Art, Radius, Wert und die Aufteilung von Score-Drops.
//
// Der Zufall kommt als Parameter herein (`random`), damit Tests die Ergebnisse
// exakt festnageln koennen, statt Wahrscheinlichkeiten zu wuerfeln.

import type { PickupKind } from "@projekt/shared";
import {
  CHAIN_PICKUP_CHANCE,
  CHAIN_PICKUP_RADIUS,
  ORB_RADIUS,
  ORB_VALUE_MAX,
  ORB_VALUE_MIN,
  ROCKET_PICKUP_CHANCE,
  ROCKET_PICKUP_RADIUS,
  SCORE_DROP_ORB_MAX,
  SCORE_DROP_ORB_MIN,
  SCORE_DROP_ORB_RADIUS,
  SPECIAL_PICKUP_CHANCE,
  SPECIAL_PICKUP_RADIUS,
} from "../config";
import { clamp } from "./math";

const SPECIAL_KINDS: readonly PickupKind[] = ["speed", "shield", "stealth"];

/**
 * Ordnet einem Zufallswurf [0,1) eine Orb-Art zu. Die Chancen liegen
 * hintereinander auf der Zahlengerade: erst Rakete, dann Chain, dann Specials,
 * der Rest ist ein normales Mass-Orb. `specialRoll` waehlt innerhalb der
 * Specials aus.
 */
export function rollPickupKind(roll: number, specialRoll: number): PickupKind {
  if (roll < ROCKET_PICKUP_CHANCE) {
    return "rocket";
  }
  if (roll < ROCKET_PICKUP_CHANCE + CHAIN_PICKUP_CHANCE) {
    return "chain";
  }
  if (roll < ROCKET_PICKUP_CHANCE + CHAIN_PICKUP_CHANCE + SPECIAL_PICKUP_CHANCE) {
    return SPECIAL_KINDS[Math.floor(specialRoll * SPECIAL_KINDS.length)] ?? "speed";
  }
  return "mass";
}

export function radiusForPickupKind(kind: PickupKind): number {
  switch (kind) {
    case "mass":
      return ORB_RADIUS;
    case "rocket":
      return ROCKET_PICKUP_RADIUS;
    case "chain":
      return CHAIN_PICKUP_RADIUS;
    case "score":
      return SCORE_DROP_ORB_RADIUS;
    default:
      return SPECIAL_PICKUP_RADIUS;
  }
}

/** Nur Mass-Orbs tragen Masse; Specials haben Wert 0. */
export function rollOrbValue(kind: PickupKind, random: () => number = Math.random): number {
  if (kind !== "mass") {
    return 0;
  }
  return ORB_VALUE_MIN + Math.floor(random() * (ORB_VALUE_MAX - ORB_VALUE_MIN + 1));
}

/**
 * Zerlegt die Punkte eines gestorbenen Spielers in einzelne Score-Orbs.
 *
 * Invariante: Die Summe der Werte entspricht exakt den eingesetzten Punkten —
 * beim Sterben duerfen weder Punkte verschwinden noch entstehen. Deshalb ist
 * die Orb-Anzahl zusaetzlich auf die Punktzahl begrenzt (jedes Orb ist >= 1).
 */
export function splitScoreIntoOrbValues(
  totalPoints: number,
  random: () => number = Math.random,
): number[] {
  if (totalPoints <= 0) {
    return [];
  }

  let remaining = Math.max(1, Math.round(totalPoints));
  const orbCount = Math.min(
    remaining,
    clamp(Math.ceil(Math.sqrt(totalPoints) * 1.15), SCORE_DROP_ORB_MIN, SCORE_DROP_ORB_MAX),
  );

  const values: number[] = [];
  for (let i = 0; i < orbCount; i += 1) {
    const slotsLeft = orbCount - i;
    let value = remaining;

    if (slotsLeft > 1) {
      const average = remaining / slotsLeft;
      const spread = Math.max(1, Math.round(average * 0.35));
      // Jedem verbleibenden Orb muss mindestens 1 Punkt uebrig bleiben.
      const maxAllowed = remaining - (slotsLeft - 1);
      value = clamp(Math.round(average + (random() * 2 - 1) * spread), 1, maxAllowed);
    }

    remaining -= value;
    values.push(value);
  }

  return values;
}
