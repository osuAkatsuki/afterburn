import { DISCONNECT_GRACE_MS, MAX_PLAYERS, TICK_RATE } from "../shared/constants.js";
import {
  addPlayerToRoom,
  cleanName,
  createPlayer,
  createRoomState,
  neutralInput,
  resetPlayerForRound,
  sanitizeInput,
  setPlayerInput,
  startRound,
  stepRoom
} from "../shared/simulation.js";
import type { CombatEvent, InputFrame, RoomState } from "../shared/types.js";

export type JoinResult =
  | { ok: true; room: RoomState; playerId: string }
  | { ok: false; message: string };

export type TickResult = {
  room: RoomState;
  events: CombatEvent[];
  ended: boolean;
};

export class GameRoomManager {
  readonly rooms = new Map<string, RoomState>();
  private readonly playerRooms = new Map<string, string>();
  private readonly socketPlayers = new Map<string, string>();
  private readonly playerSockets = new Map<string, string>();
  private readonly disconnectedAt = new Map<string, number>();
  private readonly inputQueues = new Map<string, InputFrame[]>();
  private tick = 0;

  constructor(private readonly makeRoomId = defaultRoomId) {}

  createRoom(socketId: string, name: string, now = Date.now(), clientId: unknown = socketId): JoinResult {
    let playerId = normalizeClientId(clientId, socketId);

    if (this.isActivePlayerOnAnotherSocket(playerId, socketId)) {
      playerId = this.uniquePlayerId(playerId, socketId);
    } else if (this.playerRooms.has(playerId)) {
      this.removePlayer(playerId);
    }

    const roomId = this.uniqueRoomId();
    const room = createRoomState(roomId, playerId, now);
    const player = createPlayer(playerId, uniquePlayerName(room, name, playerId), 0, now);
    addPlayerToRoom(room, player);
    this.rooms.set(roomId, room);
    this.attachSocket(socketId, playerId, roomId);

    return { ok: true, room, playerId };
  }

  joinRoom(roomId: string, socketId: string, name: string, now = Date.now(), clientId: unknown = socketId): JoinResult {
    const normalized = normalizeRoomId(roomId);
    const room = this.rooms.get(normalized);
    let playerId = normalizeClientId(clientId, socketId);

    if (!room) {
      return { ok: false, message: "Room not found." };
    }

    const existingPlayer = room.players[playerId];
    if (existingPlayer) {
      if (!this.isActivePlayerOnAnotherSocket(playerId, socketId)) {
        existingPlayer.name = uniquePlayerName(room, name, playerId);
        this.attachSocket(socketId, playerId, normalized);
        room.now = now;
        return { ok: true, room, playerId };
      }

      playerId = this.uniquePlayerId(playerId, socketId, room);
    }

    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      return { ok: false, message: "That room is full." };
    }

    if (this.playerRooms.has(playerId)) {
      this.removePlayer(playerId);
    }

    const player = createPlayer(playerId, uniquePlayerName(room, name, playerId), Object.keys(room.players).length, now);
    addPlayerToRoom(room, player);
    if (room.phase === "playing") {
      resetPlayerForRound(player, Object.keys(room.players).length - 1, now);
    }

    this.attachSocket(socketId, playerId, normalized);
    room.now = now;

