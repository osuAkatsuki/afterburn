import { clamp } from "../../shared/math.js";
import type { PlayerState, RoomState } from "../../shared/types.js";

type RadarProps = {
  room?: RoomState;
  localPlayer?: PlayerState;
};

export function Radar({ room, localPlayer }: RadarProps) {
  const dots =
    room && localPlayer
      ? Object.values(room.players)
          .filter((player) => player.status === "alive")
          .map((player) => {
            const dx = player.position.x - localPlayer.position.x;
            const dz = player.position.z - localPlayer.position.z;
            const scale = 42 / 900;
            return {
              player,
              x: clamp(dx * scale, -42, 42),
              y: clamp(dz * scale, -42, 42),
              className: player.id === localPlayer.id ? "self" : "enemy"
            };
          })
      : [];

  return (
    <aside className="radar" aria-label="Radar">
      <b />
      {dots.map(({ player, x, y, className }) => (
        <i key={player.id} className={className} style={{ "--x": `${x}px`, "--y": `${y}px`, "--pilot": player.color } as React.CSSProperties} />
      ))}
    </aside>
  );
}
