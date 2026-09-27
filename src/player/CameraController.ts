import * as THREE from "three";
import { movementConfig } from "../config/movementConfig.js";

/** FPS camera: yaw/pitch, ADS fov, slide roll, speed FOV kick, recoil. */
export class CameraController {
  yaw = 0; // face -Z (from spawn z=42 toward targets)
  pitch = 0;
  sensitivity = 0.0023;
  adsSensitivityScale = 0.55;
  currentFov = movementConfig.baseFov;
  roll = 0;
  private recoilOffset = 0;
  private eyeH = movementConfig.standingEyeHeight;

  addLook(dx: number, dy: number, ads: boolean): void {
    const s = this.sensitivity * (ads ? this.adsSensitivityScale : 1);
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  kickRecoil(deg: number): void {
    this.recoilOffset += (deg * Math.PI) / 180;
  }

  forwardDir(): THREE.Vector3 {
    const cp = Math.cos(this.pitch - this.recoilOffset * 0.15);
    return new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      Math.sin(this.pitch) - this.recoilOffset * 0.4,
      -Math.cos(this.yaw) * cp,
    ).normalize();
  }

  eyeHeight(sliding: boolean): number {
    return sliding ? movementConfig.slideEyeHeight : movementConfig.standingEyeHeight;
  }

  /**
   * Smoothed stance height: fast drop into the slide, smooth rise back —
   * never a camera snap. Settles within slideCameraTransitionMs.
   */
  eyeHeightSmooth(sliding: boolean, dt: number): number {
    const target = sliding ? movementConfig.slideEyeHeight : movementConfig.standingEyeHeight;
    const lambda = 4.6 / Math.max(0.03, movementConfig.slideCameraTransitionMs / 1000);
    this.eyeH = THREE.MathUtils.damp(this.eyeH, target, lambda, dt);
    return this.eyeH;
  }

  update(
    camera: THREE.PerspectiveCamera,
    dt: number,
    opts: { ads: boolean; scopeFov: number; sliding: boolean; speed: number; strafeLean: number },
  ): void {
    // recoil recovery
    this.recoilOffset = THREE.MathUtils.damp(this.recoilOffset, 0, 9, dt);
    const targetFov = opts.ads
      ? opts.scopeFov
      : movementConfig.baseFov + Math.min(movementConfig.speedFovGain, Math.max(0, opts.speed - movementConfig.runSpeed) * 0.55);
    const speed = opts.ads ? 14 : 8;
    this.currentFov = THREE.MathUtils.damp(this.currentFov, targetFov, speed, dt);
    camera.fov = this.currentFov;
    camera.updateProjectionMatrix();

    const targetRoll = opts.sliding ? -0.07 + opts.strafeLean * -0.03 : opts.strafeLean * -0.02;
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 8, dt);
    camera.rotation.set(0, 0, 0);
    camera.rotation.order = "YXZ";
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch + this.recoilOffset;
    camera.rotation.z = this.roll;
  }
}
