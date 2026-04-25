import type { ClientDebugStats } from "./GameCanvas.js";
import type { NetworkStats } from "../hooks/useGameSocket.js";

type DebugOverlayProps = {
  visible: boolean;
  stats?: ClientDebugStats;
  networkStats?: NetworkStats;
};

export function DebugOverlay({ visible, stats, networkStats }: DebugOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <aside className="debug-overlay" aria-label="Debug performance stats">
      <div className="debug-header">
        <strong>Debug</strong>
        <span>F3</span>
      </div>
      {stats ? (
        <>
          <DebugSection
            title="Frame"
            rows={[
              ["FPS", stats.fps.toFixed(0)],
              ["Frame", `${stats.frameMs.toFixed(1)} ms`],
              ["Worst", `${stats.worstFrameMs.toFixed(1)} ms`]
            ]}
          />
          <DebugSection
            title="Network"
            rows={[
              ["RTT", networkStats?.rttMs ? `${networkStats.rttMs.toFixed(0)} ms` : "--"],
              ["Snapshots", networkStats?.snapshotHz ? `${networkStats.snapshotHz.toFixed(1)} Hz` : "--"],
              ["Jitter", networkStats?.snapshotJitterMs ? `${networkStats.snapshotJitterMs.toFixed(1)} ms` : "--"],
              ["Age", networkStats?.lastSnapshotAt ? `${Math.max(0, performance.now() - networkStats.lastSnapshotAt).toFixed(0)} ms` : "--"],
              ["Delay", `${stats.snapshotDelayMs.toFixed(0)} ms`],
              ["Buffered", `${stats.snapshotBufferMs.toFixed(0)} ms`],
              ["Reconnects", formatCount(networkStats?.reconnects ?? 0)]
            ]}
          />
          <DebugSection
            title="Render"
            rows={[
              ["Calls", formatCount(stats.drawCalls)],
              ["Triangles", formatCount(stats.triangles)],
              ["Objects", formatCount(stats.objects)]
            ]}
          />
          <DebugSection
            title="Scene"
            rows={[
              ["Jets", formatCount(stats.jets)],
              ["Projectiles", formatCount(stats.projectiles)],
              ["Smoke", formatCount(stats.smokePuffs)],
              ["Explosions", formatCount(stats.explosions)],
              ["Water glints", formatCount(stats.waterGlints)]
            ]}
          />
          <DebugSection
            title="GPU"
            rows={[
              ["Geometries", formatCount(stats.geometries)],
              ["Textures", formatCount(stats.textures)],
              ["Resolution", `${stats.width}x${stats.height}`],
              ["DPR", stats.pixelRatio.toFixed(2)]
            ]}
          />
        </>
      ) : (
        <p className="debug-empty">Collecting samples...</p>
      )}
    </aside>
  );
}

function DebugSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="debug-section">
      <h2>{title}</h2>
      {rows.map(([label, value]) => (
        <div className="debug-row" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
