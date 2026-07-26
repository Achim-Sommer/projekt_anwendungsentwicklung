// Reine Mathe-Helfer der Simulation (Masse ↔ Radius, Tempo, Vektoren).

import {
  PLAYER_ACCELERATION_BASE,
  PLAYER_MAX_SPEED_BASE,
} from "../config";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Normiert einen Vektor. Bei (nahezu) Nulllaenge kommt der Nullvektor mit
 * length 0 zurueck — Aufrufer pruefen `length > 0`, statt durch 0 zu teilen.
 */
export function normalize(x: number, y: number): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }
  return { x: x / length, y: y / length, length };
}

/** Radius waechst mit der Wurzel der Masse — grosse Spieler wirken traege. */
export function massToRadius(mass: number): number {
  return 10 + 2.35 * Math.sqrt(Math.max(1, mass));
}

/** Je schwerer, desto langsamer — nach unten auf 145 begrenzt. */
export function maxSpeedForMass(mass: number): number {
  const speed = PLAYER_MAX_SPEED_BASE * Math.pow(Math.max(1, mass), -0.25);
  return clamp(speed, 145, PLAYER_MAX_SPEED_BASE);
}

/** Je schwerer, desto traeger die Beschleunigung — nach unten auf 430 begrenzt. */
export function accelerationForMass(mass: number): number {
  const acceleration = PLAYER_ACCELERATION_BASE * Math.pow(Math.max(1, mass), -0.2);
  return clamp(acceleration, 430, PLAYER_ACCELERATION_BASE);
}
