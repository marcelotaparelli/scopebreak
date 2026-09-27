import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig as C } from "../src/config/movementConfig";
import { MovementController } from "../src/player/MovementController";

// Real-body traces at 1/120 (same step as GameLoop). A reactive "player"
// presses keys from the body's state, so timings follow the real arc.
const FLOOR = [box(0, -2, 0, 2000, 2, 2000)];
const STEP = 1 / 120;
const RUN = C.runSpeed;

interface Arc { takeoffH: number; takeoffV: number; preH: number; apex: number; airtime: number; dist: number; landIn: number; landOut: number }

function jumpArc(slide: boolean): Arc {
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let t = 0, shiftAt = -1e4, shift = false, preH = 0, took = -1;
  let x0 = 0, z0 = 0, apex = 0, takeoffH = 0, takeoffV = 0;
  for (let i = 0; i < 600; i++, t += 1000 / 120) {
    if (slide && t >= 1000 && !shift && took < 0) { shift = true; shiftAt = t; }
    const jump = took < 0 && t >= 1100;
    const before = m.horizontalSpeed();
    const bx = m.body.x, bz = m.body.z;
    m.update(STEP, t, { forward: 1, strafe: 0, jumpPressed: jump, slideHeld: shift, shiftPressedAtMs: shiftAt }, 0, FLOOR, 1);
    if (jump && !m.body.grounded) {
      took = i; preH = before; x0 = bx; z0 = bz;
      takeoffH = m.horizontalSpeed(); takeoffV = m.body.vy + C.gravity * STEP;
      shift = false;
    }
    if (took >= 0) {
      apex = Math.max(apex, m.body.y);
      if (m.body.grounded) {
        return { takeoffH, takeoffV, preH, apex, airtime: (i - took + 1) * STEP, dist: Math.hypot(m.body.x - x0, m.body.z - z0), landIn: before, landOut: m.horizontalSpeed() };
      }
    }
  }
  throw new Error("never landed");
}

/** Skilled surf: fresh Shift ~120ms before touchdown, Space `jumpDelayMs` into each slide. */
function surf(cycles: number, jumpDelayMs: number): { pre: number[]; post: number[]; flows: number; peak: number } {
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let t = 0, shiftAt = -1e4, shift = false, slideStart = -1, pressed = false, wasGrounded = true;
  let pre = 0, flows = 0, peak = 0, started = false;
  const preL: number[] = [], postL: number[] = [];
  for (let i = 0; i < 120 * 120 && preL.length < cycles; i++, t += 1000 / 120) {
    const b = m.body;
    if (!started && t >= 1000) { shift = true; shiftAt = t; started = true; }
    if (!b.grounded && !pressed && b.vy < 0) {
      const tLand = (b.vy + Math.sqrt(b.vy * b.vy + 2 * C.gravity * b.y)) / C.gravity;
      if (tLand <= 0.12) { shift = true; shiftAt = t; pressed = true; }
    }
    const jump = m.sliding && slideStart >= 0 && t - slideStart >= jumpDelayMs;
    const before = m.horizontalSpeed();
    m.update(STEP, t, { forward: 1, strafe: 0, jumpPressed: jump, slideHeld: shift, shiftPressedAtMs: shiftAt }, 0, FLOOR, 1);
    peak = Math.max(peak, m.horizontalSpeed());
    if (b.grounded && !wasGrounded) { pre = before; preL.push(pre); postL.push(m.horizontalSpeed()); if (m.events.justFlowLanded) flows++; }
    if (m.events.justStartedSlide) slideStart = t;
    if (m.events.justSlideJumped) { slideStart = -1; shift = false; pressed = false; }
    wasGrounded = b.grounded;
  }
  return { pre: preL, post: postL, flows, peak };
}

