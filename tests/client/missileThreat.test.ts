import { describe, expect, it } from "vitest";
import { MISSILE_DAMAGE, MISSILE_SPEED } from "../../src/shared/constants.js";
import { addPlayerToRoom, createPlayer, createRoomState, startRound } from "../../src/shared/simulation.js";
import { quaternionFromRotation } from "../../src/shared/math.js";
import type { PlayerState, ProjectileState } from "../../src/shared/types.js";
import { getIncomingMissileCue } from "../../src/client/utils/missileThreat.js";

function testRoom() {
  const room = createRoomState("MISS", "p1", 1000);
  addPlayerToRoom(room, createPlayer("p1", "Local", 0, 1000));
  addPlayerToRoom(room, createPlayer("p2", "Bandit", 1, 1000));
  startRound(room, 1000);
  const local = room.players.p1;
  local.position = { x: 0, y: 200, z: 0 };
  setRotation(local, { pitch: 0, yaw: 0, roll: 0 });
  return { room, local };
}

function setRotation(player: PlayerState, rotation: PlayerState["rotation"]): void {
  player.rotation = rotation;
  player.orientation = quaternionFromRotation(rotation);
}

function addMissile(room: ReturnType<typeof createRoomState>, id: string, position: ProjectileState["position"]): void {
  room.projectiles[id] = {
    id,
    type: "missile",
    ownerId: "p2",
    targetId: "p1",
    targetType: "player",
    position,
    velocity: { x: 0, y: 0, z: -MISSILE_SPEED },
    ttl: 4,
    damage: MISSILE_DAMAGE,
    createdAt: 1000
  };
}

describe("missile threat cues", () => {
  it("reports nearest inbound missile as aircraft-relative clock direction", () => {
    const { room, local } = testRoom();
    addMissile(room, "front", { x: 0, y: 200, z: 900 });
    addMissile(room, "right", { x: 240, y: 200, z: 0 });

    const cue = getIncomingMissileCue(room, local);

    expect(cue?.clockLabel).toBe("3 O'CLOCK");
    expect(cue?.range).toBeCloseTo(240);
    expect(cue?.bearingRadians).toBeCloseTo(Math.PI / 2);
  });

  it("tracks rear and left missile bearings", () => {
    const { room, local } = testRoom();
    addMissile(room, "rear", { x: 0, y: 200, z: -600 });

    expect(getIncomingMissileCue(room, local)?.clockLabel).toBe("6 O'CLOCK");

    room.projectiles = {};
    addMissile(room, "left", { x: -600, y: 200, z: 0 });

    expect(getIncomingMissileCue(room, local)?.clockLabel).toBe("9 O'CLOCK");
  });
});
