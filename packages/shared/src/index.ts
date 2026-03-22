/** Payload sent from server → client when a player joins. */
export interface PlayerJoinedPayload {
  id: string;
  x: number;
  y: number;
}

/** Payload sent from server → client when a player leaves. */
export interface PlayerLeftPayload {
  id: string;
}

/** Payload sent from client → server when requesting a position update. */
export interface MovePayload {
  x: number;
  y: number;
}

/** Payload sent from server → client with the authoritative position of a player. */
export interface PositionUpdatePayload {
  id: string;
  x: number;
  y: number;
}

/** All events exchanged over Socket.IO. */
export interface ServerToClientEvents {
  playerJoined: (payload: PlayerJoinedPayload) => void;
  playerLeft: (payload: PlayerLeftPayload) => void;
  positionUpdate: (payload: PositionUpdatePayload) => void;
}

export interface ClientToServerEvents {
  move: (payload: MovePayload) => void;
}