describe("SHIFT = SPEED", () => {
  function slideTrace(): number[] {
    const m = new MovementController();
    m.reset(0, 0.001, 900);
    const out: number[] = [];
    let t = 0;
    for (let i = 0; i < 240; i++, t += 1000 / 120) {
      const shift = t >= 1000;
      m.update(STEP, t, { forward: 1, strafe: 0, jumpPressed: false, slideHeld: shift, shiftPressedAtMs: shift ? 1000 : -1e4 }, 0, FLOOR, 1);
      out.push(m.horizontalSpeed());
    }
    return out;
  }
  const at = (s: number[], ms: number) => s[Math.round((ms * 120) / 1000)]!;

  test("run 9 → slide ≥ 13 on the Shift tick", () => {
    const s = slideTrace();
    expect(at(s, 990)).toBeCloseTo(RUN, 3);
    expect(at(s, 1000)).toBeGreaterThan(13.2);
  });

  test("burst is felt: +100ms still ~13, +300ms still clearly > 11", () => {
    const s = slideTrace();
    expect(at(s, 1100)).toBeGreaterThan(12.8);
    expect(at(s, 1300)).toBeGreaterThan(11.5);
    expect(at(s, 1300)).toBeGreaterThan(RUN + 2);
  });
});

describe("SHIFT + SPACE = SPEED + HEIGHT", () => {
  const normal = jumpArc(false);
  const sj = jumpArc(true);

  test("slide-jump keeps ~100% horizontal on the real body", () => {
    expect(sj.takeoffH).toBeGreaterThan(sj.preH * 0.995);
    expect(sj.takeoffH).toBeLessThanOrEqual(sj.preH + 1e-6);
    expect(sj.takeoffH).toBeGreaterThan(12.5);
  });

  test("vertical impulse, apex, airtime and reach all beat the normal jump", () => {
    expect(sj.takeoffV).toBeGreaterThan(normal.takeoffV);
    expect(sj.apex).toBeGreaterThan(normal.apex * 1.3);
    expect(sj.apex).toBeGreaterThan(2.0); // clears the 2m side platforms; normal jump can't
    expect(normal.apex).toBeLessThan(2.0);
    expect(sj.airtime).toBeGreaterThan(normal.airtime);
    expect(sj.dist).toBeGreaterThan(normal.dist * 1.5);
    // controlled: not a rocket
    expect(sj.apex).toBeLessThan(2.6);
  });

  test("landing never creates speed", () => {
    for (const a of [normal, sj]) expect(a.landOut).toBeLessThanOrEqual(a.landIn + 1e-6);
  });
});

describe("FLOW LANDING = KEEP THE FLOW", () => {
  test("a correct flow landing preserves (no boost, no landing tax)", () => {
    const r = surf(5, 16);
    expect(r.flows).toBe(5);
    for (let i = 0; i < r.pre.length; i++) {
      expect(r.post[i]!).toBeLessThanOrEqual(r.pre[i]! + 1e-6);
      expect(r.post[i]!).toBeGreaterThan(r.pre[i]! - 1e-6);
    }
  });

  test("20 skilled flow cycles stay fast (no slide toward 7.6)", () => {
    const r = surf(20, 16);
    expect(r.flows).toBe(20);
    // per-cycle loss is only ~2 ticks of slide friction
    for (let i = 1; i < r.pre.length; i++) expect(r.pre[i - 1]! - r.pre[i]!).toBeLessThan(0.1);
    expect(Math.min(...r.pre)).toBeGreaterThan(12);
    // bounded: flow never adds energy above what Shift gave
    expect(r.peak).toBeLessThanOrEqual(C.slideBoostTargetSpeed + 1e-6);
  });

  test("even a sloppy chain never degrades below run speed", () => {
    const r = surf(20, 250);
    expect(Math.min(...r.pre)).toBeGreaterThanOrEqual(RUN - 1e-6);
    expect(r.peak).toBeLessThanOrEqual(C.slideBoostTargetSpeed + 1e-6);
  });
});
