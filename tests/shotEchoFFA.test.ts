import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { shotEchoConfig, type ShotEchoConfig } from "../src/config/shotEchoConfig";
import { SimpleBot } from "../src/bots/SimpleBot";
import { HitDetection } from "../src/combat/HitDetection";
import { ShotCapture } from "../src/combat/ShotCapture";
import type { ShotSnapshot } from "../src/combat/ShotSnapshot";
import { describeEcho } from "../src/feedback/EchoCopy";
import { buildImpactSketch } from "../src/feedback/ImpactSketch";
import { ShotEchoSession } from "../src/feedback/ShotEchoSession";
import { FFAMode } from "../src/modes/FFAMode";

// Real FFA pieces: SimpleBot hitboxes, HitDetection raycast, ShotCapture.
const CFG: ShotEchoConfig = { ...shotEchoConfig };
const PLAYER = 0;
const DEG = Math.PI / 180;
const EYE = new THREE.Vector3(0, 1.75, 0);

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(32, 16 / 9, 0.05, 400);
  c.position.copy(EYE);
  c.updateMatrixWorld();
  return c;
}
/** A bot standing at (x, 0, z), rendered once (matrices = what the raycast sees). */
function bot(index: number, x: number, z: number): SimpleBot {
  const b = new SimpleBot(index, `Bot ${index}`, { x, y: 0, z });
  b.group.position.set(x, 0, z);
  b.group.rotation.y = 0;
  b.group.updateMatrixWorld(true);
  return b;
}
function headOf(b: SimpleBot): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(b.meshes[1]!.matrixWorld);
}
/** Direction from the eye to the bot's head, rotated by (az right, el up) degrees. */
function aimAt(b: SimpleBot, az = 0, el = 0): THREE.Vector3 {
  const d = headOf(b).sub(EYE).normalize();
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -az * DEG);
  const right = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
  const pitch = new THREE.Quaternion().setFromAxisAngle(right, el * DEG);
  return d.applyQuaternion(yaw).applyQuaternion(pitch).normalize();
}

interface Shot { aim: THREE.Vector3; bullet?: THREE.Vector3; spread?: number; ads?: boolean; adsMs?: number; now?: number; walls?: THREE.Object3D[] }
/** Resolve a real hitscan against the bots, then capture exactly like Game.fireFFA. */
function fireAt(bots: SimpleBot[], o: Shot): { snap: ShotSnapshot; hit: ReturnType<HitDetection["resolve"]> } {
  const cam = camera();
  const bullet = o.bullet ?? o.aim;
  const walls = o.walls ?? [];
  const alive = bots.filter((b) => b.alive);
  const hit = new HitDetection().resolve(cam.position.clone(), bullet, 220, alive, walls);
  const snap = new ShotCapture().capture({
    nowMs: o.now ?? 1000, weaponId: "viper", camera: cam, aimDir: o.aim, shotDir: bullet,
    spreadDeg: o.spread ?? 0, preciseSpreadDeg: 0, ads: o.ads ?? true, adsElapsedMs: o.adsMs ?? 200, snapPrecisionMs: 45,
    sliding: true, airborne: false, horizontalSpeed: 14, result: hit, targets: bots, walls, maximumAnalysisAngleDeg: CFG.maximumAnalysisAngleDeg,
  });
  return { snap, hit };
}
function ffaSession(): ShotEchoSession {
  const s = new ShotEchoSession(CFG);
  s.start("ffa-offline");
  return s;
}

