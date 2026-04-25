import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  CombatEvent,
  ClientToServerEvents,
  InputFrame,
  NetPongPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomState,
  RoundEndedPayload,
  ServerToClientEvents,
  StateSnapshotPayload
} from "../../shared/types.js";

export type ConnectionStatus = "Connecting" | "Online" | "Offline";

export type CombatNotice = {
  id: number;
  event: CombatEvent;
};

export type RoundEndedNotice = {
  id: number;
  payload: RoundEndedPayload;
};

export type NetworkStats = {
  rttMs: number;
  snapshotHz: number;
  snapshotJitterMs: number;
  lastSnapshotAt: number;
  reconnects: number;
};

type LastJoin = {
  roomId: string;
  name: string;
};

const CLIENT_ID_KEY = "afterburn.sessionClientId";
const PING_INTERVAL_MS = 2000;

export function useGameSocket() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const noticeId = useRef(0);
  const clientId = useRef(getClientId());
  const lastJoin = useRef<LastJoin | undefined>(undefined);
  const pendingName = useRef("Pilot");
  const previousSnapshotAt = useRef(0);
  const snapshotIntervalMs = useRef(0);
  const reconnects = useRef(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("Connecting");
  const [statusLine, setStatusLine] = useState("");
  const [room, setRoom] = useState<RoomState>();
  const [snapshot, setSnapshot] = useState<StateSnapshotPayload>();
  const [playerId, setPlayerId] = useState("");
  const [combatNotice, setCombatNotice] = useState<CombatNotice>();
  const [roundEndedNotice, setRoundEndedNotice] = useState<RoundEndedNotice>();
  const [networkStats, setNetworkStats] = useState<NetworkStats>({
    rttMs: 0,
    snapshotHz: 0,
    snapshotJitterMs: 0,
    lastSnapshotAt: 0,
    reconnects: 0
  });

  useEffect(() => {
    const socket = io() as Socket<ServerToClientEvents, ClientToServerEvents>;
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionStatus("Online");
      setStatusLine("");
      const reconnecting = reconnects.current > 0;
      if (reconnecting && lastJoin.current) {
        socket.emit("room:join", { ...lastJoin.current, clientId: clientId.current });
      }
      reconnects.current += 1;
      setNetworkStats((stats) => ({ ...stats, reconnects: Math.max(0, reconnects.current - 1) }));
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
      updateSnapshotStats(payload, previousSnapshotAt, snapshotIntervalMs, setNetworkStats);
    });
    socket.on("net:pong", (payload: NetPongPayload) => {
      const rttMs = Math.max(0, performance.now() - payload.clientTime);
      setNetworkStats((stats) => ({ ...stats, rttMs }));
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
      if (socket.connected) {
        socket.emit("net:ping", { clientTime: performance.now() });
      }
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
    networkStats,
    playerId,
    room,
    roundEndedNotice,
    sendInput,
    setLocalStatus,
    snapshot,
    startRound,
    statusLine
  };
}

function updateSnapshotStats(
  _payload: StateSnapshotPayload,
  previousSnapshotAt: MutableRefObject<number>,
  snapshotIntervalMs: MutableRefObject<number>,
  setNetworkStats: Dispatch<SetStateAction<NetworkStats>>
): void {
  const receivedAt = performance.now();
  const previous = previousSnapshotAt.current;
  previousSnapshotAt.current = receivedAt;

  if (previous <= 0) {
    setNetworkStats((stats) => ({ ...stats, lastSnapshotAt: receivedAt }));
    return;
  }

  const interval = receivedAt - previous;
  const smoothedInterval = snapshotIntervalMs.current > 0 ? snapshotIntervalMs.current * 0.85 + interval * 0.15 : interval;
  const jitter = Math.abs(interval - smoothedInterval);
  snapshotIntervalMs.current = smoothedInterval;

  setNetworkStats((stats) => ({
    ...stats,
    snapshotHz: smoothedInterval > 0 ? 1000 / smoothedInterval : 0,
    snapshotJitterMs: stats.snapshotJitterMs * 0.85 + jitter * 0.15,
    lastSnapshotAt: receivedAt
  }));
}

function getClientId(): string {
  const existing = window.sessionStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }

  const generated = window.crypto?.randomUUID?.() ?? `client-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  persistClientId(generated);
  return generated;
}

function persistClientId(clientId: string): void {
  window.sessionStorage.setItem(CLIENT_ID_KEY, clientId);
}
