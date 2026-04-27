import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addPlayerToRoom, createPlayer, createRoomState } from "../../src/shared/simulation.js";
import type { PlayerState, RoomState } from "../../src/shared/types.js";
import {
  formatTargetRange,
  getTargetOverlayModels,
  TARGET_LABEL_RANGE_METERS
} from "../../src/client/game/targeting/targetOverlay.js";

const VIEWPORT = { width: 1000, height: 800 };

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(70, VIEWPORT.width / VIEWPORT.height, 0.1, 10_000);
  camera.position.set(0, 100, 0);
  camera.lookAt(0, 100, 1000);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function makeRoom(): RoomState {
  const room = createRoomState("TGT01", "local", 1000);
  const local = alivePlayer("local", "Local", 0, 100, 0);
  const target = alivePlayer("target", "Bandit", 0, 100, 1200);
  target.velocity = { x: 160, y: 0, z: 0 };
  addPlayerToRoom(room, local);
  addPlayerToRoom(room, target);
  return room;
}

function alivePlayer(id: string, name: string, x: number, y: number, z: number): PlayerState {
  const player = createPlayer(id, name, 0, 1000);
  player.status = "alive";
  player.position = { x, y, z };
  player.velocity = { x: 0, y: 0, z: 0 };
  player.spawnProtectionRemainingMs = 0;
  player.spawnProtectionUntil = undefined;
  return player;
}

describe("target overlay projection", () => {
  it("shows nearby alive targets with baseline idle labels", () => {
    const room = makeRoom();
    const models = getTargetOverlayModels(room, "local", makeCamera(), playerPosition(room), VIEWPORT);

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      playerId: "target",
      lockState: "idle",
      rangeMeters: 1200,
      speedMetersPerSecond: 160
    });
    expect(models[0]?.screenX).toBeCloseTo(VIEWPORT.width / 2);
    expect(models[0]?.screenY).toBeCloseTo(VIEWPORT.height / 2);
    expect(Math.abs(models[0]?.travelVectorX ?? 0)).toBeGreaterThan(0);
  });

  it("colors lock acquisition separately from acquired missile lock", () => {
    const room = makeRoom();
    const local = room.players.local;
    local.missileLockTargetId = "target";
    local.missileLockProgress = 0.5;
    local.missileLockAcquired = false;

    expect(getTargetOverlayModels(room, "local", makeCamera(), playerPosition(room), VIEWPORT)[0]?.lockState).toBe("locking");

    local.missileLockProgress = 1;
    local.missileLockAcquired = true;

    expect(getTargetOverlayModels(room, "local", makeCamera(), playerPosition(room), VIEWPORT)[0]?.lockState).toBe("locked");
  });

  it("keeps general labels visible when missiles are unavailable", () => {
    const room = makeRoom();
    const local = room.players.local;
    local.missilesRemaining = 0;
    local.missileLockTargetId = "target";
    local.missileLockProgress = 1;
    local.missileLockAcquired = true;

    const models = getTargetOverlayModels(room, "local", makeCamera(), playerPosition(room), VIEWPORT);

    expect(models).toHaveLength(1);
    expect(models[0]?.lockState).toBe("idle");
  });

  it("hides dead, distant, and off-screen targets", () => {
    const room = makeRoom();
    const dead = alivePlayer("dead", "Dead", 0, 100, 1000);
    dead.status = "dead";
    const far = alivePlayer("far", "Far", 0, 100, TARGET_LABEL_RANGE_METERS + 1);
    const offscreen = alivePlayer("offscreen", "Offscreen", 5000, 100, 1000);
    addPlayerToRoom(room, dead);
    addPlayerToRoom(room, far);
    addPlayerToRoom(room, offscreen);

    const models = getTargetOverlayModels(room, "local", makeCamera(), playerPosition(room), VIEWPORT);

    expect(models.map((model) => model.playerId)).toEqual(["target"]);
  });

  it("formats range labels in meters and kilometers", () => {
    expect(formatTargetRange(812)).toBe("812 M");
    expect(formatTargetRange(2100)).toBe("2.1 KM");
  });
});

function playerPosition(room: RoomState): (playerId: string) => THREE.Vector3 | undefined {
  return (playerId: string) => {
    const player = room.players[playerId];
    return player ? new THREE.Vector3(player.position.x, player.position.y, player.position.z) : undefined;
  };
}
