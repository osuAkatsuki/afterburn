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
  serverClockOffsetMs: number;
  serverClockSamples: number;
  snapshotHz: number;
  snapshotJitterMs: number;
  lastSnapshotAt: number;
  transportDelayMs: number;
  reconnects: number;
};

type LastJoin = {
  roomId: string;
  name: string;
};

const CLIENT_ID_KEY = "afterburn.sessionClientId";
const PING_INTERVAL_MS = 1000;

export function useGameSocket() {
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const noticeId = useRef(0);
  const clientId = useRef(getClientId());
  const lastJoin = useRef<LastJoin | undefined>(undefined);
  const pendingName = useRef("Pilot");
  const previousSnapshotAt = useRef(0);
  const previousSnapshotSentAt = useRef(0);
  const snapshotIntervalMs = useRef(0);
  const serverClockOffsetMs = useRef<number | undefined>(undefined);
  const serverClockSamples = useRef(0);
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
    serverClockOffsetMs: 0,
    serverClockSamples: 0,
    snapshotHz: 0,
    snapshotJitterMs: 0,
    lastSnapshotAt: 0,
    transportDelayMs: 0,
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
      sendPing(socket);
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
      updateSnapshotStats(payload, previousSnapshotAt, previousSnapshotSentAt, snapshotIntervalMs, serverClockOffsetMs, setNetworkStats);
    });
    socket.on("net:pong", (payload: NetPongPayload) => {
      updateClockStats(payload, serverClockOffsetMs, serverClockSamples, setNetworkStats);
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

function sendPing(socket: Socket<ServerToClientEvents, ClientToServerEvents>): void {
  if (socket.connected) {
    socket.emit("net:ping", { clientTime: performance.now() });
  }
}

function updateSnapshotStats(
  payload: StateSnapshotPayload,
  previousSnapshotAt: MutableRefObject<number>,
  previousSnapshotSentAt: MutableRefObject<number>,
  snapshotIntervalMs: MutableRefObject<number>,
  serverClockOffsetMs: MutableRefObject<number | undefined>,
  setNetworkStats: Dispatch<SetStateAction<NetworkStats>>
): void {
  const receivedAt = performance.now();
  const previous = previousSnapshotAt.current;
  const previousSentAt = previousSnapshotSentAt.current;
  previousSnapshotAt.current = receivedAt;
  previousSnapshotSentAt.current = payload.sentAt;
  const sentAtLocal = toClientTimeline(payload.sentAt, receivedAt, serverClockOffsetMs.current);
  const transportDelayMs = Math.max(0, receivedAt - sentAtLocal);

  if (previous <= 0) {
    setNetworkStats((stats) => ({
      ...stats,
      lastSnapshotAt: receivedAt,
      transportDelayMs
    }));
    return;
  }

  const receiveInterval = receivedAt - previous;
  const serverInterval = previousSentAt > 0 ? Math.max(1, payload.sentAt - previousSentAt) : receiveInterval;
  const smoothedInterval = snapshotIntervalMs.current > 0 ? snapshotIntervalMs.current * 0.85 + serverInterval * 0.15 : serverInterval;
  const jitter = Math.abs(receiveInterval - serverInterval);
  snapshotIntervalMs.current = smoothedInterval;

  setNetworkStats((stats) => ({
    ...stats,
    snapshotHz: smoothedInterval > 0 ? 1000 / smoothedInterval : 0,
    snapshotJitterMs: stats.snapshotJitterMs * 0.85 + jitter * 0.15,
    lastSnapshotAt: receivedAt,
    transportDelayMs: stats.transportDelayMs > 0 ? stats.transportDelayMs * 0.85 + transportDelayMs * 0.15 : transportDelayMs
  }));
}

function updateClockStats(
  payload: NetPongPayload,
  serverClockOffsetMs: MutableRefObject<number | undefined>,
  serverClockSamples: MutableRefObject<number>,
  setNetworkStats: Dispatch<SetStateAction<NetworkStats>>
): void {
  const receivedAt = performance.now();
  const rttMs = Math.max(0, receivedAt - payload.clientTime);
  const estimatedServerAtReceive = payload.serverTime + rttMs / 2;
  const sampledOffset = estimatedServerAtReceive - receivedAt;
  const currentOffset = serverClockOffsetMs.current;
  const nextOffset = currentOffset === undefined ? sampledOffset : currentOffset * 0.9 + sampledOffset * 0.1;
  serverClockOffsetMs.current = nextOffset;
  serverClockSamples.current += 1;

  setNetworkStats((stats) => ({
    ...stats,
    rttMs,
    serverClockOffsetMs: nextOffset,
    serverClockSamples: serverClockSamples.current
  }));
}

function toClientTimeline(serverTime: number, fallbackClientTime: number, serverClockOffsetMs?: number): number {
  if (serverClockOffsetMs === undefined || !Number.isFinite(serverClockOffsetMs)) {
    return fallbackClientTime;
  }

  return serverTime - serverClockOffsetMs;
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
