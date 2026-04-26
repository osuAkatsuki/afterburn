import * as THREE from "three";
import { MAX_ALTITUDE } from "../../../shared/constants.js";
import type { PlayerState } from "../../../shared/types.js";
import type { CameraLookInput } from "../../hooks/useFlightInput.js";

export const CAMERA_FAR = Math.max(6000, MAX_ALTITUDE * 6);

export class ChaseCamera {
  private readonly cameraLookTarget = new THREE.Vector3(0, 180, 0);
  private readonly chaseCameraFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.far = CAMERA_FAR;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, local: PlayerState | undefined, localJet: THREE.Group | undefined, look?: CameraLookInput): void {
    const cameraAlpha = 1 - Math.exp(-dt * 16);
    const rotationAlpha = 1 - Math.exp(-dt * 24);
    const lookAlpha = 1 - Math.exp(-dt * 12);

    if (!local || local.status !== "alive" || !localJet?.visible) {
      this.camera.position.lerp(new THREE.Vector3(0, 520, -860), cameraAlpha * 0.35);
      this.cameraLookTarget.lerp(new THREE.Vector3(0, 180, 0), lookAlpha * 0.35);
      this.camera.lookAt(this.cameraLookTarget);
      return;
    }

    const desiredOffset = new THREE.Vector3(0, 20, -86).applyQuaternion(localJet.quaternion);
    const desired = localJet.position.clone().add(desiredOffset);
    const desiredRotation = localJet.quaternion.clone().multiply(this.chaseCameraFlip);
    if (look?.active) {
      desiredRotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0, "YXZ")));
    }

    this.camera.position.lerp(desired, cameraAlpha);
    this.camera.quaternion.slerp(desiredRotation, rotationAlpha);
  }
}
