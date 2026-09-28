import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig as C } from "../src/config/movementConfig";
import { MovementController } from "../src/player/MovementController";

// Vertical signature: POP → UP → short apex → DROP → LAND. Real body,
// GameLoop-faithful (60Hz × 2 substeps). W held; Space at 1000ms (normal)
// or Shift 1000ms + Space 1100ms (slide-jump). No air input after takeoff.
const FLOOR = [box(0, -2, 0, 2000, 2, 2000)];
const STEP = 1 / 120;
// Old floaty baseline (g 23, no fall multiplier) for comparison.
const OLD = { normalAir: 0.70, slideAir: 0.86, hangMs: 100 };

interface Arc {
  takeoffTickVy: number; groundedAfterTakeoff: boolean; ys: number[]; vys: number[];
  tApex: number; tDown: number; airtime: number; height: number; vyLand: number;
  hangMs: number; dist: number; hBefore: number; hAir: number[]; landIn: number; landOut: number;
}

function arc(slide: boolean): Arc {
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let take = -1, tick = 0, x0 = 0, z0 = 0, hBefore = 0, takeoffTickVy = 0, groundedAfterTakeoff = true;
  const ys: number[] = [], vys: number[] = [], hAir: number[] = [];
  for (let fr = 0; fr < 60 * 4; fr++) {
    const now = (fr * 1000) / 60;
    for (let k = 0; k < 2; k++, tick++) {
      const space = k === 0 && fr === (slide ? 66 : 60);
      const bx = m.body.x, bz = m.body.z, hb = m.horizontalSpeed(), vyPrev = m.body.vy;
      m.update(STEP, now, {
        forward: take >= 0 ? 0 : 1, strafe: 0, jumpPressed: space,
        slideHeld: slide && fr >= 60 && take < 0, shiftPressedAtMs: slide && fr >= 60 ? 1000 : -1e4,
      }, 0, FLOOR, 1);
      if (space) {
        take = tick; x0 = bx; z0 = bz; hBefore = hb;
        takeoffTickVy = m.body.vy; groundedAfterTakeoff = m.body.grounded;
      }
      if (take < 0) continue;
      ys.push(m.body.y); vys.push(m.body.vy); hAir.push(m.horizontalSpeed());
      if (m.body.grounded && tick > take) {
        const apexI = ys.reduce((bi, y, i) => (y > ys[bi]! ? i : bi), 0);
        const air = (tick - take + 1) * STEP;
        return {
          takeoffTickVy, groundedAfterTakeoff, ys, vys,
          tApex: (apexI + 1) * STEP, tDown: air - (apexI + 1) * STEP, airtime: air, height: ys[apexI]!,
          vyLand: vyPrev, hangMs: (vys.filter((v) => Math.abs(v) < 1).length * 1000) / 120,
          dist: Math.hypot(m.body.x - x0, m.body.z - z0), hBefore, hAir: hAir.slice(0, -1),
          landIn: hAir[hAir.length - 2]!, landOut: m.horizontalSpeed(),
        };
      }
    }
  }
  throw new Error("never landed");
}

const normal = arc(false);
const slide = arc(true);

