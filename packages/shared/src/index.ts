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

export interface ForceOrb {
  id: string;
  x: number;
  y: number;
  value: number;
  radius: number;
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
  mass: number;
  score: number;
  isBot: boolean;
  alive: boolean;
}

export interface GameSnapshot {
  tick: number;
  serverTime: number;
  players: PlayerSnapshot[];
  pickups: ForceOrb[];
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
}

export interface ServerToClientEvents {
  welcome: (payload: WelcomePayload) => void;
  snapshot: (payload: GameSnapshot) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
}

export interface ClientToServerEvents {
  input: (payload: PlayerInputPayload) => void;
}
