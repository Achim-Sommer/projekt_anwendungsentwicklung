// Kopfgeld-Berechnung.
//
// Die Belohnung haengt von Spielerzahl, Masse und Score des Ziels sowie einem
// zufaelligen Volatilitaets-Offset ab. Als reine Funktion laesst sich das
// Balancing testen, ohne den Server laufen zu lassen.

import {
  BOUNTY_BONUS_POINTS_BASE,
  BOUNTY_BONUS_POINTS_MAX,
  BOUNTY_BONUS_POINTS_MIN,
  BOUNTY_MIN_PLAYERS,
  EVENT_BOUNTY_RUSH_MULTIPLIER,
  PLAYER_START_MASS,
  SPECIAL_BOUNTY_SCORE_RATIO,
} from "../config";
import { clamp } from "./math";

export interface BountyRewardContext {
  /** Lebende Spieler inklusive Bots. */
  alivePlayerCount: number;
  /** Masse des Kopfgeld-Ziels; null, wenn (noch) kein Ziel existiert. */
  targetMass: number | null;
  /** Score des Kopfgeld-Ziels; null, wenn (noch) kein Ziel existiert. */
  targetScore: number | null;
  /** Zufaelliger Offset pro Rotation (-5..+5), sorgt fuer schwankende Preise. */
  volatility: number;
  /** Waehrend "Bounty Rush" gibt es einen Multiplikator obendrauf. */
  bountyRushActive: boolean;
}

/** Normales Kopfgeld — immer zwischen BOUNTY_BONUS_POINTS_MIN und _MAX. */
export function computeStandardBountyReward(context: BountyRewardContext): number {
  const playerFactor = Math.max(0, context.alivePlayerCount - BOUNTY_MIN_PLAYERS) * 3;

  const targetMass = Math.max(8, context.targetMass ?? PLAYER_START_MASS);
  const massFactor = Math.round(Math.sqrt(targetMass) * 3.1);

  const targetScore = Math.max(0, context.targetScore ?? 0);
  const scoreFactor = Math.round(Math.log10(targetScore + 10) * 8.2);

  let reward = BOUNTY_BONUS_POINTS_BASE + playerFactor + massFactor + scoreFactor + context.volatility;
  if (context.bountyRushActive) {
    reward *= EVENT_BOUNTY_RUSH_MULTIPLIER;
  }

  return clamp(Math.round(reward), BOUNTY_BONUS_POINTS_MIN, BOUNTY_BONUS_POINTS_MAX);
}

/**
 * Spezial-Kopfgeld: ein Anteil vom Score des groessten Spielers, bewusst
 * ohne Obergrenze — das ist der grosse Jackpot.
 */
export function computeSpecialBountyReward(largestPlayerScore: number | null): number {
  if (largestPlayerScore === null) {
    return 0;
  }
  return Math.max(0, Math.round(largestPlayerScore * SPECIAL_BOUNTY_SCORE_RATIO));
}

/** Auszahlungswert: nur das normale Kopfgeld wird gedeckelt. */
export function clampBountyReward(points: number, specialBountyActive: boolean): number {
  const rounded = Math.max(0, Math.round(points));
  if (specialBountyActive) {
    return rounded;
  }
  return clamp(rounded, BOUNTY_BONUS_POINTS_MIN, BOUNTY_BONUS_POINTS_MAX);
}
