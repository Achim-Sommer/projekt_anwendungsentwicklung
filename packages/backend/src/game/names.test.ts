import { describe, expect, it } from "vitest";
import { MAX_PLAYER_NAME_LENGTH, pickBotName, sanitizePlayerName } from "./names";

describe("sanitizePlayerName", () => {
  it("laesst normale Namen unveraendert", () => {
    expect(sanitizePlayerName("Achim")).toBe("Achim");
  });

  it("erlaubt Umlaute, Ziffern und die Zeichen . - _", () => {
    expect(sanitizePlayerName("Jörg_23")).toBe("Jörg_23");
    expect(sanitizePlayerName("Anna-Lena M.")).toBe("Anna-Lena M.");
  });

  it("entfernt Rand-Leerzeichen und fasst Mehrfach-Leerzeichen zusammen", () => {
    expect(sanitizePlayerName("  Max    Mustermann ")).toBe("Max Mustermann");
  });

  it("filtert Sonderzeichen heraus — inklusive HTML-Klammern", () => {
    expect(sanitizePlayerName("<script>")).toBe("script");
    expect(sanitizePlayerName("Bob🚀!")).toBe("Bob");
  });

  it("kuerzt zu lange Namen auf die Maximallaenge", () => {
    const long = "A".repeat(50);
    expect(sanitizePlayerName(long)).toHaveLength(MAX_PLAYER_NAME_LENGTH);
  });

  it("gibt fuer alles, was kein String ist, einen leeren Namen zurueck", () => {
    // Der Server lehnt die Verbindung dann ab — ein Client koennte hier
    // beliebigen Unsinn im Handshake schicken.
    expect(sanitizePlayerName(undefined)).toBe("");
    expect(sanitizePlayerName(null)).toBe("");
    expect(sanitizePlayerName(42)).toBe("");
    expect(sanitizePlayerName({ playerName: "Hacker" })).toBe("");
  });

  it("laesst reine Sonderzeichen-Namen leer zurueck", () => {
    expect(sanitizePlayerName("!!!###")).toBe("");
  });
});

describe("pickBotName", () => {
  const pool = ["Alex", "Karla", "Finn"];

  it("stellt jedem Botnamen das Praefix 'Bot ' voran", () => {
    expect(pickBotName(new Set(), 1, pool, () => 0)).toBe("Bot Alex");
  });

  it("vergibt keinen Namen doppelt", () => {
    const used = new Set(["Bot Alex", "Bot Karla"]);
    expect(pickBotName(used, 1, pool, () => 0)).toBe("Bot Finn");
  });

  it("waehlt aus den freien Namen zufaellig aus", () => {
    expect(pickBotName(new Set(), 1, pool, () => 0.99)).toBe("Bot Finn");
    expect(pickBotName(new Set(), 1, pool, () => 0.5)).toBe("Bot Karla");
  });

  it("nutzt die laufende Nummer, wenn der Namenspool erschoepft ist", () => {
    const used = new Set(["Bot Alex", "Bot Karla", "Bot Finn"]);
    expect(pickBotName(used, 7, pool, () => 0)).toBe("Bot 7");
  });
});
