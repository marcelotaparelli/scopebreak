import { describe, expect, test } from "bun:test";
import { shotEchoConfig, type ShotEchoConfig } from "../src/config/shotEchoConfig";
import type { ShotSnapshot, TargetSample, Vec3 } from "../src/combat/ShotSnapshot";
import { applyEchoSlot, echoSlotAt, echoTextTimeline, type EchoSlot } from "../src/feedback/EchoDisplayPolicy";
import { buildImpactSketch } from "../src/feedback/ImpactSketch";
import { analyzeShot } from "../src/feedback/ShotAnalyzer";
import { ShotEcho } from "../src/feedback/ShotEcho";

// Camera at the origin looking down -Z (identity quaternion): +az = right, +el = up.
const CFG: ShotEchoConfig = { ...shotEchoConfig, enabled: true, impactSketchEnabled: true };
const R = 0.27;
const D = 20;
const DEG = Math.PI / 180;
const HALF = Math.asin(R / D) / DEG; // head angular radius ≈ 0.77°

function dir(az: number, el: number): Vec3 {
  return { x: Math.sin(az * DEG) * Math.cos(el * DEG), y: Math.sin(el * DEG), z: -Math.cos(az * DEG) * Math.cos(el * DEG) };
}
function head(id: number, az: number, el: number, over: Partial<TargetSample> = {}): TargetSample {
  const d = dir(az, el);
  return { id, lifeId: 0, alive: true, headCenter: { x: d.x * D, y: d.y * D, z: d.z * D }, headRadius: R, headVisible: true, ...over };
}
function shot(over: Partial<ShotSnapshot> & { aim?: [number, number]; bullet?: [number, number] } = {}): ShotSnapshot {
  const aim = over.aim ?? [0, 0];
  const bullet = over.bullet ?? aim;
  return {
    timeMs: 1000, weaponId: "viper", origin: { x: 0, y: 0, z: 0 }, cameraQuat: { x: 0, y: 0, z: 0, w: 1 }, fovDeg: 32,
    aimDir: dir(aim[0], aim[1]), shotDir: dir(bullet[0], bullet[1]), spreadDeg: 0, preciseSpreadDeg: 0,
    ads: true, adsElapsedMs: 200, snapPrecisionMs: 45, sliding: false, airborne: false, horizontalSpeed: 0,
    result: { targetId: null, headshot: false, blocked: false, distance: 220 },
    targets: [head(0, 0, 0)], ...over,
  };
}
const sketchOf = (s: ShotSnapshot, cfg = CFG) => buildImpactSketch(s, analyzeShot(s, cfg), cfg);
/** Expected offset in head radii for a small angular miss (tangent plane). */
const radii = (deg: number): number => Math.tan(deg * DEG) / Math.tan(HALF * DEG);

describe("Impact Sketch: bullet position relative to the head at the shot instant", () => {
  test("1. shot left → X left of the head, level; arrow points right into the valid region", () => {
    const r = sketchOf(shot({ aim: [-1.2, 0] }));
    expect(r.suppressed).toBeNull();
    expect(r.sketch!.bullet.x).toBeCloseTo(-radii(1.2), 2);
    expect(Math.abs(r.sketch!.bullet.y)).toBeLessThan(1e-6);
    expect(r.sketch!.arrowTo!.x).toBeGreaterThan(r.sketch!.arrowFrom!.x);
    expect(Math.hypot(r.sketch!.arrowTo!.x, r.sketch!.arrowTo!.y)).toBeCloseTo(CFG.validRegionInset, 2); // lands on the valid rim
  });

  test("2. shot right → X right of the head", () => {
    const r = sketchOf(shot({ aim: [1.0, 0] }));
    expect(r.sketch!.bullet.x).toBeCloseTo(radii(1.0), 2);
    expect(r.sketch!.arrowTo!.x).toBeLessThan(r.sketch!.arrowFrom!.x);
  });

  test("3. above → X above, below → X below", () => {
    expect(sketchOf(shot({ aim: [0, 1.1] })).sketch!.bullet.y).toBeGreaterThan(1);
    const low = sketchOf(shot({ aim: [0, -1.4] })).sketch!;
    expect(low.bullet.y).toBeLessThan(-1);
    expect(Math.abs(low.bullet.x)).toBeLessThan(1e-6);
  });

  test("4. diagonal → both components visible (X down-left, arrow up-right)", () => {
    const sk = sketchOf(shot({ aim: [-1, -1] })).sketch!;
    expect(sk.bullet.x).toBeLessThan(-0.8);
    expect(sk.bullet.y).toBeLessThan(-0.8);
    expect(sk.arrowTo!.x - sk.arrowFrom!.x).toBeGreaterThan(0.5);
    expect(sk.arrowTo!.y - sk.arrowFrom!.y).toBeGreaterThan(0.5);
  });

  test("far misses stay on the diagram rim with their direction (flagged off-scale)", () => {
    const sk = sketchOf(shot({ aim: [-3.5, 0] })).sketch!;
    expect(sk.bulletClamped).toBe(true);
    expect(sk.bullet.x).toBeCloseTo(-sk.extent * 0.9, 6);
    expect(Math.abs(sk.bullet.y)).toBeLessThan(1e-6);
  });

  test("5. body shot is drawn relative to the SAME target's head", () => {
    const s = shot({
      aim: [0.2, -1.6],
      targets: [head(0, 0.2, -1.3), head(1, 0, 0)],
      result: { targetId: 1, headshot: false, blocked: false, distance: 20 },
    });
    const r = sketchOf(s);
    expect(r.sketch!.bullet.y).toBeCloseTo(-radii(1.6), 1); // below head #1, not near head #0
    expect(r.sketch!.bullet.x).toBeGreaterThan(0);
  });
});

