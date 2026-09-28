import { describe, expect, test } from "bun:test";
import { box } from "../src/world/physics";
import { movementConfig as C } from "../src/config/movementConfig";
import { weaponConfigs } from "../src/config/weaponConfigs";
import { MovementController } from "../src/player/MovementController";
import { slideSteerStep } from "../src/player/movementRules";

const FLOOR = [box(0, -2, 0, 2000, 2, 2000)];
const STEP = 1 / 120;
const DEG = Math.PI / 180;
const heading = (m: MovementController): number => Math.atan2(m.body.vx, -m.body.vz) / DEG; // 0 = -z, +90 = right (+x)

interface Tick { t: number; heading: number; speed: number; sliding: boolean; grounded: boolean; slideJumped: boolean }

/**
 * W held, Shift at 1000ms. From 1050ms: strafe (+1 D / -1 A), forward, and a
 * mouse turn of `mouseDegS` (+ = right). Optional Space at `jumpAtMs`.
 */
function slide(opts: { strafe?: number; forward?: number; mouseDegS?: number; jumpAtMs?: number; untilMs?: number; adsSlow?: number } = {}): Tick[] {
  const { strafe = 0, forward = 1, mouseDegS = 0, jumpAtMs = -1, untilMs = 2000, adsSlow = 1 } = opts;
  const m = new MovementController();
  m.reset(0, 0.001, 900);
  let yaw = 0;
  const out: Tick[] = [];
  for (let i = 0; i * STEP * 1000 <= untilMs; i++) {
    const t = i * STEP * 1000;
    const act = t >= 1050;
    if (act) yaw -= mouseDegS * DEG * STEP; // turning right = yaw decreasing
    m.update(STEP, t, {
      forward: act ? forward : 1, strafe: act ? strafe : 0,
      jumpPressed: jumpAtMs > 0 && Math.abs(t - jumpAtMs) < STEP * 500,
      slideHeld: t >= 1000, shiftPressedAtMs: t >= 1000 ? 1000 : -1e4,
    }, yaw, FLOOR, adsSlow);
    out.push({ t, heading: heading(m), speed: m.horizontalSpeed(), sliding: m.sliding, grounded: m.body.grounded, slideJumped: m.events.justSlideJumped });
  }
  return out;
}
const at = (s: Tick[], t: number): Tick => s.filter((x) => x.t <= t + 1e-6).pop()!;
const maxStepDeg = C.slideTurnRateDeg * STEP;

describe("slideSteerStep (pure)", () => {
  test("rotates toward the wish by at most maxTurn, magnitude exact", () => {
    const r = slideSteerStep(0, -15, 1, 0, 10 * DEG, 150 * DEG); // moving -z, wish +x (90° right)
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(15, 12);
    expect(Math.atan2(r.vx, -r.vz) / DEG).toBeCloseTo(10, 9);
    expect(r.diffRad / DEG).toBeCloseTo(90, 9);
  });
  test("small differences are closed exactly, never overshot", () => {
    const r = slideSteerStep(0, -15, Math.sin(3 * DEG), -Math.cos(3 * DEG), 10 * DEG, 150 * DEG);
    expect(Math.atan2(r.vx, -r.vz) / DEG).toBeCloseTo(3, 9);
  });
  test("near-opposite wish does not steer (no reverse-slide)", () => {
    const r = slideSteerStep(0, -15, 0, 1, 10 * DEG, 150 * DEG);
    expect(r.vx).toBe(0);
    expect(r.vz).toBe(-15);
  });
});

