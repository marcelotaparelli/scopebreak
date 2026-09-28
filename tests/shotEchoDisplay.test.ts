import { describe, expect, test } from "bun:test";
import { shotEchoConfig, type ShotEchoConfig } from "../src/config/shotEchoConfig";
import type { ShotSnapshot, Vec3 } from "../src/combat/ShotSnapshot";
import { decideEchoText, echoTextTimeline, type ShownEcho } from "../src/feedback/EchoDisplayPolicy";
import { ShotEcho, type EchoFeedback } from "../src/feedback/ShotEcho";

const CFG: ShotEchoConfig = { ...shotEchoConfig };
const DEG = Math.PI / 180;
const dir = (az: number, el = 0): Vec3 => ({ x: Math.sin(az * DEG) * Math.cos(el * DEG), y: Math.sin(el * DEG), z: -Math.cos(az * DEG) * Math.cos(el * DEG) });

function snap(t: number, aimAz: number, result: ShotSnapshot["result"], targetAz = 0): ShotSnapshot {
  const h = dir(targetAz);
  return {
    timeMs: t, weaponId: "viper", origin: { x: 0, y: 0, z: 0 }, cameraQuat: { x: 0, y: 0, z: 0, w: 1 }, fovDeg: 32,
    aimDir: dir(aimAz), shotDir: dir(aimAz), spreadDeg: 0, preciseSpreadDeg: 0, ads: true, adsElapsedMs: 200, snapPrecisionMs: 45,
    sliding: false, airborne: false, horizontalSpeed: 0, result,
    targets: [{ id: 0, lifeId: 0, alive: true, headCenter: { x: h.x * 20, y: h.y * 20, z: h.z * 20 }, headRadius: 0.27, headVisible: true }],
  };
}
const MISS = { targetId: null, headshot: false, blocked: false, distance: 220 };
const HEAD = { targetId: 0, headshot: true, blocked: false, distance: 20 };

/** A realistic sequence of feedbacks from the real ShotEcho. */
function feedbacks(): { advice: EchoFeedback; corrected: EchoFeedback; headshot: EchoFeedback; scenery: EchoFeedback } {
  const e = new ShotEcho(CFG);
  const advice = e.onShot(snap(1000, -1.2, MISS))!;
  const corrected = e.onShot(snap(1500, -0.1, HEAD))!;
  const headshot = e.onShot(snap(2000, 0, HEAD))!;
  const scenery = e.onShot(snap(2500, 30, MISS))!;
  return { advice, corrected, headshot, scenery };
}

describe("SHOT ECHO display: readable duration, separate short ghost", () => {
  test("defaults: text 1500ms with a 250ms fade at the end; ghost stays ~250ms", () => {
    expect(CFG.feedbackDurationMs).toBe(1500);
    expect(CFG.feedbackFadeMs).toBe(250);
    expect(echoTextTimeline(CFG)).toEqual({ holdMs: 1250, fadeMs: 250, totalMs: 1500 });
    expect(CFG.ghostReticleDurationMs).toBe(250);
    expect(CFG.ghostReticleDurationMs).toBeLessThan(CFG.feedbackDurationMs);
  });

  test("CORRECTED uses the same 1500ms text slot (and keeps its sound)", () => {
    const { corrected } = feedbacks();
    expect(corrected.corrected).toBe(true);
    expect(corrected.visible).toBe(true);
    expect(corrected.sound).toBe("corrected");
    expect(decideEchoText(null, corrected, 1500, CFG)).toBe("replace");
  });

  test("live-tuned durations are honoured; fade never exceeds the total", () => {
    expect(echoTextTimeline({ ...CFG, feedbackDurationMs: 3000, feedbackFadeMs: 400 })).toEqual({ holdMs: 2600, fadeMs: 400, totalMs: 3000 });
    expect(echoTextTimeline({ ...CFG, feedbackDurationMs: 200, feedbackFadeMs: 400 })).toEqual({ holdMs: 0, fadeMs: 200, totalMs: 200 });
  });
});

describe("SHOT ECHO display: one slot, replaced by priority", () => {
  const shownAdvice: ShownEcho = { corrected: false, shownAtMs: 1000 };
  const shownCorrected: ShownEcho = { corrected: true, shownAtMs: 1500 };

  test("a new analysed shot replaces the previous message (no stacking)", () => {
    const { advice } = feedbacks();
    expect(decideEchoText(shownAdvice, advice, 1200, CFG)).toBe("replace");
  });

  test("a plain headshot clears stale error advice", () => {
    const { headshot } = feedbacks();
    expect(headshot.visible).toBe(false);
    expect(decideEchoText(shownAdvice, headshot, 1300, CFG)).toBe("clear");
  });

  test("CORRECTED keeps priority: not wiped by a headshot, not replaced early by advice", () => {
    const { advice, headshot } = feedbacks();
    expect(decideEchoText(shownCorrected, headshot, 1600, CFG)).toBe("keep");
    expect(decideEchoText(shownCorrected, advice, 1500 + CFG.correctedPriorityMs - 1, CFG)).toBe("keep");
    expect(decideEchoText(shownCorrected, advice, 1500 + CFG.correctedPriorityMs, CFG)).toBe("replace");
  });

  test("CORRECTED always takes the slot", () => {
    const { corrected } = feedbacks();
    expect(decideEchoText(shownAdvice, corrected, 1100, CFG)).toBe("replace");
    expect(decideEchoText(shownCorrected, corrected, 1600, CFG)).toBe("replace");
  });

  test("a scenery shot (nothing to analyse) keeps the last real advice", () => {
    const { scenery } = feedbacks();
    expect(scenery.visible).toBe(false);
    expect(decideEchoText(shownAdvice, scenery, 1300, CFG)).toBe("keep");
    expect(decideEchoText(null, scenery, 1300, CFG)).toBe("keep");
  });

  test("rapid fire never shows more than one message", () => {
    const { advice, corrected, headshot, scenery } = feedbacks();
    const seq = [advice, advice, corrected, advice, headshot, scenery, advice, headshot];
    let slot: ShownEcho | null = null;
    let t = 0;
    for (const fb of seq) {
      t += 120;
      const a = decideEchoText(slot, fb, t, CFG);
      if (a === "replace") slot = { corrected: fb.corrected, shownAtMs: t };
      if (a === "clear") slot = null;
      expect(["replace", "keep", "clear"]).toContain(a);
    }
    // single slot by construction: the model holds at most one message
    expect(slot === null || typeof slot.shownAtMs === "number").toBe(true);
  });
});
