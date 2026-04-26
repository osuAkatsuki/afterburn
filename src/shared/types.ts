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

export type Quaternion = {
  x: number;
  y: number;
  z: number;
  w: number;
};

export type PlayerStatus = "lobby" | "alive" | "dead";
export type RoomPhase = "lobby" | "playing" | "ended";
export type ProjectileType = "bullet" | "missile" | "flare";
export type MissileTargetType = "player" | "flare";

export type InputFrame = {
  seq: number;
  thrust: number;
  pitch: number;
  yaw: number;
  roll: number;
  fireGun: boolean;
  fireMissile: boolean;
  fireFlare: boolean;
  afterburner: boolean;
  aimDirection?: Vec3;
  timestamp: number;
};

export type PlayerState = {
  id: string;
  name: string;
  color: string;
  isBot: boolean;
  ready: boolean;
  status: PlayerStatus;
  position: Vec3;
  velocity: Vec3;
  rotation: Rotation;
  orientation?: Quaternion;
  throttle: number;
  health: number;
  score: number;
  deaths: number;
  latencyMs: number;
  gunHeat: number;
  gunCooldown: number;
  missilesRemaining: number;
  flaresRemaining: number;
  missileCooldown: number;
  flareCooldown: number;
  missileLockTargetId?: string;
  missileLockProgress: number;
  missileLockAcquired: boolean;
  outOfBoundsUntil?: number;
  outOfBoundsRemainingMs: number;
  spawnProtectionUntil?: number;
  spawnProtectionRemainingMs: number;
  respawnAt: number;
  lastInputSeq: number;
  input: InputFrame;
};

export type ProjectileState = {
  id: string;
  type: ProjectileType;
  ownerId: string;
  targetId?: string;
  targetType?: MissileTargetType;
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
    }
  | {
      type: "impact";
      roomId: string;
      ownerId: string;
      projectileType: "bullet" | "missile";
      position: Vec3;
      reason: "terrain" | "player" | "flare";
    }
  | {
      type: "crash";
      roomId: string;
      playerId: string;
      reason: "terrain" | "out-of-bounds" | "collision";
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
  sentAt: number;
  room: RoomState;
};

export type RoundEndedPayload = {
  room: RoomState;
  winnerId?: string;
};

export type RoomCreatePayload = {
  name?: string;
  clientId?: string;
};

export type RoomJoinPayload = {
  roomId?: string;
  name?: string;
  clientId?: string;
};

export type PlayerRenamePayload = {
  name?: string;
};

export type PlayerReadyPayload = {
  ready?: boolean;
};

export type RoundStartPayload = {
  force?: boolean;
};

export type BotAddPayload = {
  count?: number;
};

export type BotRemovePayload = {
  playerId?: string;
};

export type NetPingPayload = {
  clientTime: number;
};

export type NetPongPayload = {
  clientTime: number;
  serverTime: number;
};

export type NetLatencyPayload = {
  rttMs: number;
};

export type ClientToServerEvents = {
  "room:create": (payload?: RoomCreatePayload) => void;
  "room:join": (payload?: RoomJoinPayload) => void;
  "round:start": (payload?: RoundStartPayload) => void;
  "player:rename": (payload?: PlayerRenamePayload) => void;
  "player:ready": (payload?: PlayerReadyPayload) => void;
  "bot:add": (payload?: BotAddPayload) => void;
  "bot:remove": (payload?: BotRemovePayload) => void;
  "input:update": (input: Partial<InputFrame>) => void;
  "net:ping": (payload: NetPingPayload) => void;
  "net:latency": (payload: NetLatencyPayload) => void;
};

export type ServerToClientEvents = {
  "room:joined": (payload: RoomJoinedPayload) => void;
  "room:error": (payload: RoomErrorPayload) => void;
  "state:snapshot": (payload: StateSnapshotPayload) => void;
  "combat:event": (event: CombatEvent) => void;
  "round:ended": (payload: RoundEndedPayload) => void;
  "net:pong": (payload: NetPongPayload) => void;
};
