import { MAX_PLAYERS, TICK_RATE } from "../shared/constants.js";
import {
  addPlayerToRoom,
  createPlayer,
  createRoomState,
  resetPlayerForRound,
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
  private tick = 0;

  constructor(private readonly makeRoomId = defaultRoomId) {}

  createRoom(socketId: string, name: string, now = Date.now()): JoinResult {
    if (this.playerRooms.has(socketId)) {
      this.removePlayer(socketId);
    }

    const roomId = this.uniqueRoomId();
    const room = createRoomState(roomId, socketId, now);
    const player = createPlayer(socketId, name, 0, now);
    addPlayerToRoom(room, player);
    this.rooms.set(roomId, room);
    this.playerRooms.set(socketId, roomId);

    return { ok: true, room, playerId: socketId };
  }

  joinRoom(roomId: string, socketId: string, name: string, now = Date.now()): JoinResult {
    const normalized = normalizeRoomId(roomId);
    const room = this.rooms.get(normalized);

    if (!room) {
      return { ok: false, message: "Room not found." };
    }

    if (Object.keys(room.players).length >= MAX_PLAYERS) {
      return { ok: false, message: "That room is full." };
    }

    if (this.playerRooms.has(socketId)) {
      this.removePlayer(socketId);
    }

    const player = createPlayer(socketId, name, Object.keys(room.players).length, now);
    addPlayerToRoom(room, player);
    if (room.phase === "playing") {
      resetPlayerForRound(player, Object.keys(room.players).length - 1, now);
    }

    this.playerRooms.set(socketId, normalized);
    room.now = now;

    return { ok: true, room, playerId: socketId };
  }

  startRoom(socketId: string, now = Date.now()): JoinResult {
    const room = this.getRoomForPlayer(socketId);
    if (!room) {
      return { ok: false, message: "Join or create a room first." };
    }

    if (room.hostId !== socketId) {
      return { ok: false, message: "Only the host can start the round." };
    }

    if (room.phase === "playing") {
      return { ok: false, message: "This room is already flying." };
    }

    const players = Object.values(room.players);
    if (players.length < 1) {
      return { ok: false, message: "Need at least one pilot to start." };
    }

    startRound(room, now);
    return { ok: true, room, playerId: socketId };
  }

  setInput(socketId: string, input: Partial<InputFrame>): void {
    const room = this.getRoomForPlayer(socketId);
    const player = room?.players[socketId];
    if (!room || !player || room.phase !== "playing" || player.status !== "alive") {
      return;
    }

    setPlayerInput(player, input);
  }

  removePlayer(socketId: string): RoomState[] {
    const roomId = this.playerRooms.get(socketId);
    const room = roomId ? this.rooms.get(roomId) : undefined;
    if (!room) {
      return [];
    }

    delete room.players[socketId];
    this.playerRooms.delete(socketId);
    room.now = Date.now();

    if (room.hostId === socketId) {
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
      const wasPlaying = room.phase === "playing";
      const events = stepRoom(room, 1 / TICK_RATE, now);
      const ended = wasPlaying && room.phase === "ended";

      if (wasPlaying || events.length > 0 || ended) {
        results.push({ room, events, ended });
      }
    });

    return results;
  }

  getTick(): number {
    return this.tick;
  }

  getRoomForPlayer(socketId: string): RoomState | undefined {
    const roomId = this.playerRooms.get(socketId);
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
}

export function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function defaultRoomId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 5; i += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return id;
}
