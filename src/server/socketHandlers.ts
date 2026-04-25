import type { Server, Socket } from "socket.io";
import { TICK_RATE } from "../shared/constants.js";
import type { InputFrame, RoomErrorPayload, RoomJoinedPayload, RoundEndedPayload, RoomState, StateSnapshotPayload } from "../shared/types.js";
import { GameRoomManager, normalizeRoomId, type JoinResult } from "./gameServer.js";

export function registerGameSocketHandlers(io: Server, manager: GameRoomManager): void {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload: { name?: string } = {}) => {
      joinSocketRoom(io, manager, socket, () => manager.createRoom(socket.id, payload.name ?? "Pilot"));
    });

    socket.on("room:join", (payload: { roomId?: string; name?: string } = {}) => {
      const roomId = normalizeRoomId(payload.roomId ?? "");
      joinSocketRoom(io, manager, socket, () => manager.joinRoom(roomId, socket.id, payload.name ?? "Pilot"));
    });

    socket.on("round:start", () => {
      const result = manager.startRoom(socket.id);
      if (!result.ok) {
        emitError(socket, result.message);
        return;
      }

      emitSnapshot(io, manager, result.room);
    });

    socket.on("input:update", (input: Partial<InputFrame>) => {
      manager.setInput(socket.id, input);
    });

    socket.on("disconnect", () => {
      const changedRooms = manager.removePlayer(socket.id);
      changedRooms.forEach((room) => emitSnapshot(io, manager, room));
    });
  });
}

export function startGameLoop(io: Server, manager: GameRoomManager): NodeJS.Timeout {
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

function joinSocketRoom(io: Server, manager: GameRoomManager, socket: Socket, join: () => JoinResult): void {
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

function emitJoined(socket: Socket, room: RoomState, playerId: string): void {
  const payload: RoomJoinedPayload = { roomId: room.id, playerId, room };
  socket.emit("room:joined", payload);
}

function emitError(socket: Socket, message: string): void {
  const payload: RoomErrorPayload = { message };
  socket.emit("room:error", payload);
}

function emitSnapshot(io: Server, manager: GameRoomManager, room: RoomState): void {
  const payload: StateSnapshotPayload = { tick: manager.getTick(), room };
  io.to(room.id).emit("state:snapshot", payload);
}
