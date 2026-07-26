import { describe, expect, it } from "vitest";
import { STREAM_FULL_RESYNC_MS } from "../config";
import { createStreamState, diffSnapshot, pickupSignature, playerSignature } from "./snapshot";
import { makeOrb, makeSnapshotPlayer } from "./testSupport";

const NOW = 100_000;
const META = "meta-1";

describe("playerSignature", () => {
  it("aendert sich, wenn sich der Spieler bewegt", () => {
    const player = makeSnapshotPlayer({ x: 100 });
    expect(playerSignature(player)).not.toBe(playerSignature({ ...player, x: 101 }));
  });

  it("aendert sich, wenn sich der Score aendert", () => {
    const player = makeSnapshotPlayer({ score: 10 });
    expect(playerSignature(player)).not.toBe(playerSignature({ ...player, score: 11 }));
  });

  it("ignoriert winzige Aenderungen an laufenden Timern", () => {
    // Sonst wuerde jeder Tick als Aenderung gelten und der Diff waere sinnlos.
    const player = makeSnapshotPlayer({ stunnedMsLeft: 1_000 });
    expect(playerSignature(player)).toBe(playerSignature({ ...player, stunnedMsLeft: 999 }));
  });

  it("bemerkt es, wenn ein Timer sichtbar weiterlaeuft", () => {
    const player = makeSnapshotPlayer({ stunnedMsLeft: 1_000 });
    expect(playerSignature(player)).not.toBe(playerSignature({ ...player, stunnedMsLeft: 500 }));
  });
});

describe("pickupSignature", () => {
  it("unterscheidet Orbs nach Position und Wert", () => {
    const orb = makeOrb({ x: 10, value: 8 });
    expect(pickupSignature(orb)).not.toBe(pickupSignature({ ...orb, x: 12 }));
    expect(pickupSignature(orb)).not.toBe(pickupSignature({ ...orb, value: 9 }));
  });
});

describe("diffSnapshot", () => {
  it("sendet dem frisch verbundenen Client ein volles Snapshot", () => {
    const state = createStreamState();
    const players = [makeSnapshotPlayer()];
    const pickups = [makeOrb()];

    const diff = diffSnapshot(state, players, pickups, META, NOW);

    expect(diff?.full).toBe(true);
    expect(diff?.players).toHaveLength(1);
    expect(diff?.pickups).toHaveLength(1);
  });

  it("sendet gar nichts, wenn sich nichts geaendert hat", () => {
    const state = createStreamState();
    const players = [makeSnapshotPlayer()];
    const pickups = [makeOrb()];

    diffSnapshot(state, players, pickups, META, NOW);
    const second = diffSnapshot(state, players, pickups, META, NOW + 16);

    expect(second).toBeNull();
  });

  it("schickt nur den Spieler, der sich bewegt hat", () => {
    const state = createStreamState();
    const mover = makeSnapshotPlayer({ id: "mover", x: 100 });
    const idler = makeSnapshotPlayer({ id: "idler", x: 500 });

    diffSnapshot(state, [mover, idler], [], META, NOW);
    const diff = diffSnapshot(state, [{ ...mover, x: 140 }, idler], [], META, NOW + 16);

    expect(diff?.full).toBe(false);
    expect(diff?.players.map((player) => player.id)).toEqual(["mover"]);
  });

  it("meldet eingesammelte Orbs als entfernt", () => {
    const state = createStreamState();
    const player = makeSnapshotPlayer();
    const eaten = makeOrb({ id: "orb-eaten" });
    const remaining = makeOrb({ id: "orb-remaining" });

    diffSnapshot(state, [player], [eaten, remaining], META, NOW);
    const diff = diffSnapshot(state, [player], [remaining], META, NOW + 16);

    expect(diff?.removedPickupIds).toEqual(["orb-eaten"]);
    expect(diff?.pickups).toEqual([]);
  });

  it("meldet Spieler als entfernt, die verschwunden sind (Tarnung oder Disconnect)", () => {
    const state = createStreamState();
    const staying = makeSnapshotPlayer({ id: "bleibt" });
    const leaving = makeSnapshotPlayer({ id: "weg" });

    diffSnapshot(state, [staying, leaving], [], META, NOW);
    const diff = diffSnapshot(state, [staying], [], META, NOW + 16);

    expect(diff?.removedPlayerIds).toEqual(["weg"]);
  });

  it("sendet ein Paket, wenn sich nur das Kopfgeld aendert", () => {
    const state = createStreamState();
    const players = [makeSnapshotPlayer()];

    diffSnapshot(state, players, [], "bounty-a", NOW);
    const diff = diffSnapshot(state, players, [], "bounty-b", NOW + 16);

    expect(diff).not.toBeNull();
    expect(diff?.players).toEqual([]);
  });

  it("resynchronisiert nach STREAM_FULL_RESYNC_MS wieder vollstaendig", () => {
    const state = createStreamState();
    const players = [makeSnapshotPlayer()];
    const pickups = [makeOrb()];

    diffSnapshot(state, players, pickups, META, NOW);
    const kurzDavor = diffSnapshot(state, players, pickups, META, NOW + STREAM_FULL_RESYNC_MS - 1);
    const faellig = diffSnapshot(state, players, pickups, META, NOW + STREAM_FULL_RESYNC_MS);

    expect(kurzDavor).toBeNull();
    expect(faellig?.full).toBe(true);
    expect(faellig?.pickups).toHaveLength(1);
  });

  it("erzwingt auf Wunsch ein volles Snapshot", () => {
    const state = createStreamState();
    const players = [makeSnapshotPlayer()];

    diffSnapshot(state, players, [], META, NOW);
    const forced = diffSnapshot(state, players, [], META, NOW + 16, true);

    expect(forced?.full).toBe(true);
  });

  it("meldet ein Orb, das wieder auftaucht, nicht faelschlich als entfernt", () => {
    const state = createStreamState();
    const player = makeSnapshotPlayer();
    const orb = makeOrb({ id: "orb-1" });

    diffSnapshot(state, [player], [orb], META, NOW);
    diffSnapshot(state, [player], [], META, NOW + 16);
    const diff = diffSnapshot(state, [player], [orb], META, NOW + 32);

    expect(diff?.removedPickupIds).toEqual([]);
    expect(diff?.pickups.map((pickup) => pickup.id)).toEqual(["orb-1"]);
  });
});
