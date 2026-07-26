import { describe, expect, it } from "vitest";
import {
  CHAIN_PICKUP_CHANCE,
  CHAIN_PICKUP_RADIUS,
  ORB_RADIUS,
  ORB_VALUE_MAX,
  ORB_VALUE_MIN,
  ROCKET_PICKUP_CHANCE,
  ROCKET_PICKUP_RADIUS,
  SCORE_DROP_ORB_MAX,
  SPECIAL_PICKUP_CHANCE,
  SPECIAL_PICKUP_RADIUS,
} from "../config";
import { radiusForPickupKind, rollOrbValue, rollPickupKind, splitScoreIntoOrbValues } from "./pickups";
import { sequenceRandom } from "./testSupport";

const ROCKET_END = ROCKET_PICKUP_CHANCE;
const CHAIN_END = ROCKET_PICKUP_CHANCE + CHAIN_PICKUP_CHANCE;
const SPECIAL_END = CHAIN_END + SPECIAL_PICKUP_CHANCE;

describe("rollPickupKind", () => {
  it("ordnet die Wuerfe den Bereichen aus der config zu", () => {
    expect(rollPickupKind(0, 0)).toBe("rocket");
    expect(rollPickupKind(ROCKET_END - 0.001, 0)).toBe("rocket");
    expect(rollPickupKind(ROCKET_END, 0)).toBe("chain");
    expect(rollPickupKind(CHAIN_END - 0.001, 0)).toBe("chain");
    expect(rollPickupKind(SPECIAL_END, 0)).toBe("mass");
    expect(rollPickupKind(0.99, 0)).toBe("mass");
  });

  it("verteilt die Specials gleichmaessig auf Speed, Schild und Tarnung", () => {
    const specialRoll = CHAIN_END;
    expect(rollPickupKind(specialRoll, 0)).toBe("speed");
    expect(rollPickupKind(specialRoll, 0.5)).toBe("shield");
    expect(rollPickupKind(specialRoll, 0.99)).toBe("stealth");
  });

  it("faellt bei einem Randwert von 1 auf Speed zurueck, statt undefined zu liefern", () => {
    expect(rollPickupKind(CHAIN_END, 1)).toBe("speed");
  });

  it("laesst Mass-Orbs den mit Abstand haeufigsten Fall bleiben", () => {
    expect(SPECIAL_END).toBeLessThan(0.5);
  });
});

describe("radiusForPickupKind", () => {
  it("liefert je Art den passenden Radius", () => {
    expect(radiusForPickupKind("mass")).toBe(ORB_RADIUS);
    expect(radiusForPickupKind("rocket")).toBe(ROCKET_PICKUP_RADIUS);
    expect(radiusForPickupKind("chain")).toBe(CHAIN_PICKUP_RADIUS);
    expect(radiusForPickupKind("speed")).toBe(SPECIAL_PICKUP_RADIUS);
    expect(radiusForPickupKind("shield")).toBe(SPECIAL_PICKUP_RADIUS);
  });
});

describe("rollOrbValue", () => {
  it("bleibt bei Mass-Orbs im konfigurierten Wertebereich", () => {
    expect(rollOrbValue("mass", () => 0)).toBe(ORB_VALUE_MIN);
    expect(rollOrbValue("mass", () => 0.9999)).toBe(ORB_VALUE_MAX);
  });

  it("gibt Specials keinen Masse-Wert", () => {
    expect(rollOrbValue("speed", () => 0.5)).toBe(0);
    expect(rollOrbValue("rocket", () => 0.5)).toBe(0);
  });
});

describe("splitScoreIntoOrbValues", () => {
  it("verteilt die Punkte exakt — es entstehen und verschwinden keine Punkte", () => {
    const random = sequenceRandom([0.1, 0.9, 0.5, 0.3, 0.7, 0.0, 1.0]);
    for (const total of [1, 2, 5, 7, 13, 50, 137, 999, 100_000]) {
      const values = splitScoreIntoOrbValues(total, random);
      const sum = values.reduce((acc, value) => acc + value, 0);
      expect(sum).toBe(Math.round(total));
    }
  });

  it("gibt jedem Orb mindestens einen Punkt", () => {
    const values = splitScoreIntoOrbValues(40, sequenceRandom([0, 1, 0.5]));
    expect(values.every((value) => value >= 1)).toBe(true);
  });

  it("erzeugt nie mehr Orbs als Punkte vorhanden sind", () => {
    // Sonst wuerde ein 1-Punkt-Drop zu sechs 1-Punkt-Orbs — Punkte aus dem Nichts.
    expect(splitScoreIntoOrbValues(1, () => 0.5)).toEqual([1]);
    expect(splitScoreIntoOrbValues(3, () => 0.5)).toHaveLength(3);
  });

  it("deckelt die Orb-Anzahl auch bei riesigen Punktzahlen", () => {
    expect(splitScoreIntoOrbValues(1_000_000, () => 0.5).length).toBeLessThanOrEqual(
      SCORE_DROP_ORB_MAX,
    );
  });

  it("laesst bei 0 oder negativen Punkten gar nichts fallen", () => {
    expect(splitScoreIntoOrbValues(0)).toEqual([]);
    expect(splitScoreIntoOrbValues(-20)).toEqual([]);
  });

  it("streut die Werte, statt sie stur gleich zu verteilen", () => {
    const values = splitScoreIntoOrbValues(200, sequenceRandom([0, 1, 0.2, 0.8, 0.5]));
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});
