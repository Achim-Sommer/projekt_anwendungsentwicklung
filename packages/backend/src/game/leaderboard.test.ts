import type { LeaderboardEntry } from "@projekt/shared";
import { describe, expect, it } from "vitest";
import { buildLeaderboardEntries, filterLeaderboardForClient, LEADERBOARD_SIZE } from "./leaderboard";
import { makeLeaderboardCandidate } from "./testSupport";

const NOW = 10_000;

describe("buildLeaderboardEntries", () => {
  it("sortiert absteigend nach Score", () => {
    const players = [
      makeLeaderboardCandidate({ id: "a", score: 10 }),
      makeLeaderboardCandidate({ id: "b", score: 90 }),
      makeLeaderboardCandidate({ id: "c", score: 50 }),
    ];

    expect(buildLeaderboardEntries(players).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });

  it("zeigt hoechstens LEADERBOARD_SIZE Eintraege", () => {
    const players = Array.from({ length: 25 }, (_, index) =>
      makeLeaderboardCandidate({ score: index }),
    );

    expect(buildLeaderboardEntries(players)).toHaveLength(LEADERBOARD_SIZE);
  });

  it("uebernimmt Name und Bot-Kennzeichen", () => {
    const players = [makeLeaderboardCandidate({ id: "bot-1", name: "Bot Mia", score: 5, isBot: true })];

    expect(buildLeaderboardEntries(players)[0]).toEqual({
      id: "bot-1",
      name: "Bot Mia",
      score: 5,
      isBot: true,
    });
  });

  it("kommt mit einer leeren Arena klar", () => {
    expect(buildLeaderboardEntries([])).toEqual([]);
  });
});

describe("filterLeaderboardForClient", () => {
  const leaderboard: LeaderboardEntry[] = [
    { id: "me", name: "Ich", score: 100, isBot: false },
    { id: "sneaky", name: "Getarnt", score: 90, isBot: false },
    { id: "bot", name: "Bot Finn", score: 80, isBot: true },
    { id: "gone", name: "Weg", score: 70, isBot: false },
  ];

  const players = new Map([
    ["me", { stealthUntil: 0 }],
    ["sneaky", { stealthUntil: NOW + 1_000 }],
    ["bot", { stealthUntil: 0 }],
  ]);

  it("blendet getarnte Gegner aus", () => {
    const visible = filterLeaderboardForClient("me", leaderboard, players, NOW).map((e) => e.id);
    expect(visible).not.toContain("sneaky");
  });

  it("zeigt den eigenen Eintrag auch bei aktiver Tarnung", () => {
    const visible = filterLeaderboardForClient("sneaky", leaderboard, players, NOW).map((e) => e.id);
    expect(visible).toContain("sneaky");
  });

  it("entfernt Eintraege von Spielern, die es nicht mehr gibt", () => {
    const visible = filterLeaderboardForClient("me", leaderboard, players, NOW).map((e) => e.id);
    expect(visible).toEqual(["me", "bot"]);
  });

  it("zeigt Getarnte nach Ablauf der Tarnung wieder", () => {
    const later = NOW + 5_000;
    const visible = filterLeaderboardForClient("me", leaderboard, players, later).map((e) => e.id);
    expect(visible).toContain("sneaky");
  });
});
