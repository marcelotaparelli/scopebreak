import { describe, expect, test } from "bun:test";
import {
  airControlStep,
  applyMomentumRetention,
  canFire,
  canStartSlide,
  canWallKick,
  computeDamage,
  detectSkillEvents,
  isFlowLanding,
  isPrecisionReady,
  slideJumpVelocity,
  slideSpeedAfter,
} from "../src/player/movementRules";

describe("slide eligibility", () => {
  test("requires grounded + speed + no cooldown", () => {
    expect(
      canStartSlide({ grounded: true, alreadySliding: false, horizontalSpeed: 8, minimumSlideSpeed: 3.5, cooldownRemainingMs: 0 }),
    ).toBe(true);
    expect(
      canStartSlide({ grounded: false, alreadySliding: false, horizontalSpeed: 12, minimumSlideSpeed: 3.5, cooldownRemainingMs: 0 }),
    ).toBe(false);
    expect(
      canStartSlide({ grounded: true, alreadySliding: false, horizontalSpeed: 2, minimumSlideSpeed: 3.5, cooldownRemainingMs: 0 }),
    ).toBe(false);
    expect(
      canStartSlide({ grounded: true, alreadySliding: true, horizontalSpeed: 9, minimumSlideSpeed: 3.5, cooldownRemainingMs: 0 }),
    ).toBe(false);
    expect(
      canStartSlide({ grounded: true, alreadySliding: false, horizontalSpeed: 9, minimumSlideSpeed: 3.5, cooldownRemainingMs: 100 }),
    ).toBe(false);
  });
});

describe("momentum preservation", () => {
  test("slide decay is gradual, not instant", () => {
    const after = slideSpeedAfter(10, 1.6, 0.5);
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(10);
  });
  test("retention keeps most momentum", () => {
    expect(applyMomentumRetention(10, 0.92)).toBeCloseTo(9.2, 5);
  });
  test("slide jump preserves + boosts horizontal", () => {
    const v = slideJumpVelocity(10, 1.07, 8.6);
    expect(v.horizontal).toBeCloseTo(10.7, 5);
    expect(v.vertical).toBe(8.6);
  });
});

describe("air control limits", () => {
  const DEG = Math.PI / 180;
  // turn 450°/s, opposite 150°, accel 27.2, air ceiling 16, run 9, dt 1/60
  const step = (vx: number, vz: number, wx: number, wz: number) =>
    airControlStep(vx, vz, wx, wz, 450 * DEG / 60, 150 * DEG, 27.2, 16, 9, 1 / 60);

  test("cannot instantly reverse: opposite wish brakes, never rotates", () => {
    const r = step(10, 0, -1, 0);
    expect(r.vz).toBe(0);
    expect(r.vx).toBeGreaterThan(9);
    expect(r.vx).toBeLessThan(10);
  });

  test("turns fast at the rate limit, magnitude kept, never overshoots", () => {
    let { vx, vz } = { vx: 10, vz: 0 };
    const r1 = step(vx, vz, 0, 1); // wish 90° away
    expect(Math.atan2(r1.vz, r1.vx) / DEG).toBeCloseTo(7.5, 9); // first tick: full rate
    expect(Math.hypot(r1.vx, r1.vz)).toBeCloseTo(10, 9);
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const r = step(vx, vz, 0, 1);
      vx = r.vx; vz = r.vz;
      peak = Math.max(peak, Math.hypot(vx, vz));
    }
    expect(vx).toBeCloseTo(0, 9); // aligned with wish after 90/450 s, no overshoot
    expect(vz).toBeCloseTo(10, 9);
    expect(peak).toBeLessThanOrEqual(10 + 1e-9); // steering alone never adds speed
  });

  test("input builds speed only up to run speed; excess above ceiling decays", () => {
    const r0 = step(0, 0, 1, 0);
    expect(r0.vx).toBeCloseTo(27.2 / 60, 9);
    const slow = step(5, 0, 1, 0);
    expect(slow.vx).toBeGreaterThan(5);
    expect(step(12, 0, 1, 0).vx).toBe(12); // W above run speed adds nothing
    expect(step(20, 0, 1, 0).vx).toBeLessThan(20);
  });
});

describe("flow landing window", () => {
  test("shift buffered before landing counts", () => {
    expect(isFlowLanding({ timeSinceShiftMs: 120, timeSinceLandMs: 5, windowMs: 200 })).toBe(true);
  });
  test("shift after landing counts", () => {
    expect(isFlowLanding({ timeSinceShiftMs: 5, timeSinceLandMs: 150, windowMs: 200 })).toBe(true);
  });
  test("outside window does not count", () => {
    expect(isFlowLanding({ timeSinceShiftMs: 500, timeSinceLandMs: 400, windowMs: 200 })).toBe(false);
  });
});

describe("wall kick once per airtime", () => {
  test("allowed once while airborne near wall", () => {
    expect(canWallKick({ airborne: true, wallAvailable: true, alreadyKickedThisAirtime: false })).toBe(true);
    expect(canWallKick({ airborne: true, wallAvailable: true, alreadyKickedThisAirtime: true })).toBe(false);
    expect(canWallKick({ airborne: false, wallAvailable: true, alreadyKickedThisAirtime: false })).toBe(false);
  });
});

describe("precision window + cooldown", () => {
  test("precision unlocks after window", () => {
    expect(isPrecisionReady(50, 100)).toBe(false);
    expect(isPrecisionReady(100, 100)).toBe(true);
  });
  test("cooldown gates fire", () => {
    expect(canFire(1000, 0, 1050)).toBe(false);
    expect(canFire(1100, 0, 1050)).toBe(true);
  });
});

describe("damage / headshot", () => {
  test("viper headshot kills 100hp, body does not", () => {
    expect(computeDamage({ headshot: true, bodyDamage: 80, headDamage: 150, targetHealth: 100 }).killed).toBe(true);
    const body = computeDamage({ headshot: false, bodyDamage: 80, headDamage: 150, targetHealth: 100 });
    expect(body.killed).toBe(false);
    expect(body.damage).toBe(80);
  });
  test("phantom needs two body shots", () => {
    const one = computeDamage({ headshot: false, bodyDamage: 34, headDamage: 70, targetHealth: 100 });
    expect(one.killed).toBe(false);
  });
});

describe("skill events", () => {
  test("detects headshot + air + long shot combo", () => {
    const ev = detectSkillEvents({
      headshot: true, sliding: false, airborne: true, wallKickRecent: false,
      distance: 55, longShotDistance: 40, killed: true,
    });
    expect(ev).toContain("headshot");
    expect(ev).toContain("airShot");
    expect(ev).toContain("longShot");
  });
  test("slide shot detected", () => {
    const ev = detectSkillEvents({
      headshot: false, sliding: true, airborne: false, wallKickRecent: false,
      distance: 10, longShotDistance: 40, killed: false,
    });
    expect(ev).toEqual(["slideShot"]);
  });
  test("wall kick shot detected", () => {
    const ev = detectSkillEvents({
      headshot: false, sliding: false, airborne: true, wallKickRecent: true,
      distance: 12, longShotDistance: 40, killed: false,
    });
    expect(ev).toContain("wallKickShot");
  });
});
