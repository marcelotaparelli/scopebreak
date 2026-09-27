import { describe, expect, test } from "bun:test";
import { movementConfig } from "../src/config/movementConfig";
import { slideBoostSpeed } from "../src/player/movementRules";

const entry = (v: number): number =>
  slideBoostSpeed(v, movementConfig.slideBoostTargetSpeed, movementConfig.slideBoostStrength);
const TABLE = [8, 9, 10, 10.5, 10.9, 10.99, 11.0, 11.01, 11.5, 12, 13, 14, 15];

describe("slide entry curve: continuous diminishing returns", () => {
  test("table snapshot (input → entry)", () => {
    const rows = TABLE.map((v) => [v, +entry(v).toFixed(3)]);
    expect(rows).toEqual([
      [8, 11.6], [9, 11.85], [10, 12.1], [10.5, 12.225], [10.9, 12.325], [10.99, 12.348],
      [11, 12.35], [11.01, 12.353], [11.5, 12.475], [12, 12.6], [13, 13], [14, 14], [15, 15],
    ]);
  });

  test("no threshold: 10.99 vs 11.00 are practically equal (old rule: 15.39 vs 11.00)", () => {
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

  test("normal run speed gets a perceptible boost (Shift = FASTER)", () => {
    const run = entry(movementConfig.runSpeed);
    expect(run).toBeGreaterThan(11.5);
    expect(run).toBeLessThan(12.2);
  });

  test("high speed is never multiplied, only preserved", () => {
    for (const v of [13, 13.5, 14, 15, 18]) expect(entry(v)).toBe(v);
    // entry output is bounded by max(current, target): no pumping source
    for (let v = 0; v <= 25; v += 0.1) {
      expect(entry(v)).toBeLessThanOrEqual(Math.max(v, movementConfig.slideBoostTargetSpeed) + 1e-9);
    }
  });

  test("maxMovementSpeed stays a pure safety backstop, far above any legit entry", () => {
    expect(movementConfig.maxMovementSpeed).toBeGreaterThan(movementConfig.slideBoostTargetSpeed + 5);
  });
});
