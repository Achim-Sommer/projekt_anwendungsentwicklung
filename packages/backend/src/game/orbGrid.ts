// Raster fuer schnelle Orb-Suche.
//
// Statt bei jedem Tick alle ~250 Orbs gegen jeden Spieler zu pruefen, liegen
// die Orb-IDs in Zellen von GRID_CELL Kantenlaenge. Eingesammelt wird nur in
// den Zellen rund um den Spieler.

export class OrbGrid {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  private readonly cells: Set<string>[];

  constructor(width: number, height: number, cellSize: number) {
    this.cellSize = cellSize;
    this.cols = Math.ceil(width / cellSize);
    this.rows = Math.ceil(height / cellSize);
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i += 1) {
      this.cells.push(new Set<string>());
    }
  }

  /** Zellindex einer Weltposition; Positionen ausserhalb werden geklemmt. */
  indexAt(x: number, y: number): number {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    return row * this.cols + col;
  }

  insert(id: string, x: number, y: number): void {
    this.cells[this.indexAt(x, y)].add(id);
  }

  remove(id: string, x: number, y: number): void {
    this.cells[this.indexAt(x, y)].delete(id);
  }

  /**
   * Alle Zellen im Umkreis von `distance` um (x, y) — inklusive einer
   * Sicherheitszelle Rand. Die Sets sind die echten Zellen: Aufrufer duerfen
   * eingesammelte IDs direkt daraus entfernen.
   */
  cellsNear(x: number, y: number, distance: number): Set<string>[] {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cellSize)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / this.cellSize)));
    const range = Math.ceil(distance / this.cellSize) + 1;

    const result: Set<string>[] = [];
    for (let dr = -range; dr <= range; dr += 1) {
      const r = row + dr;
      if (r < 0 || r >= this.rows) {
        continue;
      }
      for (let dc = -range; dc <= range; dc += 1) {
        const c = col + dc;
        if (c < 0 || c >= this.cols) {
          continue;
        }
        result.push(this.cells[r * this.cols + c]);
      }
    }
    return result;
  }

  /** Anzahl aller eingetragenen IDs — nur fuer Tests und Diagnose. */
  get size(): number {
    let total = 0;
    for (const cell of this.cells) {
      total += cell.size;
    }
    return total;
  }
}
