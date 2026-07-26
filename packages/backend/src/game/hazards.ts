// Arena-Geometrie: Hazards (Gruben/Lava/Elektro), Randabstoßung, Strahlen.
//
// Alle Funktionen bekommen die Arena explizit uebergeben, statt das globale
// Arena-Objekt aus server.ts zu lesen — nur so sind sie isoliert testbar.

import type { HazardZone } from "@projekt/shared";
import {
  HAZARD_DEATH_OVERLAP_MAX,
  HAZARD_DEATH_OVERLAP_MIN,
  HAZARD_DEATH_OVERLAP_RATIO,
} from "../config";
import { clamp } from "./math";
import type { Point } from "./types";

export function isPointInHazard(hazards: readonly HazardZone[], x: number, y: number): boolean {
  return hazards.some((hazard) => {
    return x >= hazard.x && x <= hazard.x + hazard.width && y >= hazard.y && y <= hazard.y + hazard.height;
  });
}

/** Abstand zum naechstgelegenen Hazard-Rand; 0 wenn der Punkt drin liegt. */
export function distanceToNearestHazard(hazards: readonly HazardZone[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const hazard of hazards) {
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

export function hazardCenter(hazard: HazardZone): Point {
  return {
    x: hazard.x + hazard.width / 2,
    y: hazard.y + hazard.height / 2,
  };
}

/** Mittelpunkt des naechsten Hazards; ohne Hazards der Punkt selbst. */
export function nearestHazardCenter(hazards: readonly HazardZone[], x: number, y: number): Point {
  if (hazards.length === 0) {
    return { x, y };
  }

  let best = hazardCenter(hazards[0]);
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const hazard of hazards) {
    const center = hazardCenter(hazard);
    const dx = center.x - x;
    const dy = center.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      best = center;
      bestDistSq = distSq;
    }
  }

  return best;
}

/**
 * Hazard, in den der Spieler tief genug hineinragt, um zu sterben.
 * Kurz anecken ist erlaubt: erst ab HAZARD_DEATH_OVERLAP_RATIO des Radius
 * (begrenzt auf MIN..MAX Welt-Einheiten) ist es toedlich.
 */
export function findDeadlyHazard(
  hazards: readonly HazardZone[],
  x: number,
  y: number,
  radius: number,
): HazardZone | undefined {
  const radiusSq = radius * radius;
  for (const hazard of hazards) {
    const nearestX = clamp(x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(y, hazard.y, hazard.y + hazard.height);
    const dx = x - nearestX;
    const dy = y - nearestY;
    const distSq = dx * dx + dy * dy;

    if (distSq >= radiusSq) {
      continue;
    }

    const distance = Math.sqrt(distSq);
    const overlapDepth = radius - distance;
    const requiredDepth = clamp(
      radius * HAZARD_DEATH_OVERLAP_RATIO,
      HAZARD_DEATH_OVERLAP_MIN,
      HAZARD_DEATH_OVERLAP_MAX,
    );

    if (overlapDepth >= requiredDepth) {
      return hazard;
    }
  }

  return undefined;
}

/** Strecke vom Ursprung bis zum Arenarand entlang einer (normierten) Richtung. */
export function rayDistanceToArenaEdge(
  arenaWidth: number,
  arenaHeight: number,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
): number {
  let best = Number.POSITIVE_INFINITY;

  if (Math.abs(dirX) > 0.000001) {
    const tx = dirX > 0 ? (arenaWidth - originX) / dirX : (0 - originX) / dirX;
    if (tx >= 0) {
      best = Math.min(best, tx);
    }
  }

  if (Math.abs(dirY) > 0.000001) {
    const ty = dirY > 0 ? (arenaHeight - originY) / dirY : (0 - originY) / dirY;
    if (ty >= 0) {
      best = Math.min(best, ty);
    }
  }

  if (!Number.isFinite(best) || best < 0) {
    return 0;
  }

  return best;
}

/** Lenkvektor der Bot-KI: schiebt vom Arenarand weg (0 in der Mitte). */
export function edgeRepulsion(arenaWidth: number, arenaHeight: number, x: number, y: number): Point {
  const margin = 180;
  const left = clamp((margin - x) / margin, 0, 1);
  const right = clamp((x - (arenaWidth - margin)) / margin, 0, 1);
  const top = clamp((margin - y) / margin, 0, 1);
  const bottom = clamp((y - (arenaHeight - margin)) / margin, 0, 1);

  return {
    x: left - right,
    y: top - bottom,
  };
}

/** Lenkvektor der Bot-KI: schiebt von Hazards weg, quadratisch verstaerkt. */
export function hazardRepulsion(hazards: readonly HazardZone[], x: number, y: number): Point {
  let sumX = 0;
  let sumY = 0;
  const avoidRange = 140;
  const avoidRangeSq = avoidRange * avoidRange;

  for (const hazard of hazards) {
    const nearestX = clamp(x, hazard.x, hazard.x + hazard.width);
    const nearestY = clamp(y, hazard.y, hazard.y + hazard.height);
    const dx = x - nearestX;
    const dy = y - nearestY;
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
