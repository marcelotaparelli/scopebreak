import * as THREE from "three";

export interface Hittable {
  alive: boolean;
  meshes: THREE.Object3D[];
  applyDamage(dmg: number, nowMs: number): boolean;
}

export interface HitscanResult {
  target: Hittable | null;
  headshot: boolean;
  distance: number;
  point: THREE.Vector3;
  blocked: boolean;
}

/**
 * Hitscan resolver: nearest target hit wins unless a wall is closer.
 * Spread is applied by the caller (rotation jitter on the direction).
 */
export class HitDetection {
  private raycaster = new THREE.Raycaster();

  resolve(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxRange: number,
    targets: Hittable[],
    walls: THREE.Object3D[],
  ): HitscanResult {
    this.raycaster.set(origin, dir);
    this.raycaster.far = maxRange;

    let bestTarget: Hittable | null = null;
    let bestHead = false;
    let bestDist = Infinity;
    const bestPoint = new THREE.Vector3();

    for (const t of targets) {
      if (!t.alive) continue;
      const hits = this.raycaster.intersectObjects(t.meshes, false);
      if (hits.length > 0) {
        const h = hits[0];
        if (h && h.distance < bestDist) {
          bestDist = h.distance;
          bestTarget = t;
          bestHead = h.object.userData["part"] === "head";
          bestPoint.copy(h.point);
        }
      }
    }

    let wallDist = Infinity;
    const wallPoint = new THREE.Vector3();
    if (walls.length > 0) {
      const wh = this.raycaster.intersectObjects(walls, false);
      if (wh.length > 0 && wh[0]) {
        wallDist = wh[0].distance;
        wallPoint.copy(wh[0].point);
      }
    }

    if (bestTarget && bestDist <= wallDist) {
      return { target: bestTarget, headshot: bestHead, distance: bestDist, point: bestPoint.clone(), blocked: false };
    }
    if (wallDist < Infinity) {
      return { target: null, headshot: false, distance: wallDist, point: wallPoint.clone(), blocked: true };
    }
    // clean miss into the sky: report max-range point
    const far = origin.clone().addScaledVector(dir, maxRange);
    return { target: null, headshot: false, distance: maxRange, point: far, blocked: false };
  }

  /** Apply gaussian-ish spread (uniform in disc) to a direction, in radians. */
  static applySpread(dir: THREE.Vector3, spreadDeg: number, rand: () => number = Math.random): THREE.Vector3 {
    if (spreadDeg <= 0) return dir.clone();
    const spreadRad = (spreadDeg * Math.PI) / 180;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * spreadRad;
    const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3().crossVectors(dir, up).normalize();
    const bitangent = new THREE.Vector3().crossVectors(dir, tangent).normalize();
    return dir
      .clone()
      .addScaledVector(tangent, Math.cos(a) * r)
      .addScaledVector(bitangent, Math.sin(a) * r)
      .normalize();
  }
}
