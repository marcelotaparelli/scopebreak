import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig } from "../src/config/movementConfig";
import { weaponConfigs } from "../src/config/weaponConfigs";
import { MovementController } from "../src/player/MovementController";
import { WeaponController } from "../src/weapons/WeaponController";
import { decideLmbEdge, resolvePendingQuickshot } from "../src/player/movementRules";

// Same pipeline as slidePipeline.test.ts (60Hz frames, 1/120 substeps), plus
// RMB/LMB routed through the REAL WeaponController and the exact adsSlow
// expression Game.tick feeds into MovementController.
const FLOOR = [box(0, -2, 0, 400, 2, 400)];
const RUN = movementConfig.runSpeed;
const QUICKSHOT_BUFFER_MS = 90;

type Key = "W" | "Shift" | "Space" | "RMB" | "LMB";
interface KeyEvent { t: number; down?: Key; up?: Key }
interface Sample { t: number; speed: number; grounded: boolean; sliding: boolean; ads: boolean; shots: number }

function simulate(events: KeyEvent[], endMs: number, weaponId: "viper" | "titan" = "viper"): Sample[] {
  const m = new MovementController();
  m.reset(0, 0.001, 150);
  const w = new WeaponController();
  w.switchTo(weaponId, 0);
  const keys = new Set<Key>();
  let shiftAt = -10_000;
  let jumpQueued = false;
  let pendingLmb = -1;
  let shots = 0;
  let ei = 0;
  let acc = 0;
  let last = 0;
  const step = 1 / 120;
  const out: Sample[] = [];
  const sorted = [...events].sort((a, b) => a.t - b.t);
  for (let f = 0; (f * 1000) / 60 <= endMs; f++) {
    const now = (f * 1000) / 60;
    while (ei < sorted.length && sorted[ei]!.t <= now) {
      const e = sorted[ei++]!;
      if (e.down) {
        keys.add(e.down);
        if (e.down === "Space") jumpQueued = true;
        if (e.down === "Shift") shiftAt = e.t;
        if (e.down === "RMB") w.setAds(true, now);
        if (e.down === "LMB") {
          const d = decideLmbEdge({
            sinceAdsStartMs: now - w.lastAdsStartMs, adsElapsedMs: w.adsElapsedMs(now),
            quickShotBufferMs: QUICKSHOT_BUFFER_MS, snapPrecisionMs: w.config.snapPrecisionMs,
          });
          if (d === "buffer-quickshot") pendingLmb = now;
          else { w.consumeShot(now); shots++; }
        }
      }
      if (e.up) {
        keys.delete(e.up);
        if (e.up === "RMB") w.setAds(false, now);
      }
    }
    if (resolvePendingQuickshot({ pendingLmbMs: pendingLmb, adsStartMs: w.lastAdsStartMs, snapMs: w.config.snapPrecisionMs, nowMs: now }) === "fire") {
      w.consumeShot(now);
      shots++;
      pendingLmb = -1;
    }
    acc += (now - last) / 1000;
    last = now;
    while (acc >= step - 1e-9) {
      const jumpPressed = jumpQueued;
      jumpQueued = false;
      const adsSlow = w.adsActive ? w.config.moveSpeedMultiplier : 1; // == Game.tick
      m.update(step, now, {
        forward: keys.has("W") ? 1 : 0, strafe: 0, jumpPressed,
        slideHeld: keys.has("Shift"), shiftPressedAtMs: shiftAt,
      }, 0, FLOOR, adsSlow);
      acc -= step;
      out.push({ t: now, speed: m.horizontalSpeed(), grounded: m.body.grounded, sliding: m.sliding, ads: w.adsActive, shots });
    }
  }
  return out;
}

const at = (s: Sample[], t: number): Sample => { const f = s.filter((x) => x.t <= t); return f[f.length - 1]!; };

/** ADS must be movement-neutral: every sample identical to the no-ADS run. */
function expectSameMotion(withAds: Sample[], without: Sample[]): void {
  expect(withAds.length).toBe(without.length);
  for (let i = 0; i < without.length; i++) {
    expect(withAds[i]!.speed).toBeCloseTo(without[i]!.speed, 9);
    expect(withAds[i]!.grounded).toBe(without[i]!.grounded);
    expect(withAds[i]!.sliding).toBe(without[i]!.sliding);
  }
}

const slideJump: KeyEvent[] = [
  { t: 0, down: "W" }, { t: 1000, down: "Shift" }, { t: 1300, down: "Space" }, { t: 1320, up: "Space" },
];

