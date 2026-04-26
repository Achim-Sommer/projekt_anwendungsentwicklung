export type HazardType = "pit" | "lava" | "electric";

export interface Vec2 {
  x: number;
  y: number;
}

export interface HazardZone {
  id: string;
  type: HazardType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArenaState {
  width: number;
  height: number;
  hazards: HazardZone[];
}

export type PickupKind = "mass" | "speed" | "shield" | "stealth" | "score" | "rocket";

export interface ForceOrb {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  value: number;
  radius: number;
}

export type SkinId = "starter" | "mint" | "sunset" | "rose" | "gold";
export type MatchEventKind = "none" | "double_orbs" | "haste" | "bounty_rush";

export interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  isBot: boolean;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  skinId: SkinId;
  spawnProtectionMsLeft: number;
  speedBoostMsLeft: number;
  invulnerableMsLeft: number;
  stealthMsLeft: number;
  stunnedMsLeft: number;
  shockCooldownMsLeft: number;
  rocketAmmo: number;
  mass: number;
  score: number;
  isBot: boolean;
  alive: boolean;
}

export interface SnapshotDebugInfo {
  serverTickMs: number;
  snapshotRate: number;
  leaderboardRate: number;
  combatActive: boolean;
  orbCount: number;
  orbCap: number;
}

export interface ActiveMatchEventSnapshot {
  kind: MatchEventKind;
  title: string;
  description: string;
  msLeft: number;
}

export interface GameSnapshot {
  tick: number;
  serverTime: number;
  players: PlayerSnapshot[];
  pickups: ForceOrb[];
  full?: boolean;
  removedPlayerIds?: string[];
  removedPickupIds?: string[];
  leaderboard?: LeaderboardEntry[];
  bountyTargetId?: string | null;
  bountyBonus?: number;
  specialBountyActive?: boolean;
  activeEvent?: ActiveMatchEventSnapshot;
  debug?: SnapshotDebugInfo;
}

export interface WelcomePayload {
  yourId: string;
  arena: ArenaState;
  snapshot: GameSnapshot;
}

export interface PlayerLeftPayload {
  id: string;
}

export interface PlayerInputPayload {
  seq: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  ability: boolean;
  rocketFire: boolean;
  aimX: number;
  aimY: number;
}

export interface DebugPingPayload {
  clientSentAt: number;
}

export interface DebugPongPayload {
  clientSentAt: number;
  serverTime: number;
}

export interface RocketShotPayload {
  shooterId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  hitPlayerId?: string;
  serverTime: number;
}

export interface ServerToClientEvents {
  welcome: (payload: WelcomePayload) => void;
  snapshot: (payload: GameSnapshot) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
  debugPong: (payload: DebugPongPayload) => void;
  rocketShot: (payload: RocketShotPayload) => void;
}

export interface ClientToServerEvents {
  input: (payload: PlayerInputPayload) => void;
  debugPing: (payload: DebugPingPayload) => void;
}
