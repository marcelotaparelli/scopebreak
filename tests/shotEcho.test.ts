import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { shotEchoConfig, type ShotEchoConfig } from "../src/config/shotEchoConfig";
import { gameplayConfig } from "../src/config/gameplayConfig";
import { weaponConfigs } from "../src/config/weaponConfigs";
import { ShotCapture } from "../src/combat/ShotCapture";
import type { ShotSnapshot, TargetSample, Vec3 } from "../src/combat/ShotSnapshot";
import { analyzeShot, formatCorrection } from "../src/feedback/ShotAnalyzer";
import { ShotEcho } from "../src/feedback/ShotEcho";
import { adsSpreadDeg, decideLmbEdge, resolvePendingQuickshot } from "../src/player/movementRules";
import { WeaponController } from "../src/weapons/WeaponController";
import { TrainingTarget } from "../src/world/TrainingTarget";

// Camera at the origin looking down -Z (identity quaternion): +az = right, +el = up.
const CFG: ShotEchoConfig = { ...shotEchoConfig, enabled: true };
const R = 0.27; // training head radius
const D = 20;
const DEG = Math.PI / 180;
const HALF = Math.asin(R / D) / DEG; // head angular radius ≈ 0.77°
const INNER = HALF * CFG.validRegionInset;

function dir(azDeg: number, elDeg: number): Vec3 {
  const a = azDeg * DEG, e = elDeg * DEG;
  return { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) };
}
function head(id: number, azDeg: number, elDeg: number, over: Partial<TargetSample> = {}): TargetSample {
  const d = dir(azDeg, elDeg);
  return { id, lifeId: 0, alive: true, headCenter: { x: d.x * D, y: d.y * D, z: d.z * D }, headRadius: R, headVisible: true, ...over };
}
function shot(over: Partial<ShotSnapshot> & { aim?: [number, number]; bullet?: [number, number] } = {}): ShotSnapshot {
  const aim = over.aim ?? [0, 0];
  const bullet = over.bullet ?? aim;
  return {
    timeMs: 1000, weaponId: "viper", origin: { x: 0, y: 0, z: 0 },
    cameraQuat: { x: 0, y: 0, z: 0, w: 1 }, fovDeg: 32,
    aimDir: dir(aim[0], aim[1]), shotDir: dir(bullet[0], bullet[1]),
    spreadDeg: 0, preciseSpreadDeg: 0, ads: true, adsElapsedMs: 200, snapPrecisionMs: 45,
    sliding: false, airborne: false, horizontalSpeed: 0,
    result: { targetId: null, headshot: false, blocked: false, distance: 220 },
    targets: [head(0, 0, 0)],
    ...over,
  };
}

describe("SHOT ECHO geometry: smallest correction into the head", () => {
  test("1. shot left of the head → RIGHT (exact angular value)", () => {
    const a = analyzeShot(shot({ aim: [-1.2, 0] }), CFG);
    expect(a.kind).toBe("aim");
    expect(a.correction!.h).toBeCloseTo(1.2 - INNER, 3);
    expect(Math.abs(a.correction!.v)).toBeLessThan(1e-6);
    expect(formatCorrection(a.correction!)).toEqual({ arrow: "→", text: `${(Math.ceil((1.2 - INNER) * 10) / 10).toFixed(1)}° RIGHT` });
  });

  test("2. shot right → LEFT", () => {
    const a = analyzeShot(shot({ aim: [1.0, 0] }), CFG);
    expect(a.correction!.h).toBeCloseTo(-(1.0 - INNER), 3);
    expect(formatCorrection(a.correction!).text).toContain("LEFT");
    expect(formatCorrection(a.correction!).arrow).toBe("←");
  });

  test("3/4. below → UP, above → DOWN", () => {
    const below = analyzeShot(shot({ aim: [0, -1.5] }), CFG);
    expect(below.correction!.v).toBeCloseTo(1.5 - INNER, 3);
    expect(formatCorrection(below.correction!).arrow).toBe("↑");
    const above = analyzeShot(shot({ aim: [0, 1.1] }), CFG);
    expect(above.correction!.v).toBeCloseTo(-(1.1 - INNER), 3);
    expect(formatCorrection(above.correction!).text).toContain("DOWN");
  });

  test("5. diagonal miss → diagonal correction along the shortest path", () => {
    const a = analyzeShot(shot({ aim: [-1, -1] }), CFG);
    expect(a.correction!.h).toBeGreaterThan(0);
    expect(a.correction!.v).toBeGreaterThan(0);
    expect(a.correction!.h).toBeCloseTo(a.correction!.v, 2); // symmetric miss → symmetric fix
    expect(a.correction!.total).toBeCloseTo(Math.hypot(1, 1) - INNER, 2);
    const f = formatCorrection(a.correction!);
    expect(f.arrow).toBe("↗");
    expect(f.text).toMatch(/RIGHT \+ .*UP/);
  });

  test("small secondary component is dropped (one clear instruction)", () => {
    const f = formatCorrection({ h: 0.8, v: 0.1, total: 0.81 });
    expect(f).toEqual({ arrow: "→", text: "0.8° RIGHT" });
  });
});

