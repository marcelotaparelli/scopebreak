import * as THREE from "three";
import { gameplayConfig } from "../config/gameplayConfig.js";

export type TargetMotion = "static" | "slider" | "weaver" | "elevated";

export interface TargetHit {
  headshot: boolean;
  distance: number;
  point: THREE.Vector3;
}

/**
 * Pop-up range target: body box + distinct head sphere.
 * Health 100, head/body colliders explicit, auto-respawn.
 */
export class TrainingTarget {
  readonly id: number;
  readonly group = new THREE.Group();
  readonly motion: TargetMotion;
  health = 100;
  alive = true;
  basePos: THREE.Vector3;
  private respawnAt = 0;
  private bodyMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private ringMesh: THREE.Mesh;

  constructor(id: number, pos: THREE.Vector3, motion: TargetMotion) {
    this.id = id;
    this.motion = motion;
    this.basePos = pos.clone();

    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x2e7d6e });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xffd60a, emissive: 0x4a3a00 });
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.45), bodyMat);
    this.bodyMesh.position.y = 0.9;
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 18, 14), headMat);
    this.headMesh.position.y = 1.75;
    this.ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
    );
    this.ringMesh.position.y = 0.9;

    this.bodyMesh.userData = { targetId: id, part: "body" };
    this.headMesh.userData = { targetId: id, part: "head" };

    // pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
      new THREE.MeshLambertMaterial({ color: 0x39465e }),
    );
    pole.position.y = 0.2;
    this.group.add(pole, this.bodyMesh, this.headMesh, this.ringMesh);
    this.group.position.copy(pos);
  }

  get meshes(): THREE.Object3D[] {
    return [this.bodyMesh, this.headMesh];
  }

  update(nowMs: number, timeS: number): void {
    if (!this.alive) {
      if (nowMs >= this.respawnAt) {
        this.alive = true;
        this.health = 100;
        this.group.visible = true;
      } else return;
    }
    const p = this.basePos;
    switch (this.motion) {
      case "static":
      case "elevated":
        this.group.position.set(p.x, p.y, p.z);
        break;
      case "slider":
        this.group.position.set(p.x + Math.sin(timeS * 1.1) * 7, p.y, p.z);
        break;
      case "weaver":
        this.group.position.set(
          p.x + Math.sin(timeS * 0.9) * 6,
          p.y,
          p.z + Math.cos(timeS * 0.63) * 3,
        );
        break;
    }
  }

  applyDamage(dmg: number, nowMs: number): boolean {
    if (!this.alive) return false;
    this.health -= dmg;
    if (this.health <= 0) {
      this.alive = false;
      this.group.visible = false;
      this.respawnAt = nowMs + gameplayConfig.targetRespawnMs;
      return true;
    }
    // flash body on non-lethal hit
    const m = this.bodyMesh.material as THREE.MeshLambertMaterial;
    m.emissive.setHex(0x66ffff);
    window.setTimeout(() => m.emissive.setHex(0x000000), 90);
    return false;
  }
}

export function buildTargets(): TrainingTarget[] {
  return [
    new TrainingTarget(0, new THREE.Vector3(0, 0, 18), "static"),
    new TrainingTarget(1, new THREE.Vector3(-8, 0, 6), "slider"),
    new TrainingTarget(2, new THREE.Vector3(8, 0, -2), "weaver"),
    new TrainingTarget(3, new THREE.Vector3(0, 3.05, -8), "elevated"),
    new TrainingTarget(4, new THREE.Vector3(-6, 0, -46), "static"), // long shot
    new TrainingTarget(5, new THREE.Vector3(6, 0, -46), "slider"), // long shot mover
  ];
}
