import type { ClientDebugStats } from "./GameCanvas.js";
import type { NetworkCaptureSummary } from "../net/NetworkCapture.js";
import type { NetworkStats } from "../net/NetworkTelemetry.js";

type DebugOverlayProps = {
  visible: boolean;
  stats?: ClientDebugStats;
  networkStats?: NetworkStats;
  playerId?: string;
  capture?: NetworkCaptureSummary;
};

export function DebugOverlay({
  visible,
  stats,
  networkStats,
  playerId,
  capture
}: DebugOverlayProps) {
  if (!visible) {
    return null;
  }

  const serverDebug = networkStats?.serverDebug;
  const localServerDebug = playerId ? serverDebug?.players[playerId] : undefined;

  return (
    <aside className="debug-overlay" aria-label="Debug performance stats">
      <div className="debug-header">
        <strong>Debug</strong>
        <span>F3</span>
      </div>
      {stats ? (
        <div className="debug-body">
          <div className="debug-column">
            <DebugSection
              title="Frame"
              rows={[
                ["FPS", stats.fps.toFixed(0)],
                ["Frame", `${stats.frameMs.toFixed(1)} ms`],
                ["Worst", `${stats.worstFrameMs.toFixed(1)} ms`],
                ["Spikes", formatCount(stats.frameSpikeCount)],
                ["Spike", `${stats.frameSpikeMs.toFixed(1)} ms`],
                ["Spike age", `${stats.frameSpikeAgeMs.toFixed(0)} ms`],
                ["Spike int", `${stats.frameSpikeIntervalMs.toFixed(0)} ms`]
              ]}
            />
            {capture ? <DebugCapture capture={capture} /> : null}
            <DebugSection
              title="Render"
              rows={[
                ["Calls", formatCount(stats.drawCalls)],
                ["Triangles", formatCount(stats.triangles)],
                ["Objects", formatCount(stats.objects)]
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
          </div>
          <div className="debug-column">
            <DebugSection
              title="Network"
              rows={[
                ["RTT", networkStats?.rttMs ? `${networkStats.rttMs.toFixed(0)} ms` : "--"],
                ["Clock", networkStats?.serverClockSamples ? `${networkStats.serverClockSamples}x` : "--"],
                ["Snapshots", networkStats?.snapshotHz ? `${networkStats.snapshotHz.toFixed(1)} Hz` : "--"],
                ["Jitter", networkStats?.snapshotJitterMs ? `${networkStats.snapshotJitterMs.toFixed(1)} ms` : "--"],
                ["Receive age", networkStats?.lastSnapshotAt ? `${Math.max(0, performance.now() - networkStats.lastSnapshotAt).toFixed(0)} ms` : "--"],
                ["Server age", `${stats.snapshotServerAgeMs.toFixed(0)} ms`],
                ["Transport", networkStats?.serverClockSamples ? `${networkStats.transportDelayMs.toFixed(0)} ms` : "--"],
                ["Snapshot", networkStats?.snapshotBytes ? formatBytes(networkStats.snapshotBytes) : "--"],
                ["Rewind", localServerDebug ? `${localServerDebug.combatRewindMs.toFixed(0)} ms` : "--"],
                [
                  "History",
                  serverDebug ? `${formatCount(serverDebug.historySamples)} / ${formatCount(serverDebug.historyClampedSamples)} clamp` : "--"
                ],
                ["Input q", localServerDebug ? formatCount(localServerDebug.inputQueued) : "--"],
                ["Input drop", localServerDebug ? formatCount(localServerDebug.inputDropped) : "--"],
                ["Input cons", localServerDebug ? formatCount(localServerDebug.inputConsumed) : "--"],
                ["Interp delay", `${stats.snapshotDelayMs.toFixed(0)} ms`],
                ["Buffer ahead", `${stats.snapshotBufferMs.toFixed(0)} ms`],
                ["Pending inputs", formatCount(stats.pendingInputs)],
                ["Ack", formatCount(stats.ackSeq)],
                ["Ack delta", formatCount(stats.ackDelta)],
                ["Ack age", `${stats.ackAgeMs.toFixed(0)} ms`],
                ["Ack int", `${stats.ackIntervalMs.toFixed(0)} ms`],
                ["Reconnects", formatCount(networkStats?.reconnects ?? 0)]
              ]}
            />
            <DebugSection
              title="Prediction"
              rows={[
                ["Predicted", `${stats.predictedMs.toFixed(0)} ms`],
                ["Lead", `${stats.predictionLeadMeters.toFixed(1)} m`],
                ["Correction", `${stats.correctionMeters.toFixed(1)} m`],
                ["Corr last", `${stats.correctionLastMeters.toFixed(1)} m`],
                ["Corr age", `${stats.correctionAgeMs.toFixed(0)} ms`],
                ["Corr int", `${stats.correctionIntervalMs.toFixed(0)} ms`],
                ["Corr events", formatCount(stats.correctionEvents)]
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
          </div>
        </div>
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

function DebugCapture({ capture }: { capture: NetworkCaptureSummary }) {
  return (
    <section className="debug-section">
      <h2>Capture</h2>
      <div className="debug-row">
        <span>Status</span>
        <strong>{capture.recording ? "Recording" : "Idle"}</strong>
      </div>
      <div className="debug-row">
        <span>Samples</span>
        <strong>{formatCount(capture.samples)}</strong>
      </div>
      <div className="debug-row">
        <span>Duration</span>
        <strong>{`${(capture.durationMs / 1000).toFixed(1)} s`}</strong>
      </div>
      <div className="debug-actions">
        <DebugShortcut keyName="R" label={capture.recording ? "Stop" : "Record"} />
        <DebugShortcut keyName="O" label="Export" disabled={capture.samples === 0} />
        <DebugShortcut keyName="C" label="Clear" disabled={capture.samples === 0} />
      </div>
    </section>
  );
}

function DebugShortcut({ keyName, label, disabled = false }: { keyName: string; label: string; disabled?: boolean }) {
  return (
    <span className="debug-shortcut" data-disabled={disabled ? "true" : "false"}>
      <kbd>{keyName}</kbd>
      {label}
    </span>
  );
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatBytes(value: number): string {
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${Math.round(value)} B`;
}
