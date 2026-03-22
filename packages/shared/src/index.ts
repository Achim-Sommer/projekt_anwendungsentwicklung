export type MagnetMode =
  | "balanced"
  | "strong-push"
  | "long-pull"
  | "aoe"
  | "sticky";

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

export interface PlayerSnapshot {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: number;
  energy: number;
  mode: MagnetMode;
  score: number;
  isBot: boolean;
  alive: boolean;
}

export interface GameSnapshot {
  tick: number;
  serverTime: number;
  arena: ArenaState;
  players: PlayerSnapshot[];
}

export interface WelcomePayload {
  yourId: string;
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
  push: boolean;
  pull: boolean;
  aimX: number;
  aimY: number;
}

export interface ServerToClientEvents {
  welcome: (payload: WelcomePayload) => void;
  snapshot: (payload: GameSnapshot) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
}

export interface ClientToServerEvents {
  input: (payload: PlayerInputPayload) => void;
}
