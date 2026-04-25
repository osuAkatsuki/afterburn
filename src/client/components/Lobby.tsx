import type { RoomState } from "../../shared/types.js";
import { playerStatusLabel } from "../utils/format.js";

type LobbyProps = {
  visible: boolean;
  connectionStatus: string;
  callsign: string;
  roomCode: string;
  room?: RoomState;
  statusLine: string;
  onCallsignChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onShareRoom: () => void;
  onStartRound: () => void;
};

export function Lobby({
  visible,
  connectionStatus,
  callsign,
  roomCode,
  room,
  statusLine,
  onCallsignChange,
  onRoomCodeChange,
  onCreateRoom,
  onJoinRoom,
  onShareRoom,
  onStartRound
}: LobbyProps) {
  if (!visible) {
    return null;
  }

  const hasRoom = Boolean(room);
  const canLaunch = Boolean(room && room.hostId && room.phase !== "playing");

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
              <button type="button" onClick={onStartRound} disabled={!canLaunch}>
                {room.phase === "ended" ? "Restart" : "Launch"}
              </button>
            </div>
            <ul className="player-list">
              {Object.values(room.players).map((player) => (
                <li key={player.id}>
                  <span style={{ "--pilot": player.color } as React.CSSProperties} />
                  <strong>{player.name}</strong>
                  <em>{playerStatusLabel(room, player)}</em>
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
