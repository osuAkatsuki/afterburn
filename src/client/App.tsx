import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DebugOverlay } from "./components/DebugOverlay.js";
import { EndScreen } from "./components/EndScreen.js";
import { CombatFeedback } from "./components/CombatFeedback.js";
import { FlightDirector } from "./components/FlightDirector.js";
import { GameCanvas, type ClientDebugStats } from "./components/GameCanvas.js";
import { Hud } from "./components/Hud.js";
import { Lobby } from "./components/Lobby.js";
import { Radar } from "./components/Radar.js";
import { Reticle } from "./components/Reticle.js";
import { Scoreboard } from "./components/Scoreboard.js";
import { TacticalWarnings } from "./components/TacticalWarnings.js";
import { DogfightScene } from "./game/DogfightScene.js";
import { useCombatEventEffects } from "./hooks/useCombatEventEffects.js";
import { useFlightInput } from "./hooks/useFlightInput.js";
import { useGameSocket } from "./hooks/useGameSocket.js";
import { LocalPredictionBuffer } from "./net/LocalPredictionBuffer.js";
import { getSnapshotInterpolationDelayMs } from "./net/SnapshotBuffer.js";

const urlRoom = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<DogfightScene | null>(null);
  const localPredictionRef = useRef(new LocalPredictionBuffer());
  const autoJoinAttempted = useRef(false);

  const {
    combatNotice,
    connectionStatus,
    createRoom: emitCreateRoom,
    joinRoom: emitJoinRoom,
    networkStats,
    playerId,
    room,
    roundEndedNotice,
    sendInput,
    setLocalStatus,
    snapshot,
    startRound: emitStartRound,
    statusLine
  } = useGameSocket();
  const [callsign, setCallsign] = useState(() => window.localStorage.getItem("afterburn.callsign") || `Pilot-${Math.floor(Math.random() * 900 + 100)}`);
  const [roomCode, setRoomCode] = useState(urlRoom);
  const [scoreboardVisible, setScoreboardVisible] = useState(false);
  const [showEndScreen, setShowEndScreen] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugStats, setDebugStats] = useState<ClientDebugStats>();

  const localPlayer = useMemo(() => (playerId && room ? room.players[playerId] : undefined), [playerId, room]);
  const snapshotInterpolationDelayMs = useMemo(() => getSnapshotInterpolationDelayMs(networkStats), [networkStats]);
  const showLobby = room?.phase !== "playing" && !showEndScreen;

  useEffect(() => {
    if (urlRoom && connectionStatus === "Online" && !autoJoinAttempted.current) {
      autoJoinAttempted.current = true;
      persistCallsign(callsign);
      emitJoinRoom(urlRoom, callsign);
    }
  }, [callsign, connectionStatus, emitJoinRoom]);

  useCombatEventEffects(sceneRef, room, combatNotice);

  useEffect(() => {
    if (roundEndedNotice) {
      setShowEndScreen(true);
    }
  }, [roundEndedNotice]);

  useEffect(() => {
    const toggleDebug = (event: KeyboardEvent) => {
      if (event.code !== "F3" || event.repeat) {
        return;
      }

      event.preventDefault();
      setDebugVisible((visible) => !visible);
    };

    window.addEventListener("keydown", toggleDebug);
    return () => window.removeEventListener("keydown", toggleDebug);
  }, []);

  useFlightInput({
    room,
    playerId,
    sendInput,
    onLocalInput: (input) => localPredictionRef.current.recordInput(input),
    setScoreboardVisible
  });

  useEffect(() => {
    localPredictionRef.current.clear();
  }, [playerId, room?.id]);

  const createRoom = useCallback(() => {
    persistCallsign(callsign);
    setShowEndScreen(false);
    emitCreateRoom(callsign);
  }, [callsign, emitCreateRoom]);

  const joinRoom = useCallback(() => {
    persistCallsign(callsign);
    setShowEndScreen(false);
    emitJoinRoom(roomCode, callsign);
  }, [callsign, emitJoinRoom, roomCode]);

  const shareRoom = useCallback(async () => {
    if (!room) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("room", room.id);
    await navigator.clipboard?.writeText(url.toString());
    setLocalStatus("Room link copied.");
  }, [room, setLocalStatus]);

  const startRound = useCallback(() => {
    setShowEndScreen(false);
    emitStartRound();
  }, [emitStartRound]);

  const updateDebugStats = useCallback((stats: ClientDebugStats) => {
    setDebugStats(stats);
  }, []);

  return (
    <div className="shell">
      <GameCanvas
        canvasRef={canvasRef}
        reticleRef={reticleRef}
        sceneRef={sceneRef}
        localPredictionRef={localPredictionRef}
        snapshot={snapshot}
        serverClockOffsetMs={networkStats.serverClockSamples > 0 ? networkStats.serverClockOffsetMs : undefined}
        snapshotInterpolationDelayMs={snapshotInterpolationDelayMs}
        playerId={playerId}
        debugEnabled={debugVisible}
        onDebugStats={updateDebugStats}
      />
      <Hud room={room} localPlayer={localPlayer} />
      <FlightDirector room={room} localPlayer={localPlayer} />
      <Reticle ref={reticleRef} />
      <TacticalWarnings room={room} localPlayer={localPlayer} />
      <CombatFeedback notice={combatNotice} playerId={playerId} room={room} />
      <Radar room={room} localPlayer={localPlayer} />
      <Scoreboard room={room} visible={scoreboardVisible} />
      <DebugOverlay visible={debugVisible} stats={debugStats} networkStats={networkStats} />
      <Lobby
        visible={showLobby}
        connectionStatus={connectionStatus}
        callsign={callsign}
        roomCode={roomCode}
        room={room}
        statusLine={statusLine}
        onCallsignChange={setCallsign}
        onRoomCodeChange={setRoomCode}
        onCreateRoom={createRoom}
        onJoinRoom={joinRoom}
        onShareRoom={shareRoom}
        onStartRound={startRound}
      />
      <EndScreen room={room} visible={showEndScreen && room?.phase === "ended"} onBackToLobby={() => setShowEndScreen(false)} />
    </div>
  );
}

function persistCallsign(callsign: string): void {
  window.localStorage.setItem("afterburn.callsign", callsign.trim());
}
