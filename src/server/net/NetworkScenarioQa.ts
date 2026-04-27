import { BULLET_SPEED, GUN_DAMAGE, MAX_COMBAT_REWIND_MS } from "../../shared/constants.js";
import { quaternionFromRotation } from "../../shared/math.js";
import type { CombatEvent, PlayerState, ProjectileState, Rotation, Vec3 } from "../../shared/types.js";
import { GameRoomManager } from "../gameServer.js";

export type NetworkQaProfile = {
  name: string;
  rttMs: number;
  interpolationDelayMs: number;
};

export type NetworkQaResult = {
  profile: NetworkQaProfile;
  combatRewindMs: number;
  historySamples: number;
  historyClampedSamples: number;
  inputQueued: number;
  inputDropped: number;
  inputConsumed: number;
  hitCount: number;
  killCount: number;
  events: CombatEvent[];
};

export const NETWORK_QA_PROFILES: readonly NetworkQaProfile[] = [
  { name: "local", rttMs: 15, interpolationDelayMs: 90 },
  { name: "regional", rttMs: 80, interpolationDelayMs: 110 },
  { name: "cross-continent", rttMs: 190, interpolationDelayMs: 150 },
  { name: "bad-long-haul", rttMs: 320, interpolationDelayMs: 220 }
];

export function runNetworkQaScenario(profile: NetworkQaProfile): NetworkQaResult {
  const manager = new GameRoomManager(() => "NETQA");
  const created = manager.createRoom("attacker-socket", "Shooter", 1000, "attacker");
  if (!created.ok) {
    throw new Error("Failed to create QA room.");
  }

  const joined = manager.joinRoom("NETQA", "victim-socket", "Target", 1000, "victim");
  if (!joined.ok) {
    throw new Error("Failed to join QA room.");
  }

  manager.setReady("attacker-socket", true, 1000);
  manager.setReady("victim-socket", true, 1000);
  const started = manager.startRoom("attacker-socket", 1000);
  if (!started.ok) {
    throw new Error("Failed to start QA room.");
  }

  manager.setLatency("attacker-socket", profile.rttMs, profile.interpolationDelayMs, 1000);
  const room = manager.getRoom("NETQA");
  if (!room) {
    throw new Error("QA room disappeared.");
  }

  const attacker = room.players.attacker;
  const victim = room.players.victim;
  clearProtection(attacker);
  clearProtection(victim);

  // Seed recent history where the victim is exactly on the attacker's rendered gun line.
  [1100, 1133, 1166].forEach((time) => {
    setPose(attacker, { x: 0, y: 200, z: 0 }, { pitch: 0, yaw: 0, roll: 0 });
    setPose(victim, { x: 0, y: 200, z: 185 }, { pitch: 0, yaw: 0, roll: 0 });
    manager.tickRooms(time);
  });

  // Move the live victim aside, then fire a server bullet down the historical line.
  // A non-rewound hit check would miss this target.
  setPose(attacker, { x: 0, y: 200, z: 0 }, { pitch: 0, yaw: 0, roll: 0 });
  setPose(victim, { x: 90, y: 200, z: 185 }, { pitch: 0, yaw: 0, roll: 0 });
  room.projectiles["network-qa-bullet"] = lagCompensatedBullet("network-qa-bullet", attacker.id, 1400, computedRewind(profile));
  const combat = manager.tickRooms(1400);
  const events = combat.flatMap((result) => result.events);

  // Push a burst of queued inputs so the input scheduler exposes useful backlog metrics.
  for (let seq = 1; seq <= 8; seq += 1) {
    manager.setInput("attacker-socket", {
      seq,
      roll: seq % 2 === 0 ? 1 : -1,
      fireGun: seq === 1,
      timestamp: 1400 + seq
    });
  }
  manager.tickRooms(1433);

  const debug = manager.getNetworkDebugStats(room.id);
  const attackerDebug = debug?.players.attacker;
  return {
    profile,
    combatRewindMs: attackerDebug?.combatRewindMs ?? 0,
    historySamples: debug?.historySamples ?? 0,
    historyClampedSamples: debug?.historyClampedSamples ?? 0,
    inputQueued: attackerDebug?.inputQueued ?? 0,
    inputDropped: attackerDebug?.inputDropped ?? 0,
    inputConsumed: attackerDebug?.inputConsumed ?? 0,
    hitCount: events.filter((event) => event.type === "hit").length,
    killCount: events.filter((event) => event.type === "kill").length,
    events
  };
}

function computedRewind(profile: NetworkQaProfile): number {
  return Math.min(MAX_COMBAT_REWIND_MS, Math.max(0, Math.round(profile.rttMs / 2 + profile.interpolationDelayMs)));
}

function lagCompensatedBullet(id: string, ownerId: string, createdAt: number, combatRewindMs: number): ProjectileState {
  return {
    id,
    type: "bullet",
    ownerId,
    position: { x: 0, y: 200, z: 145 },
    velocity: { x: 0, y: 0, z: BULLET_SPEED },
    ttl: 1,
    damage: GUN_DAMAGE,
    createdAt,
    combatRewindMs
  };
}

function setPose(player: PlayerState, position: Vec3, rotation: Rotation): void {
  player.status = "alive";
  player.position = { ...position };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.rotation = { ...rotation };
  player.orientation = quaternionFromRotation(rotation);
}

function clearProtection(player: PlayerState): void {
  player.spawnProtectionUntil = undefined;
  player.spawnProtectionRemainingMs = 0;
}
