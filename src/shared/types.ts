export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type Rotation = {
  pitch: number;
  yaw: number;
  roll: number;
};

export type PlayerStatus = "lobby" | "alive" | "dead";
export type RoomPhase = "lobby" | "playing" | "ended";
export type ProjectileType = "bullet" | "missile";

export type InputFrame = {
  seq: number;
  thrust: number;
  pitch: number;
  yaw: number;
  roll: number;
  fireGun: boolean;
  fireMissile: boolean;
  afterburner: boolean;
  timestamp: number;
};

export type PlayerState = {
  id: string;
  name: string;
  color: string;
  status: PlayerStatus;
  position: Vec3;
  velocity: Vec3;
  rotation: Rotation;
  throttle: number;
  health: number;
  score: number;
  deaths: number;
  gunHeat: number;
  gunCooldown: number;
  missileCooldown: number;
  respawnAt: number;
  lastInputSeq: number;
  input: InputFrame;
};

export type ProjectileState = {
  id: string;
  type: ProjectileType;
  ownerId: string;
  targetId?: string;
  position: Vec3;
  velocity: Vec3;
  ttl: number;
  damage: number;
  createdAt: number;
};

export type CombatEvent =
  | {
      type: "hit";
      roomId: string;
      attackerId: string;
      victimId: string;
      damage: number;
      weapon: ProjectileType;
    }
  | {
      type: "kill";
      roomId: string;
      attackerId: string;
      victimId: string;
    }
  | {
      type: "respawn";
      roomId: string;
      playerId: string;
    }
  | {
      type: "launch";
      roomId: string;
      playerId: string;
      weapon: ProjectileType;
    };

export type RoomState = {
  id: string;
  hostId: string;
  phase: RoomPhase;
  players: Record<string, PlayerState>;
  projectiles: Record<string, ProjectileState>;
  startedAt: number;
  endsAt: number;
  roundMs: number;
  now: number;
  winnerId?: string;
};

export type RoomJoinedPayload = {
  roomId: string;
  playerId: string;
  room: RoomState;
};

export type RoomErrorPayload = {
  message: string;
};

export type StateSnapshotPayload = {
  tick: number;
  room: RoomState;
};

export type RoundEndedPayload = {
  room: RoomState;
  winnerId?: string;
};
