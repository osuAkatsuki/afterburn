import * as THREE from "three";
import type { RoomState } from "../../../shared/types.js";
import {
  formatTargetRange,
  getTargetOverlayModels,
  type TargetOverlayModel
} from "./targetOverlay.js";

type TargetOverlayElements = {
  root: HTMLElement;
  range: HTMLElement | null;
  speed: HTMLElement | null;
};

export class TargetOverlayProjector {
  constructor(
    private readonly container: HTMLElement | null,
    private readonly camera: THREE.Camera,
    private readonly getJet: (playerId: string) => THREE.Group | undefined
  ) {}

  update(room: RoomState | undefined, localPlayerId: string): void {
    if (!this.container) {
      return;
    }

    const labels = this.labelsByPlayerId();
    labels.forEach(({ root }) => {
      root.dataset.visible = "false";
      root.dataset.lockState = "idle";
    });

    const models = getTargetOverlayModels(
      room,
      localPlayerId,
      this.camera,
      (playerId) => this.renderedPlayerPosition(playerId, room),
      { width: window.innerWidth, height: window.innerHeight }
    );

    models.forEach((model) => {
      const label = labels.get(model.playerId);
      if (!label) {
        return;
      }

      this.applyModel(label, model);
    });
  }

  private applyModel(label: TargetOverlayElements, model: TargetOverlayModel): void {
    label.root.dataset.visible = "true";
    label.root.dataset.lockState = model.lockState;
    label.root.style.setProperty("--target-screen-x", `${model.screenX}px`);
    label.root.style.setProperty("--target-screen-y", `${model.screenY}px`);
    label.root.style.setProperty("--target-opacity", model.opacity.toFixed(3));
    label.root.style.setProperty("--target-progress", model.lockProgress.toFixed(3));
    label.root.style.setProperty("--travel-width", `${Math.hypot(model.travelVectorX, model.travelVectorY).toFixed(1)}px`);
    label.root.style.setProperty("--travel-angle", `${Math.atan2(model.travelVectorY, model.travelVectorX)}rad`);

    if (label.range) {
      label.range.textContent = formatTargetRange(model.rangeMeters);
    }

    if (label.speed) {
      label.speed.textContent = `${Math.round(model.speedMetersPerSecond)} M/S`;
    }
  }

  private renderedPlayerPosition(playerId: string, room: RoomState | undefined): THREE.Vector3 | undefined {
    const jet = this.getJet(playerId);
    if (jet?.visible) {
      return jet.position.clone();
    }

    const player = room?.players[playerId];
    return player ? new THREE.Vector3(player.position.x, player.position.y, player.position.z) : undefined;
  }

  private labelsByPlayerId(): Map<string, TargetOverlayElements> {
    const labels = new Map<string, TargetOverlayElements>();
    this.container?.querySelectorAll<HTMLElement>(".target-label[data-player-id]").forEach((root) => {
      const playerId = root.dataset.playerId;
      if (!playerId) {
        return;
      }

      labels.set(playerId, {
        root,
        range: root.querySelector<HTMLElement>(".target-label-range"),
        speed: root.querySelector<HTMLElement>(".target-label-speed")
      });
    });

    return labels;
  }
}
