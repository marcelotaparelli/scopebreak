import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig } from "../src/config/movementConfig";
import { MovementController } from "../src/player/MovementController";

// Full-pipeline harness: mirrors GameLoop + Game.tick exactly — rAF frames
// at 60Hz, fixed 1/120 substeps sharing the frame timestamp, key events
// turned into { held keys, Shift keydown timestamp, queued Space edge } —
// and reads the REAL body velocity after moveAndCollide each substep.
const FLOOR = [box(0, -2, 0, 400, 2, 400)];
const RUN = movementConfig.runSpeed;

type Key = "W" | "Shift" | "Space";
interface KeyEvent { t: number; down?: Key; up?: Key }
interface Sample { t: number; speed: number; grounded: boolean; sliding: boolean; startedSlide: boolean; slideJumped: boolean; flowLanded: boolean }

function simulate(events: KeyEvent[], endMs: number): Sample[] {
  const m = new MovementController();
  m.reset(0, 0.001, 150);
  const keys = new Set<Key>();
  let shiftAt = -10_000;
  let jumpQueued = false;
  let ei = 0;
  let acc = 0;
  let last = 0;
  const step = 1 / 120;
  const out: Sample[] = [];
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (let f = 0; (f * 1000) / 60 <= endMs; f++) {
    const now = (f * 1000) / 60;
    while (ei < sorted.length && sorted[ei]!.t <= now) {
      const e = sorted[ei++]!;
      if (e.down) {
        keys.add(e.down);
        if (e.down === "Space") jumpQueued = true;
        if (e.down === "Shift") shiftAt = e.t;
      }
      if (e.up) keys.delete(e.up);
    }
    acc += (now - last) / 1000;
    last = now;
    while (acc >= step - 1e-9) {
      const jumpPressed = jumpQueued;
      jumpQueued = false;
      m.update(step, now, {
        forward: keys.has("W") ? 1 : 0, strafe: 0, jumpPressed,
        slideHeld: keys.has("Shift"), shiftPressedAtMs: shiftAt,
      }, 0, FLOOR, 1);
      acc -= step;
      out.push({
        t: now, speed: m.horizontalSpeed(), grounded: m.body.grounded, sliding: m.sliding,
        startedSlide: m.events.justStartedSlide, slideJumped: m.events.justSlideJumped, flowLanded: m.events.justFlowLanded,
      });
    }
  }
  return out;
}

const at = (s: Sample[], t: number): Sample => { const f = s.filter((x) => x.t <= t); return f[f.length - 1]!; };
const first = (s: Sample[], pred: (x: Sample, i: number) => boolean): number => s.findIndex(pred);

/** Speed right before and right after each touchdown. */
function landings(s: Sample[]): { before: number; after: number }[] {
  const r: { before: number; after: number }[] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i]!.grounded && !s[i - 1]!.grounded) r.push({ before: s[i - 1]!.speed, after: s[i]!.speed });
  }
  return r;
}

describe("real pipeline — slide entry", () => {
  test("1. RUN → SHIFT: body speed > runSpeed at the end of the Shift tick", () => {
    const s = simulate([{ t: 0, down: "W" }, { t: 1000, down: "Shift" }], 1200);
    expect(at(s, 990).speed).toBeCloseTo(RUN, 2);
    const i = first(s, (x) => x.startedSlide);
    expect(s[i]!.t).toBe(1000);
    expect(s[i]!.speed).toBeGreaterThan(RUN * 1.3);
    // next tick still boosted (nothing drags it back to runSpeed)
    expect(s[i + 1]!.speed).toBeGreaterThan(RUN * 1.3);
  });

  test("2. RUN → SHIFT → 100ms: still clearly above run speed", () => {
    const s = simulate([{ t: 0, down: "W" }, { t: 1000, down: "Shift" }], 1200);
    expect(at(s, 1100).sliding).toBe(true);
    expect(at(s, 1100).speed).toBeGreaterThan(RUN + 2.5);
  });
});

