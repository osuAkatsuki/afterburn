import type { RoomState } from "../../shared/types.js";
import { sortedPlayers } from "../utils/format.js";

type ScoreboardProps = {
  room?: RoomState;
  visible: boolean;
};

export function Scoreboard({ room, visible }: ScoreboardProps) {
  if (!visible || !room) {
    return null;
  }

  return (
    <aside className="scoreboard">
      <header>
        <strong>Pilots</strong>
        <span>K</span>
        <span>D</span>
      </header>
      {sortedPlayers(room).map((player) => (
        <div key={player.id}>
          <span style={{ "--pilot": player.color } as React.CSSProperties} />
          <strong>{player.name}</strong>
          <em>{player.score}</em>
          <em>{player.deaths}</em>
        </div>
      ))}
    </aside>
  );
}
