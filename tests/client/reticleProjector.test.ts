import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { calculateInterceptTime } from "../../src/client/game/targeting/ReticleProjector.js";
import { BULLET_SPEED } from "../../src/shared/constants.js";

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
});