describe("SHOT ECHO in offline FFA", () => {
  test("1. enabled by default in FFA and Training; never in online/menu", () => {
    const s = new ShotEchoSession(CFG);
    for (const m of ["training", "ffa-offline"] as const) { s.start(m); expect(s.isActive()).toBe(true); }
    for (const m of ["online", "menu"] as const) { s.start(m); expect(s.isActive()).toBe(false); }
    const off = new ShotEchoSession({ ...CFG, ffaEnabled: false });
    off.start("ffa-offline");
    expect(off.isActive()).toBe(false);
  });

  test("2. analysable miss vs a bot → same plate as Training (sketch + correction + description)", () => {
    const b = bot(1, 0, -20);
    const { snap, hit } = fireAt([b], { aim: aimAt(b, -1.2, 0) });
    expect(hit.target).toBeNull();
    const fb = ffaSession().onShot(PLAYER, PLAYER, snap)!;
    expect(fb.analysis.target!.id).toBe(1);
    const copy = describeEcho(fb, snap.ads)!;
    expect(copy.direction).toBe("RIGHT");
    expect(copy.description).toEqual(["Shot passed left of the head."]);
    const sk = buildImpactSketch(snap, fb.analysis, CFG).sketch!;
    expect(sk.bullet.x).toBeLessThan(-1);
  });

  test("3. body shot analyses the head of the bot actually hit", () => {
    const hitBot = bot(1, 0, -20);
    const other = bot(2, 1.2, -20); // angularly close, not the one hit
    const { snap, hit } = fireAt([hitBot, other], { aim: aimAt(hitBot, 0, -2.4) });
    expect(hit.target).toBe(hitBot);
    expect(hit.headshot).toBe(false);
    const fb = ffaSession().onShot(PLAYER, PLAYER, snap)!;
    expect(fb.analysis.hit).toBe("body");
    expect(fb.analysis.target!.id).toBe(1);
    expect(describeEcho(fb, true)!.description[0]).toBe("Body hit.");
    expect(fb.analysis.correction!.v).toBeGreaterThan(0);
  });

  test("4. uses the bot hitbox exactly as the raycast saw it at the shot (not a later position)", () => {
    const b = bot(1, 0, -20);
    // the bot keeps moving in its AI (pos updated) but matrices are what the raycast used
    b.pos.set(6, 0, -20);
    b.group.position.copy(b.pos); // next frame's pose, not yet rendered
    const { snap, hit } = fireAt([b], { aim: aimAt(b) }); // aim at the rendered head
    expect(hit.headshot).toBe(true); // raycast: rendered pose
    const t = snap.targets[0]!;
    expect(t.headCenter.x).toBeCloseTo(0, 6); // capture: same pose, not x=6
    expect(t.headRadius).toBeCloseTo(0.27, 6);
    // and the snapshot is frozen data: later movement can't change the analysis
    b.group.updateMatrixWorld(true);
    expect(snap.targets[0]!.headCenter.x).toBeCloseTo(0, 6);
  });

  test("5. bot behind a wall → no correction toward it", () => {
    const b = bot(1, 0, -20);
    const wall = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.5));
    wall.position.set(0, 1.75, -10);
    wall.updateMatrixWorld();
    const { snap } = fireAt([b], { aim: aimAt(b, -1.2, 0), walls: [wall] });
    expect(snap.targets[0]!.headVisible).toBe(false);
    const fb = ffaSession().onShot(PLAYER, PLAYER, snap)!;
    expect(fb.analysis.correction).toBeNull();
    expect(describeEcho(fb, true)).toBeNull();
  });

  test("6. no plausible bot → nothing invented", () => {
    const b = bot(1, 0, -20);
    const { snap } = fireAt([b], { aim: aimAt(b, 30, 0) });
    const fb = ffaSession().onShot(PLAYER, PLAYER, snap)!;
    expect(fb.analysis.kind).toBe("none");
    expect(describeEcho(fb, true)).toBeNull();
    expect(buildImpactSketch(snap, fb.analysis, CFG).sketch).toBeNull();
  });

  test("7. spread and ADS diagnoses hold against bots", () => {
    const b = bot(1, 0, -20);
    const spread = fireAt([b], { aim: aimAt(b, 0.1, 0), bullet: aimAt(b, 1.6, -0.5), spread: 5.5, ads: false, adsMs: 0 });
    expect(ffaSession().onShot(PLAYER, PLAYER, spread.snap)!.analysis.kind).toBe("spread");
    const early = fireAt([b], { aim: aimAt(b, 0.1, 0), bullet: aimAt(b, 1.5, 0), spread: 1.8, adsMs: 20 });
    const fb = ffaSession().onShot(PLAYER, PLAYER, early.snap)!;
    expect(fb.analysis.kind).toBe("ads");
    expect(describeEcho(fb, true)!.value).toBe("ADS +25ms");
  });
});

