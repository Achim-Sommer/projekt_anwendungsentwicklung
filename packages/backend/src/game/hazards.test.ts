import type { HazardZone } from "@projekt/shared";
import { describe, expect, it } from "vitest";
import {
  distanceToNearestHazard,
  edgeRepulsion,
  findDeadlyHazard,
  hazardCenter,
  hazardRepulsion,
  isPointInHazard,
  nearestHazardCenter,
  rayDistanceToArenaEdge,
} from "./hazards";

const PIT: HazardZone = { id: "pit", type: "pit", x: 100, y: 100, width: 200, height: 100 };
const FAR_PIT: HazardZone = { id: "far", type: "pit", x: 900, y: 900, width: 100, height: 100 };
const HAZARDS = [PIT, FAR_PIT];

describe("isPointInHazard", () => {
  it("erkennt Punkte innerhalb und ausserhalb", () => {
    expect(isPointInHazard(HAZARDS, 150, 150)).toBe(true);
    expect(isPointInHazard(HAZARDS, 50, 150)).toBe(false);
  });

  it("zaehlt den Rand als innen", () => {
    expect(isPointInHazard(HAZARDS, 100, 100)).toBe(true);
    expect(isPointInHazard(HAZARDS, 300, 200)).toBe(true);
  });

  it("ist ohne Hazards immer false", () => {
    expect(isPointInHazard([], 150, 150)).toBe(false);
  });
});

describe("distanceToNearestHazard", () => {
  it("liefert 0 innerhalb eines Hazards", () => {
    expect(distanceToNearestHazard(HAZARDS, 150, 150)).toBe(0);
  });

  it("misst den Abstand zur Kante, nicht zum Mittelpunkt", () => {
    expect(distanceToNearestHazard(HAZARDS, 50, 150)).toBe(50);
  });

  it("waehlt von mehreren Hazards das naechste", () => {
    expect(distanceToNearestHazard(HAZARDS, 890, 950)).toBe(10);
  });
});

describe("findDeadlyHazard", () => {
  // Radius 20 → noetige Eintauchtiefe clamp(20 * 0.55, 10, 24) = 11
  it("toetet, wenn der Spieler tief genug hineinragt", () => {
    expect(findDeadlyHazard(HAZARDS, 95, 150, 20)?.id).toBe("pit");
  });

  it("laesst blosses Anecken ueberleben", () => {
    expect(findDeadlyHazard(HAZARDS, 85, 150, 20)).toBeUndefined();
  });

  it("beruehrt den Rand gar nicht → harmlos", () => {
    expect(findDeadlyHazard(HAZARDS, 50, 150, 20)).toBeUndefined();
  });

  it("deckelt die noetige Tiefe fuer sehr grosse Spieler", () => {
    // Radius 100: 55 % waeren 55, die Obergrenze von 24 gilt — grosse Spieler
    // sterben also schon, bevor ihr halber Koerper in der Grube haengt.
    expect(findDeadlyHazard(HAZARDS, 24, 150, 100)?.id).toBe("pit");
    expect(findDeadlyHazard(HAZARDS, 20, 150, 100)).toBeUndefined();
  });
});

describe("hazardCenter / nearestHazardCenter", () => {
  it("berechnet den Mittelpunkt", () => {
    expect(hazardCenter(PIT)).toEqual({ x: 200, y: 150 });
  });

  it("findet den naechsten Mittelpunkt", () => {
    expect(nearestHazardCenter(HAZARDS, 0, 0)).toEqual({ x: 200, y: 150 });
    expect(nearestHazardCenter(HAZARDS, 1000, 1000)).toEqual({ x: 950, y: 950 });
  });

  it("gibt ohne Hazards den Punkt selbst zurueck", () => {
    expect(nearestHazardCenter([], 42, 7)).toEqual({ x: 42, y: 7 });
  });
});

describe("rayDistanceToArenaEdge", () => {
  it("misst gerade nach rechts und nach oben", () => {
    expect(rayDistanceToArenaEdge(1000, 600, 100, 100, 1, 0)).toBe(900);
    expect(rayDistanceToArenaEdge(1000, 600, 100, 100, 0, -1)).toBe(100);
  });

  it("nimmt bei schraegem Schuss die zuerst erreichte Kante", () => {
    expect(rayDistanceToArenaEdge(1000, 600, 100, 100, 0.6, 0.8)).toBeCloseTo(625);
  });

  it("gibt 0 zurueck, wenn es keine Richtung gibt", () => {
    expect(rayDistanceToArenaEdge(1000, 600, 100, 100, 0, 0)).toBe(0);
  });
});

describe("edgeRepulsion", () => {
  it("ist in der Arenamitte null", () => {
    expect(edgeRepulsion(1000, 600, 500, 300)).toEqual({ x: 0, y: 0 });
  });

  it("schiebt am linken Rand nach rechts und am unteren nach oben", () => {
    expect(edgeRepulsion(1000, 600, 10, 300).x).toBeGreaterThan(0);
    expect(edgeRepulsion(1000, 600, 500, 590).y).toBeLessThan(0);
  });
});

describe("hazardRepulsion", () => {
  it("schiebt vom Hazard weg", () => {
    const push = hazardRepulsion([PIT], 340, 150);
    expect(push.x).toBeGreaterThan(0);
  });

  it("wirkt ausserhalb des Wirkradius gar nicht", () => {
    expect(hazardRepulsion([PIT], 800, 150)).toEqual({ x: 0, y: 0 });
  });

  it("wird staerker, je naeher der Spieler ist", () => {
    const near = hazardRepulsion([PIT], 320, 150);
    const far = hazardRepulsion([PIT], 400, 150);
    expect(near.x).toBeGreaterThan(far.x);
  });
});