describe("Impact Sketch: suppression (never invent a position)", () => {
  test("6. no valid target → no sketch", () => {
    const r = sketchOf(shot({ aim: [25, 0] }));
    expect(r.sketch).toBeNull();
    expect(r.suppressed).toBe("no-target");
  });

  test("7. hidden heads and cover never produce a sketch", () => {
    expect(sketchOf(shot({ aim: [-1, 0], targets: [head(0, 0, 0, { headVisible: false })] })).sketch).toBeNull();
    const body = sketchOf(shot({ targets: [head(0, 0, 0, { headVisible: false })], result: { targetId: 0, headshot: false, blocked: false, distance: 20 } }));
    expect(body.suppressed).toBe("generic");
    // line WAS on the head, a wall stopped it: a miss diagram would contradict the cause
    const cover = sketchOf(shot({ aim: [0.1, 0], result: { targetId: null, headshot: false, blocked: true, distance: 8 } }));
    expect(cover.sketch).toBeNull();
    expect(cover.suppressed).toBe("cover");
    expect(cover.offset).not.toBeNull(); // still reported to debug
  });

  test("8. spread: shows where the bullet went + the crosshair ON the head, no aim arrow", () => {
    const sk = sketchOf(shot({ aim: [0.1, 0], bullet: [1.6, -0.6], spreadDeg: 5.5, ads: false })).sketch!;
    expect(sk.kind).toBe("spread");
    expect(sk.bullet.x).toBeGreaterThan(1);
    expect(sk.aim).not.toBeNull();
    expect(Math.hypot(sk.aim!.x, sk.aim!.y)).toBeLessThanOrEqual(CFG.validRegionInset);
    expect(sk.arrowTo).toBeNull(); // the crosshair was right: nothing to correct
    // ADS timing coexists the same way
    const ads = sketchOf(shot({ aim: [0.1, 0], bullet: [1.5, 0], spreadDeg: 1.8, adsElapsedMs: 10 })).sketch!;
    expect(ads.kind).toBe("ads");
    expect(ads.arrowTo).toBeNull();
  });

  test("11. SHOT ECHO off (or sketch off) → no sketch", () => {
    expect(sketchOf(shot({ aim: [-1.2, 0] }), { ...CFG, enabled: false }).suppressed).toBe("disabled");
    expect(sketchOf(shot({ aim: [-1.2, 0] }), { ...CFG, impactSketchEnabled: false }).sketch).toBeNull();
    expect(new ShotEcho({ ...CFG, enabled: false }).onShot(shot({ aim: [-1.2, 0] }))).toBeNull();
  });
});

describe("Impact Sketch lives in the feedback plate", () => {
  const e = new ShotEcho(CFG);
  const missSnap = shot({ timeMs: 1000, aim: [-1.2, 0] });
  const miss = e.onShot(missSnap)!;
  const missSk = buildImpactSketch(missSnap, miss.analysis, CFG).sketch;
  const hsSnap = shot({ timeMs: 1600, aim: [-0.1, 0], result: { targetId: 0, headshot: true, blocked: false, distance: 20 } });
  const corrected = e.onShot(hsSnap)!;

  test("9. appears with the text and lasts exactly the text timeline (~1.5s, same fade)", () => {
    const { slot } = applyEchoSlot(null, miss, missSk !== null, 1000, CFG);
    expect(slot!.sketch).toBe(true);
    const tl = echoTextTimeline(CFG);
    expect(echoSlotAt(slot, 1000 + tl.totalMs - 1, CFG)!.sketch).toBe(true);
    expect(echoSlotAt(slot, 1000 + tl.totalMs, CFG)).toBeNull();
  });

  test("10. replaced/cleared together with the feedback", () => {
    let slot: EchoSlot | null = applyEchoSlot(null, miss, true, 1000, CFG).slot;
    // CORRECTED replaces the plate: no miss diagram lingers next to "CORRECTED"
    const sk = buildImpactSketch(hsSnap, corrected.analysis, CFG);
    expect(sk.suppressed).toBe("headshot");
    slot = applyEchoSlot(slot, corrected, sk.sketch !== null, 1600, CFG).slot;
    expect(slot!.corrected).toBe(true);
    expect(slot!.sketch).toBe(false);
    // a plain headshot clears an advice plate → sketch gone with it
    const plain = new ShotEcho(CFG).onShot(shot({ timeMs: 1, result: { targetId: 0, headshot: true, blocked: false, distance: 20 } }))!;
    expect(applyEchoSlot({ corrected: false, shownAtMs: 0, sketch: true }, plain, false, 100, CFG).slot).toBeNull();
  });

  test("12. CORRECTED still recognised and announced", () => {
    expect(corrected.corrected).toBe(true);
    expect(corrected.title).toBe("CORRECTED");
    expect(corrected.sound).toBe("corrected");
  });
});

describe("Impact Sketch size follows the text", () => {
  test("square side = measured height of the whole text column (floor only for tiny text)", async () => {
    const { sketchSizeFor } = await import("../src/feedback/ImpactSketch");
    expect(sketchSizeFor(96.4, CFG)).toBe(96); // header + value + direction + 2 lines
    expect(sketchSizeFor(131, CFG)).toBe(131); // taller text → taller sketch
    expect(sketchSizeFor(20, CFG)).toBe(CFG.impactSketchMinSize);
  });
});