describe("SHOT ECHO target selection", () => {
  test("6. body shot analyses the target actually hit (not the angularly closer one)", () => {
    const s = shot({
      aim: [0.2, -1.2],
      targets: [head(0, 0.2, -0.9), head(1, 0, 0)],
      result: { targetId: 1, headshot: false, blocked: false, distance: 20 },
    });
    const a = analyzeShot(s, CFG);
    expect(a.hit).toBe("body");
    expect(a.target!.id).toBe(1);
    expect(a.correction!.v).toBeGreaterThan(0); // up to ITS head
    expect(a.correction!.h).toBeLessThan(0); // and a bit left: diagonal, not pure vertical
  });

  test("7. headshot → no error feedback", () => {
    const e = new ShotEcho(CFG);
    const fb = e.onShot(shot({ result: { targetId: 0, headshot: true, blocked: false, distance: 20 } }))!;
    expect(fb.analysis.kind).toBe("headshot");
    expect(fb.analysis.correction).toBeNull();
    expect(fb.visible).toBe(false);
  });

  test("8. scenery shot with no plausible target → no invented direction", () => {
    const e = new ShotEcho(CFG);
    const fb = e.onShot(shot({ aim: [25, 0], targets: [head(0, 0, 0)], result: { targetId: null, headshot: false, blocked: true, distance: 6 } }))!;
    expect(fb.analysis.kind).toBe("none");
    expect(fb.analysis.correction).toBeNull();
    expect(fb.visible).toBe(false);
    expect(e.stats.noTarget).toBe(1);
  });

  test("9. hidden heads are never selected", () => {
    const hidden = analyzeShot(shot({ aim: [-1, 0], targets: [head(0, 0, 0, { headVisible: false })] }), CFG);
    expect(hidden.kind).toBe("none");
    const pick = analyzeShot(shot({ aim: [-1, 0], targets: [head(0, 0, 0, { headVisible: false }), head(1, 2.5, 0)] }), CFG);
    expect(pick.target!.id).toBe(1);
    // body hit whose head is hidden: honest generic, no arrow
    const body = analyzeShot(shot({ targets: [head(0, 0, 0, { headVisible: false })], result: { targetId: 0, headshot: false, blocked: false, distance: 20 } }), CFG);
    expect(body.kind).toBe("generic");
    expect(body.correction).toBeNull();
  });

  test("selection is by angle, not by 3D distance", () => {
    const near = head(0, 3, 0); near.headCenter = { x: near.headCenter.x / 4, y: near.headCenter.y / 4, z: near.headCenter.z / 4 };
    const a = analyzeShot(shot({ aim: [-0.9, 0], targets: [near, head(1, 0, 0)] }), CFG);
    expect(a.target!.id).toBe(1);
  });
});