describe("slide steering: a curve controlled by skill, not a rail", () => {
  const straight = slide();

  test("1. no lateral input: direction stays stable", () => {
    for (const x of straight.filter((x) => x.sliding)) expect(Math.abs(x.heading)).toBeLessThan(1e-9);
  });

  test("2/3. D curves right, A curves left — gradually, mirror-symmetric", () => {
    const right = slide({ strafe: 1, mouseDegS: 90 });
    const left = slide({ strafe: -1, mouseDegS: -90 });
    expect(at(right, 1600).heading).toBeGreaterThan(45);
    expect(at(left, 1600).heading).toBeLessThan(-45);
    for (let i = 0; i < right.length; i++) expect(left[i]!.heading).toBeCloseTo(-right[i]!.heading, 9);
    // a typical slide can build a real curve (45–90°+), not a nudge
    expect(at(right, 1300).heading).toBeGreaterThan(20);
    expect(at(right, 1900).heading).toBeGreaterThan(80);
  });

  test("4. steering never changes magnitude beyond normal slide friction", () => {
    const curved = slide({ strafe: 1, mouseDegS: 180 });
    for (let i = 0; i < straight.length; i++) {
      if (!straight[i]!.sliding) continue;
      expect(curved[i]!.speed).toBeCloseTo(straight[i]!.speed, 9);
    }
  });

  test("5. never snaps to the desired direction: per-tick turn ≤ turn rate", () => {
    const s = slide({ strafe: 1, forward: 0, mouseDegS: 0 }); // wish instantly 90° right
    for (let i = 1; i < s.length; i++) {
      if (!s[i]!.sliding) continue;
      expect(Math.abs(s[i]!.heading - s[i - 1]!.heading)).toBeLessThanOrEqual(maxStepDeg + 1e-9);
    }
    expect(at(s, 1060).heading).toBeLessThan(5);
  });

  test("6. opposite input (S) never reverse-slides and never turns", () => {
    const s = slide({ forward: -1 });
    for (let i = 0; i < s.length; i++) {
      if (!s[i]!.sliding) continue;
      expect(Math.abs(s[i]!.heading)).toBeLessThan(1e-9);
      expect(s[i]!.speed).toBeCloseTo(straight[i]!.speed, 9);
    }
  });

  test("7. slide-jump leaves on the tangent of the current curve, speed kept", () => {
    const s = slide({ strafe: 1, mouseDegS: 90, jumpAtMs: 1500 });
    const j = s.findIndex((x) => x.slideJumped);
    expect(j).toBeGreaterThan(0);
    const before = s[j - 1]!;
    expect(before.heading).toBeGreaterThan(30);
    expect(s[j]!.heading).toBeCloseTo(before.heading, 9);
    expect(s[j]!.speed).toBeCloseTo(before.speed, 9);
  });

  test("8. bounded + deterministic: total turn ≤ rate × time, identical reruns", () => {
    const a = slide({ strafe: 1, mouseDegS: 360 });
    const b = slide({ strafe: 1, mouseDegS: 360 });
    expect(a.map((x) => x.heading)).toEqual(b.map((x) => x.heading));
    const slid = a.filter((x) => x.sliding && x.t >= 1050);
    const turned = slid[slid.length - 1]!.heading;
    expect(turned).toBeLessThanOrEqual(C.slideTurnRateDeg * (slid[slid.length - 1]!.t - 1050 + 10) / 1000 + 1e-6);
    // no U-turn inside a short slide: 300ms of max input stays well under 90°
    expect(at(a, 1350).heading).toBeLessThan(90);
    expect(180 / C.slideTurnRateDeg).toBeGreaterThan(0.7); // a full reversal needs > 0.7s
  });

  test("A/D responds NOW: heading moves on the very next tick, big curves come fast", () => {
    const s = slide({ strafe: 1, forward: 0 }); // D only from 1050ms
    const i = s.findIndex((x) => x.t >= 1050);
    expect(s[i - 1]!.heading).toBe(0);
    expect(s[i]!.heading).toBeCloseTo(maxStepDeg, 9); // first input tick already turns at full rate
    expect(at(s, 1050 + 1000 / 60).heading).toBeGreaterThan(3); // visible within one 60Hz frame
    const tTo = (deg: number): number => s.find((x) => x.heading >= deg)!.t - 1050;
    expect(tTo(10)).toBeLessThanOrEqual(60);
    expect(tTo(30)).toBeLessThanOrEqual(150);
    expect(tTo(60)).toBeLessThanOrEqual(300);
    expect(at(s, 1050 + 450).heading).toBeGreaterThanOrEqual(90 - 1e-9); // 60–90° well inside a slide
    // W+D alone: a clear 45° lateral pull reached quickly; mouse takes it further
    expect(at(slide({ strafe: 1 }), 1050 + 250).heading).toBeCloseTo(45, 6);
  });

  test("A → D switch reverses the turn on the next tick, at the rate limit (no snap)", () => {
    // A until 1300ms, then D
    const m = new MovementController();
    m.reset(0, 0.001, 900);
    const hs: { t: number; h: number }[] = [];
    for (let i = 0; i * STEP * 1000 <= 1600; i++) {
      const t = i * STEP * 1000;
      const strafe = t < 1050 ? 0 : t < 1300 ? -1 : 1;
      m.update(STEP, t, { forward: 1, strafe, jumpPressed: false, slideHeld: t >= 1000, shiftPressedAtMs: t >= 1000 ? 1000 : -1e4 }, 0, FLOOR, 1);
      hs.push({ t, h: heading(m) });
    }
    const k = hs.findIndex((x) => x.t >= 1300);
    expect(hs[k - 1]!.h).toBeLessThan(-40);
    expect(hs[k]!.h - hs[k - 1]!.h).toBeCloseTo(maxStepDeg, 9); // already turning right
    for (let i = k; i < hs.length; i++) expect(Math.abs(hs[i]!.h - hs[i - 1]!.h)).toBeLessThanOrEqual(maxStepDeg + 1e-9);
    expect(hs.find((x) => x.t >= 1300 + 250)!.h).toBeGreaterThan(0); // back across center in < 250ms
  });

  test("9. RUN → SHIFT boost unchanged (9 → ~15)", () => {
    expect(at(straight, 990).speed).toBeCloseTo(C.runSpeed, 3);
    expect(straight.find((x) => x.sliding)!.speed).toBeCloseTo(15, 1);
  });

  test("Viper ADS while curving: identical motion (quickscope is movement-neutral)", () => {
    const plain = slide({ strafe: 1, mouseDegS: 90, jumpAtMs: 1500 });
    const ads = slide({ strafe: 1, mouseDegS: 90, jumpAtMs: 1500, adsSlow: weaponConfigs.viper.moveSpeedMultiplier });
    for (let i = 0; i < plain.length; i++) {
      expect(ads[i]!.heading).toBeCloseTo(plain[i]!.heading, 9);
      expect(ads[i]!.speed).toBeCloseTo(plain[i]!.speed, 9);
    }
  });
});

