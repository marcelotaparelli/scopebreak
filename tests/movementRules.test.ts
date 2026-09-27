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
  test("cannot instantly reverse", () => {
    const r = airControlStep(10, 0, -1, 0, 32, 0.85, 16, 9, 1 / 60);
    expect(r.vx).toBeGreaterThan(9);
  });
  test("curves gradually and respects speed cap", () => {
    let { vx, vz } = { vx: 10, vz: 0 };
    let earlyVx = 0;
    let peak = 0;
    for (let i = 0; i < 60; i++) {
      const r = airControlStep(vx, vz, 0, 1, 32, 0.85, 16, 9, 1 / 60);
      vx = r.vx; vz = r.vz;
      if (i === 14) earlyVx = vx;
      peak = Math.max(peak, Math.hypot(vx, vz));
    }
    // after 0.25s the turn has barely started (no instant 180s)
    expect(earlyVx).toBeGreaterThan(8);
    // lateral curve builds up
    expect(vz).toBeGreaterThan(3);
    // speed never explodes past the cap
    expect(peak).toBeLessThanOrEqual(16.001);
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
