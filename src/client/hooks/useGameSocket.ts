import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CombatEvent,
  ClientToServerEvents,
  InputFrame,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomState,
  RoundEndedPayload,
  ServerToClientEvents,
  StateSnapshotPayload
} from "../../shared/types.js";
import { getClientId, persistClientId } from "../net/ClientSession.js";
import { createPingPayload, NetworkTelemetry, PING_INTERVAL_MS, type NetworkStats } from "../net/NetworkTelemetry.js";

export type ConnectionStatus = "Connecting" | "Online" | "Offline";

export type CombatNotice = {
  id: number;
  event: CombatEvent;
};

export type RoundEndedNotice = {
  id: number;
  payload: RoundEndedPayload;
};

type LastJoin = {
  roomId: string;
  name: string;
};

export function useGameSocket() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const noticeId = useRef(0);
  const clientId = useRef(getClientId());
  const lastJoin = useRef<LastJoin | undefined>(undefined);
  const pendingName = useRef("Pilot");
  const telemetry = useRef(new NetworkTelemetry());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Connecting");
  const [statusLine, setStatusLine] = useState("");
  const [room, setRoom] = useState<RoomState>();
  const [snapshot, setSnapshot] = useState<StateSnapshotPayload>();
  const [playerId, setPlayerId] = useState("");
  const [combatNotice, setCombatNotice] = useState<CombatNotice>();
  const [roundEndedNotice, setRoundEndedNotice] = useState<RoundEndedNotice>();
  const [networkStats, setNetworkStats] = useState<NetworkStats>(() => telemetry.current.getStats());

  useEffect(() => {
    const socket = io() as Socket<ServerToClientEvents, ClientToServerEvents>;
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("Online");
      setStatusLine("");
      const reconnecting = telemetry.current.hasConnected();
      if (reconnecting && lastJoin.current) {
        socket.emit("room:join", { ...lastJoin.current, clientId: clientId.current });
      }
      sendPing(socket);
      setNetworkStats(telemetry.current.recordConnect());
    });
    socket.on("disconnect", () => {
      setConnectionStatus("Offline");
      setStatusLine("Connection lost. Reconnecting...");
    });
    socket.on("room:error", (payload: RoomErrorPayload) => {
      setStatusLine(payload.message);
    });
    socket.on("room:joined", (payload: RoomJoinedPayload) => {
      setRoom(payload.room);
      setSnapshot({ tick: 0, sentAt: Date.now(), room: payload.room });
      setPlayerId(payload.playerId);
      persistClientId(payload.playerId);
      clientId.current = payload.playerId;
      lastJoin.current = { roomId: payload.roomId, name: pendingName.current };
      setStatusLine("");
      history.replaceState(null, "", `?room=${payload.roomId}`);
    });
    socket.on("state:snapshot", (payload: StateSnapshotPayload) => {
      setRoom(payload.room);
      setSnapshot(payload);
      setNetworkStats(telemetry.current.recordSnapshot(payload));
    });
    socket.on("net:pong", (payload) => {
      const stats = telemetry.current.recordPong(payload);
      setNetworkStats(stats);
      socket.emit("net:latency", { rttMs: stats.rttMs });
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

    const pingTimer = window.setInterval(() => {
      sendPing(socket);
    }, PING_INTERVAL_MS);

    return () => {
      window.clearInterval(pingTimer);
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const createRoom = useCallback((name: string) => {
    pendingName.current = name;
    socketRef.current?.emit("room:create", { name, clientId: clientId.current });
  }, []);

  const joinRoom = useCallback((roomId: string, name: string) => {
    pendingName.current = name;
    lastJoin.current = { roomId, name };
    socketRef.current?.emit("room:join", { roomId, name, clientId: clientId.current });
  }, []);

  const renamePlayer = useCallback((name: string) => {
    pendingName.current = name;
    if (lastJoin.current) {
      lastJoin.current = { ...lastJoin.current, name };
    }
    socketRef.current?.emit("player:rename", { name });
  }, []);

  const setReady = useCallback((ready: boolean) => {
    socketRef.current?.emit("player:ready", { ready });
  }, []);

  const addBot = useCallback(() => {
    socketRef.current?.emit("bot:add", { count: 1 });
  }, []);

  const removeBot = useCallback((playerId: string) => {
    socketRef.current?.emit("bot:remove", { playerId });
  }, []);

  const startRound = useCallback((force = false) => {
    socketRef.current?.emit("round:start", { force });
  }, []);

  const sendInput = useCallback((input: InputFrame) => {
    socketRef.current?.emit("input:update", input);
  }, []);

  const setLocalStatus = useCallback((message: string) => {
    setStatusLine(message);
  }, []);

  return {
    addBot,
    combatNotice,
    connectionStatus,
    createRoom,
    joinRoom,
    networkStats,
    playerId,
    renamePlayer,
    removeBot,
    room,
    roundEndedNotice,
    sendInput,
    setReady,
    setLocalStatus,
    snapshot,
    startRound,
    statusLine
  };
}

function sendPing(socket: Socket<ServerToClientEvents, ClientToServerEvents>): void {
  if (socket.connected) {
    socket.emit("net:ping", createPingPayload());
  }
}
