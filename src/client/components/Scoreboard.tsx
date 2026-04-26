import type { CSSProperties } from "react";
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

  const players = sortedPlayers(room);

  return (
    <aside className="scoreboard" aria-label="Scoreboard">
      <div className="scoreboard-title">
        <strong>Pilots</strong>
        <span>{players.length}/6</span>
      </div>
      <div className="scoreboard-grid" role="table">
        <div className="scoreboard-row scoreboard-head" role="row">
          <span />
          <span>Callsign</span>
          <span>K</span>
          <span>D</span>
          <span>Ping</span>
        </div>
        {players.map((player) => (
          <div className="scoreboard-row" key={player.id} role="row">
            <span
              className={`scoreboard-status ${player.status}`}
              style={{ "--pilot": player.color } as CSSProperties}
              aria-hidden="true"
            />
            <strong>{player.name}</strong>
            <em>{player.score}</em>
            <em>{player.deaths}</em>
            <em>{latencyLabel(player.latencyMs)}</em>
          </div>
        ))}
      </div>
    </aside>
  );
}

function latencyLabel(latencyMs: number): string {
  if (!Number.isFinite(latencyMs) || latencyMs <= 0) {
    return "--";
  }

  return `${Math.round(latencyMs)}ms`;
}