describe("vertical feel: snappy, predictable, no float", () => {
  test("1. Space applies vertical velocity on the same tick (normal + slide-jump)", () => {
    for (const [a, v] of [[normal, C.jumpForce], [slide, C.slideJumpVerticalForce]] as const) {
      expect(a.groundedAfterTakeoff).toBe(false);
      expect(a.takeoffTickVy).toBeCloseTo(v - C.gravity * STEP, 9); // impulse minus one tick of rising g
    }
  });

  test("2. ground snap never cancels the takeoff: body rises every early tick", () => {
    for (const a of [normal, slide]) {
      for (let i = 1; i < 10; i++) expect(a.ys[i]!).toBeGreaterThan(a.ys[i - 1]!);
    }
  });

  test("3/4. higher jumps keep a short airtime (fast arc, not the old float)", () => {
    expect(normal.airtime).toBeGreaterThan(0.5);
    expect(slide.airtime).toBeGreaterThan(0.64);
    expect(normal.airtime).toBeLessThan(0.6);
    expect(normal.airtime).toBeLessThan(OLD.normalAir - 0.1);
    expect(slide.airtime).toBeLessThan(0.72);
    expect(slide.airtime).toBeLessThan(OLD.slideAir - 0.1);
  });

  test("5/6/7. heights: normal ~1.85m (still < 2m ledges), slide-jump ~2.8m, slide clearly higher", () => {
    expect(normal.height).toBeGreaterThan(1.75);
    expect(normal.height).toBeLessThan(1.95); // 2m ledges stay slide-jump-only
    expect(slide.height).toBeGreaterThan(2.7);
    expect(slide.height).toBeLessThan(2.95); // 3m platform still needs the stairs
    expect(slide.height).toBeGreaterThan(normal.height * 1.4);
  });

  test("8. slide-jump still reaches much further", () => {
    expect(slide.dist).toBeGreaterThan(normal.dist * 1.6);
  });

  test("9. falling gravity is stronger than rising gravity (apex → DOWN)", () => {
    expect(C.fallGravityMultiplier).toBeGreaterThan(1);
    const rise = slide.vys[5]! - slide.vys[6]!;
    const i = slide.vys.findIndex((v) => v < -2);
    const fall = slide.vys[i]! - slide.vys[i + 1]!;
    expect(fall).toBeCloseTo(rise * C.fallGravityMultiplier, 9);
    // asymmetric arc: descent shorter than ascent
    expect(normal.tDown).toBeLessThan(normal.tApex);
    expect(slide.tDown).toBeLessThan(slide.tApex);
  });

  test("10. no apex hang: |vy| < 1 m/s lasts well under the old ~100ms", () => {
    for (const a of [normal, slide]) {
      expect(a.hangMs).toBeLessThan(75);
      expect(a.hangMs).toBeLessThan(OLD.hangMs * 0.75);
    }
  });

  test("11. horizontal momentum untouched by the vertical arc (slide-jump ~100%)", () => {
    for (const h of slide.hAir) expect(h).toBeCloseTo(slide.hAir[0]!, 9);
    expect(slide.hAir[0]!).toBeCloseTo(slide.hBefore, 9);
    expect(slide.hAir[0]!).toBeGreaterThan(14.3);
  });

  test("14. landing is firm and creates no speed", () => {
    for (const a of [normal, slide]) {
      expect(a.landOut).toBeLessThanOrEqual(a.landIn + 1e-9);
      expect(a.vyLand).toBeLessThan(-8); // real drop, not a drift
    }
  });

  test("10 (collisions). a low ceiling stops the rise cleanly: no tunneling, no stick, no speed", () => {
    // ceiling slab 2.5–3.0m right above a runner (head reaches it at y ≈ 0.8)
    const world = [...FLOOR, box(0, 2.5, 0, 200, 0.5, 2000)];
    for (const slideJump of [false, true]) {
      const m = new MovementController();
      m.reset(0, 0.001, 900);
      let maxTop = 0, jumped = false, t = 0, hitVy = NaN;
      for (let i = 0; i < 360; i++, t += 1000 / 120) {
        const space = t >= (slideJump ? 1100 : 1000) && !jumped && (!slideJump || m.sliding);
        if (space) jumped = true;
        const vyBefore = m.body.vy;
        m.update(STEP, t, { forward: 1, strafe: 0, jumpPressed: space, slideHeld: slideJump && t >= 1000 && !jumped, shiftPressedAtMs: slideJump && t >= 1000 ? 1000 : -1e4 }, 0, world, 1);
        maxTop = Math.max(maxTop, m.body.y + m.body.height);
        if (jumped && Number.isNaN(hitVy) && vyBefore > 0 && m.body.vy <= 0 && m.body.y < 1) hitVy = m.body.vy;
        if (jumped && m.body.grounded && i > 1) break;
      }
      expect(jumped).toBe(true);
      expect(maxTop).toBeLessThanOrEqual(2.5 + 1e-6); // never inside / through the slab
      expect(hitVy).toBeLessThanOrEqual(0); // bonked: rise cancelled, falls right away
      expect(m.body.grounded).toBe(true);
      expect(m.horizontalSpeed()).toBeLessThanOrEqual(slideJump ? 15.01 : 9.01);
    }
  });
});
