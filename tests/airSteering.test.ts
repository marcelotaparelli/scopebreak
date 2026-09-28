import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig as C } from "../src/config/movementConfig";
import { weaponConfigs } from "../src/config/weaponConfigs";
import { MovementController } from "../src/player/MovementController";

// GameLoop-faithful: 60Hz frames × 2 substeps of 1/120 sharing the frame time.
// W → Shift@1000 → Space@1100 (slide-jump). `t0` ms after takeoff the air
// input starts: camera turns toward `camDeg` at `camRate` °/s (+ = right)
// while `fw`/`strafe` are held. Stops at touchdown unless `flow`.
const FLOOR = [box(0, -2, 0, 2000, 2, 2000)];
const DEG = Math.PI / 180;
const heading = (m: MovementController): number => Math.atan2(m.body.vx, -m.body.vz) / DEG;

interface Sample { ts: number; heading: number; speed: number; grounded: boolean }
interface Run { tr: Sample[]; takeoff: { heading: number; speed: number }; preLand: Sample; postLand: Sample; flowLanded: boolean }

function airRun(o: { camDeg: number; camRate?: number; fw: number; strafe: number; t0?: number; adsSlow?: number; flow?: boolean }): Run {
  const { camDeg, camRate = 900, fw, strafe, t0 = 0, adsSlow = 1, flow = false } = o;
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let yaw = 0, cam = 0, take = -1, shiftAt = -1e4, shift = false, pressed = false;
  let takeoff = { heading: 0, speed: 0 };
  const tr: Sample[] = [];
  for (let fr = 0; fr < 60 * 4; fr++) {
    const now = (fr * 1000) / 60;
    if (fr === 60) { shift = true; shiftAt = now; }
    const airIn = take >= 0 && now - take >= t0 && !m.body.grounded;
    if (airIn && Math.abs(cam) < Math.abs(camDeg)) {
      const d = Math.sign(camDeg) * Math.min(Math.abs(camDeg) - Math.abs(cam), camRate / 60);
      cam += d;
      yaw -= d * DEG;
    }
    const b = m.body;
    if (flow && take >= 0 && !b.grounded && !pressed && b.vy < 0 && (b.vy + Math.sqrt(b.vy * b.vy + 2 * C.gravity * C.fallGravityMultiplier * b.y)) / (C.gravity * C.fallGravityMultiplier) <= 0.12) {
      shift = true; shiftAt = now; pressed = true;
    }
    for (let k = 0; k < 2; k++) {
      const before: Sample = { ts: now - take - t0, heading: heading(m), speed: m.horizontalSpeed(), grounded: m.body.grounded };
      m.update(1 / 120, now, {
        forward: take >= 0 ? (airIn ? fw : 0) : 1, strafe: airIn ? strafe : 0,
        jumpPressed: k === 0 && fr === 66, slideHeld: shift, shiftPressedAtMs: shiftAt,
      }, yaw, FLOOR, adsSlow);
      if (m.events.justSlideJumped) { take = now; shift = false; takeoff = { heading: heading(m), speed: m.horizontalSpeed() }; }
      if (take >= 0) {
        const s: Sample = { ts: now - take - t0, heading: heading(m), speed: m.horizontalSpeed(), grounded: m.body.grounded };
        tr.push(s);
        if (m.body.grounded && now - take > 50) return { tr, takeoff, preLand: before, postLand: s, flowLanded: m.events.justFlowLanded };
      }
    }
  }
  throw new Error("never landed");
}
const timeTo = (r: Run, deg: number): number => r.tr.find((s) => s.ts >= 0 && Math.abs(s.heading) >= deg - 1e-6)!.ts;
const maxTickDeg = C.airTurnRateDeg / 120;

