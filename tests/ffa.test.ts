import { describe, expect, test } from "bun:test";
import { FFAMode } from "../src/modes/FFAMode";
import { botHitChance } from "../src/bots/SimpleBot";
import { adsSpreadDeg as realSpread } from "../src/player/movementRules";

function makeMatch(): FFAMode {
  const m = new FFAMode("YOU", ["Bot 1", "Bot 2"]);
  m.killLimit = 3;
  m.timeLimitSec = 60;
  m.start(0);
  return m;
}

describe("FFA scoring", () => {
  test("kill = score, deaths and headshots counted", () => {
    const m = makeMatch();
    m.registerShot(0);
    m.registerHit(0, 100, 1);
    m.registerKill({ killerIdx: 0, victimIdx: 1, headshot: true, skills: ["headshot"], weapon: "VIPER", nowMs: 200 });
    expect(m.scores[0]!.kills).toBe(1);
    expect(m.scores[1]!.deaths).toBe(1);
    expect(m.scores[0]!.headshots).toBe(1);
    expect(m.scores[0]!.skillScore).toBeGreaterThanOrEqual(1);
    expect(m.accuracy(0)).toBeCloseTo(1, 5);
  });

  test("skill events add flavor score", () => {
    const m = makeMatch();
    m.registerKill({ killerIdx: 0, victimIdx: 1, headshot: true, skills: ["headshot", "airShot"], weapon: "VIPER", nowMs: 100 });
    expect(m.scores[0]!.skillScore).toBe(100 + 25 + 1);
    expect(m.scores[0]!.bestSkill).toBe("airShot");
  });

  test("kill limit ends match with winner", () => {
    const m = makeMatch();
    expect(m.state).toBe("playing");
    for (let i = 0; i < 3; i++) {
      m.registerKill({ killerIdx: 0, victimIdx: 1, headshot: false, skills: [], weapon: "VIPER", nowMs: 100 * (i + 1) });
      m.consumeRespawn(1);
    }
    expect(m.state).toBe("ended");
    expect(m.winnerIndex).toBe(0);
    expect(m.placement()[0]).toBe(0);
  });

  test("time limit ends match, leader wins", () => {
    const m = makeMatch();
    m.registerKill({ killerIdx: 1, victimIdx: 0, headshot: false, skills: [], weapon: "VIPER", nowMs: 1000 });
    m.update(0, 61_000);
    expect(m.state).toBe("ended");
    expect(m.winnerIndex).toBe(1);
  });

  test("respawn state: dead until timer, then due", () => {
    const m = makeMatch();
    m.respawnMs = 1500;
    m.registerKill({ killerIdx: 1, victimIdx: 0, headshot: false, skills: [], weapon: "VIPER", nowMs: 5000 });
    expect(m.isAlive(0, 5000)).toBe(false);
    expect(m.respawnDue(0, 6000)).toBe(false);
    expect(m.respawnDue(0, 6500)).toBe(true);
    m.consumeRespawn(0);
    expect(m.isAlive(0, 6500)).toBe(true);
  });

  test("K/D and engagement tracking", () => {
    const m = makeMatch();
    m.registerHit(0, 1000, 1);
    m.registerKill({ killerIdx: 0, victimIdx: 1, headshot: false, skills: [], weapon: "VIPER", nowMs: 2500 });
    expect(m.kd(0)).toBe(1);
    expect(m.avgEngagementSec()).toBeCloseTo(1.5, 5);
  });
});

describe("ADS snap spread curve", () => {
  const HIP = 5.5;
  const SNAP = 45;
  test("endpoints: hip at 0, zero at/after snap", () => {
    expect(realSpread({ adsElapsedMs: 0, snapMs: SNAP, hipSpreadDeg: HIP, preciseSpreadDeg: 0 })).toBeCloseTo(HIP, 5);
    expect(realSpread({ adsElapsedMs: SNAP, snapMs: SNAP, hipSpreadDeg: HIP, preciseSpreadDeg: 0 })).toBe(0);
    expect(realSpread({ adsElapsedMs: 999, snapMs: SNAP, hipSpreadDeg: HIP, preciseSpreadDeg: 0 })).toBe(0);
  });

  test("monotonically decreasing with fast early collapse", () => {
    let prev = Infinity;
    for (const t of [0, 10, 20, 30, 40, 45, 130]) {
      const v = realSpread({ adsElapsedMs: t, snapMs: SNAP, hipSpreadDeg: HIP, preciseSpreadDeg: 0 });
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
    // ~half snap time spread already collapsed hard (skill timing rewarded)
    const mid = realSpread({ adsElapsedMs: 22, snapMs: SNAP, hipSpreadDeg: HIP, preciseSpreadDeg: 0 });
    expect(mid).toBeLessThan(HIP * 0.35);
  });
});

describe("bot accuracy bounds", () => {
  test("limited, falls with distance and speed", () => {
    const close = botHitChance(10, 2, 1);
    const far = botHitChance(50, 2, 1);
    const fast = botHitChance(10, 15, 1);
    expect(close).toBeLessThanOrEqual(0.5);
    expect(far).toBeLessThan(close);
    expect(fast).toBeLessThan(close);
    expect(far).toBeGreaterThanOrEqual(0.04);
  });
});
