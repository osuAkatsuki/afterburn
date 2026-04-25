import type { RoomState } from "../../shared/types.js";
import { sortedPlayers } from "../utils/format.js";

type EndScreenProps = {
  room?: RoomState;
  visible: boolean;
  onBackToLobby: () => void;
};

export function EndScreen({ room, visible, onBackToLobby }: EndScreenProps) {
  if (!visible || !room) {
    return null;
  }

  const winner = room.winnerId ? room.players[room.winnerId] : undefined;

  return (
    <section className="overlay">
      <div className="panel compact">
        <h2>{winner ? `${winner.name} Wins` : "Round Complete"}</h2>
        <div className="final-scores">
          {sortedPlayers(room).map((player) => (
            <div key={player.id}>
              <span style={{ "--pilot": player.color } as React.CSSProperties} />
              <strong>{player.name}</strong>
              <em>
                {player.score} / {player.deaths}
              </em>
            </div>
          ))}
        </div>
        <button type="button" onClick={onBackToLobby}>
          Back To Lobby
        </button>
      </div>
    </section>
  );
}
