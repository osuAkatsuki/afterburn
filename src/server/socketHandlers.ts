import type { Server, Socket } from "socket.io";
import { TICK_RATE } from "../shared/constants.js";
import type {
  ClientToServerEvents,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoundEndedPayload,
  RoomState,
  BotSkill,
  ServerToClientEvents,
  StateSnapshotPayload
} from "../shared/types.js";
import { GameRoomManager, normalizeRoomId, type JoinResult } from "./gameServer.js";

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerGameSocketHandlers(io: GameServer, manager: GameRoomManager): void {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}) => {
      joinSocketRoom(io, manager, socket, () => manager.createRoom(socket.id, readName(payload), Date.now(), readClientId(payload)));
    });

    socket.on("room:join", (payload = {}) => {
      const roomId = normalizeRoomId(readRoomId(payload));
      joinSocketRoom(io, manager, socket, () => manager.joinRoom(roomId, socket.id, readName(payload), Date.now(), readClientId(payload)));
    });

    socket.on("round:start", (payload = {}) => {
      const result = manager.startRoom(socket.id, Date.now(), Boolean(payload?.force));
      if (!result.ok) {
        emitError(socket, result.message);
        return;
      }

      emitSnapshot(io, manager, result.room);
    });

    socket.on("player:ready", (payload = {}) => {
      const result = manager.setReady(socket.id, payload?.ready);
      if (!result.ok) {
        emitError(socket, result.message);
        return;
      }

      emitSnapshot(io, manager, result.room);
    });

    socket.on("player:rename", (payload = {}) => {
      const result = manager.renamePlayer(socket.id, readName(payload));
      if (!result.ok) {
        emitError(socket, result.message);
        return;
      }

      emitSnapshot(io, manager, result.room);
    });

    socket.on("bot:add", (payload = {}) => {
      const count = readBotCount(payload);
      const skill = readBotSkill(payload);
      let latestRoom: RoomState | undefined;

      for (let i = 0; i < count; i += 1) {
        const result = manager.addBot(socket.id, Date.now(), skill);
        if (!result.ok) {
          emitError(socket, result.message);
          break;
        }

        latestRoom = result.room;
      }

      if (latestRoom) {
        emitSnapshot(io, manager, latestRoom);
      }
    });

    socket.on("bot:remove", (payload = {}) => {
      const result = manager.removeBot(socket.id, readPlayerId(payload));
      if (!result.ok) {
        emitError(socket, result.message);
        return;
      }

      emitSnapshot(io, manager, result.room);
    });

    socket.on("input:update", (input) => {
      manager.setInput(socket.id, input);
    });

    socket.on("net:ping", (payload) => {
      socket.emit("net:pong", {
        clientTime: typeof payload?.clientTime === "number" && Number.isFinite(payload.clientTime) ? payload.clientTime : 0,
        serverTime: Date.now()
      });
    });

    socket.on("net:latency", (payload) => {
      const room = manager.setLatency(socket.id, payload?.rttMs, payload?.interpolationDelayMs);
      if (room && room.phase !== "playing") {
        emitSnapshot(io, manager, room);
      }
    });

    socket.on("disconnect", () => {
      const changedRooms = manager.disconnectSocket(socket.id);
      changedRooms.forEach((room) => emitSnapshot(io, manager, room));
    });
  });
}

export function startGameLoop(io: GameServer, manager: GameRoomManager): NodeJS.Timeout {
  return setInterval(() => {
    manager.tickRooms().forEach(({ room, events, ended }) => {
      events.forEach((event) => {
        io.to(room.id).emit("combat:event", event);
      });

      emitSnapshot(io, manager, room);

      if (ended) {
        const payload: RoundEndedPayload = { room, winnerId: room.winnerId };
        io.to(room.id).emit("round:ended", payload);
      }
    });
  }, 1000 / TICK_RATE);
}

function joinSocketRoom(io: GameServer, manager: GameRoomManager, socket: GameSocket, join: () => JoinResult): void {
  const previousRoomId = manager.getRoomForPlayer(socket.id)?.id;
  const result = join();
  if (!result.ok) {
    emitError(socket, result.message);
    return;
  }

  if (previousRoomId && previousRoomId !== result.room.id) {
    socket.leave(previousRoomId);
  }

  socket.join(result.room.id);
  emitJoined(socket, result.room, result.playerId);
  emitSnapshot(io, manager, result.room);
}

function emitJoined(socket: GameSocket, room: RoomState, playerId: string): void {
  const payload: RoomJoinedPayload = { roomId: room.id, playerId, room };
  socket.emit("room:joined", payload);
}

function emitError(socket: GameSocket, message: string): void {
  const payload: RoomErrorPayload = { message };
  socket.emit("room:error", payload);
}

function emitSnapshot(io: GameServer, manager: GameRoomManager, room: RoomState): void {
  const payload: StateSnapshotPayload = { tick: manager.getTick(), sentAt: Date.now(), room };
  io.to(room.id).emit("state:snapshot", payload);
}

function readName(payload: unknown): string {
  const value = readPayloadValue(payload, "name");
  return typeof value === "string" ? value : "Pilot";
}

function readRoomId(payload: unknown): string {
  const value = readPayloadValue(payload, "roomId");
  return typeof value === "string" ? value : "";
}

function readClientId(payload: unknown): string | undefined {
  const value = readPayloadValue(payload, "clientId");
  return typeof value === "string" ? value : undefined;
}

function readPlayerId(payload: unknown): string {
  const value = readPayloadValue(payload, "playerId");
  return typeof value === "string" ? value : "";
}

function readBotCount(payload: unknown): number {
  const value = readPayloadValue(payload, "count");
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(6, Math.floor(value))) : 1;
}

function readBotSkill(payload: unknown): BotSkill {
  const value = readPayloadValue(payload, "skill");
  return value === "ace" ? "ace" : "regular";
}

function readPayloadValue(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}
