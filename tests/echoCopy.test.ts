import { describe, expect, test } from "bun:test";
import { shotEchoConfig, type ShotEchoConfig } from "../src/config/shotEchoConfig";
import type { ShotSnapshot, TargetSample, Vec3 } from "../src/combat/ShotSnapshot";
import { describeEcho, placeOf, placePhrase } from "../src/feedback/EchoCopy";
import { applyEchoSlot, echoSlotAt, echoTextTimeline } from "../src/feedback/EchoDisplayPolicy";
import { buildImpactSketch } from "../src/feedback/ImpactSketch";
import { ShotEcho } from "../src/feedback/ShotEcho";

// Camera at the origin looking down -Z (identity quaternion): +az = right, +el = up.
const CFG: ShotEchoConfig = { ...shotEchoConfig, enabled: true, impactSketchEnabled: true };
const DEG = Math.PI / 180;
const dir = (az: number, el: number): Vec3 => ({ x: Math.sin(az * DEG) * Math.cos(el * DEG), y: Math.sin(el * DEG), z: -Math.cos(az * DEG) * Math.cos(el * DEG) });
function head(id: number, az: number, el: number, over: Partial<TargetSample> = {}): TargetSample {
  const d = dir(az, el);
  return { id, lifeId: 0, alive: true, headCenter: { x: d.x * 20, y: d.y * 20, z: d.z * 20 }, headRadius: 0.27, headVisible: true, ...over };
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
/** The full presentation for one shot: feedback, copy, sketch — all from the same snapshot. */
function present(s: ShotSnapshot, echo = new ShotEcho(CFG)) {
  const fb = echo.onShot(s)!;
  return { fb, copy: describeEcho(fb, s.ads), sketch: buildImpactSketch(s, fb.analysis, CFG) };
}

describe("SHOT ECHO copy: where it went vs what to do (never confused)", () => {
  test("1. shot left → X left, big → RIGHT, 'Shot passed left of the head.'", () => {
    const { copy, sketch } = present(shot({ aim: [-1.2, 0] }));
    expect(sketch.sketch!.bullet.x).toBeLessThan(0);
    expect(copy!.glyph).toBe("→");
    expect(copy!.value).toMatch(/^\d\.\d°$/);
    expect(copy!.direction).toBe("RIGHT");
    expect(copy!.description).toEqual(["Shot passed left of the head."]);
    expect(copy!.description.join(" ")).not.toContain("NEAR MISS");
  });

  test("2. shot right → LEFT", () => {
    const { copy } = present(shot({ aim: [1.0, 0] }));
    expect(copy!.direction).toBe("LEFT");
    expect(copy!.glyph).toBe("←");
    expect(copy!.description).toEqual(["Shot passed right of the head."]);
  });

  test("3. shot above → DOWN", () => {
    const { copy } = present(shot({ aim: [0, 1.1] }));
    expect(copy!.direction).toBe("DOWN");
    expect(copy!.description).toEqual(["Shot passed above the head."]);
  });

  test("4. shot below → UP", () => {
    const { copy } = present(shot({ aim: [0, -1.4] }));
    expect(copy!.direction).toBe("UP");
    expect(copy!.glyph).toBe("↑");
    expect(copy!.description).toEqual(["Shot passed below the head."]);
  });

  test("5. diagonal: both parts, value / direction aligned, description diagonal", () => {
    const { copy } = present(shot({ aim: [-1, 1] }));
    expect(copy!.glyph).toBe("↘");
    expect(copy!.value).toMatch(/^\d\.\d° \/ \d\.\d°$/);
    expect(copy!.direction).toBe("RIGHT / DOWN");
    expect(copy!.description).toEqual(["Shot passed above and left of the head."]);
  });

  test("6. body shot: body wording, advice follows the real correction (not always 'up')", () => {
    const up = present(shot({ aim: [0, -1.6], result: { targetId: 0, headshot: false, blocked: false, distance: 20 } })).copy!;
    expect(up.direction).toBe("UP");
    expect(up.description).toEqual(["Body hit.", "Raise your aim to reach the head."]);
    const diag = present(shot({ aim: [-1.2, -1.4], result: { targetId: 0, headshot: false, blocked: false, distance: 20 } })).copy!;
    expect(diag.direction).toBe("RIGHT / UP");
    expect(diag.description).toEqual(["Body hit.", "Aim higher and right for the head."]);
  });

  test("7. spread is never presented as the player's aim error", () => {
    const { fb, copy, sketch } = present(shot({ aim: [0.1, 0], bullet: [1.6, -0.6], spreadDeg: 5.5, ads: false }));
    expect(fb.analysis.correction).toBeNull();
    expect(copy!.value).toBe("SPREAD");
    expect(copy!.direction).toBe("");
    expect(copy!.description[0]).toBe("Your aim was on target.");
    expect(copy!.description.join(" ")).toContain("spread caused the miss");
    expect(sketch.sketch!.aim).not.toBeNull(); // + drawn on the head
    expect(sketch.sketch!.arrowTo).toBeNull(); // no correction arrow
  });

  test("8. ADS timing only when proven — with the real wait", () => {
    const proven = present(shot({ aim: [0.1, 0], bullet: [1.5, 0], spreadDeg: 1.8, adsElapsedMs: 25 })).copy!;
    expect(proven.value).toBe("ADS +20ms");
    expect(proven.description).toEqual(["Your aim was on target.", "Fire after your scope reaches snap precision."]);
    // same early ADS but the crosshair was off → spatial advice, no timing claim
    const unproven = present(shot({ aim: [-1.6, 0], bullet: [-1.9, 0], spreadDeg: 1.8, adsElapsedMs: 25 })).copy!;
    expect(unproven.value).not.toContain("ADS");
    expect(unproven.direction).toBe("RIGHT");
  });

  test("mixed: says where the CROSSHAIR was, and that spread also moved it", () => {
    const { copy } = present(shot({ aim: [-1.2, 0], bullet: [-3, 1], spreadDeg: 5.5, ads: false }));
    expect(copy!.direction).toBe("RIGHT");
    expect(copy!.description).toEqual(["Aim was left of the head.", "Spread also moved the shot."]);
  });

  test("9. cover: short coherent line, no misleading sketch", () => {
    const { copy, sketch } = present(shot({ aim: [0.1, 0], result: { targetId: null, headshot: false, blocked: true, distance: 8 } }));
    expect(copy!.value).toBe("COVER");
    expect(copy!.description).toEqual(["Your line was on the head.", "Cover blocked the shot."]);
    expect(sketch.sketch).toBeNull();
  });

  test("10. no valid target → no copy at all (nothing invented)", () => {
    expect(present(shot({ aim: [25, 0] })).copy).toBeNull();
    expect(present(shot({ aim: [-1, 0], targets: [head(0, 0, 0, { headVisible: false })] })).copy).toBeNull();
  });

  test("11. CORRECTED: special plate, no stale error sketch, sound kept", () => {
    const echo = new ShotEcho(CFG);
    present(shot({ timeMs: 1000, aim: [-1.2, 0] }), echo);
    const { fb, copy, sketch } = present(shot({ timeMs: 1600, aim: [-0.1, 0], result: { targetId: 0, headshot: true, blocked: false, distance: 20 } }), echo);
    expect(fb.corrected).toBe(true);
    expect(fb.sound).toBe("corrected");
    expect(copy).toEqual({ header: "SHOT ECHO", glyph: "✓", value: "CORRECTED!", direction: "", description: ["Perfect adjustment."] });
    expect(sketch.sketch).toBeNull();
    // plain headshot: nothing new on the plate
    expect(present(shot({ result: { targetId: 0, headshot: true, blocked: false, distance: 20 } })).copy).toBeNull();
  });

  test("12. drawing and text share one plate and one 1.5s timeline", () => {
    const { fb, sketch } = present(shot({ aim: [-1.2, 0] }));
    const { slot } = applyEchoSlot(null, fb, sketch.sketch !== null, 1000, CFG);
    expect(slot!.sketch).toBe(true);
    const tl = echoTextTimeline(CFG);
    expect(tl).toEqual({ holdMs: 1250, fadeMs: 250, totalMs: 1500 });
    expect(echoSlotAt(slot, 1000 + tl.totalMs - 1, CFG)).not.toBeNull();
    expect(echoSlotAt(slot, 1000 + tl.totalMs, CFG)).toBeNull();
  });

  test("13. sketch, correction and description all describe the SAME shot", () => {
    for (const aim of [[-1.2, 0.4], [0.9, -1.1], [-0.3, 1.5], [1.4, 1.2]] as [number, number][]) {
      const { fb, copy, sketch } = present(shot({ aim }));
      const b = sketch.sketch!.bullet;
      const c = fb.analysis.correction!;
      // the X is on the opposite side of the fix on every used axis
      if (copy!.direction.includes("RIGHT")) expect(b.x).toBeLessThan(0);
      if (copy!.direction.includes("LEFT")) expect(b.x).toBeGreaterThan(0);
      if (copy!.direction.includes("UP")) expect(b.y).toBeLessThan(0);
      if (copy!.direction.includes("DOWN")) expect(b.y).toBeGreaterThan(0);
      // description is computed from the same bullet offset the sketch draws
      expect(copy!.description[0]).toBe(`Shot passed ${placePhrase(placeOf(sketch.offset!.x, sketch.offset!.y))}.`);
      // arrow in the sketch points the same way as the correction
      expect(Math.sign(sketch.sketch!.arrowTo!.x - sketch.sketch!.arrowFrom!.x)).toBe(Math.sign(c.h));
      expect(Math.sign(sketch.sketch!.arrowTo!.y - sketch.sketch!.arrowFrom!.y)).toBe(Math.sign(c.v));
    }
  });
});
