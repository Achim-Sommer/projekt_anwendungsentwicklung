// Diff-Snapshots: Jeder Client bekommt nur, was sich seit seinem letzten
// Paket geaendert hat.
//
// Das spart Bandbreite, ist aber die fehleranfaelligste Stelle im Netzcode:
// Vergisst der Diff eine Entfernung, sieht der Client Geister-Orbs. Deshalb
// liegt die Logik hier isoliert und wird direkt getestet.

import type { ForceOrb, PlayerSnapshot } from "@projekt/shared";
import { STREAM_FULL_RESYNC_MS } from "../config";
import { clamp } from "./math";

export interface StreamState {
  initialized: boolean;
  lastFullAt: number;
  playerSignatures: Map<string, string>;
  pickupSignatures: Map<string, string>;
  lastMetaSignature: string;
}

export interface SnapshotDiff {
  full: boolean;
  players: PlayerSnapshot[];
  pickups: ForceOrb[];
  removedPlayerIds: string[];
  removedPickupIds: string[];
}

export function createStreamState(): StreamState {
  return {
    initialized: false,
    lastFullAt: 0,
    playerSignatures: new Map<string, string>(),
    pickupSignatures: new Map<string, string>(),
    lastMetaSignature: "",
  };
}

/**
 * Fingerabdruck eines Spielers. Zeiten laufen ueber Buckets (z. B. 120 ms),
 * damit ein herunterzaehlender Timer nicht bei jedem Tick als "geaendert"
 * gilt — Positionen dagegen auf 0,1 Einheiten genau.
 */
export function playerSignature(player: PlayerSnapshot): string {
  const protectionBucket = Math.ceil(player.spawnProtectionMsLeft / 120);
  const speedBucket = Math.ceil(player.speedBoostMsLeft / 180);
  const invulnerabilityBucket = Math.ceil(player.invulnerableMsLeft / 180);
  const stealthBucket = Math.ceil(player.stealthMsLeft / 180);
  const stunBucket = Math.ceil(player.stunnedMsLeft / 120);
  const shockCooldownBucket = Math.ceil(player.shockCooldownMsLeft / 250);
  const rocketAmmoBucket = clamp(Math.round(player.rocketAmmo), 0, 9);
  return [
    Math.round(player.x * 10),
    Math.round(player.y * 10),
    Math.round(player.vx * 10),
    Math.round(player.vy * 10),
    Math.round(player.radius * 10),
    player.score,
    player.alive ? 1 : 0,
    player.skinId,
    protectionBucket,
    speedBucket,
    invulnerabilityBucket,
    stealthBucket,
    stunBucket,
    shockCooldownBucket,
    rocketAmmoBucket,
  ].join("|");
}

export function pickupSignature(pickup: ForceOrb): string {
  return [pickup.id, pickup.kind, Math.round(pickup.x), Math.round(pickup.y), pickup.value, pickup.radius].join("|");
}

/**
 * Vergleicht den aktuellen Weltzustand mit dem zuletzt an diesen Client
 * gesendeten und schreibt den neuen Stand in `streamState`.
 *
 * - erstes Paket, erzwungenes Paket oder STREAM_FULL_RESYNC_MS abgelaufen
 *   → volles Snapshot (full = true)
 * - sonst nur geaenderte und entfernte Objekte
 * - hat sich nichts geaendert → null, es wird gar nichts gesendet
 */
export function diffSnapshot(
  streamState: StreamState,
  visiblePlayers: PlayerSnapshot[],
  visiblePickups: ForceOrb[],
  metaSignature: string,
  now: number,
  forceFull = false,
): SnapshotDiff | null {
  const shouldFull =
    forceFull || !streamState.initialized || now - streamState.lastFullAt >= STREAM_FULL_RESYNC_MS;

  const nextPlayerSignatures = new Map<string, string>();
  for (const player of visiblePlayers) {
    nextPlayerSignatures.set(player.id, playerSignature(player));
  }

  const nextPickupSignatures = new Map<string, string>();
  for (const pickup of visiblePickups) {
    nextPickupSignatures.set(pickup.id, pickupSignature(pickup));
  }

  if (shouldFull) {
    streamState.initialized = true;
    streamState.lastFullAt = now;
    streamState.playerSignatures = nextPlayerSignatures;
    streamState.pickupSignatures = nextPickupSignatures;
    streamState.lastMetaSignature = metaSignature;
    return {
      full: true,
      players: visiblePlayers,
      pickups: visiblePickups,
      removedPlayerIds: [],
      removedPickupIds: [],
    };
  }

  const changedPlayers = visiblePlayers.filter((player) => {
    return nextPlayerSignatures.get(player.id) !== streamState.playerSignatures.get(player.id);
  });
  const changedPickups = visiblePickups.filter((pickup) => {
    return nextPickupSignatures.get(pickup.id) !== streamState.pickupSignatures.get(pickup.id);
  });
  const removedPlayerIds = Array.from(streamState.playerSignatures.keys()).filter(
    (id) => !nextPlayerSignatures.has(id),
  );
  const removedPickupIds = Array.from(streamState.pickupSignatures.keys()).filter(
    (id) => !nextPickupSignatures.has(id),
  );
  const metaChanged = metaSignature !== streamState.lastMetaSignature;

  streamState.playerSignatures = nextPlayerSignatures;
  streamState.pickupSignatures = nextPickupSignatures;
  streamState.lastMetaSignature = metaSignature;

  if (
    changedPlayers.length === 0 &&
    changedPickups.length === 0 &&
    removedPlayerIds.length === 0 &&
    removedPickupIds.length === 0 &&
    !metaChanged
  ) {
    return null;
  }

  return {
    full: false,
    players: changedPlayers,
    pickups: changedPickups,
    removedPlayerIds,
    removedPickupIds,
  };
}
