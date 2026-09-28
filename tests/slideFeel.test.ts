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
      const tLand = (b.vy + Math.sqrt(b.vy * b.vy + 2 * C.gravity * C.fallGravityMultiplier * b.y)) / (C.gravity * C.fallGravityMultiplier);
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

// ---------------- flow-landing friction grace ----------------
// GameLoop-faithful: 60Hz frames, 2 × 1/120 substeps sharing the frame
// timestamp. Reactive player: fresh Shift ~120ms before predicted touchdown
// (or held from the start when `holdShift`), Space `spaceMs` after touchdown.
interface FlowCycle { pre: number; post: number; flow: boolean; midGrace: number; takeoff: number }
function flowChain(cycles: number, spaceMs: number, holdShift = false): { cyc: FlowCycle[]; peak: number; normalEntry: number; landings: boolean[] } {
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let shiftAt = -1e4, shift = false, landAt = -1, pressed = false, jumpQ = false, wasG = true, started = false;
  let peak = 0, normalEntry = 0;
  let cur: FlowCycle | null = null;
  const cyc: FlowCycle[] = [];
  const landings: boolean[] = [];
  for (let fr = 0; fr < 60 * 200 && cyc.length < cycles; fr++) {
    const now = (fr * 1000) / 60;
    const b = m.body;
    if (!started && now >= 1000) { shift = true; shiftAt = now; started = true; landAt = now; }
    if (!holdShift && !b.grounded && !pressed && b.vy < 0 && (b.vy + Math.sqrt(b.vy * b.vy + 2 * C.gravity * C.fallGravityMultiplier * b.y)) / (C.gravity * C.fallGravityMultiplier) <= 0.12) {
      shift = true; shiftAt = now; pressed = true;
    }
    if (landAt >= 0 && now - landAt >= spaceMs - 1e-6) { jumpQ = true; landAt = -1; }
    for (let k = 0; k < 2; k++) {
      const jp = jumpQ;
      jumpQ = false;
      const before = m.horizontalSpeed();
      m.update(STEP, now, { forward: 1, strafe: 0, jumpPressed: jp, slideHeld: shift, shiftPressedAtMs: shiftAt }, 0, FLOOR, 1);
      const sp = m.horizontalSpeed();
      peak = Math.max(peak, sp);
      if (m.events.justStartedSlide && !m.events.justFlowLanded && cyc.length === 0 && !cur) normalEntry = sp;
      if (m.body.grounded && !wasG) {
        cur = { pre: before, post: sp, flow: m.events.justFlowLanded, midGrace: sp, takeoff: NaN };
        landings.push(m.events.justFlowLanded);
        if (holdShift && landings.length >= cycles) return { cyc, peak, normalEntry, landings };
        landAt = now;
      } else if (cur && m.sliding && now - landAt < 40) cur.midGrace = sp;
      if (m.events.justSlideJumped) {
        if (cur) { cur.takeoff = sp; cyc.push(cur); cur = null; }
        if (!holdShift) shift = false;
        pressed = false;
      }
      wasG = m.body.grounded;
    }
  }
  return { cyc, peak, normalEntry, landings };
}

describe("FLOW LANDING friction grace (perfect flow = keep speed)", () => {
  test("grace is configured and short", () => {
    expect(C.flowLandingFrictionGraceMs).toBeGreaterThanOrEqual(40);
    expect(C.flowLandingFrictionGraceMs).toBeLessThanOrEqual(60);
  });

  test("flow landing adds nothing; inside the grace speed is held at 100%", () => {
    const { cyc } = flowChain(5, 17);
    expect(cyc.length).toBe(5);
    for (const c of cyc) {
      expect(c.flow).toBe(true);
      expect(c.post).toBeLessThanOrEqual(c.pre + 1e-9);
      expect(c.post).toBeCloseTo(c.pre, 9);
      expect(c.midGrace).toBeCloseTo(c.pre, 9);
    }
  });

  test("Space inside the grace takes off with the exact pre-land horizontal speed", () => {
    for (const ms of [17, 33]) {
      const { cyc } = flowChain(5, ms);
      expect(cyc.length).toBe(5);
      for (const c of cyc) expect(c.takeoff).toBeCloseTo(c.pre, 9);
    }
  });

  test("Space after the grace pays normal slide friction", () => {
    const { cyc } = flowChain(5, 100);
    expect(cyc.length).toBe(5);
    for (const c of cyc) {
      expect(c.takeoff).toBeLessThan(c.pre * 0.99);
      // at most ~100ms of friction (the grace covered the start)
      expect(c.takeoff).toBeGreaterThan(c.pre * Math.exp(-C.slideFriction * 0.1) - 1e-6);
    }
  });

  test("a normal RUN → SHIFT slide gets no grace: friction from the next tick", () => {
    const m = new MovementController();
    m.reset(0, 0.001, 900);
    m.body.vx = RUN;
    const input = { forward: 1, strafe: 0, jumpPressed: false, slideHeld: true, shiftPressedAtMs: 1000 };
    m.update(STEP, 1000, input, 0, FLOOR, 1);
    expect(m.events.justStartedSlide).toBe(true);
    const entry = m.horizontalSpeed();
    m.update(STEP, 1000, input, 0, FLOOR, 1);
    expect(m.horizontalSpeed()).toBeLessThan(entry);
  });

  test("Shift HELD through touchdown: no flow re-trigger, so no grace either", () => {
    const { landings } = flowChain(1, 17, true);
    // held Shift never produces a flow landing
    expect(landings).toEqual([false]);
  });

  test("PERFECT × 20: speed stays constant", () => {
    const { cyc } = flowChain(20, 17);
    expect(cyc.length).toBe(20);
    const t = cyc.map((c) => c.takeoff);
    expect(Math.max(...t) - Math.min(...t)).toBeLessThan(0.01);
    expect(t[t.length - 1]!).toBeGreaterThan(13);
  });

  test("LATE Space × 20: speed decays gradually (mistake = lose speed)", () => {
    for (const ms of [100, 250]) {
      const t = flowChain(20, ms).cyc.map((c) => c.takeoff);
      expect(t.length).toBe(20);
      for (let i = 1; i < t.length; i++) expect(t[i]!).toBeLessThanOrEqual(t[i - 1]! + 1e-6);
      expect(t[t.length - 1]!).toBeLessThan(t[0]! - 1);
    }
  });

  test("no sequence ever exceeds the speed the last normal slide gave", () => {
    for (const ms of [17, 33, 100, 250]) {
      const r = flowChain(20, ms);
      expect(r.normalEntry).toBeGreaterThan(13);
      expect(r.peak).toBeLessThanOrEqual(r.normalEntry + 1e-9);
    }
  });
});
