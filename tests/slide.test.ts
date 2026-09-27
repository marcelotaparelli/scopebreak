import { describe, expect, test } from "bun:test";
import { box, type AABB } from "../src/world/physics";
import { movementConfig } from "../src/config/movementConfig";
import { MovementController } from "../src/player/MovementController";
import { slideBoostSpeed, slideJumpTakeoff } from "../src/player/movementRules";

const FLOOR: AABB[] = [box(0, -2, 0, 130, 2, 130)];
const DT = 1 / 60;

function runner(speedX = 9, z = 42): MovementController {
  const m = new MovementController();
  m.reset(0, 0.001, z); // feet on the floor: grounded after first integrate
  m.body.vx = speedX;
  m.body.vz = 0;
  return m;
}

function slideInput(over: Partial<Record<string, number | boolean>> = {}): {
  forward: number; strafe: number; jumpPressed: boolean; slideHeld: boolean; shiftPressedAtMs: number;
} {
  return {
    forward: 1, strafe: 0, jumpPressed: false, slideHeld: true, shiftPressedAtMs: 1000, ...over,
  };
}

describe("slide boost", () => {
  test("valid slide entry increases speed (Shift = faster)", () => {
    const m = runner(9);
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    expect(m.sliding).toBe(true);
    // 9 * 1.32 = 11.88 minus one frame of gentle friction
    expect(m.horizontalSpeed()).toBeGreaterThan(11.4);
  });

  test("boost floor guarantees perceptible gain from low speed", () => {
    expect(slideBoostSpeed(9, 1.32, 11.0)).toBeCloseTo(11.88, 2);
    expect(slideBoostSpeed(3.5, 1.32, 11.0)).toBe(11.0);
  });

  test("boost applies once per entry, then decays gradually", () => {
    const m = runner(9);
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    const entry = m.horizontalSpeed();
    m.update(DT, 2016, slideInput(), 0, FLOOR, 1);
    const second = m.horizontalSpeed();
    expect(second).toBeLessThan(entry); // decaying, never re-boosted
    expect(second).toBeGreaterThan(entry - 0.5); // gradual, not a cliff
    // after 0.5s still fast (travels significant distance)
    for (let i = 0; i < 28; i++) m.update(DT, 2032 + i * 16, slideInput(), 0, FLOOR, 1);
    expect(m.horizontalSpeed()).toBeGreaterThan(7);
  });

  test("standstill Shift does nothing (no crouch)", () => {
    const m = runner(0);
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    expect(m.sliding).toBe(false);
  });
});

describe("slide-jump momentum", () => {
  test("preserves ~all horizontal speed with LOW vertical", () => {
    const m = runner(9);
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    const slideSpeed = m.horizontalSpeed();
    m.update(DT, 2016, slideInput({ jumpPressed: true }), 0, FLOOR, 1);
    expect(m.events.justSlideJumped).toBe(true);
    expect(m.body.grounded).toBe(false);
    // 0.98 retention of slide speed
    expect(m.horizontalSpeed()).toBeCloseTo(slideSpeed * 0.98, 0);
    // own low vertical — clearly below a normal jump
    // (same-frame gravity already applied: 6.2 - 23/60)
    expect(m.body.vy).toBeCloseTo(movementConfig.slideJumpVerticalForce - (23 * DT), 5);
    expect(movementConfig.slideJumpVerticalForce).toBeLessThan(movementConfig.jumpForce);
  });

  test("pure takeoff math", () => {
    const t = slideJumpTakeoff(12, 0.98, 6.2);
    expect(t.horizontal).toBeCloseTo(11.76, 5);
    expect(t.vertical).toBe(6.2);
  });
});

describe("air momentum preservation", () => {
  test("airborne does not clamp tech speed back to runSpeed", () => {
    const m = runner(0);
    m.reset(0, 5, 42);
    m.body.grounded = false;
    m.body.vx = 14;
    m.body.vy = 0;
    for (let i = 0; i < 30; i++) {
      m.update(DT, 3000 + i * 16, { forward: 0, strafe: 0, jumpPressed: false, slideHeld: false, shiftPressedAtMs: -10_000 }, 0, FLOOR, 1);
    }
    // still way above runSpeed 9 — gravity only touches vy
    expect(m.horizontalSpeed()).toBeGreaterThan(13);
  });
});

describe("stance height", () => {
  test("player returns to standing height after valid slide", () => {
    const m = runner(9);
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    expect(m.sliding).toBe(true);
    expect(m.body.height).toBe(movementConfig.slideHeight);
    m.update(DT, 2016, slideInput({ slideHeld: false }), 0, FLOOR, 1);
    expect(m.sliding).toBe(false);
    expect(m.body.height).toBe(movementConfig.standingHeight);
  });

  test("no headroom → stays low instead of clipping geometry", () => {
    // low bar at y 1.3..2.0 above the player: slide fits (1.15), stand (1.7) does not
    const lowBar: AABB[] = [...FLOOR, box(0, 1.3, 30, 2, 0.7, 2)];
    const m = runner(9, 30);
    m.update(DT, 2000, slideInput(), 0, lowBar, 1);
    expect(m.sliding).toBe(true);
    m.update(DT, 2016, slideInput({ slideHeld: false }), 0, lowBar, 1);
    expect(m.sliding).toBe(true); // blocked — remains low
    expect(m.body.height).toBe(movementConfig.slideHeight);
  });
});

describe("directional slide", () => {
  test("boost follows real momentum, not camera facing", () => {
    const m = runner(0);
    m.body.vx = 9; // moving +x while facing -z (yaw 0)
    m.body.vz = 0;
    m.update(DT, 2000, slideInput(), 0, FLOOR, 1);
    expect(m.sliding).toBe(true);
    expect(m.body.vx).toBeGreaterThan(8);
    expect(Math.abs(m.body.vz)).toBeLessThan(0.5);
  });
});
