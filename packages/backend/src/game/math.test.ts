import { describe, expect, it } from "vitest";
import { PLAYER_MAX_SPEED_BASE } from "../config";
import { accelerationForMass, clamp, massToRadius, maxSpeedForMass, normalize } from "./math";

describe("clamp", () => {
  it("laesst Werte im Bereich unveraendert", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("begrenzt nach unten und oben", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe("normalize", () => {
  it("liefert einen Einheitsvektor und die urspruengliche Laenge", () => {
    const result = normalize(3, 4);
    expect(result.length).toBe(5);
    expect(result.x).toBeCloseTo(0.6);
    expect(result.y).toBeCloseTo(0.8);
  });

  it("gibt bei Nulllaenge den Nullvektor zurueck, statt durch 0 zu teilen", () => {
    const result = normalize(0, 0);
    expect(result).toEqual({ x: 0, y: 0, length: 0 });
    expect(Number.isNaN(result.x)).toBe(false);
  });
});

describe("massToRadius", () => {
  it("waechst monoton mit der Masse", () => {
    expect(massToRadius(50)).toBeGreaterThan(massToRadius(10));
    expect(massToRadius(200)).toBeGreaterThan(massToRadius(50));
  });

  it("waechst unterlinear — 4-fache Masse ist kein 4-facher Radius", () => {
    // Sonst wuerden grosse Spieler den halben Bildschirm fuellen.
    expect(massToRadius(40)).toBeLessThan(massToRadius(10) * 4);
  });

  it("faengt unsinnige Massen ab (Masse < 1 verhaelt sich wie 1)", () => {
    expect(massToRadius(0)).toBe(massToRadius(1));
    expect(massToRadius(-99)).toBe(massToRadius(1));
  });
});

describe("maxSpeedForMass", () => {
  it("macht schwere Spieler langsamer", () => {
    expect(maxSpeedForMass(400)).toBeLessThan(maxSpeedForMass(10));
  });

  it("bleibt im Korridor 145..PLAYER_MAX_SPEED_BASE", () => {
    for (const mass of [1, 10, 100, 5000, 1_000_000]) {
      expect(maxSpeedForMass(mass)).toBeGreaterThanOrEqual(145);
      expect(maxSpeedForMass(mass)).toBeLessThanOrEqual(PLAYER_MAX_SPEED_BASE);
    }
  });
});

describe("accelerationForMass", () => {
  it("macht schwere Spieler traeger, bleibt aber ueber der Untergrenze", () => {
    expect(accelerationForMass(400)).toBeLessThan(accelerationForMass(10));
    expect(accelerationForMass(10_000_000)).toBeGreaterThanOrEqual(430);
  });
});
