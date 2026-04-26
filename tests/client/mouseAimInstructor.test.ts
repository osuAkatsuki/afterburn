import { describe, expect, it } from "vitest";
import {
  computeMouseAimInstructorAxes,
  computeMouseAimInstructorAxesFromDirection,
  isNeutralMouseAim
} from "../../src/client/input/mouseAimInstructor.js";
import { normalize, quaternionFromRotation } from "../../src/shared/math.js";

describe("computeMouseAimInstructorAxes", () => {
  it("does not command flight controls while centered and level", () => {
    expect(computeMouseAimInstructorAxes({ x: 0, y: 0 }, 0)).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("turns and banks toward a right-side aim point", () => {
    const axes = computeMouseAimInstructorAxes({ x: 0.7, y: 0 }, 0);

    expect(axes.yaw).toBeGreaterThan(0);
    expect(axes.roll).toBeLessThan(0);
    expect(Math.abs(axes.roll)).toBeGreaterThan(Math.abs(axes.yaw));
  });

  it("turns and banks toward a left-side aim point", () => {
    const axes = computeMouseAimInstructorAxes({ x: -0.7, y: 0 }, 0);

    expect(axes.yaw).toBeLessThan(0);
    expect(axes.roll).toBeGreaterThan(0);
    expect(Math.abs(axes.roll)).toBeGreaterThan(Math.abs(axes.yaw));
  });

  it("keeps horizontal mouse input as continuous roll rate instead of a target bank angle", () => {
    const level = computeMouseAimInstructorAxes({ x: 0.7, y: 0 }, 0);
    const inverted = computeMouseAimInstructorAxes({ x: 0.7, y: 0 }, Math.PI);

    expect(level.pitch).toBe(0);
    expect(inverted.pitch).toBe(0);
    expect(inverted.roll).toBeCloseTo(level.roll, 5);
    expect(inverted.roll).toBeLessThan(0);
  });

  it("honors downward intent even with lateral aim", () => {
    expect(computeMouseAimInstructorAxes({ x: 0.7, y: 0.7 }, 0).pitch).toBeLessThan(0);
    expect(computeMouseAimInstructorAxes({ x: -0.7, y: 0.7 }, 0).pitch).toBeLessThan(0);
  });

  it("pitches toward the vertical aim point", () => {
    expect(computeMouseAimInstructorAxes({ x: 0, y: -0.7 }, 0).pitch).toBeGreaterThan(0);
    expect(computeMouseAimInstructorAxes({ x: 0, y: 0.7 }, 0).pitch).toBeLessThan(0);
  });

  it("leaves the current bank alone when the cursor is centered", () => {
    expect(computeMouseAimInstructorAxes({ x: 0, y: 0 }, 0.6).roll).toBe(0);
    expect(computeMouseAimInstructorAxes({ x: 0, y: 0 }, -0.6).roll).toBe(0);
  });

  it("treats tiny centered aim offsets as neutral", () => {
    expect(isNeutralMouseAim({ x: 0.02, y: -0.02 })).toBe(true);
    expect(isNeutralMouseAim({ x: 0.08, y: 0 })).toBe(false);
  });

  it("keeps rudder as a small coordination input instead of primary steering", () => {
    const axes = computeMouseAimInstructorAxes({ x: 0.7, y: 0 }, 0);

    expect(Math.abs(axes.yaw)).toBeLessThan(0.06);
    expect(Math.abs(axes.roll)).toBeGreaterThan(Math.abs(axes.yaw) * 8);
  });

  it("uses the local aircraft frame when tracking a camera ray", () => {
    const level = quaternionFromRotation({ pitch: 0, yaw: 0, roll: 0 });
    const rightRay = normalize({ x: 0.5, y: 0, z: 1 });
    const upRay = normalize({ x: 0, y: 0.5, z: 1 });

    expect(computeMouseAimInstructorAxesFromDirection(rightRay, level, 0).yaw).toBeGreaterThan(0);
    expect(computeMouseAimInstructorAxesFromDirection(rightRay, level, 0).roll).toBeLessThan(0);
    expect(computeMouseAimInstructorAxesFromDirection(upRay, level, 0).pitch).toBeGreaterThan(0);
  });

  it("respects aircraft roll instead of treating screen axes as world axes", () => {
    const rolledRight = quaternionFromRotation({ pitch: 0, yaw: 0, roll: -Math.PI / 2 });
    const worldUpRay = normalize({ x: 0, y: 0.5, z: 1 });
    const axes = computeMouseAimInstructorAxesFromDirection(worldUpRay, rolledRight, -Math.PI / 2);

    expect(Math.abs(axes.yaw)).toBeGreaterThan(0.01);
    expect(Math.abs(axes.roll)).toBeGreaterThan(0.01);
  });
});