describe("SHOT ECHO: aim error vs spread", () => {
  test("10. the ghost and the hit test use the REAL bullet direction", () => {
    const a = analyzeShot(shot({ aim: [0, 0], bullet: [-1.4, 0.3], spreadDeg: 1.6, ads: false }), CFG);
    expect(a.shotOnHead).toBe(false);
    expect(a.ghost!.shot.x).toBeCloseTo(Math.tan(-1.4 * DEG) / Math.cos(0.3 * DEG), 3);
    expect(a.ghost!.shot.y).toBeGreaterThan(0);
    expect(a.ghost!.fix!.x).toBeGreaterThan(a.ghost!.shot.x); // arrow from the bullet toward the head
  });

  test("11. crosshair on the head + spread miss → SPREAD, never an aim correction", () => {
    const e = new ShotEcho(CFG);
    const fb = e.onShot(shot({ aim: [0.1, 0], bullet: [2.0, -1.0], spreadDeg: 5.5, ads: false, adsElapsedMs: 0 }))!;
    expect(fb.analysis.kind).toBe("spread");
    expect(fb.analysis.correction).toBeNull();
    expect(fb.title).toBe("SPREAD");
    expect(fb.detail).toContain("SCOPE IN");
    expect(e.stats.spreadLimited).toBe(1);
  });

  test("crosshair off AND big spread → both contributed (mixed), aim part still exact", () => {
    const a = analyzeShot(shot({ aim: [-1.2, 0], bullet: [-3, 1], spreadDeg: 5.5, ads: false }), CFG);
    expect(a.kind).toBe("mixed");
    expect(a.correction!.h).toBeCloseTo(1.2 - INNER, 3); // from the crosshair, not the bullet
  });

  test("12. pre-snap ADS: timing advice ONLY when waiting provably hits", () => {
    const viper = weaponConfigs.viper;
    const spread = adsSpreadDeg({ adsElapsedMs: 10, snapMs: viper.snapPrecisionMs, hipSpreadDeg: 5.5, preciseSpreadDeg: 0 });
    // aim was on the head, pre-snap spread moved the bullet → ADS +35ms
    const onHead = analyzeShot(shot({ aim: [0.1, 0], bullet: [1.5, 0], spreadDeg: spread, adsElapsedMs: 10 }), CFG);
    expect(onHead.kind).toBe("ads");
    expect(onHead.adsWaitMs).toBe(viper.snapPrecisionMs - 10);
    // aim was OFF: waiting would not have fixed it → spatial advice, no timing claim
    const off = analyzeShot(shot({ aim: [-1.5, 0], bullet: [-1.9, 0], spreadDeg: spread, adsElapsedMs: 10 }), CFG);
    expect(off.kind === "aim" || off.kind === "mixed").toBe(true);
    expect(off.adsWaitMs).toBeNull();
    // Titan's own snap time is respected
    const titan = analyzeShot(shot({ weaponId: "titan", snapPrecisionMs: weaponConfigs.titan.snapPrecisionMs, aim: [0, 0], bullet: [1.5, 0], spreadDeg: 2, adsElapsedMs: 30 }), CFG);
    expect(titan.adsWaitMs).toBe(weaponConfigs.titan.snapPrecisionMs - 30);
  });

  test("cover: the line was on the head but a wall in front stopped the bullet", () => {
    const a = analyzeShot(shot({ aim: [0.1, 0], result: { targetId: null, headshot: false, blocked: true, distance: 8 } }), CFG);
    expect(a.kind).toBe("cover");
    expect(a.correction).toBeNull();
  });
});

