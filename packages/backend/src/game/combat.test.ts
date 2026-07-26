import { describe, expect, it } from "vitest";
import { CONSUME_MIN_RATIO, SHOCK_EDGE_RANGE } from "../config";
import {
  canConsumeTarget,
  canShockTarget,
  findProjectileHit,
  isProtectedFromKnockOut,
  isWithinConsumeRange,
  isWithinShockEdgeRange,
} from "./combat";
import { makeActor } from "./testSupport";

const NOW = 10_000;

describe("canConsumeTarget", () => {
  it("erlaubt das Fressen genau ab dem Massenverhaeltnis CONSUME_MIN_RATIO", () => {
    const victim = makeActor({ mass: 100 });
    const exactlyBigEnough = makeActor({ mass: 100 * CONSUME_MIN_RATIO });
    const slightlyTooSmall = makeActor({ mass: 100 * CONSUME_MIN_RATIO - 0.01 });

    expect(canConsumeTarget(exactlyBigEnough, victim, NOW)).toBe(true);
    expect(canConsumeTarget(slightlyTooSmall, victim, NOW)).toBe(false);
  });

  it("verhindert, dass ein Spieler sich selbst frisst", () => {
    const player = makeActor({ mass: 100 });
    expect(canConsumeTarget(player, player, NOW)).toBe(false);
  });

  it("ignoriert tote Spieler auf beiden Seiten", () => {
    const eater = makeActor({ mass: 100 });
    const victim = makeActor({ mass: 10 });

    expect(canConsumeTarget({ ...eater, alive: false }, victim, NOW)).toBe(false);
    expect(canConsumeTarget(eater, { ...victim, alive: false }, NOW)).toBe(false);
  });

  it("schuetzt frisch gespawnte Spieler — und haelt sie zugleich vom Angriff ab", () => {
    const eater = makeActor({ mass: 100 });
    const victim = makeActor({ mass: 10 });

    expect(canConsumeTarget(eater, { ...victim, spawnProtectedUntil: NOW + 1 }, NOW)).toBe(false);
    expect(canConsumeTarget({ ...eater, spawnProtectedUntil: NOW + 1 }, victim, NOW)).toBe(false);
  });

  it("laeuft nach Ablauf des Spawnschutzes wieder normal", () => {
    const eater = makeActor({ mass: 100 });
    const victim = makeActor({ mass: 10, spawnProtectedUntil: NOW });

    // spawnProtectedUntil === now gilt bereits als abgelaufen.
    expect(canConsumeTarget(eater, victim, NOW)).toBe(true);
  });

  it("macht Ziele mit Schild oder Tarnung unfressbar", () => {
    const eater = makeActor({ mass: 100 });
    const shielded = makeActor({ mass: 10, invulnerableUntil: NOW + 500 });
    const stealthed = makeActor({ mass: 10, stealthUntil: NOW + 500 });

    expect(canConsumeTarget(eater, shielded, NOW)).toBe(false);
    expect(canConsumeTarget(eater, stealthed, NOW)).toBe(false);
  });

  it("hindert einen Spieler mit Schild nicht am Fressen", () => {
    const eater = makeActor({ mass: 100, invulnerableUntil: NOW + 500 });
    const victim = makeActor({ mass: 10 });

    expect(canConsumeTarget(eater, victim, NOW)).toBe(true);
  });
});

describe("isWithinConsumeRange", () => {
  it("verlangt echte Ueberlappung statt blossem Beruehren", () => {
    const eater = { x: 0, y: 0, radius: 40 };
    const victim = { radius: 10, y: 0 };
    // Rand an Rand (Abstand 50) reicht nicht …
    expect(isWithinConsumeRange(eater, { ...victim, x: 50 })).toBe(false);
    // … tief eingetaucht dagegen schon.
    expect(isWithinConsumeRange(eater, { ...victim, x: 20 })).toBe(true);
  });
});

