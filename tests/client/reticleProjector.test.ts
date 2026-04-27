import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  calculateInterceptTime,
  convergenceSightPoint,
  leadPipSizePx,
  selectGunLeadCandidate
} from "../../src/client/game/targeting/ReticleProjector.js";
import { createPlayer } from "../../src/shared/simulation.js";
import { BULLET_SPEED, GUN_CONVERGENCE_DISTANCE, MISSILE_LOCK_BREAK_DOT, MISSILE_LOCK_DOT } from "../../src/shared/constants.js";

describe("reticle projector", () => {
  it("uses the current shared bullet speed for static gun lead", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, 0, BULLET_SPEED * 0.5);
    const interceptTime = calculateInterceptTime(origin, target, new THREE.Vector3(0, 0, 0), BULLET_SPEED);

    expect(interceptTime).toBeCloseTo(0.5);
  });

  it("moves the lead solution closer when projectile speed increases", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const target = new THREE.Vector3(0, 0, 650);
    const targetVelocity = new THREE.Vector3(120, 0, 0);

    const slowerTime = calculateInterceptTime(origin, target, targetVelocity, BULLET_SPEED / 2);
    const currentTime = calculateInterceptTime(origin, target, targetVelocity, BULLET_SPEED);

    expect(currentTime).toBeDefined();
    expect(slowerTime).toBeDefined();
    expect(currentTime).toBeLessThan(slowerTime ?? 0);
  });

  it("projects gun lead onto the server gun convergence sphere", () => {
    const origin = new THREE.Vector3(0, 0, 0);
    const muzzle = new THREE.Vector3(-8.5, -0.8, 22);
    const interceptPoint = new THREE.Vector3(140, 0, 1200);

    const sightPoint = convergenceSightPoint(origin, muzzle, interceptPoint);

    expect(sightPoint.length()).toBeCloseTo(GUN_CONVERGENCE_DISTANCE);
    expect(
      sightPoint
        .clone()
        .sub(muzzle)
        .normalize()
        .dot(interceptPoint.clone().sub(muzzle).normalize())
    ).toBeCloseTo(1);
  });

  it("scales the lead indicator down as target range increases", () => {
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 10_000);
    camera.position.set(0, 0, 0);

    const nearSize = leadPipSizePx(new THREE.Vector3(0, 0, 400), camera, 18, 900);
    const farSize = leadPipSizePx(new THREE.Vector3(0, 0, 1600), camera, 18, 900);

    expect(nearSize).toBeGreaterThan(farSize);
    expect(farSize).toBeGreaterThanOrEqual(14);
  });

  it("selects gun lead by gun direction when no missile lock is active", () => {
    const local = createPlayer("local", "Local", 0, 1000);
    const noseTarget = createPlayer("nose", "Nose", 1, 1000);
    const aimTarget = createPlayer("aimed", "Aimed", 2, 1000);

    const selected = selectGunLeadCandidate(
      [
        {
          player: noseTarget,
          targetPosition: new THREE.Vector3(0, 0, 300),
          range: 300,
          gunAlignment: 0.92,
          seekerAlignment: MISSILE_LOCK_DOT - 0.01
        },
        {
          player: aimTarget,
          targetPosition: new THREE.Vector3(140, 0, 900),
          range: 900,
          gunAlignment: 0.4,
          seekerAlignment: MISSILE_LOCK_DOT + 0.001
        }
      ],
      local
    );

    expect(selected?.player.id).toBe("nose");
  });

  it("keeps the current missile target while it remains inside break tolerance", () => {
    const local = createPlayer("local", "Local", 0, 1000);
    const locked = createPlayer("locked", "Locked", 1, 1000);
    const newTarget = createPlayer("new", "New", 2, 1000);
    local.missileLockTargetId = "locked";
    local.missileLockProgress = 0.5;

    const selected = selectGunLeadCandidate(
      [
        {
          player: locked,
          targetPosition: new THREE.Vector3(0, 0, 700),
          range: 700,
          gunAlignment: 0.36,
          seekerAlignment: MISSILE_LOCK_BREAK_DOT + 0.001
        },
        {
          player: newTarget,
          targetPosition: new THREE.Vector3(40, 0, 600),
          range: 600,
          gunAlignment: 0.94,
          seekerAlignment: MISSILE_LOCK_DOT + 0.002
        }
      ],
      local
    );

    expect(selected?.player.id).toBe("locked");
  });
});