describe("Viper ADS is movement-neutral", () => {
  test("1. RUN ≈ RUN + ADS (no ADS speed penalty)", () => {
    expect(weaponConfigs.viper.moveSpeedMultiplier).toBe(1);
    const run = simulate([{ t: 0, down: "W" }], 2000);
    const runAds = simulate([{ t: 0, down: "W" }, { t: 0, down: "RMB" }], 2000);
    expect(at(run, 2000).speed).toBeCloseTo(RUN, 3);
    expect(at(runAds, 2000).speed).toBeCloseTo(RUN, 3);
  });

  test("2. entering ADS never lowers current horizontal velocity (run, and with post-slide overspeed)", () => {
    const base: KeyEvent[] = [{ t: 0, down: "W" }, { t: 1000, down: "Shift" }, { t: 1150, up: "Shift" }];
    const plain = simulate(base, 2500);
    const ads = simulate([...base, { t: 800, down: "RMB" }, { t: 1300, up: "RMB" }, { t: 1400, down: "RMB" }], 2500);
    expect(at(ads, 1400).speed).toBeGreaterThan(RUN); // legit overspeed still present when ADS starts
    expectSameMotion(ads, plain);
  });

  test("3. ADS during slide keeps slide momentum", () => {
    const base: KeyEvent[] = [{ t: 0, down: "W" }, { t: 1000, down: "Shift" }];
    const plain = simulate(base, 1600);
    const ads = simulate([...base, { t: 1100, down: "RMB" }], 1600);
    expect(at(ads, 1100).sliding).toBe(true);
    expect(at(ads, 1100).speed).toBeGreaterThan(RUN + 2.5);
    expectSameMotion(ads, plain);
  });

  test("4. ADS while airborne keeps horizontal momentum (slide-jump, W held)", () => {
    const plain = simulate(slideJump, 2000);
    const ads = simulate([...slideJump, { t: 1400, down: "RMB" }], 2000);
    expect(at(ads, 1400).grounded).toBe(false);
    expect(at(ads, 1400).speed).toBeGreaterThan(RUN + 1);
    expectSameMotion(ads, plain);
  });

  test("5. Snap Precision quickscope (RMB → LMB inside the 45ms window) does not touch movement", () => {
    const quick: KeyEvent[] = [...slideJump, { t: 1400, down: "RMB" }, { t: 1416, down: "LMB" }, { t: 1430, up: "LMB" }, { t: 1600, up: "RMB" }];
    const plain = simulate(slideJump, 2000);
    const ads = simulate(quick, 2000);
    expect(at(ads, 1500).shots).toBe(1); // the buffered shot really fired at snap
    expectSameMotion(ads, plain);
  });

  test("full ADS held through the whole chain: identical motion", () => {
    const plain = simulate(slideJump, 3000);
    const ads = simulate([{ t: 0, down: "RMB" }, ...slideJump], 3000);
    expectSameMotion(ads, plain);
  });

  test("Titan keeps its own handling (not rebalanced here)", () => {
    const runAds = simulate([{ t: 0, down: "W" }, { t: 0, down: "RMB" }], 2000, "titan");
    expect(at(runAds, 2000).speed).toBeCloseTo(RUN * weaponConfigs.titan.moveSpeedMultiplier, 2);
  });
});

describe("long chain: no unbounded speed pumping", () => {
  // Cadence that reproduces the playtest 12.6 → 12.9 creep: ~330ms of RUN
  // between landing and the next Shift leaves residual overspeed (<11) that
  // the normal entry boost multiplies (×1.4). Growth is geometric and
  // converges; the entry boost is capped at minimumSlideBoostSpeed × slideBoost.
  test("6. slide → jump → land × 20 converges and stays bounded", () => {
    const ev: KeyEvent[] = [{ t: 0, down: "W" }];
    const cycles = 20;
    for (let c = 0; c < cycles; c++) {
      const t0 = 1000 + c * 1100;
      ev.push({ t: t0, down: "Shift" }, { t: t0 + 250, down: "Space" }, { t: t0 + 270, up: "Space" }, { t: t0 + 400, up: "Shift" });
    }
    const s = simulate(ev, 1000 + cycles * 1100);
    const lands: number[] = [];
    for (let i = 1; i < s.length; i++) if (s[i]!.grounded && !s[i - 1]!.grounded) lands.push(s[i]!.speed);
    expect(lands.length).toBe(cycles);
    const peak = Math.max(...s.map((x) => x.speed));
    expect(peak).toBeLessThan(movementConfig.minimumSlideBoostSpeed * movementConfig.slideBoost);
    // converging: cycle-to-cycle gain shrinks and is ~0 at the end
    const gains = lands.slice(1).map((v, i) => v - lands[i]!);
    for (let i = 1; i < gains.length; i++) expect(gains[i]!).toBeLessThanOrEqual(gains[i - 1]! + 1e-6);
    expect(Math.abs(gains[gains.length - 1]!)).toBeLessThan(0.005);
    expect(lands[lands.length - 1]! - lands[5]!).toBeLessThan(0.3);
  });
});
