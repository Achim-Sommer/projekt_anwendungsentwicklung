import { describe, expect, it } from "vitest";
import {
  BOUNTY_BONUS_POINTS_MAX,
  BOUNTY_BONUS_POINTS_MIN,
  SPECIAL_BOUNTY_SCORE_RATIO,
} from "../config";
import {
  clampBountyReward,
  computeSpecialBountyReward,
  computeStandardBountyReward,
  type BountyRewardContext,
} from "./bounty";

const BASE_CONTEXT: BountyRewardContext = {
  alivePlayerCount: 2,
  targetMass: 10,
  targetScore: 0,
  volatility: 0,
  bountyRushActive: false,
};

describe("computeStandardBountyReward", () => {
  it("bleibt immer im konfigurierten Rahmen", () => {
    const contexts: BountyRewardContext[] = [
      BASE_CONTEXT,
      { ...BASE_CONTEXT, alivePlayerCount: 60, targetMass: 5_000, targetScore: 90_000 },
      { ...BASE_CONTEXT, volatility: -500 },
      { ...BASE_CONTEXT, targetMass: 0, targetScore: -100 },
    ];

    for (const context of contexts) {
      const reward = computeStandardBountyReward(context);
      expect(reward).toBeGreaterThanOrEqual(BOUNTY_BONUS_POINTS_MIN);
      expect(reward).toBeLessThanOrEqual(BOUNTY_BONUS_POINTS_MAX);
    }
  });

  it("steigt mit der Masse des Ziels", () => {
    const small = computeStandardBountyReward({ ...BASE_CONTEXT, targetMass: 10 });
    const big = computeStandardBountyReward({ ...BASE_CONTEXT, targetMass: 400 });
    expect(big).toBeGreaterThan(small);
  });

  it("steigt mit dem Score des Ziels", () => {
    const low = computeStandardBountyReward({ ...BASE_CONTEXT, targetScore: 0 });
    const high = computeStandardBountyReward({ ...BASE_CONTEXT, targetScore: 5_000 });
    expect(high).toBeGreaterThan(low);
  });

  it("steigt mit der Zahl lebender Spieler", () => {
    const duell = computeStandardBountyReward({ ...BASE_CONTEXT, alivePlayerCount: 2 });
    const volleArena = computeStandardBountyReward({ ...BASE_CONTEXT, alivePlayerCount: 12 });
    expect(volleArena).toBeGreaterThan(duell);
  });

  it("zahlt waehrend Bounty Rush mehr", () => {
    const normal = computeStandardBountyReward(BASE_CONTEXT);
    const rush = computeStandardBountyReward({ ...BASE_CONTEXT, bountyRushActive: true });
    expect(rush).toBeGreaterThan(normal);
  });

  it("rechnet ohne Ziel mit den Startwerten weiter, statt NaN zu liefern", () => {
    const reward = computeStandardBountyReward({
      ...BASE_CONTEXT,
      targetMass: null,
      targetScore: null,
    });
    expect(Number.isFinite(reward)).toBe(true);
    expect(reward).toBeGreaterThanOrEqual(BOUNTY_BONUS_POINTS_MIN);
  });
});

describe("computeSpecialBountyReward", () => {
  it("zahlt den konfigurierten Anteil vom Score des groessten Spielers", () => {
    expect(computeSpecialBountyReward(1_000)).toBe(Math.round(1_000 * SPECIAL_BOUNTY_SCORE_RATIO));
  });

  it("ist bewusst nicht gedeckelt — das ist der Jackpot", () => {
    expect(computeSpecialBountyReward(100_000)).toBeGreaterThan(BOUNTY_BONUS_POINTS_MAX);
  });

  it("ist 0, wenn es keinen Spieler gibt", () => {
    expect(computeSpecialBountyReward(null)).toBe(0);
  });
});

describe("clampBountyReward", () => {
  it("deckelt normale Kopfgelder", () => {
    expect(clampBountyReward(9_999, false)).toBe(BOUNTY_BONUS_POINTS_MAX);
    expect(clampBountyReward(1, false)).toBe(BOUNTY_BONUS_POINTS_MIN);
  });

  it("laesst Spezial-Kopfgelder ungedeckelt durch", () => {
    expect(clampBountyReward(9_999, true)).toBe(9_999);
  });

  it("zahlt nie negative Punkte aus", () => {
    expect(clampBountyReward(-50, true)).toBe(0);
  });
});
