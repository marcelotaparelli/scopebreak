import * as THREE from "three";
import { box, type AABB } from "./physics.js";

/**
 * Training arena: a movement playground, not art.
 * Flat-lit boxes, high contrast trim, fog for depth.
 * Circuit: spawn → sprint → slide → steps/ramp → slide jump →
 * air-strafe gap → wall-kick channel → quickscope targets → flow landing lane.
 */
export class TrainingArena {
  readonly group = new THREE.Group();
  readonly colliders: AABB[] = [];
  readonly solidMeshes: THREE.Object3D[] = [];
  spawn = new THREE.Vector3(0, 0.1, 42);

  constructor() {
    this.build();
    // Mirror static geometry into Rapier (non-blocking, best-effort) so a
    // future authoritative server can reuse identical level bounds.
    void this.mirrorToRapier();
  }

  private addBox(
    cx: number, minY: number, cz: number,
    sx: number, sy: number, sz: number,
    color: number, emissive = 0x000000,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mat = new THREE.MeshLambertMaterial({ color, emissive });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx, minY + sy / 2, cz);
    this.group.add(mesh);
    this.solidMeshes.push(mesh);
    this.colliders.push(box(cx, minY, cz, sx, sy, sz));
    return mesh;
  }

  private build(): void {
    const FLOOR = 0x11161f;
    const TRIM = 0x00f0ff;
    const WALL = 0x1a2333;
    const PLAT = 0x232f47;
    const BLOCK = 0x2b3a55;

    // ground
    this.addBox(0, -2, 0, 130, 2, 130, FLOOR);

    // glowing grid lanes (visual only)
    const grid = new THREE.GridHelper(120, 60, TRIM, 0x1e2c44);
    grid.position.y = 0.01;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    this.group.add(grid);

    // perimeter walls (h=8)
    this.addBox(0, 0, -62, 130, 8, 2, WALL);
    this.addBox(0, 0, 62, 130, 8, 2, WALL);
    this.addBox(-62, 0, 0, 2, 8, 130, WALL);
    this.addBox(62, 0, 0, 2, 8, 130, WALL);

    // accent glow strips on perimeter
    const stripMat = new THREE.MeshBasicMaterial({ color: TRIM });
    for (const z of [-60.9, 60.9]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(120, 0.15, 0.15), stripMat);
      s.position.set(0, 4, z);
      this.group.add(s);
    }

    // --- central elevated platform (y=3) with step ramp on south side
    this.addBox(0, 0, -8, 16, 3, 14, PLAT);
    // steps up (south): 4 steps
    for (let i = 0; i < 4; i++) {
      this.addBox(0, 0, -0.5 + i * 1.1, 6, 0.75 * (i + 1), 1.0, BLOCK);
    }
    // platform trim
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(16.2, 0.12, 14.2),
      new THREE.MeshBasicMaterial({ color: TRIM }),
    );
    trim.position.set(0, 3.06, -8);
    this.group.add(trim);

    // --- window wall (north of platform): wall with 3 openings to shoot through
    // segments: wall h 5 at y=3..8 on platform far edge z=-15
    this.addBox(-12, 3, -15, 8, 5, 1, WALL);
    this.addBox(12, 3, -15, 8, 5, 1, WALL);
    this.addBox(0, 6.2, -15, 8, 1.8, 1, WALL); // lintel above middle opening
    this.addBox(-4.5, 3, -15, 1, 3.2, 1, WALL);
    this.addBox(4.5, 3, -15, 1, 3.2, 1, WALL);

    // --- side platforms (east/west) for verticality
    this.addBox(-30, 0, 5, 12, 2, 12, PLAT);
    this.addBox(30, 0, 5, 12, 2, 12, PLAT);
    // steps to side platforms
    for (let i = 0; i < 3; i++) {
      this.addBox(-30, 0, 12.5 + i * 1.0, 5, 0.66 * (i + 1), 0.9, BLOCK);
      this.addBox(30, 0, 12.5 + i * 1.0, 5, 0.66 * (i + 1), 0.9, BLOCK);
    }

    // --- slide obstacles: low blocks to slalom (slide under bar)
    for (const x of [-10, 0, 10]) {
      // pillars pair + high bar (slide under)
      this.addBox(x - 1.6, 0, 24, 0.8, 3.2, 0.8, BLOCK);
      this.addBox(x + 1.6, 0, 24, 0.8, 3.2, 0.8, BLOCK);
      this.addBox(x, 1.7, 24, 4.0, 0.5, 0.8, 0x3a2b55, 0x1a0b2e);
    }

    // --- wall-kick channel: two tall parallel walls (x = ±4, z from -34 to -22)
    this.addBox(-4.5, 0, -28, 1, 9, 14, WALL, 0x0a1420);
    this.addBox(4.5, 0, -28, 1, 9, 14, WALL, 0x0a1420);
    const kickTrimMat = new THREE.MeshBasicMaterial({ color: 0xffd60a });
    for (const x of [-3.9, 3.9]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 14), kickTrimMat);
      s.position.set(x, 5, -28);
      this.group.add(s);
    }

    // --- long-shot back wall marker (far north)
    this.addBox(0, 0, -55, 30, 6, 1, WALL);
    const laneMat = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
    const lane = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 90), laneMat);
    lane.position.set(8, 0.03, -5);
    this.group.add(lane);

    // --- scattered cover blocks for strafing practice
    const covers: Array<[number, number, number, number]> = [
      [-16, 34, 3, 1.4], [16, 34, 3, 1.4],
      [-20, 12, 2.5, 2.2], [20, 12, 2.5, 2.2],
      [-14, -38, 4, 1.6], [14, -38, 4, 1.6],
    ];
    for (const [x, z, s, h] of covers) this.addBox(x, 0, z, s, h, s, BLOCK);

    // lighting
    const hemi = new THREE.HemisphereLight(0x8fb8ff, 0x0a0e14, 0.9);
    this.group.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(20, 40, 20);
    this.group.add(dir);
    const p1 = new THREE.PointLight(TRIM, 60, 60);
    p1.position.set(0, 8, 24);
    this.group.add(p1);
    const p2 = new THREE.PointLight(0xffd60a, 40, 50);
    p2.position.set(0, 10, -28);
    this.group.add(p2);
  }

  private async mirrorToRapier(): Promise<void> {
    try {
      const RAPIER = await import("@dimforge/rapier3d-compat");
      await RAPIER.init();
      const world = new RAPIER.World({ x: 0, y: -23, z: 0 });
      for (const c of this.colliders) {
        const hx = (c.maxX - c.minX) / 2;
        const hy = (c.maxY - c.minY) / 2;
        const hz = (c.maxZ - c.minZ) / 2;
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(
            (c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2,
          ),
          body,
        );
      }
      void world;
    } catch {
      // Rapier is optional for the local vertical slice; custom physics is authoritative.
    }
  }
}