describe("real pipeline — slide-jump and landing", () => {
  const slideJump: KeyEvent[] = [
    { t: 0, down: "W" }, { t: 1000, down: "Shift" }, { t: 1300, down: "Space" }, { t: 1320, up: "Space" },
  ];

  test("3. SLIDE → JUMP: takeoff keeps slide momentum; W mid-air adds nothing", () => {
    const s = simulate(slideJump, 2000);
    const j = first(s, (x) => x.slideJumped);
    const slideSpeed = s[j - 1]!.speed;
    expect(s[j]!.speed).toBeGreaterThan(slideSpeed * 0.95);
    expect(s[j]!.speed).toBeGreaterThan(RUN + 1);
    // whole airtime with W held: speed never grows (old bug: 9.9 → 18)
    for (let i = j; i < s.length && !s[i]!.grounded; i++) {
      expect(s[i]!.speed).toBeLessThanOrEqual(s[j]!.speed + 1e-6);
    }
  });

  test("4. AIR → LAND: touchdown never increases speed (plain jump too)", () => {
    for (const ev of [slideJump, [{ t: 0, down: "W" as Key }, { t: 1000, down: "Space" as Key }, { t: 1020, up: "Space" as Key }]]) {
      const s = simulate(ev, 2600);
      const l = landings(s);
      expect(l.length).toBe(1);
      expect(l[0]!.after).toBeLessThanOrEqual(l[0]!.before + 1e-6);
      // and the ground afterwards only decays toward run speed
      expect(at(s, 2600).speed).toBeLessThanOrEqual(l[0]!.after + 1e-6);
      expect(at(s, 2600).speed).toBeGreaterThanOrEqual(RUN - 1e-6);
    }
  });

  test("5. Shift HELD through slide-jump landing: no re-entry, no reboost", () => {
    const s = simulate(slideJump, 2600); // Shift never released
    const j = first(s, (x) => x.slideJumped);
    const land = first(s, (x, i) => i > j && x.grounded);
    const before = s[land - 1]!.speed;
    for (let i = land; i < s.length; i++) {
      expect(s[i]!.startedSlide).toBe(false);
      expect(s[i]!.speed).toBeLessThanOrEqual(before + 1e-6);
    }
  });

  test("6. fresh Shift just before landing: flow slide preserves, never multiplies", () => {
    const s = simulate([...slideJump, { t: 1400, up: "Shift" }, { t: 1700, down: "Shift" }], 2200);
    const i = first(s, (x) => x.flowLanded);
    expect(i).toBeGreaterThan(0);
    expect(s[i]!.sliding).toBe(true);
    expect(s[i]!.speed).toBeLessThanOrEqual(s[i - 1]!.speed);
    expect(s[i]!.speed).toBeGreaterThan(s[i - 1]!.speed * 0.9);
  });

  test("6b. fresh Shift just AFTER landing is a late flow entry, not a boost", () => {
    const s = simulate([...slideJump, { t: 1400, up: "Shift" }, { t: 1870, down: "Shift" }], 2200);
    const l = first(s, (x, i) => i > 0 && x.grounded && !s[i - 1]!.grounded);
    const i = first(s, (x) => x.startedSlide && x.t >= 1870);
    expect(i).toBeGreaterThan(l);
    expect(s[i]!.speed).toBeLessThanOrEqual(s[l - 1]!.speed);
  });

  test("6c. early mid-air Shift (outside window) held into landing: no ground boost", () => {
    const s = simulate([...slideJump, { t: 1400, up: "Shift" }, { t: 1450, down: "Shift" }], 2400);
    const l = first(s, (x, i) => i > 0 && x.grounded && !s[i - 1]!.grounded);
    for (let i = l; i < s.length; i++) expect(s[i]!.startedSlide).toBe(false);
  });

  test("7. repeated slide→jump→land chain stays bounded", () => {
    const ev: KeyEvent[] = [{ t: 0, down: "W" }];
    for (let c = 0; c < 6; c++) {
      const t0 = 1000 + c * 1100;
      ev.push({ t: t0, down: "Shift" }, { t: t0 + 250, down: "Space" }, { t: t0 + 270, up: "Space" }, { t: t0 + 400, up: "Shift" });
    }
    const s = simulate(ev, 1000 + 6 * 1100);
    const peak = Math.max(...s.map((x) => x.speed));
    // one entry boost per press, preserved above the floor → never compounds
    expect(peak).toBeLessThan(movementConfig.minimumSlideBoostSpeed * movementConfig.slideBoost);
    for (const l of landings(s)) expect(l.after).toBeLessThanOrEqual(l.before + 1e-6);
  });

  test("Shift HELD on the ground: exactly one boosted entry per press", () => {
    const s = simulate([{ t: 0, down: "W" }, { t: 1000, down: "Shift" }], 8000);
    expect(s.filter((x) => x.startedSlide).length).toBe(1);
  });

  test("Shift TAP: speed bleeds back to run speed instead of ratcheting", () => {
    const s = simulate([{ t: 0, down: "W" }, { t: 1000, down: "Shift" }, { t: 1080, up: "Shift" }], 3500);
    expect(at(s, 1090).speed).toBeGreaterThan(RUN + 1);
    expect(at(s, 3500).speed).toBeLessThan(RUN + 0.05);
  });
});