describe("10. curved flow: direction + speed survive jump and flow landing", () => {
  test("curve → jump → fresh Shift → flow land keeps heading and speed, then curves again", () => {
    const m = new MovementController();
    m.reset(0, 0.001, 900);
    let yaw = 0, t = 0, shiftAt = -1e4, shift = false, phase = "run", pressed = false;
    let preLand = { h: 0, s: 0 }, postLand = { h: 0, s: 0 }, takeoff = { h: 0, s: 0 }, curvedAgain = 0;
    let landT = -1;
    for (let i = 0; i < 600; i++, t += STEP * 1000) {
      const b = m.body;
      if (phase === "run" && t >= 1000) { shift = true; shiftAt = t; phase = "slide"; }
      const steering = phase === "slide" || phase === "flow";
      if (steering) yaw -= 90 * DEG * STEP;
      let jump = false;
      if (phase === "slide" && t >= 1400) { jump = true; }
      if (phase === "air" && !pressed && b.vy < 0 && (b.vy + Math.sqrt(b.vy * b.vy + 2 * C.gravity * C.fallGravityMultiplier * b.y)) / (C.gravity * C.fallGravityMultiplier) <= 0.12) {
        shift = true; shiftAt = t; pressed = true;
      }
      const hBefore = heading(m), sBefore = m.horizontalSpeed();
      // air: no WASD (pure momentum) so the landing direction is the takeoff tangent
      m.update(STEP, t, {
        forward: phase === "air" ? 0 : 1, strafe: steering ? 1 : 0, jumpPressed: jump,
        slideHeld: shift, shiftPressedAtMs: shiftAt,
      }, yaw, FLOOR, 1);
      if (m.events.justSlideJumped) { takeoff = { h: heading(m), s: m.horizontalSpeed() }; phase = "air"; shift = false; }
      if (m.events.justFlowLanded) { preLand = { h: hBefore, s: sBefore }; postLand = { h: heading(m), s: m.horizontalSpeed() }; phase = "flow"; landT = t; }
      if (phase === "flow" && t - landT > 300) { curvedAgain = heading(m) - postLand.h; break; }
    }
    expect(takeoff.h).toBeGreaterThan(25);
    expect(preLand.h).toBeCloseTo(takeoff.h, 6);
    expect(postLand.h).toBeCloseTo(preLand.h, 9);
    expect(postLand.s).toBeCloseTo(preLand.s, 9); // flow preserves, never boosts
    expect(postLand.s).toBeLessThanOrEqual(takeoff.s + 1e-9);
    expect(curvedAgain).toBeGreaterThan(20); // the flow slide keeps curving
  });
});
