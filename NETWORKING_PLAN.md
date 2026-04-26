# Afterburn Networking Plan

## Goal

Make high-latency play feel substantially better while keeping the server authoritative. The client may predict local motion and render remote state with interpolation, but it should not be trusted to own position, damage, hits, scoring, or round state.

This is not a full rollback/peer-to-peer plan. Afterburn is closer to a Source/Quake/Valorant-style authoritative server model than to GGPO. GGPO-style rollback is useful as a design reference for deterministic simulation and replayable inputs, but it is the wrong primary architecture for a 3D projectile dogfighting game with authoritative rooms, bots, terrain, missiles, and persistent world state.

## Current State

### What Already Works

- Server-authoritative room simulation at `TICK_RATE = 30`.
- Client sends `InputFrame` through `input:update`.
- Server acknowledges local inputs by copying `lastInputSeq` into `PlayerState`.
- Client predicts only the local aircraft in `src/client/net/LocalPredictionBuffer.ts`.
- Client renders remote players/projectiles through `src/client/net/SnapshotBuffer.ts`.
- Snapshot interpolation uses server send timestamps, clock offset estimates, adaptive jitter delay, and a debug overlay.
- Combat, scoring, respawn, terrain collision, plane collision, missile guidance, and bot logic run server-side.

### Main Weak Points

1. Gun hit registration is not lag-compensated.
   - The server checks bullet/projectile hits against current authoritative target positions.
   - A shooter is aiming at remote players rendered in the past by snapshot interpolation plus transport delay.
   - This makes guns feel unfair at higher latency even when the shooter visually tracks correctly.

2. Server input scheduling is too lossy.
   - `GameRoomManager.consumeQueuedInputs` collapses all queued inputs into the latest movement axes and ORs one-shot fire flags.
   - This is simple and currently functional, but it discards timing inside a backlog.
   - Under jitter, the server can process movement that does not match the client's intended per-tick sequence.

3. Socket.IO snapshots are reliable and ordered.
   - Reliable ordering is good for room/control events.
   - For high-rate world snapshots, stale packets are obsolete once newer snapshots exist.
   - A reliable ordered stream can add head-of-line delay when the browser/network stalls.

4. Snapshot payloads are full room JSON.
   - Fine for 2-6 players today.
   - Not ideal as terrain/world complexity, bots, projectiles, and visual events increase.

5. Telemetry is strong for local debugging but not yet scenario-driven.
   - We show RTT, jitter, snapshot age, buffer, pending inputs, and correction stats.
   - We do not yet have a repeatable network QA harness with simulated latency/loss profiles and expected thresholds.

## Target Model

Keep this architecture:

```text
client input -> server authoritative sim -> snapshots/events -> client interpolation/prediction
```

Add these capabilities:

```text
server player history -> lag-compensated combat traces -> capped rewind -> fair hit validation
ordered input commands -> stable server replay -> better reconciliation
transport hygiene -> less stale-state delay -> reliable control events stay reliable
network QA profiles -> measurable iteration loop
```

## Phase 1: Server-Side History Ring

Add a server-only history buffer for each room. Do not put this in `RoomState`; it should never be sent to clients.

### Proposed Files

- Add `src/server/net/RoomHistory.ts`.
- Add tests in `tests/server/roomHistory.test.ts`.
- Integrate from `src/server/gameServer.ts`.

### Stored Data

Each history frame should be minimal:

```ts
type RoomHistoryFrame = {
  tick: number;
  serverTime: number;
  players: Record<string, HistoricalPlayerState>;
};

type HistoricalPlayerState = {
  id: string;
  status: PlayerStatus;
  position: Vec3;
  velocity: Vec3;
  rotation: Rotation;
  orientation?: Quaternion;
  spawnProtectionUntil?: number;
};
```

Keep roughly `750-1000ms` of history. At 30 Hz that is only 23-30 frames per room, which is small for 6 players.

### Sampling

Expose:

```ts
record(room: RoomState, tick: number, serverTime: number): void
samplePlayer(roomId: string, playerId: string, serverTime: number): HistoricalPlayerState | undefined
```

Sampling should interpolate between surrounding frames by position, velocity, rotation angle, and quaternion. If the requested time is older than retained history, clamp to the oldest retained frame and mark the sample as clamped for debug metrics.

### Rewind Amount

Use a capped, server-controlled rewind estimate:

```text
rewindMs = clamp(playerLatencyRttMs / 2 + clientInterpolationDelayMs, 0, MAX_COMBAT_REWIND_MS)
```

