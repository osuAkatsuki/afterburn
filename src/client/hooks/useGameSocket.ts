import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CombatEvent,
  InputFrame,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomState,
  RoundEndedPayload,
  StateSnapshotPayload
} from "../../shared/types.js";

type ConnectionStatus = "Connecting" | "Online" | "Offline";

type CombatNotice = {
  id: number;
  event: CombatEvent;
};

type RoundEndedNotice = {
  id: number;
  payload: RoundEndedPayload;
};

export function useGameSocket() {
  const socketRef = useRef<Socket | null>(null);
  const noticeId = useRef(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Connecting");
  const [statusLine, setStatusLine] = useState("");
  const [room, setRoom] = useState<RoomState>();
  const [playerId, setPlayerId] = useState("");
  const [combatNotice, setCombatNotice] = useState<CombatNotice>();
  const [roundEndedNotice, setRoundEndedNotice] = useState<RoundEndedNotice>();

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("Online");
      setStatusLine("");
    });
    socket.on("disconnect", () => {
      setConnectionStatus("Offline");
      setStatusLine("Connection lost.");
    });
    socket.on("room:error", (payload: RoomErrorPayload) => {
      setStatusLine(payload.message);
    });
    socket.on("room:joined", (payload: RoomJoinedPayload) => {
      setRoom(payload.room);
      setPlayerId(payload.playerId);
      setStatusLine("");
      history.replaceState(null, "", `?room=${payload.roomId}`);
    });
    socket.on("state:snapshot", (payload: StateSnapshotPayload) => {
      setRoom(payload.room);
    });
    socket.on("combat:event", (event: CombatEvent) => {
      noticeId.current += 1;
      setCombatNotice({ id: noticeId.current, event });
    });
    socket.on("round:ended", (payload: RoundEndedPayload) => {
      setRoom(payload.room);
      noticeId.current += 1;
      setRoundEndedNotice({ id: noticeId.current, payload });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const createRoom = useCallback((name: string) => {
    socketRef.current?.emit("room:create", { name });
  }, []);

  const joinRoom = useCallback((roomId: string, name: string) => {
    socketRef.current?.emit("room:join", { roomId, name });
  }, []);

  const startRound = useCallback(() => {
    socketRef.current?.emit("round:start");
  }, []);

  const sendInput = useCallback((input: InputFrame) => {
    socketRef.current?.emit("input:update", input);
  }, []);

  const setLocalStatus = useCallback((message: string) => {
    setStatusLine(message);
  }, []);

  return {
    combatNotice,
    connectionStatus,
    createRoom,
    joinRoom,
    playerId,
    room,
    roundEndedNotice,
    sendInput,
    setLocalStatus,
    startRound,
    statusLine
  };
}
