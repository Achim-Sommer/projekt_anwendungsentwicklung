// Kampfregeln: Wer darf wen fressen, stunnen, treffen?
//
// Diese Regeln entscheiden ueber jeden Tod im Spiel und sind damit der
// wichtigste Kandidat fuer Unit-Tests: Ein Fehler hier ist im laufenden Spiel
// kaum reproduzierbar, im Test dagegen in drei Zeilen beschrieben.

import { CONSUME_MIN_RATIO, SHOCK_EDGE_RANGE } from "../config";
import type { Circle, CombatActor, Point } from "./types";

export function hasSpeedBoost(player: { speedBoostUntil: number }, now: number): boolean {
  return player.speedBoostUntil > now;
}

export function hasInvulnerability(player: { invulnerableUntil: number }, now: number): boolean {
  return player.invulnerableUntil > now;
}

export function hasStealth(player: { stealthUntil: number }, now: number): boolean {
  return player.stealthUntil > now;
}

/** Spawnschutz oder Schild — beides verhindert jeden Knockout. */
export function isProtectedFromKnockOut(
  player: { spawnProtectedUntil: number; invulnerableUntil: number },
  now: number,
): boolean {
  return player.spawnProtectedUntil > now || hasInvulnerability(player, now);
}

/**
 * Fressen ist erlaubt, wenn der Fresser mindestens CONSUME_MIN_RATIO mal so
 * schwer ist und weder Angreifer noch Opfer geschuetzt sind. Die Kollision
 * selbst wird davon getrennt geprueft (siehe isWithinConsumeRange).
 */
export function canConsumeTarget(source: CombatActor, target: CombatActor, now: number): boolean {
  if (source.id === target.id || !source.alive || !target.alive) {
    return false;
  }
  if (source.spawnProtectedUntil > now || target.spawnProtectedUntil > now) {
    return false;
  }
  if (hasInvulnerability(target, now) || hasStealth(target, now)) {
    return false;
  }
  return source.mass >= target.mass * CONSUME_MIN_RATIO;
}

/** Das Opfer muss weit genug im Fresser stecken — nicht nur beruehren. */
export function isWithinConsumeRange(eater: Circle, victim: Circle): boolean {
  const dx = eater.x - victim.x;
  const dy = eater.y - victim.y;
  const consumeRadius = Math.max(8, eater.radius - victim.radius * 0.32);
  return dx * dx + dy * dy <= consumeRadius * consumeRadius;
}

/** Blitz/Chain treffen unabhaengig von der Masse, aber nicht durch Schutz/Tarnung. */
export function canShockTarget(source: CombatActor, target: CombatActor, now: number): boolean {
  if (source.id === target.id || !source.alive || !target.alive) {
    return false;
  }
  if (target.spawnProtectedUntil > now || hasInvulnerability(target, now) || hasStealth(target, now)) {
    return false;
  }
  return true;
}

export const canChainTarget = canShockTarget;

/** Blitzreichweite zaehlt von Rand zu Rand, nicht von Mittelpunkt zu Mittelpunkt. */
export function isWithinShockEdgeRange(source: Circle, target: Circle): boolean {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const centerRange = SHOCK_EDGE_RANGE + source.radius + target.radius;
  return dx * dx + dy * dy <= centerRange * centerRange;
}

export interface ProjectileHit<T extends Circle> {
  target: T;
  distance: number;
}

/**
 * Erster Treffer eines Strahls (Rakete/Chain): Strahl-Kreis-Schnitt entlang
 * `direction`. Rueckwaerts liegende Ziele und Ziele hinter dem Arenarand
 * zaehlen nicht; von mehreren Treffern gewinnt der naechstgelegene.
 */
export function findProjectileHit<T extends Circle>(
  origin: Point,
  candidates: Iterable<T>,
  direction: Point,
  maxDistance: number,
  hitPadding: number,
  canTarget: (candidate: T) => boolean,
): ProjectileHit<T> | null {
  let bestTarget: T | undefined;
  let bestHitDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!canTarget(candidate)) {
      continue;
    }

    const relX = candidate.x - origin.x;
    const relY = candidate.y - origin.y;
    const projectedDistance = relX * direction.x + relY * direction.y;
    if (projectedDistance <= 0 || projectedDistance > maxDistance) {
      continue;
    }

    const perpendicularDistanceSq = relX * relX + relY * relY - projectedDistance * projectedDistance;
    const hitRadius = candidate.radius + hitPadding;
    const hitRadiusSq = hitRadius * hitRadius;
    if (perpendicularDistanceSq > hitRadiusSq) {
      continue;
    }

    const entryOffset = Math.sqrt(Math.max(0, hitRadiusSq - perpendicularDistanceSq));
    const hitDistance = projectedDistance - entryOffset;
    if (hitDistance < 0 || hitDistance > maxDistance || hitDistance >= bestHitDistance) {
      continue;
    }

    bestTarget = candidate;
    bestHitDistance = hitDistance;
  }

  if (!bestTarget) {
    return null;
  }

  return { target: bestTarget, distance: bestHitDistance };
}