Recommended initial cap: `250ms`.

The client already computes interpolation delay locally. Extend `net:latency` to include `interpolationDelayMs`, sanitized server-side. The current public `PlayerState.latencyMs` can keep serving the scoreboard; the server can store richer per-player networking data privately in `GameRoomManager` or a `PlayerNetworkStats` helper. `interpolationDelayMs` is not trusted for authority; it only influences how far back the server samples target hitboxes, and remains capped.

## Phase 2: Lag-Compensated Guns

Implement guns first. Missiles are slower, server-guided, and already use proximity/direct impact logic. Guns are where high latency is most noticeable.

### Recommended Behavior

When a bullet segment is checked for player hits:

1. Keep projectile spawning and motion server-authoritative.
2. For each victim candidate, sample that victim's historical aircraft state at `now - shooterRewindMs`.
3. Test the current bullet segment against the historical victim hitboxes.
4. Apply damage to the current live victim if the historical hit succeeds and the current victim is still alive and not spawn-protected.
5. Cap rewind and record debug metadata.

This is shooter-favored by design, so the cap matters. It should make "I tracked the target but the server says no" happen less often without letting a 600ms player hit ghosts forever.

### Proposed Shared Simulation Change

`src/shared/simulation.ts` currently owns projectile stepping and hit detection. Add an optional simulation context:

```ts
export type SimulationContext = {
  getCombatRewindMs?: (attacker: PlayerState) => number;
  sampleHistoricalPlayer?: (playerId: string, serverTime: number) => PlayerState | undefined;
};

export function stepRoom(
  room: RoomState,
  dtSeconds: number,
  now = room.now + dtSeconds * 1000,
  context: SimulationContext = {}
): CombatEvent[] {
  // existing behavior
}
```

`GameRoomManager.tickRooms` passes the server history context. Tests that call `stepRoom` directly continue to use current behavior.

### Projectile Metadata

Add optional metadata to `ProjectileState`:

```ts
combatRewindMs?: number;
sourceInputSeq?: number;
```

When `fireGun` creates a bullet, record the shooter's rewind amount and input seq. This keeps the hit check deterministic for that projectile even if latency changes later.

### Hit Detection Changes

`findBulletHit` should:

- Resolve candidate players from current `RoomState`.
- For each candidate, choose historical state if `projectile.combatRewindMs > 0`.
- Reuse `closestProjectileToAircraftBulletDamage` against the sampled player shape.
- Apply damage to the current victim ID, not the historical object.

### Tests

Add coverage for:

- History sampling interpolates correctly between two frames.
- Rewind is capped.
- Bullet misses current target position but hits the historical rendered target position.
- Bullet does not damage a target that is currently dead or spawn-protected.
- Rewind does not let a shooter damage a player after the retained history window beyond the cap.
- Low-latency rewind behaves like current hit detection.

## Phase 3: Better Input Command Scheduling

Replace "collapse all queued input" with a small per-player command scheduler.

### Current Code

`src/server/gameServer.ts`:

```ts
const nextInput = collapseQueuedInputs(queue, player.lastInputSeq);
```

This jumps to the latest axes and loses sub-tick ordering.

### Target Behavior

For each server tick:

1. Consume the next unprocessed input in sequence where possible.
2. If the queue is empty, continue holding the last input.
3. If the queue is far behind, catch up conservatively:
   - Drop stale movement inputs after a small backlog cap.
   - Preserve one-shot action edges for guns, missiles, and flares.
4. Track queue depth and dropped commands for debug.

### Proposed Files

- Add `src/server/net/PlayerInputQueue.ts`.
- Replace `inputQueues: Map<string, InputFrame[]>` with `Map<string, PlayerInputQueue>`.
- Add tests in `tests/server/playerInputQueue.test.ts`.

### Why This Matters

Prediction assumes the server is acknowledging a coherent sequence of inputs. Collapsing inputs can produce fewer visible corrections, but it can also make server motion less faithful under jitter. A command scheduler gives us explicit control over latency vs. correctness.

## Phase 4: Snapshot Transport Hygiene

Keep Socket.IO for now. It is good enough for the current deploy and friend-lobby scope.

### Immediate Improvements

- Keep `state:snapshot` reliable while Afterburn is on Socket.IO. Volatile snapshots can be revisited after input/control traffic is split from world snapshots; with Socket.IO fallback transports or write pressure, volatile snapshots can drop too aggressively during held-fire input.
- Keep `room:joined`, `room:error`, `combat:event`, `round:ended`, room lifecycle events, and critical weapon/combat events reliable.
- Measure serialized snapshot byte size in debug mode.
- Avoid emitting lobby-only latency snapshots while playing unless the player scoreboard needs them immediately.

