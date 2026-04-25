import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EndScreen } from "./components/EndScreen.js";
import { CombatFeedback } from "./components/CombatFeedback.js";
import { FlightDirector } from "./components/FlightDirector.js";
import { GameCanvas } from "./components/GameCanvas.js";
import { Hud } from "./components/Hud.js";
import { Lobby } from "./components/Lobby.js";
import { Radar } from "./components/Radar.js";
import { Reticle } from "./components/Reticle.js";
import { Scoreboard } from "./components/Scoreboard.js";
import { TacticalWarnings } from "./components/TacticalWarnings.js";
import { DogfightScene } from "./game/DogfightScene.js";
import { useFlightInput } from "./hooks/useFlightInput.js";
import { useGameSocket } from "./hooks/useGameSocket.js";
import type { RoomState } from "../shared/types.js";

const urlRoom = new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<DogfightScene | null>(null);
  const latestRoomRef = useRef<RoomState | undefined>(undefined);
  const autoJoinAttempted = useRef(false);

  const {
    combatNotice,
    connectionStatus,
    createRoom: emitCreateRoom,
    joinRoom: emitJoinRoom,
    playerId,
    room,
    roundEndedNotice,
    sendInput,
    setLocalStatus,
    startRound: emitStartRound,
    statusLine
  } = useGameSocket();
  const [callsign, setCallsign] = useState(() => window.localStorage.getItem("afterburn.callsign") || `Pilot-${Math.floor(Math.random() * 900 + 100)}`);
  const [roomCode, setRoomCode] = useState(urlRoom);
  const [scoreboardVisible, setScoreboardVisible] = useState(false);
  const [showEndScreen, setShowEndScreen] = useState(false);

  const localPlayer = useMemo(() => (playerId && room ? room.players[playerId] : undefined), [playerId, room]);
  const showLobby = room?.phase !== "playing" && !showEndScreen;

  useEffect(() => {
    latestRoomRef.current = room;
  }, [room]);

  useEffect(() => {
    if (urlRoom && connectionStatus === "Online" && !autoJoinAttempted.current) {
      autoJoinAttempted.current = true;
      persistCallsign(callsign);
      emitJoinRoom(urlRoom, callsign);
    }
  }, [callsign, connectionStatus, emitJoinRoom]);

  useEffect(() => {
    const event = combatNotice?.event;
    if (!event) {
      return;
    }

    if (event.type === "crash") {
      const player = latestRoomRef.current?.players[event.playerId];
      if (player) {
        sceneRef.current?.spawnExplosion(player.position, player.color);
      }
      return;
    }

    if (event.type !== "hit" && event.type !== "kill") {
      return;
    }

    const victim = latestRoomRef.current?.players[event.victimId];
    if (!victim) {
      return;
    }

    if (event.type === "hit") {
      sceneRef.current?.spawnHitSpark(victim.position, event.weapon === "missile" ? "#f97316" : "#fef08a");
      return;
    }

    if (victim) {
      sceneRef.current?.spawnExplosion(victim.position, victim.color);
    }
  }, [combatNotice]);

  useEffect(() => {
    if (roundEndedNotice) {
      setShowEndScreen(true);
    }
  }, [roundEndedNotice]);

  useFlightInput({
    room,
    playerId,
    sendInput,
    setScoreboardVisible
  });

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

  return (
    <div className="shell">
      <GameCanvas canvasRef={canvasRef} reticleRef={reticleRef} sceneRef={sceneRef} room={room} playerId={playerId} />
      <Hud room={room} localPlayer={localPlayer} />
      <FlightDirector room={room} localPlayer={localPlayer} />
      <Reticle ref={reticleRef} />
      <TacticalWarnings room={room} localPlayer={localPlayer} />
      <CombatFeedback notice={combatNotice} playerId={playerId} room={room} />
      <Radar room={room} localPlayer={localPlayer} />
      <Scoreboard room={room} visible={scoreboardVisible} />
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
