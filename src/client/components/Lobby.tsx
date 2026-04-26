import type { RoomState } from "../../shared/types.js";
import { playerStatusLabel } from "../utils/format.js";

type LobbyProps = {
  visible: boolean;
  connectionStatus: string;
  callsign: string;
  roomCode: string;
  room?: RoomState;
  playerId: string;
  statusLine: string;
  onCallsignChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onShareRoom: () => void;
  onReadyChange: (ready: boolean) => void;
  onAddBot: () => void;
  onRemoveBot: (playerId: string) => void;
  onStartRound: (force?: boolean) => void;
};

export function Lobby({
  visible,
  connectionStatus,
  callsign,
  roomCode,
  room,
  playerId,
  statusLine,
  onCallsignChange,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  onShareRoom,
  onReadyChange,
  onAddBot,
  onRemoveBot,
  onStartRound
}: LobbyProps) {
  if (!visible) {
    return null;
  }

  const hasRoom = Boolean(room);
  const players = Object.values(room?.players ?? {});
  const totalPlayers = players.length;
  const readyCount = players.filter((player) => player.ready).length;
  const localPlayer = playerId && room ? room.players[playerId] : undefined;
  const localReady = Boolean(localPlayer?.ready);
  const isHost = Boolean(room && room.hostId === playerId);
  const allReady = totalPlayers > 0 && readyCount === totalPlayers;
  const canForceStart = isHost && localReady && !allReady && readyCount > 1;
  const canEditBots = isHost && room?.phase !== "playing";
  const startLabel = room?.phase === "ended" ? "Restart" : "Launch";

  return (
    <section className="overlay" id="lobby">
      <div className="panel">
        <div className="brand-row">
          <h1>Afterburn Arena</h1>
          <span>{connectionStatus}</span>
        </div>

        <div className="pilot-card">
          <label htmlFor="nameInput">Callsign</label>
          <input id="nameInput" maxLength={18} autoComplete="nickname" value={callsign} onChange={(event) => onCallsignChange(event.target.value)} />
        </div>

        {!hasRoom && (
          <div className="room-grid">
            <button type="button" onClick={onCreateRoom}>
              Create Room
            </button>
            <div className="join-row">
              <input
                maxLength={24}
                placeholder="CODE"
                value={roomCode}
                onChange={(event) => onRoomCodeChange(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onJoinRoom();
                  }
                }}
              />
              <button type="button" onClick={onJoinRoom}>
                Join
              </button>
            </div>
          </div>
        )}

        {room && (
          <div className="room-card">
            <div className="room-code">
              <span>Room</span>
              <strong>{room.id}</strong>
            </div>
            <div className="lobby-actions">
              <button type="button" onClick={onShareRoom}>
                Share Link
              </button>
              {canEditBots && (
                <button type="button" onClick={onAddBot} disabled={totalPlayers >= 6}>
                  Add Bot
                </button>
              )}
              {isHost && allReady ? (
                <button type="button" onClick={() => onStartRound(false)}>
                  {startLabel}
                </button>
              ) : isHost && canForceStart ? (
                <button type="button" onClick={() => onStartRound(true)}>
                  Force Start ({readyCount}/{totalPlayers} ready)
                </button>
              ) : (
                <button type="button" onClick={() => onReadyChange(!localReady)} disabled={!localPlayer}>
                  {localReady ? "Unready" : "Ready"}
                </button>
              )}
            </div>
            <ul className="player-list">
              {players.map((player) => (
                <li key={player.id}>
                  <span style={{ "--pilot": player.color } as React.CSSProperties} />
                  <strong>{player.name}</strong>
                  <em className={player.ready ? "ready" : ""}>{playerStatusLabel(room, player)}</em>
                  {canEditBots && player.isBot ? (
                    <button className="player-list-action" type="button" onClick={() => onRemoveBot(player.id)} aria-label={`Remove ${player.name}`}>
                      Remove
                    </button>
                  ) : (
                    <i className="player-list-action" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="status-line">{statusLine}</p>
      </div>
    </section>
  );
}