### Later Transport Options

Do not rewrite transport yet. If Socket.IO becomes the bottleneck, evaluate:

- WebRTC DataChannel with unordered unreliable snapshots plus reliable control channel.
- WebTransport where hosting/browser support is acceptable.
- A native sidecar or edge service using UDP-style semantics, inspired by GameNetworkingSockets. This is probably overkill for a browser-first game right now.

## Phase 5: Snapshot Bandwidth And Interest

This is lower priority than lag-compensated combat and input scheduling.

Potential changes:

- Send compact snapshots instead of full `RoomState`.
- Split static room metadata from dynamic state.
- Delta-compress players/projectiles by tick.
- Quantize positions, velocities, rotations, health, ammo, and status.
- Do simple interest management:
  - Always include local player.
  - Always include nearby threats/projectiles.
  - Downsample far-away players if needed.

For 2-6 players, this is not urgent unless projectile counts or bot counts rise substantially.

## Phase 6: Network QA Harness

Add repeatable profiles so we stop relying on subjective "feels jittery" reports.

### Manual Profiles

Use browser devtools profiles:

- Local: `0-20ms`, no packet loss.
- Regional: `50-90ms`, `0-1%` loss.
- Cross-continent: `140-220ms`, `0-2%` loss.
- Bad long haul: `250-350ms`, `1-4%` loss, jittery.

### Automated/Scripted Checks

Add a small local test mode or script that:

- Starts a room with two deterministic pilots or bots.
- Applies scripted input over 20-30 seconds.
- Records correction events, correction distance, snapshot age, buffer ahead, ack intervals, and hit outcomes.
- Exports JSON for comparison across commits.

Candidate files:

- `scripts/network-qa.mjs`
- `src/client/net/NetworkCapture.ts`
- `tests/server/networkScenario.test.ts`

### Success Metrics

Initial targets:

- Local RTT under `20ms`: no visible periodic correction spikes during idle flight.
- Regional RTT `50-90ms`: guns feel aligned with target boxes; correction events are rare and below `3m` outside impacts.
- Cross-continent RTT `140-220ms`: remote players remain smooth; local player remains responsive; gun hit validation roughly matches what the shooter sees.
- Bad long haul `250-350ms`: playable but visibly degraded; no unbounded prediction lead, no multi-second desync, no permanent state divergence.

## Rollout Order

1. Add `RoomHistory` and tests.
2. Extend `net:latency` with client interpolation delay.
3. Add lag-compensated gun hit checks behind a constant or feature flag.
4. Add debug metrics for combat rewind and history clamping.
5. Ship and test under local, regional, and cross-continent profiles.
6. Replace input collapse with `PlayerInputQueue`.
7. Add snapshot byte-size telemetry and defer volatile snapshots until the transport/input split is safer.
8. Revisit bandwidth/delta snapshots only if metrics show a real problem.

## Design Decisions

### Keep Server Authority

Clients should never send "I hit player X." They send input only. The server validates all hits against authoritative or server-rewound state.

### Cap Rewind Aggressively

Lag compensation improves shooter experience but can feel unfair to victims. The cap should start conservative, around `200-250ms`, and be tuned with real tests.

### Do Not Roll Back The Whole World

Full rollback would require snapshotting and replaying room state, projectiles, terrain, bots, missile guidance, damage, respawns, and random events. That is a poor fit here. Rewinding target hitboxes for combat traces gives most of the benefit at much lower complexity.

### Do Not Rewrite Socket.IO Yet

The biggest current user-facing miss is combat validation, not raw transport. Socket.IO is acceptable for the first production version. We should improve usage patterns before replacing it.

## References

- Riot Games: [Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode)
- GGPO: [pond3r/ggpo](https://github.com/pond3r/ggpo)
- GGPO developer guide: [Creating a new GGPO backend](https://github.com/pond3r/ggpo/blob/master/doc/DeveloperGuide.md)
- Valve: [GameNetworkingSockets](https://github.com/ValveSoftware/GameNetworkingSockets)
- Valve Developer Community: [Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)
- Glenn Fiedler: [Snapshot Interpolation](https://gafferongames.com/post/snapshot_interpolation/)
- Gabriel Gambetta: [Fast-Paced Multiplayer](https://gabrielgambetta.com/client-server-game-architecture.html)