describe("SHOT ECHO capture (real THREE objects)", () => {
  function scene(): { cam: THREE.PerspectiveCamera; target: TrainingTarget; wallMesh: THREE.Mesh } {
    const cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 400);
    cam.position.set(0, 1.75, 0);
    cam.updateMatrixWorld();
    const target = new TrainingTarget(7, new THREE.Vector3(0, 0, -20), "static");
    target.group.updateMatrixWorld(true);
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.5));
    wallMesh.position.set(0, 1.75, -10);
    wallMesh.updateMatrixWorld();
    return { cam, target, wallMesh };
  }
  const baseInput = (cam: THREE.PerspectiveCamera, target: TrainingTarget, walls: THREE.Object3D[], nowMs: number, adsElapsedMs: number, spreadDeg: number) => {
    const aim = new THREE.Vector3(0.05, 0, -1).normalize();
    return {
      nowMs, weaponId: "viper" as const, camera: cam, aimDir: aim, shotDir: aim.clone(), spreadDeg,
      preciseSpreadDeg: 0, ads: true, adsElapsedMs, snapPrecisionMs: 45, sliding: true, airborne: false, horizontalSpeed: 14,
      result: { target: null, headshot: false, distance: 220, point: new THREE.Vector3(), blocked: false },
      targets: [target], walls, maximumAnalysisAngleDeg: 4,
    };
  };

  test("reads the head sphere from the real target and checks line of sight", () => {
    const { cam, target, wallMesh } = scene();
    const cap = new ShotCapture();
    const open = cap.capture(baseInput(cam, target, [], 1000, 200, 0));
    expect(open.targets[0]!.headCenter.z).toBeCloseTo(-20, 6);
    expect(open.targets[0]!.headCenter.y).toBeCloseTo(1.75, 6);
    expect(open.targets[0]!.headRadius).toBeCloseTo(0.27, 6);
    expect(open.targets[0]!.headVisible).toBe(true);
    const walled = cap.capture(baseInput(cam, target, [wallMesh], 1000, 200, 0));
    expect(walled.targets[0]!.headVisible).toBe(false);
    expect(analyzeShot(walled, CFG).kind).toBe("none"); // no direction toward a hidden head
  });

  test("13/14. buffered quickshot: snapshot is taken at the EFFECTIVE fire instant", () => {
    // RMB at t=0, LMB at t=10 → buffered; the shot really fires at snap (45ms)
    const w = new WeaponController();
    w.setAds(true, 0);
    const decision = decideLmbEdge({ sinceAdsStartMs: 10, adsElapsedMs: 10, quickShotBufferMs: gameplayConfig.quickShotBufferMs, snapPrecisionMs: w.config.snapPrecisionMs });
    expect(decision).toBe("buffer-quickshot"); // buffer still works
    let fireAt = -1;
    for (let t = 10; t <= 100 && fireAt < 0; t++) {
      if (resolvePendingQuickshot({ pendingLmbMs: 10, adsStartMs: 0, snapMs: w.config.snapPrecisionMs, nowMs: t }) === "fire") fireAt = t;
    }
    expect(fireAt).toBe(w.config.snapPrecisionMs);
    const spread = adsSpreadDeg({ adsElapsedMs: w.adsElapsedMs(fireAt), snapMs: w.config.snapPrecisionMs, hipSpreadDeg: 5.5, preciseSpreadDeg: 0 });
    const { cam, target } = scene();
    const snap = new ShotCapture().capture(baseInput(cam, target, [], fireAt, w.adsElapsedMs(fireAt), spread));
    expect(snap.timeMs).toBe(45); // not the click (10)
    expect(snap.adsElapsedMs).toBe(45);
    expect(snap.spreadDeg).toBe(0); // snap precision reached → no ADS-timing diagnosis possible
    expect(analyzeShot(snap, CFG).kind).not.toBe("ads");
  });

  test("15. ghost uses the camera orientation AT THE SHOT (yaw + slide roll)", () => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.6, -0.07, "YXZ"));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const headDir = fwd.clone();
    const bullet = fwd.clone().addScaledVector(right, Math.tan(1.5 * DEG)).normalize(); // 1.5° to the SCREEN right
    const t: TargetSample = { id: 0, lifeId: 0, alive: true, headCenter: { x: headDir.x * D, y: headDir.y * D, z: headDir.z * D }, headRadius: R, headVisible: true };
    const a = analyzeShot(shot({ cameraQuat: { x: q.x, y: q.y, z: q.z, w: q.w }, aimDir: bullet, shotDir: bullet, targets: [t] }), CFG);
    expect(a.ghost!.shot.x).toBeCloseTo(Math.tan(1.5 * DEG), 6);
    expect(a.ghost!.shot.y).toBeCloseTo(0, 6);
    expect(a.ghost!.head.x).toBeCloseTo(0, 6);
    expect(a.correction!.h).toBeLessThan(0); // LEFT on screen, whatever the world yaw/roll
    expect(Math.abs(a.correction!.v)).toBeLessThan(1e-6);
  });
});