describe("SHOT ECHO FFA: CORRECTED and lifecycle", () => {
  test("8. CORRECTED against the same bot, same life", () => {
    const b = bot(1, 0, -20);
    const s = ffaSession();
    s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -1.2, 0), now: 1000 }).snap);
    const { snap, hit } = fireAt([b], { aim: aimAt(b, -0.1, 0), now: 1800 });
    expect(hit.headshot).toBe(true);
    const fb = s.onShot(PLAYER, PLAYER, snap)!;
    expect(fb.corrected).toBe(true);
    expect(describeEcho(fb, true)!.value).toBe("CORRECTED!");
  });

  test("another bot's headshot doesn't inherit the correction", () => {
    const a = bot(1, 0, -20);
    const c = bot(2, 8, -20);
    const s = ffaSession();
    s.onShot(PLAYER, PLAYER, fireAt([a, c], { aim: aimAt(a, -1.2, 0), now: 1000 }).snap);
    expect(s.onShot(PLAYER, PLAYER, fireAt([a, c], { aim: aimAt(c), now: 1500 }).snap)!.corrected).toBe(false);
  });

  test("9. bot respawn (new life) invalidates the previous diagnosis", () => {
    const b = bot(1, 0, -20);
    const s = ffaSession();
    s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -1.2, 0), now: 1000 }).snap);
    const lifeBefore = b.lifeId;
    b.die(1100);
    b.respawn({ x: 0, y: 0, z: -20 }, 1500);
    b.group.updateMatrixWorld(true);
    expect(b.lifeId).toBe(lifeBefore + 1);
    expect(s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b), now: 1800 }).snap)!.corrected).toBe(false);
  });

  test("10. player death/respawn clears the pending diagnosis", () => {
    const b = bot(1, 0, -20);
    const s = ffaSession();
    s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -1.2, 0), now: 1000 }).snap);
    expect(s.echo.hasPending()).toBe(true);
    s.interrupt(); // Game: player death, player respawn, match end
    expect(s.echo.hasPending()).toBe(false);
    expect(s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -0.1, 0), now: 1800 }).snap)!.corrected).toBe(false);
    // rematch / mode switch: fresh counters too
    s.start("ffa-offline");
    expect(s.echo.stats.analyzed).toBe(0);
  });

  test("11. shots from anyone but the local player never produce SHOT ECHO", () => {
    const b = bot(1, 0, -20);
    const s = ffaSession();
    const { snap } = fireAt([b], { aim: aimAt(b, -1.2, 0) });
    for (const botShooter of [1, 2, 3]) expect(s.onShot(botShooter, PLAYER, snap)).toBeNull();
    expect(s.echo.stats.analyzed).toBe(0);
    expect(s.echo.hasPending()).toBe(false);
  });

  test("12. Training keeps working through the same session", () => {
    const s = new ShotEchoSession(CFG);
    s.start("training");
    const b = bot(0, 0, -20); // same capture path, any EchoTarget
    expect(s.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -1.2, 0) }).snap)!.analysis.kind).toBe("aim");
    const off = new ShotEchoSession({ ...CFG, trainingEnabled: false });
    off.start("training");
    expect(off.onShot(PLAYER, PLAYER, fireAt([b], { aim: aimAt(b, -1.2, 0) }).snap)).toBeNull();
  });

  test("13. analysis never touches bots or FFA scoring", () => {
    const b = bot(1, 0, -20);
    const match = new FFAMode("YOU", ["Bot 1"]);
    match.start(0);
    const s = ffaSession();
    // body hit then killing headshot, scored exactly like Game.fireFFA, with SHOT ECHO in between
    for (const [aim, now] of [[aimAt(b, 0, -2.4), 1000], [aimAt(b), 2000]] as const) {
      const hp = b.health;
      const { snap, hit } = fireAt([b], { aim, now });
      s.onShot(PLAYER, PLAYER, snap);
      expect(b.health).toBe(hp); // capture/analysis did not damage
      match.registerShot(0);
      match.registerHit(0, now, b.botIndex);
      const killed = (b.health -= hit.headshot ? 150 : 80) <= 0;
      if (killed) match.registerKill({ killerIdx: 0, victimIdx: 1, headshot: hit.headshot, skills: ["headshot"], weapon: "VIPER", nowMs: now });
    }
    expect(match.scores[0]!.shots).toBe(2);
    expect(match.scores[0]!.hits).toBe(2);
    expect(match.scores[0]!.kills).toBe(1);
    expect(match.scores[0]!.headshots).toBe(1);
    expect(s.echo.stats.corrected).toBe(1); // body-hit advice → headshot = CORRECTED
  });
});
