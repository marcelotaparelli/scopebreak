import { describe, expect, test } from "bun:test";
import { movementConfig } from "../src/config/movementConfig";
import { slideBoostSpeed } from "../src/player/movementRules";

const entry = (v: number): number =>
  slideBoostSpeed(v, movementConfig.slideBoostTargetSpeed, movementConfig.slideBoostStrength);
const TABLE = [8, 9, 10, 10.5, 10.9, 10.99, 11.0, 11.01, 11.5, 12, 13, 14, 15];

describe("slide entry curve: continuous diminishing returns", () => {
  test("table snapshot (input → entry)", () => {
    const expected = [14.75, 15, 15.25, 15.375, 15.475, 15.4975, 15.5, 15.5025, 15.625, 15.75, 16, 16.25, 16.5];
    TABLE.forEach((v, i) => expect(entry(v)).toBeCloseTo(expected[i]!, 6));
  });

  test("no threshold: 10.99 vs 11.00 are practically equal (threshold rule gave 15.39 vs 11.00)", () => {
    expect(Math.abs(entry(10.99) - entry(11.0))).toBeLessThan(0.01);
  });

  test("continuous + monotonic: a 0.01 input step never moves output by more than 0.01", () => {
    let prev = entry(0);
    for (let v = 0.01; v <= 25; v += 0.01) {
      const cur = entry(v);
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(cur - prev).toBeLessThanOrEqual(0.01 + 1e-9);
      prev = cur;
    }
  });

  test("never below current speed on a valid entry", () => {
    for (let v = movementConfig.minimumSlideSpeed; v <= 25; v += 0.05) expect(entry(v)).toBeGreaterThanOrEqual(v);
  });

  test("gain shrinks as speed grows (diminishing returns)", () => {
    const gains = TABLE.map((v) => entry(v) - v);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]! + 1e-9);
  });

  test("normal run speed gets a STRONG burst (Shift = GO)", () => {
    const run = entry(movementConfig.runSpeed);
    expect(run).toBeCloseTo(15, 1);
    expect(run - movementConfig.runSpeed).toBeGreaterThan(5.5);
  });

  test("high speed is never multiplied, only preserved", () => {
    for (const v of [17, 17.5, 18, 22]) expect(entry(v)).toBe(v);
    // near the target the gain is small (diminishing returns)
    expect(entry(16) - 16).toBeLessThan(1);
    expect(entry(13) - 13).toBeLessThan(entry(9) - 9);
    // entry output is bounded by max(current, target): no pumping source
    for (let v = 0; v <= 25; v += 0.1) {
      expect(entry(v)).toBeLessThanOrEqual(Math.max(v, movementConfig.slideBoostTargetSpeed) + 1e-9);
    }
  });

  test("maxMovementSpeed stays a pure safety backstop, above any legit entry and the air ceiling", () => {
    expect(movementConfig.maxMovementSpeed).toBeGreaterThan(Math.max(movementConfig.slideBoostTargetSpeed, movementConfig.maxAirSpeed) + 3);
  });
});
