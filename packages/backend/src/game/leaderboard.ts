// Leaderboard: Top-Liste bauen und pro Client um getarnte Spieler bereinigen.

import type { LeaderboardEntry } from "@projekt/shared";
import { hasStealth } from "./combat";
import type { LeaderboardCandidate } from "./types";

export const LEADERBOARD_SIZE = 10;

/** Top-N nach Score, absteigend. Auch tote Spieler bleiben gelistet. */
export function buildLeaderboardEntries(
  players: Iterable<LeaderboardCandidate>,
  limit: number = LEADERBOARD_SIZE,
): LeaderboardEntry[] {
  return Array.from(players)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isBot: player.isBot,
    }));
}

/**
 * Getarnte Spieler duerfen im Leaderboard nicht auftauchen — sonst waere die
 * Tarnung nutzlos. Der eigene Eintrag bleibt immer sichtbar; Eintraege ohne
 * bekannten Spieler (gerade disconnected) fallen raus.
 */
export function filterLeaderboardForClient(
  localPlayerId: string,
  leaderboard: readonly LeaderboardEntry[],
  players: ReadonlyMap<string, { stealthUntil: number }>,
  now: number,
): LeaderboardEntry[] {
  return leaderboard.filter((entry) => {
    if (entry.id === localPlayerId) {
      return true;
    }
    const candidate = players.get(entry.id);
    if (!candidate) {
      return false;
    }
    return !hasStealth(candidate, now);
  });
}