    return { ok: true, room, playerId };
  }

  startRoom(socketId: string, now = Date.now(), force = false): JoinResult {
    const playerId = this.resolvePlayerId(socketId);
    const room = this.getRoomForPlayer(playerId);
    if (!room) {
      return { ok: false, message: "Join or create a room first." };
    }

    if (room.hostId !== playerId) {
      return { ok: false, message: "Only the host can start the round." };
    }

    if (room.phase === "playing") {
      return { ok: false, message: "This room is already flying." };
    }

    const players = Object.values(room.players);
    if (players.length < 1) {
      return { ok: false, message: "Need at least one pilot to start." };
    }

    const readyPlayers = players.filter((player) => player.ready);
    const hostReady = Boolean(room.players[playerId]?.ready);
    if (!hostReady) {
      return { ok: false, message: "Ready up before launching." };
    }

    if (!force && readyPlayers.length !== players.length) {
      return { ok: false, message: "Waiting for all pilots to ready up." };
    }

    if (force && players.length > 1 && readyPlayers.length < 2) {
      return { ok: false, message: "Need another ready pilot to force start." };
    }

    startRound(room, now);
    this.clearRoomInputQueues(room);
    return { ok: true, room, playerId };
  }

  renamePlayer(socketId: string, name: string, now = Date.now()): JoinResult {
    const playerId = this.resolvePlayerId(socketId);
    const room = this.getRoomForPlayer(playerId);
    const player = room?.players[playerId];
    if (!room || !player) {
      return { ok: false, message: "Join or create a room first." };
    }

    player.name = uniquePlayerName(room, name, playerId);
    room.now = now;
    return { ok: true, room, playerId };
  }

  setReady(socketId: string, ready: unknown, now = Date.now()): JoinResult {
    const playerId = this.resolvePlayerId(socketId);
    const room = this.getRoomForPlayer(playerId);
    const player = room?.players[playerId];
    if (!room || !player) {
      return { ok: false, message: "Join or create a room first." };
    }

    if (room.phase === "playing") {
      return { ok: false, message: "Cannot change ready state while flying." };
    }

    player.ready = Boolean(ready);
    room.now = now;
    return { ok: true, room, playerId };
  }

  setInput(socketId: string, input: Partial<InputFrame>): void {
    const playerId = this.resolvePlayerId(socketId);
    const room = this.getRoomForPlayer(playerId);
    const player = room?.players[playerId];
    if (!room || !player || room.phase !== "playing" || player.status !== "alive") {
      return;
    }

    this.queueInput(player.id, player.lastInputSeq, input);
  }

  setLatency(socketId: string, rttMs: unknown, now = Date.now()): RoomState | undefined {
    const playerId = this.resolvePlayerId(socketId);
    const room = this.getRoomForPlayer(playerId);
    const player = room?.players[playerId];
    if (!room || !player) {
      return undefined;
    }

    player.latencyMs = normalizeLatencyMs(rttMs);
    room.now = now;
    return room;
  }

  disconnectSocket(socketId: string, now = Date.now()): RoomState[] {
    const playerId = this.socketPlayers.get(socketId);
    if (!playerId || this.playerSockets.get(playerId) !== socketId) {
      this.socketPlayers.delete(socketId);
      return [];
    }

    const room = this.getRoomForPlayer(playerId);
    const player = room?.players[playerId];
    this.socketPlayers.delete(socketId);
    this.playerSockets.delete(playerId);
    if (!room || !player) {
      return [];
    }

    this.disconnectedAt.set(playerId, now);
    player.ready = false;
    player.input = neutralInput(now);
    this.inputQueues.delete(playerId);
    room.now = now;
    return [room];
  }

  removePlayer(playerId: string, now = Date.now()): RoomState[] {
    const roomId = this.playerRooms.get(playerId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) {
      return [];
    }

    delete room.players[playerId];
    this.playerRooms.delete(playerId);
    this.disconnectedAt.delete(playerId);
    this.inputQueues.delete(playerId);
    const socketId = this.playerSockets.get(playerId);
    if (socketId) {
      this.socketPlayers.delete(socketId);
    }
    this.playerSockets.delete(playerId);
    room.now = now;

    if (room.hostId === playerId) {
      const nextHost = Object.keys(room.players)[0];
      if (nextHost) {
        room.hostId = nextHost;
      }
    }

    if (Object.keys(room.players).length === 0) {
      this.rooms.delete(room.id);
      return [];
    }

    return [room];
  }

  tickRooms(now = Date.now()): TickResult[] {
    const results: TickResult[] = [];
    this.tick += 1;

    this.rooms.forEach((room) => {
      const cleanupChanged = this.removeExpiredDisconnectedPlayers(room, now);
      if (!this.rooms.has(room.id)) {
        return;
      }

      const wasPlaying = room.phase === "playing";
      if (wasPlaying) {
        this.consumeQueuedInputs(room);
      }
      const events = stepRoom(room, 1 / TICK_RATE, now);
      const ended = wasPlaying && room.phase === "ended";

      if (wasPlaying || events.length > 0 || ended || cleanupChanged) {
        results.push({ room, events, ended });
      }
    });

    return results;
  }

  getTick(): number {
    return this.tick;
  }

  getRoomForPlayer(socketId: string): RoomState | undefined {
    const roomId = this.playerRooms.get(this.resolvePlayerId(socketId));
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getRoom(roomId: string): RoomState | undefined {
    return this.rooms.get(normalizeRoomId(roomId));
  }

  private uniqueRoomId(): string {
    let id = this.makeRoomId();
    while (this.rooms.has(id)) {
      id = this.makeRoomId();
    }

    return id;
  }

  private attachSocket(socketId: string, playerId: string, roomId: string): void {
    const previousPlayerId = this.socketPlayers.get(socketId);
    if (previousPlayerId && previousPlayerId !== playerId && this.playerSockets.get(previousPlayerId) === socketId) {
      this.playerSockets.delete(previousPlayerId);
      this.disconnectedAt.set(previousPlayerId, Date.now());
    }

    const previousSocketId = this.playerSockets.get(playerId);
    if (previousSocketId && previousSocketId !== socketId) {
      this.socketPlayers.delete(previousSocketId);
    }

    this.socketPlayers.set(socketId, playerId);
    this.playerSockets.set(playerId, socketId);
    this.playerRooms.set(playerId, roomId);
    this.disconnectedAt.delete(playerId);
  }

  private queueInput(playerId: string, lastProcessedSeq: number, input: Partial<InputFrame>): void {
    const sanitized = sanitizeInput(input, 0);
    if (sanitized.seq <= lastProcessedSeq) {
      return;
    }

    const queue = this.inputQueues.get(playerId) ?? [];
    const lastQueued = queue.at(-1);
    if (lastQueued && sanitized.seq < lastQueued.seq) {
      return;
    }

    if (lastQueued && sanitized.seq === lastQueued.seq) {
      queue[queue.length - 1] = sanitized;
    } else {
      queue.push(sanitized);
    }

    while (queue.length > 96) {
      queue.shift();
    }

    this.inputQueues.set(playerId, queue);
  }

  private consumeQueuedInputs(room: RoomState): void {
    Object.values(room.players).forEach((player) => {
      if (player.status !== "alive") {
        return;
      }

      const queue = this.inputQueues.get(player.id);
      if (!queue || queue.length === 0) {
        return;
      }

      while (queue.length > 0 && queue[0].seq <= player.lastInputSeq) {
        queue.shift();
      }

      const nextInput = queue.shift();
      if (nextInput) {
        setPlayerInput(player, nextInput);
      }

      if (queue.length === 0) {
        this.inputQueues.delete(player.id);
      }
    });
  }

  private clearRoomInputQueues(room: RoomState): void {
    Object.keys(room.players).forEach((playerId) => this.inputQueues.delete(playerId));
  }

  private resolvePlayerId(socketOrPlayerId: string): string {
    return this.socketPlayers.get(socketOrPlayerId) ?? socketOrPlayerId;
  }

  private isActivePlayerOnAnotherSocket(playerId: string, socketId: string): boolean {
    const activeSocketId = this.playerSockets.get(playerId);
    return Boolean(activeSocketId && activeSocketId !== socketId);
  }

  private uniquePlayerId(preferredPlayerId: string, socketId: string, room?: RoomState): string {
    const socketSuffix = normalizeClientId(socketId, socketId).slice(0, 10);
    const base = `${preferredPlayerId.slice(0, Math.max(1, 52 - socketSuffix.length))}-${socketSuffix}`;
    let candidate = base;
    let index = 2;

    while (this.playerRooms.has(candidate) || room?.players[candidate]) {
      const suffix = `-${index}`;
      candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      index += 1;
    }

    return candidate;
  }

  private removeExpiredDisconnectedPlayers(room: RoomState, now: number): boolean {
    let changed = false;
    Object.keys(room.players).forEach((playerId) => {
      const disconnectedAt = this.disconnectedAt.get(playerId);
      if (disconnectedAt === undefined || now - disconnectedAt < DISCONNECT_GRACE_MS) {
        return;
      }

      this.removePlayer(playerId, now);
      changed = true;
    });
    return changed;
  }
}

export function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

export function normalizeClientId(clientId: unknown, fallback: string): string {
  const raw = typeof clientId === "string" ? clientId : "";
  const normalized = raw.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeLatencyMs(rttMs: unknown): number {
  if (typeof rttMs !== "number" || !Number.isFinite(rttMs)) {
    return 0;
  }

  return Math.max(0, Math.min(9999, Math.round(rttMs)));
}

export function uniquePlayerName(room: RoomState, requestedName: string, playerId: string): string {
  const base = cleanName(requestedName);
  const taken = new Set(
    Object.values(room.players)
      .filter((player) => player.id !== playerId)
      .map((player) => player.name.toLocaleLowerCase())
  );

  if (!taken.has(base.toLocaleLowerCase())) {
    return base;
  }

  for (let index = 2; index < 100; index += 1) {
    const suffix = ` ${index}`;
    const candidate = `${base.slice(0, Math.max(1, 18 - suffix.length))}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }

  return `${base.slice(0, 14)} ${Math.floor(Math.random() * 900 + 100)}`;
}

function defaultRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return id;
}
