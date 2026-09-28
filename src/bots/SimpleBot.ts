import * as THREE from "three";

export interface BotFireIntent {
  origin: THREE.Vector3;
  dir: THREE.Vector3;
}

const ARENA_HALF = 56;

/** Hit probability vs a moving player: limited on purpose (simple bots). */
export function botHitChance(distance: number, targetSpeed: number, adsAdvantage: number): number {
  const base = 0.34;
  const distFalloff = Math.max(0.25, 1 - distance / 70);
  const movePenalty = Math.max(0.4, 1 - targetSpeed / 22);
  return Math.max(0.04, Math.min(0.5, base * distFalloff * movePenalty * adsAdvantage));
}

export function pickSpawnIndex(aliveCount: number, total: number, rand: () => number = Math.random): number {
  void aliveCount;
  return Math.floor(rand() * total);
}

/**
 * Minimal FFA bot: waypoint wander + face/shoot player when close.
 * No pathfinding, no jumps, no strafing tricks — just enough to test
 * movement / aim / kills / respawn / match flow.
 */
export class SimpleBot {
  readonly group = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0;
  health = 100;
  alive = true;
  /** Bumps on every respawn (SHOT ECHO: a correction never carries over to a new life). */
  lifeId = 0;
  nextDecideMs = 0;
  nextShotMs = 0;
  waypoint = new THREE.Vector3();
  private bodyMesh: THREE.Mesh;
  private headMesh: THREE.Mesh;
  private flashMs = 0;

  constructor(
    readonly botIndex: number, // index in FFA scores array
    readonly name: string,
    spawn: { x: number; y: number; z: number },
  ) {
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x7a2438 });
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd8dee9, emissive: 0x222222 });
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.45), bodyMat);
    this.bodyMesh.position.y = 0.9;
    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), headMat);
    this.headMesh.position.y = 1.75;
    this.bodyMesh.userData = { botIndex, part: "body" };
    this.headMesh.userData = { botIndex, part: "head" };
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.08, 0.49),
      new THREE.MeshBasicMaterial({ color: 0xff2d55 }),
    );
    stripe.position.y = 1.25;
    this.group.add(this.bodyMesh, this.headMesh, stripe);
    this.respawn(spawn, 0);
    this.waypoint.copy(this.pos);
  }

  /** Stable identity for analysis (same as the FFA score index). */
  get id(): number {
    return this.botIndex;
  }

  get meshes(): THREE.Object3D[] {
    return [this.bodyMesh, this.headMesh];
  }

  respawn(spawn: { x: number; y: number; z: number }, nowMs: number): void {
    this.pos.set(spawn.x, spawn.y, spawn.z);
    this.health = 100;
    this.alive = true;
    this.lifeId++;
    this.group.visible = true;
    this.group.position.copy(this.pos);
    this.waypoint.set(
      (Math.random() * 2 - 1) * 40,
      0.1,
      (Math.random() * 2 - 1) * 40,
    );
    this.nextDecideMs = nowMs + 2000 + Math.random() * 3000;
    this.nextShotMs = nowMs + 1200 + Math.random() * 1500; // reaction delay
    this.yaw = Math.atan2(-this.pos.x, -this.pos.z);
  }

  die(nowMs: number): void {
    void nowMs;
    this.alive = false;
    this.group.visible = false;
  }

  /** Returns true if this shot killed the bot. */
  applyDamage(dmg: number): boolean {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flashMs = performance.now();
    const m = this.bodyMesh.material as THREE.MeshLambertMaterial;
    m.emissive.setHex(0x550000);
    window.setTimeout(() => m.emissive.setHex(0x000000), 90);
    if (this.health <= 0) {
      this.die(performance.now());
      return true;
    }
    return false;
  }

  update(dt: number, nowMs: number, playerPos: THREE.Vector3, playerAlive: boolean): BotFireIntent | null {
    if (!this.alive) return null;
    this.group.position.copy(this.pos);

    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.pos);
    toPlayer.y = 0;
    const distToPlayer = toPlayer.length();
    const seesPlayer = playerAlive && distToPlayer < 48;

    // decide waypoint
    if (nowMs >= this.nextDecideMs || this.pos.distanceTo(this.waypoint) < 2) {
      this.nextDecideMs = nowMs + 3500 + Math.random() * 3500;
      if (seesPlayer && Math.random() < 0.55) {
        // strafe orbit: waypoint near player but offset, keeps fights mobile
        const a = Math.random() * Math.PI * 2;
        this.waypoint.set(
          THREE.MathUtils.clamp(playerPos.x + Math.cos(a) * 12, -ARENA_HALF, ARENA_HALF),
          0.1,
          THREE.MathUtils.clamp(playerPos.z + Math.sin(a) * 12, -ARENA_HALF, ARENA_HALF),
        );
      } else {
        this.waypoint.set(
          (Math.random() * 2 - 1) * 44,
          0.1,
          (Math.random() * 2 - 1) * 44,
        );
      }
    }

    // steer (ground plane, speed ~5.5)
    const toWay = new THREE.Vector3().subVectors(this.waypoint, this.pos);
    toWay.y = 0;
    const wayDist = toWay.length();
    if (wayDist > 0.2) {
      toWay.normalize();
      const speed = seesPlayer ? 6.0 : 5.0;
      this.pos.addScaledVector(toWay, Math.min(speed * dt, wayDist));
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -ARENA_HALF, ARENA_HALF);
      this.pos.z = THREE.MathUtils.clamp(this.pos.z, -ARENA_HALF, ARENA_HALF);
    }

    // face player in combat, else face travel
    if (seesPlayer && distToPlayer > 0.5) {
      this.yaw = Math.atan2(-toPlayer.x, -toPlayer.z);
    } else if (wayDist > 0.5) {
      this.yaw = Math.atan2(-toWay.x, -toWay.z);
    }
    this.group.rotation.y = this.yaw;

    // fire intent: cooldown + reaction, only with rough aim
    if (seesPlayer && nowMs >= this.nextShotMs && distToPlayer > 2) {
      this.nextShotMs = nowMs + 1300 + Math.random() * 1400;
      const origin = this.pos.clone();
      origin.y += 1.55;
      const target = playerPos.clone();
      target.y += 1.3;
      const dir = new THREE.Vector3().subVectors(target, origin).normalize();
      return { origin, dir };
    }
    void this.flashMs;
    return null;
  }
}