describe("SHOT ECHO: CORRECTED", () => {
  const miss = (t: number, aim: [number, number], over: Partial<ShotSnapshot> = {}) => shot({ timeMs: t, aim, ...over });
  const hs = (t: number, aim: [number, number], over: Partial<ShotSnapshot> = {}) =>
    shot({ timeMs: t, aim, result: { targetId: 0, headshot: true, blocked: false, distance: 20 }, ...over });

  test("16. miss → advised fix → headshot on the same target = CORRECTED", () => {
    const e = new ShotEcho(CFG);
    expect(e.onShot(miss(1000, [-1.2, 0]))!.title).toContain("RIGHT");
    const fb = e.onShot(hs(1800, [-0.1, 0]))!;
    expect(fb.corrected).toBe(true);
    expect(fb.visible).toBe(true);
    expect(fb.title).toBe("CORRECTED");
    expect(fb.sound).toBe("corrected");
    expect(e.stats.corrected).toBe(1);
    // consumed: another headshot doesn't re-trigger it
    expect(e.onShot(hs(2000, [0, 0]))!.corrected).toBe(false);
  });

  test("17. headshot with no previous error is not CORRECTED", () => {
    const e = new ShotEcho(CFG);
    expect(e.onShot(hs(1000, [0, 0]))!.corrected).toBe(false);
  });

  test("18. outside the recognition window → not CORRECTED", () => {
    const e = new ShotEcho(CFG);
    e.onShot(miss(1000, [-1.2, 0]));
    expect(e.onShot(hs(1000 + CFG.correctionRecognitionWindowMs + 1, [0, 0]))!.corrected).toBe(false);
  });

  test("other target or a new life of the same target → no forced association", () => {
    const e = new ShotEcho(CFG);
    const two = [head(0, 0, 0), head(1, 3, 0)];
    e.onShot(miss(1000, [-1.2, 0], { targets: two }));
    const other = e.onShot(shot({ timeMs: 1500, aim: [3, 0], targets: two, result: { targetId: 1, headshot: true, blocked: false, distance: 20 } }))!;
    expect(other.corrected).toBe(false);
    // still pending for target 0 — but it respawned (new life)
    const respawned = e.onShot(hs(1800, [0, 0], { targets: [head(0, 0, 0, { lifeId: 1 }), head(1, 3, 0)] }))!;
    expect(respawned.corrected).toBe(false);
  });

  test("spread/timing lesson is corrected only by a PRECISE headshot", () => {
    const e = new ShotEcho(CFG);
    e.onShot(shot({ timeMs: 1000, aim: [0.1, 0], bullet: [1.5, 0], spreadDeg: 1.8, adsElapsedMs: 10 }));
    expect(e.onShot(hs(1500, [0, 0], { spreadDeg: 1.2, adsElapsedMs: 20 }))!.corrected).toBe(false); // lucky, still early
    e.onShot(shot({ timeMs: 2000, aim: [0.1, 0], bullet: [1.5, 0], spreadDeg: 1.8, adsElapsedMs: 10 }));
    expect(e.onShot(hs(2500, [0, 0], { spreadDeg: 0, adsElapsedMs: 60 }))!.corrected).toBe(true); // waited for snap
  });
});

describe("SHOT ECHO safety", () => {
  test("19. repeated feedback keeps O(1) state (no queues, no growth)", () => {
    const e = new ShotEcho(CFG);
    const sizeAfter = (n: number): number => {
      for (let i = 0; i < n; i++) e.onShot(shot({ timeMs: i * 10, aim: [i % 2 ? -1.2 : 0, 0], result: i % 2 ? { targetId: null, headshot: false, blocked: false, distance: 220 } : { targetId: 0, headshot: true, blocked: false, distance: 20 } }));
      return JSON.stringify(e).length;
    };
    const a = sizeAfter(100);
    const b = sizeAfter(10_000);
    expect(b - a).toBeLessThan(64); // only counter digits grow
    expect(e.stats.analyzed).toBe(10_100);
  });

  test("20. disabled: no analysis, no state, no feedback; analysis never mutates the shot", () => {
    const e = new ShotEcho({ ...CFG, enabled: false });
    expect(e.onShot(shot({ aim: [-1.2, 0] }))).toBeNull();
    expect(e.stats.analyzed).toBe(0);
    const s = shot({ aim: [-1.2, 0], bullet: [-1.5, 0.2], spreadDeg: 1 });
    const before = JSON.stringify(s);
    new ShotEcho(CFG).onShot(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});
