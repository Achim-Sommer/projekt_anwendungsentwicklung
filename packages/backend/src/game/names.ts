// Namensvergabe: Eingaben echter Spieler saeubern, Botnamen vergeben.

import { BOT_NAMES } from "../config";

export const MIN_PLAYER_NAME_LENGTH = 2;
export const MAX_PLAYER_NAME_LENGTH = 16;

/**
 * Saeubert einen vom Client gelieferten Namen: Nur Buchstaben, Ziffern,
 * Leerzeichen, Punkt, Bindestrich und Unterstrich bleiben stehen, Mehrfach-
 * Leerzeichen werden zusammengefasst, Laenge auf 16 Zeichen begrenzt.
 * Alles, was kein String ist, ergibt "" (der Server lehnt die Verbindung ab).
 */
export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}_\- .]/gu, "")
    .slice(0, MAX_PLAYER_NAME_LENGTH);
}

/**
 * Waehlt einen noch freien Botnamen aus dem Pool. Ist der Pool erschoepft
 * (mehr Bots als Namen), dient die laufende Nummer als Rueckfallebene.
 */
export function pickBotName(
  usedNames: ReadonlySet<string>,
  fallbackCounter: number,
  pool: readonly string[] = BOT_NAMES,
  random: () => number = Math.random,
): string {
  const available = pool.filter((name) => !usedNames.has(`Bot ${name}`));
  if (available.length > 0) {
    return `Bot ${available[Math.floor(random() * available.length)]}`;
  }
  return `Bot ${fallbackCounter}`;
}