describe("canShockTarget", () => {
  it("trifft unabhaengig von der Masse — auch groessere Gegner", () => {
    const smallSource = makeActor({ mass: 10 });
    const hugeTarget = makeActor({ mass: 900 });

    expect(canShockTarget(smallSource, hugeTarget, NOW)).toBe(true);
  });

  it("prallt an Spawnschutz, Schild und Tarnung ab", () => {
    const source = makeActor();
    expect(canShockTarget(source, makeActor({ spawnProtectedUntil: NOW + 1 }), NOW)).toBe(false);
    expect(canShockTarget(source, makeActor({ invulnerableUntil: NOW + 1 }), NOW)).toBe(false);
    expect(canShockTarget(source, makeActor({ stealthUntil: NOW + 1 }), NOW)).toBe(false);
  });
});

describe("isWithinShockEdgeRange", () => {
  it("misst von Rand zu Rand, nicht von Mittelpunkt zu Mittelpunkt", () => {
    const source = { x: 0, y: 0, radius: 60 };
    const target = { x: SHOCK_EDGE_RANGE + 100, y: 0, radius: 50 };

    // Mittelpunktabstand liegt ueber der Reichweite, der Randabstand nicht.
    expect(isWithinShockEdgeRange(source, target)).toBe(true);
    expect(isWithinShockEdgeRange(source, { ...target, x: SHOCK_EDGE_RANGE + 120 })).toBe(false);
  });
});

describe("isProtectedFromKnockOut", () => {
  it("gilt bei Spawnschutz und bei Schild", () => {
    expect(isProtectedFromKnockOut({ spawnProtectedUntil: NOW + 1, invulnerableUntil: 0 }, NOW)).toBe(true);
    expect(isProtectedFromKnockOut({ spawnProtectedUntil: 0, invulnerableUntil: NOW + 1 }, NOW)).toBe(true);
    expect(isProtectedFromKnockOut({ spawnProtectedUntil: 0, invulnerableUntil: 0 }, NOW)).toBe(false);
  });
});

describe("findProjectileHit", () => {
  const origin = { x: 0, y: 0 };
  const east = { x: 1, y: 0 };
  const alwaysTargetable = () => true;

  it("trifft ein Ziel auf der Flugbahn und meldet die Distanz bis zum Rand des Ziels", () => {
    const target = makeActor({ x: 200, y: 0, radius: 20 });

    const hit = findProjectileHit(origin, [target], east, 1000, 0, alwaysTargetable);

    expect(hit?.target.id).toBe(target.id);
    expect(hit?.distance).toBeCloseTo(180);
  });

  it("ignoriert Ziele hinter dem Schuetzen", () => {
    const behind = makeActor({ x: -200, y: 0, radius: 20 });

    expect(findProjectileHit(origin, [behind], east, 1000, 0, alwaysTargetable)).toBeNull();
  });

  it("ignoriert Ziele hinter der maximalen Reichweite", () => {
    const farAway = makeActor({ x: 900, y: 0, radius: 20 });

    expect(findProjectileHit(origin, [farAway], east, 300, 0, alwaysTargetable)).toBeNull();
  });

  it("nimmt bei mehreren Treffern den naechstgelegenen", () => {
    const near = makeActor({ x: 200, y: 0, radius: 20 });
    const far = makeActor({ x: 600, y: 0, radius: 20 });

    const hit = findProjectileHit(origin, [far, near], east, 1000, 0, alwaysTargetable);

    expect(hit?.target.id).toBe(near.id);
  });

  it("trifft knapp daneben nur dank des Trefferbonus", () => {
    const target = makeActor({ x: 200, y: 25, radius: 20 });

    expect(findProjectileHit(origin, [target], east, 1000, 0, alwaysTargetable)).toBeNull();
    expect(findProjectileHit(origin, [target], east, 1000, 10, alwaysTargetable)?.target.id).toBe(
      target.id,
    );
  });

  it("respektiert den Ziel-Filter (z. B. Tarnung oder eigener Spieler)", () => {
    const target = makeActor({ x: 200, y: 0, radius: 20 });

    expect(findProjectileHit(origin, [target], east, 1000, 0, () => false)).toBeNull();
  });
});
