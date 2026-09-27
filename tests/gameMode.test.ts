import { describe, expect, test } from "bun:test";
import { TrainingMode } from "../src/modes/TrainingMode";

describe("GameMode scoring primitives", () => {
  test("training mode scores hits and skill events without touching combat", () => {
    const mode = new TrainingMode();
    mode.registerShot();
    mode.registerShot();
    mode.registerHit({ headshot: false, skills: ["slideShot"], distance: 12 });
    expect(mode.stats.shots).toBe(2);
    expect(mode.stats.hits).toBe(1);
    expect(mode.stats.skillScore).toBe(25);
    expect(mode.stats.headshots).toBe(0);
  });
  test("headshot combo accumulates", () => {
    const mode = new TrainingMode();
    mode.registerShot();
    mode.registerHit({ headshot: true, skills: ["headshot", "airShot", "longShot"], distance: 55 });
    expect(mode.stats.headshots).toBe(1);
    expect(mode.stats.skillScore).toBe(150);
    expect(mode.accuracy()).toBeCloseTo(1, 5);
  });
});
