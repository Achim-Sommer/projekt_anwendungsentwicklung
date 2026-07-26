import { describe, expect, it } from "vitest";
import { OrbGrid } from "./orbGrid";

function idsIn(cells: Set<string>[]): string[] {
  return cells.flatMap((cell) => Array.from(cell));
}

describe("OrbGrid", () => {
  it("legt ein Raster passend zur Arenagroesse an", () => {
    const grid = new OrbGrid(1000, 600, 100);
    expect(grid.cols).toBe(10);
    expect(grid.rows).toBe(6);
  });

  it("findet ein eingetragenes Orb in seiner Umgebung", () => {
    const grid = new OrbGrid(1000, 600, 100);
    grid.insert("orb-1", 250, 250);

    expect(idsIn(grid.cellsNear(250, 250, 10))).toContain("orb-1");
  });

  it("liefert weit entfernte Orbs nicht mit", () => {
    const grid = new OrbGrid(1000, 600, 100);
    grid.insert("weit-weg", 950, 550);

    expect(idsIn(grid.cellsNear(50, 50, 30))).not.toContain("weit-weg");
  });

  it("entfernt Orbs wieder", () => {
    const grid = new OrbGrid(1000, 600, 100);
    grid.insert("orb-1", 250, 250);
    grid.remove("orb-1", 250, 250);

    expect(idsIn(grid.cellsNear(250, 250, 50))).not.toContain("orb-1");
    expect(grid.size).toBe(0);
  });

  it("findet auch Orbs in den Nachbarzellen", () => {
    const grid = new OrbGrid(1000, 600, 100);
    // Direkt hinter der Zellgrenze — beim Einsammeln darf das nicht verloren gehen.
    grid.insert("nachbar", 301, 250);

    expect(idsIn(grid.cellsNear(299, 250, 10))).toContain("nachbar");
  });

  it("klemmt Positionen ausserhalb der Arena, statt abzustuerzen", () => {
    const grid = new OrbGrid(1000, 600, 100);
    grid.insert("ausserhalb", -500, 9_999);

    expect(grid.size).toBe(1);
    expect(idsIn(grid.cellsNear(0, 599, 10))).toContain("ausserhalb");
  });

  it("liefert bei grossem Suchradius mehr Zellen als bei kleinem", () => {
    const grid = new OrbGrid(1000, 600, 100);
    expect(grid.cellsNear(500, 300, 300).length).toBeGreaterThan(
      grid.cellsNear(500, 300, 10).length,
    );
  });

  it("schneidet die Suche am Arenarand ab, statt ins Leere zu greifen", () => {
    const grid = new OrbGrid(1000, 600, 100);
    // In der Mitte deckt derselbe Radius 5x5 Zellen ab, in der Ecke nur 3x3.
    expect(grid.cellsNear(500, 300, 10).length).toBe(25);
    expect(grid.cellsNear(0, 0, 10).length).toBe(9);
  });
});