describe("air steering: camera is free, movement input + camera = fast trajectory control", () => {
  test("1. airborne, NO WASD: camera rotation alone never changes the trajectory", () => {
    const r = airRun({ camDeg: 90, fw: 0, strafe: 0 });
    for (const s of r.tr) {
      expect(Math.abs(s.heading)).toBeLessThan(1e-9);
      expect(s.speed).toBeCloseTo(r.takeoff.speed, 9);
    }
  });

  test("2/3. airborne + W: camera turn steers, starting on the first tick", () => {
    const r = airRun({ camDeg: 90, fw: 1, strafe: 0 });
    // takeoff frame: no air input yet; the very next tick already turns
    const first = r.tr.find((s) => s.ts > 0)!;
    expect(r.tr.filter((s) => s.ts <= 0).every((s) => s.heading === 0)).toBe(true);
    expect(first.heading).toBeCloseTo(maxTickDeg, 9); // full rate right away
  });

  test("4/5/6. 30° fast, 60° quick, 90° reached well inside the slide-jump airtime", () => {
    const r = airRun({ camDeg: 90, fw: 1, strafe: 0 });
    expect(timeTo(r, 10)).toBeLessThanOrEqual(40);
    expect(timeTo(r, 30)).toBeLessThanOrEqual(80);
    expect(timeTo(r, 60)).toBeLessThanOrEqual(150);
    expect(timeTo(r, 90)).toBeLessThanOrEqual(220);
    expect(r.preLand.heading).toBeCloseTo(90, 6); // lands on the NEW line, not the old one
  });

  test("per-tick turn never exceeds the rate: no teleported vector", () => {
    const r = airRun({ camDeg: 45, camRate: 5400, fw: 0, strafe: 1 }); // wish snaps to 135° away
    for (let i = 1; i < r.tr.length; i++) {
      const d = ((r.tr[i]!.heading - r.tr[i - 1]!.heading + 540) % 360) - 180; // wrap ±180
      expect(Math.abs(d)).toBeLessThanOrEqual(maxTickDeg + 1e-9);
    }
  });

  test("7/8. moderate and 90° turns keep the full magnitude; steering never adds speed", () => {
    for (const camDeg of [30, 45, 60, 90]) {
      const r = airRun({ camDeg, fw: 1, strafe: 0 });
      for (const s of r.tr) expect(s.speed).toBeLessThanOrEqual(r.takeoff.speed + 1e-9);
      expect(r.preLand.speed).toBeCloseTo(r.takeoff.speed, 9);
      expect(r.preLand.heading).toBeCloseTo(camDeg, 6);
    }
  });

  test("A/D + camera: even more aggressive, mirror-symmetric", () => {
    const right = airRun({ camDeg: 90, fw: 0, strafe: 1 });
    const left = airRun({ camDeg: -90, fw: 0, strafe: -1 });
    expect(right.preLand.heading).toBeGreaterThan(135);
    for (let i = 0; i < right.tr.length; i++) expect(left.tr[i]!.heading).toBeCloseTo(-right.tr[i]!.heading, 9);
  });

  test("9. a 180° reversal is never instant and costs speed", () => {
    const s = airRun({ camDeg: 0, fw: -1, strafe: 0 }); // S: pure opposition
    const quick = s.tr.find((x) => x.ts >= 100)!;
    expect(Math.abs(quick.heading)).toBeLessThan(1e-9); // still going forward after 100ms
    expect(quick.speed).toBeLessThan(s.takeoff.speed);
    expect(s.preLand.speed).toBeLessThan(s.takeoff.speed * 0.7);
    const cam = airRun({ camDeg: 180, camRate: 3600, fw: 1, strafe: 0 }); // flick behind + W
    expect(timeTo(cam, 179)).toBeGreaterThanOrEqual(180 / C.airTurnRateDeg * 1000 - 20);
    expect(cam.preLand.speed).toBeLessThan(cam.takeoff.speed);
  });

  test("10. Viper ADS does not change air steering at all", () => {
    const plain = airRun({ camDeg: 70, fw: 1, strafe: 0 });
    const ads = airRun({ camDeg: 70, fw: 1, strafe: 0, adsSlow: weaponConfigs.viper.moveSpeedMultiplier });
    expect(ads.tr.length).toBe(plain.tr.length);
    for (let i = 0; i < plain.tr.length; i++) {
      expect(ads.tr[i]!.heading).toBeCloseTo(plain.tr[i]!.heading, 9);
      expect(ads.tr[i]!.speed).toBeCloseTo(plain.tr[i]!.speed, 9);
    }
  });

  test("11. slide-jump baseline intact (~15 slide, 100% takeoff)", () => {
    const r = airRun({ camDeg: 0, fw: 0, strafe: 0 });
    expect(r.takeoff.speed).toBeGreaterThan(14.3);
    expect(Math.abs(r.takeoff.heading)).toBeLessThan(1e-9);
  });

  test("12/13. flow landing continues the NEW air direction and keeps the speed", () => {
    const r = airRun({ camDeg: 70, fw: 1, strafe: 0, flow: true });
    expect(r.flowLanded).toBe(true);
    expect(r.preLand.heading).toBeCloseTo(70, 6);
    expect(r.postLand.heading).toBeCloseTo(r.preLand.heading, 9);
    expect(r.postLand.speed).toBeCloseTo(r.preLand.speed, 9);
    expect(r.postLand.speed).toBeCloseTo(r.takeoff.speed, 9);
  });
});
