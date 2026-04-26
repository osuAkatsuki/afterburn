import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { calculateInterceptTime, convergenceSightPoint } from "../../src/client/game/targeting/ReticleProjector.js";
import { BULLET_SPEED, GUN_CONVERGENCE_DISTANCE } from "../../src/shared/constants.js";

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
});
