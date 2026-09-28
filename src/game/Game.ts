import * as THREE from "three";
import { BOT_NAMES, FFA_SPAWNS, ffaMatchConfig } from "../config/ffaConfig.js";
import { gameplayConfig } from "../config/gameplayConfig.js";
import { shotEchoConfig } from "../config/shotEchoConfig.js";
import { weaponConfigs, weaponOrder, type WeaponId } from "../config/weaponConfigs.js";
import { botHitChance, SimpleBot } from "../bots/SimpleBot.js";
import { Telemetry } from "../debug/Telemetry.js";
import { CameraController } from "../player/CameraController.js";
import { MovementController } from "../player/MovementController.js";
import { classifyState } from "../player/PlayerState.js";
import { adsSpreadDeg, decideLmbEdge, detectSkillEvents, isPrecisionReady, resolvePendingQuickshot } from "../player/movementRules.js";
import { HitDetection } from "../combat/HitDetection.js";
import { ShotCapture } from "../combat/ShotCapture.js";
import type { ShotSnapshot } from "../combat/ShotSnapshot.js";
import { ShotEcho } from "../feedback/ShotEcho.js";
import { ShotEchoRenderer } from "../feedback/ShotEchoRenderer.js";
import { FFAMode } from "../modes/FFAMode.js";
import { TrainingMode } from "../modes/TrainingMode.js";
import { WeaponController } from "../weapons/WeaponController.js";
import { TrainingArena } from "../world/TrainingArena.js";
import { buildTargets } from "../world/TrainingTarget.js";
import { CombatFeedback } from "../feedback/CombatFeedback.js";
import { SkillFeedback } from "../feedback/SkillFeedback.js";
import { DebugPanel } from "../debug/DebugPanel.js";
import { GameLoop } from "./GameLoop.js";

type AppMode = "menu" | "training" | "ffa";

/**
 * SCOPEBREAK vertical slice: menu → training arena → movement + quickscope loop.
 * Combat reports facts; TrainingMode owns score. Movement owns no DOM.
 */
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private arena = new TrainingArena();
  private targets = buildTargets();
  private move = new MovementController();
  private cam = new CameraController();
  private weapon = new WeaponController();
  private mode = new TrainingMode();
  private hits = new HitDetection();
  private loop: GameLoop;
  private debug: DebugPanel;

  private keys = new Set<string>();
  private jumpQueued = false;
  private shiftPressedAtMs = -10_000;
  private triggerHeld = false;
  private triggerEdge = false;
  private pointerLocked = false;
  private playing = false;
  private appMode: AppMode = "menu";
  private lastWallKickMs = -10_000;
  private adsWasPrecise = false;
  private lastHudMs = 0;
  private showScoreboard = false;

  // FFA state (training path untouched when appMode === "training")
  private ffa = new FFAMode("YOU", BOT_NAMES);
  private bots: SimpleBot[] = [];
  private playerHealth = 100;
  private playerAlive = true;
  private playerRespawnAtMs = 0;
  private telemetry = new Telemetry();
  private nextBotDuelMs = 0;
  private matchEndShown = false;
  private occlusionRay = new THREE.Raycaster();
  // Snap Precision buffer: one LMB edge → at most one shot, never lost.
  private pendingQuickLmbMs = -1;
  private pendingQuickAdsStartMs = -1;

  // HUD refs
  private elAmmoMag!: HTMLElement;
  private elAmmoReserve!: HTMLElement;
  private elWeaponName!: HTMLElement;
  private elStats!: HTMLElement;
  private elScope!: HTMLElement;
  private elCrosshair!: HTMLElement;
  private elReload!: HTMLElement;
  private elCenter!: HTMLElement;
  private elWeaponBar!: HTMLElement;
  private elHealth!: HTMLElement;
  private elMatch!: HTMLElement;
  private elKillfeed!: HTMLElement;
  private elScoreboard!: HTMLElement;
  private elMatchEnd!: HTMLElement;
  private combatFx: CombatFeedback;
  private skillFx: SkillFeedback;
  // SHOT ECHO (training only): observes real shots, never alters them
  private shotCapture = new ShotCapture();
  private shotEcho = new ShotEcho(shotEchoConfig);
  private echoFx!: ShotEchoRenderer;
  private gun = new THREE.Group();
  private gunKick = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x070b12);
    this.scene.fog = new THREE.Fog(0x070b12, 40, 130);
    this.camera = new THREE.PerspectiveCamera(92, window.innerWidth / window.innerHeight, 0.05, 400);
    this.scene.add(this.arena.group);
    for (const t of this.targets) this.scene.add(t.group);
    this.scene.add(this.camera);

    this.buildGun();
    this.buildHud();
    this.combatFx = new CombatFeedback(document.getElementById("hitmarker") as HTMLElement);
    this.combatFx.attachScene(this.scene);
    this.skillFx = new SkillFeedback(document.getElementById("skill-feed") as HTMLElement);
    this.debug = new DebugPanel(this.move, this.weapon);
    this.buildMenu();
    this.bindInput();

    this.move.reset(this.arena.spawn.x, this.arena.spawn.y, this.arena.spawn.z);

    this.loop = new GameLoop(
      (dt, nowMs) => this.tick(dt, nowMs),
      () => this.renderer.render(this.scene, this.camera),
    );
    this.loop.start();
  }

  // ---------------- setup ----------------

  private buildGun(): void {
    const dark = new THREE.MeshLambertMaterial({ color: 0x141b28 });
    const accent = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -0.5);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 12), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, -0.05);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.015, 0.3), accent);
    stripe.position.set(0, -0.02, 0.05);
    this.gun.add(body, barrel, scope, stripe);
    this.camera.add(this.gun);
  }

  private buildHud(): void {
    const hud = document.createElement("div");
    hud.id = "hud";
    hud.innerHTML = `
      <div id="vignette"></div>
      <div id="crosshair">
        <div class="dot"></div>
        <div class="l" data-d="t"></div><div class="l" data-d="b"></div>
        <div class="l" data-d="l"></div><div class="l" data-d="r"></div>
      </div>
      <div id="scope-overlay"><div class="ring"></div><div class="hline"></div><div class="vline"></div><div class="ch"></div></div>
      <div id="hitmarker"><span class="h"></span><span class="v"></span></div>
      <div id="skill-feed"></div>
      <div id="reload-tip"></div>
      <div id="center-msg"></div>
      <div id="ammo-box"><div class="wname" id="wname">VIPER</div><div class="mag" id="mag">5</div><div class="reserve" id="reserve">∞</div></div>
      <div id="weapon-bar"></div>
      <div id="health-box">HP <b id="hp">100</b></div>
      <div id="match-box"></div>
      <div id="killfeed"></div>
      <div id="scoreboard" style="display:none"></div>
      <div id="match-end" style="display:none"></div>
      <div id="stats-box"></div>`;
    this.container.appendChild(hud);
    this.echoFx = new ShotEchoRenderer(hud, shotEchoConfig);

    // crosshair arms
    const arms = hud.querySelectorAll<HTMLElement>("#crosshair .l");
    arms.forEach((el) => {
      const d = el.dataset["d"];
      el.style.width = d === "l" || d === "r" ? "10px" : "2px";
      el.style.height = d === "t" || d === "b" ? "10px" : "2px";
      if (d === "t") { el.style.left = "21px"; el.style.top = "6px"; }
      if (d === "b") { el.style.left = "21px"; el.style.bottom = "6px"; }
      if (d === "l") { el.style.left = "6px"; el.style.top = "21px"; }
      if (d === "r") { el.style.right = "6px"; el.style.top = "21px"; }
    });

    this.elAmmoMag = hud.querySelector("#mag") as HTMLElement;
    this.elAmmoReserve = hud.querySelector("#reserve") as HTMLElement;
    this.elWeaponName = hud.querySelector("#wname") as HTMLElement;
    this.elStats = hud.querySelector("#stats-box") as HTMLElement;
    this.elScope = hud.querySelector("#scope-overlay") as HTMLElement;
    this.elCrosshair = hud.querySelector("#crosshair") as HTMLElement;
    this.elReload = hud.querySelector("#reload-tip") as HTMLElement;
    this.elCenter = hud.querySelector("#center-msg") as HTMLElement;
    this.elWeaponBar = hud.querySelector("#weapon-bar") as HTMLElement;
    this.elHealth = hud.querySelector("#health-box") as HTMLElement;
    this.elMatch = hud.querySelector("#match-box") as HTMLElement;
    this.elKillfeed = hud.querySelector("#killfeed") as HTMLElement;
    this.elScoreboard = hud.querySelector("#scoreboard") as HTMLElement;
    this.elMatchEnd = hud.querySelector("#match-end") as HTMLElement;
    this.refreshWeaponBar();
  }

  private refreshWeaponBar(): void {
    this.elWeaponBar.innerHTML = "";
    weaponOrder.forEach((id, i) => {
      const d = document.createElement("div");
      d.className = "wslot" + (id === this.weapon.currentId ? " active" : "");
      d.textContent = `${i + 1} ${weaponConfigs[id]?.displayName ?? id}`;
      this.elWeaponBar.appendChild(d);
    });
  }

  private buildMenu(): void {
    const menu = document.createElement("div");
    menu.id = "menu";
    menu.innerHTML = `
      <div class="logo">SCOPE<span>BREAK</span></div>
      <div class="tagline">ONE SHOT. NEVER STOP.</div>
      <div class="motto">Move fast. Aim faster.</div>
      <div class="play-row">
        <button class="menu-btn primary" id="btn-training">PLAY — TRAINING</button>
        <button class="menu-btn primary" id="btn-ffa">PLAY — FREE FOR ALL (6, bots)</button>
      </div>
      <button class="menu-btn" disabled>TEAM DEATHMATCH — COMING SOON</button>
      <div class="hint"><b>WASD</b> move · <b>MOUSE</b> aim · <b>SPACE</b> jump / wall-kick · <b>SHIFT</b> slide · <b>RMB</b> ADS · <b>LMB</b> fire · <b>R</b> reload · <b>1/2/3</b> snipers · <b>TAB</b> scoreboard · <b>F1</b> tuning<br/>RUN → SLIDE → JUMP → AIR-STRAFE → WALL-KICK → QUICKSCOPE → LAND → SLIDE</div>`;
    this.container.appendChild(menu);
    const hide = (): void => {
      menu.style.display = "none";
      this.playing = true;
      this.renderer.domElement.requestPointerLock();
    };
    (menu.querySelector("#btn-training") as HTMLElement).onclick = (): void => {
      this.enterTraining();
      hide();
    };
    (menu.querySelector("#btn-ffa") as HTMLElement).onclick = (): void => {
      this.enterFFA();
      hide();
    };
  }

  private bindInput(): void {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space") e.preventDefault();
      if (e.code === "Tab") {
        e.preventDefault();
        if (this.appMode === "ffa" && this.playing) this.showScoreboard = true;
        return;
      }
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.jumpQueued = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftPressedAtMs = performance.now();
      if (e.code === "KeyR" && this.playing && this.appMode !== "menu") {
        if (this.weapon.startReload(performance.now())) this.combatFx.reload();
      }
      if (this.playing && this.appMode !== "menu" && (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3")) {
        const idx = Number(e.code.slice(-1)) - 1;
        const id: WeaponId | undefined = weaponOrder[idx];
        if (id) {
          this.weapon.switchTo(id, performance.now());
          this.clearPendingQuickshot();
          this.adsWasPrecise = false;
          this.refreshWeaponBar();
        }
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Tab") {
        this.showScoreboard = false;
        return;
      }
      this.keys.delete(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked || !this.playing) return;
      this.cam.addLook(e.movementX, e.movementY, this.weapon.adsActive);
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.playing) return;
      if (!this.pointerLocked) {
        this.renderer.domElement.requestPointerLock();
        return;
      }
      if (e.button === 0) {
        this.triggerHeld = true;
        this.triggerEdge = true;
      }
      if (e.button === 2) {
        this.weapon.setAds(true, performance.now());
        this.adsWasPrecise = false;
      }
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.triggerHeld = false;
        this.triggerEdge = false;
      }
      if (e.button === 2) this.weapon.setAds(false, performance.now());
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    this.renderer.domElement.addEventListener("click", () => {
      if (this.playing && !this.pointerLocked) this.renderer.domElement.requestPointerLock();
    });
  }

  // ---------------- per-tick ----------------

  private moveInput(): { forward: number; strafe: number } {
    const k = this.keys;
    const f = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    const s = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    return { forward: f, strafe: s };
  }

  private tick(dt: number, nowMs: number): void {
    const frameStart = performance.now();
    this.weapon.update(nowMs);

    const canMove = this.playerAliveOrTraining();
    const { forward, strafe } = canMove ? this.moveInput() : { forward: 0, strafe: 0 };
    const jumpPressed = canMove && this.jumpQueued;
    this.jumpQueued = false;
    const slideHeld = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const adsSlow = this.weapon.adsActive ? this.weapon.config.moveSpeedMultiplier : 1;

    this.move.update(
      dt, nowMs,
      { forward, strafe, jumpPressed, slideHeld, shiftPressedAtMs: this.shiftPressedAtMs },
      this.cam.yaw, this.arena.colliders, adsSlow,
    );
    if (this.move.events.justWallKicked) this.lastWallKickMs = nowMs;
    this.telemetry.observeSpeed(this.move.horizontalSpeed());

    // camera pose
    const b = this.move.body;
    this.camera.position.set(b.x, b.y + this.cam.eyeHeightSmooth(this.move.sliding, dt), b.z);
    this.cam.update(this.camera, dt, {
      ads: this.weapon.adsActive,
      scopeFov: this.weapon.config.scopeFov,
      sliding: this.move.sliding,
      speed: this.move.horizontalSpeed(),
      strafeLean: strafe,
    });

    // gun pose: hip offset → centered ADS
    const adsK = this.weapon.adsActive ? 1 : 0;
    this.gunKick = Math.max(0, this.gunKick - dt * 6);
    const gx = THREE.MathUtils.lerp(0.28, 0, adsK);
    const gy = THREE.MathUtils.lerp(-0.24, -0.155, adsK);
    this.gun.position.set(gx, gy + this.gunKick * 0.03, -0.5 + this.gunKick * 0.12);
    this.gun.visible = !(this.weapon.adsActive && this.cam.currentFov < this.weapon.config.scopeFov + 6);

    // precision window feedback (subtle: gold ring + tick)
    const precisionMs = Math.max(gameplayConfig.precisionWindowMs, this.weapon.config.adsMs);
    const precise = this.weapon.adsActive && isPrecisionReady(this.weapon.adsElapsedMs(nowMs), precisionMs);
    if (precise && !this.adsWasPrecise) {
      this.adsWasPrecise = true;
      this.combatFx.precisionReady();
    }

    // targets (training only; hidden in FFA where bots are the targets)
    if (this.appMode === "ffa") {
      for (const t of this.targets) t.group.visible = false;
    } else {
      for (const t of this.targets) t.update(nowMs, nowMs / 1000);
    }

    // shooting: LMB is NEVER ignored.
    // - edge (one click) → immediate shot, or buffered snap shot when ADS just started
    // - semi-auto hold (Phantom) → cadence fire while held
    if (this.triggerEdge) {
      this.triggerEdge = false;
      if (this.playing && this.playerAliveOrTraining()) this.handleLmbEdge(nowMs);
    }
    this.updatePendingQuickshot(nowMs);
    if (
      this.playing && this.playerAliveOrTraining() &&
      !this.weapon.config.boltAction && this.triggerHeld && this.pendingQuickLmbMs < 0 &&
      this.weapon.canFireNow(nowMs)
    ) {
      if (this.appMode === "ffa") this.fireFFA(nowMs);
      else this.fire(nowMs);
    }

    if (this.appMode === "ffa") this.updateFFA(dt, nowMs);
    else this.mode.update(dt);
    this.combatFx.update(nowMs);

    // DOM @ ~15Hz (never per-substep full refresh)
    if (nowMs - this.lastHudMs > 66) {
      this.lastHudMs = nowMs;
      this.refreshHud(nowMs, precise, precisionMs);
    }
    this.debug.recordFrame(performance.now() - frameStart);
  }

  // ---------------- snap precision ----------------

  private clearPendingQuickshot(): void {
    this.pendingQuickLmbMs = -1;
    this.pendingQuickAdsStartMs = -1;
  }

  /** Spread right now: hip when unscoped, snap curve once ADS starts. */
  private currentAdsSpread(nowMs: number): number {
    const w = this.weapon;
    const hip = Math.max(gameplayConfig.hipfireSpreadDeg, w.config.hipSpreadDeg);
    if (!w.adsActive) return hip;
    return adsSpreadDeg({
      adsElapsedMs: w.adsElapsedMs(nowMs),
      snapMs: w.config.snapPrecisionMs,
      hipSpreadDeg: hip,
      preciseSpreadDeg: gameplayConfig.adsSpreadDeg,
    });
  }

  private tryFireNow(nowMs: number): void {
    if (this.weapon.canFireNow(nowMs)) {
      if (this.appMode === "ffa") this.fireFFA(nowMs);
      else this.fire(nowMs);
    } else if (this.weapon.ammoInMag <= 0 && !this.weapon.reloading) {
      this.combatFx.dryFire();
      this.weapon.startReload(nowMs);
    }
    // NOTE: bolt cooldown drops the click by design (cycling identity) —
    // the buffer bridges ADS timing, never the weapon cycle.
  }

  /**
   * One LMB click, routed purely:
   * - RMB just started ADS (within buffer) + snap not ready → buffer until snap
   * - otherwise → immediate shot (hipfire, or precise when already scoped)
   */
  private handleLmbEdge(nowMs: number): void {
    const w = this.weapon;
    const sinceAdsStart = nowMs - w.lastAdsStartMs;
    const decision = decideLmbEdge({
      sinceAdsStartMs: sinceAdsStart,
      adsElapsedMs: w.adsActive ? w.adsElapsedMs(nowMs) : sinceAdsStart,
      quickShotBufferMs: gameplayConfig.quickShotBufferMs,
      snapPrecisionMs: w.config.snapPrecisionMs,
    });
    if (decision === "buffer-quickshot") {
      this.pendingQuickLmbMs = nowMs;
      this.pendingQuickAdsStartMs = w.lastAdsStartMs;
      return;
    }
    this.tryFireNow(nowMs);
  }

  /**
   * Buffered RMB+LMB: fires automatically at ADS-start + snap delay with
   * ~zero spread — whether RMB is still held (stay scoped) or already
   * released (tap → snap shot → back to hip).
   */
  private updatePendingQuickshot(nowMs: number): void {
    const state = resolvePendingQuickshot({
      pendingLmbMs: this.pendingQuickLmbMs,
      adsStartMs: this.pendingQuickAdsStartMs,
      snapMs: this.weapon.config.snapPrecisionMs,
      nowMs,
    });
    if (state === "fire") {
      this.clearPendingQuickshot();
      if (this.playing && this.playerAliveOrTraining()) this.tryFireNow(nowMs);
    }
  }

  private fire(nowMs: number): void {
    this.mode.registerShot();
    this.telemetry.registerShot(this.weapon.currentId);
    this.weapon.consumeShot(nowMs);

    const spread = this.currentAdsSpread(nowMs);

    const origin = this.camera.position.clone();
    const aimDir = this.cam.forwardDir();
    const dir = HitDetection.applySpread(aimDir, spread);
    const res = this.hits.resolve(origin, dir, 220, this.targets, this.arena.solidMeshes);
    // SHOT ECHO snapshot: this IS the effective fire instant (buffered
    // quickshots arrive here when they fire), taken before damage is applied
    const echoSnap = this.appMode === "training" && shotEchoConfig.enabled
      ? this.shotCapture.capture({
        nowMs, weaponId: this.weapon.currentId, camera: this.camera, aimDir, shotDir: dir,
        spreadDeg: spread, preciseSpreadDeg: gameplayConfig.adsSpreadDeg,
        ads: this.weapon.adsActive, adsElapsedMs: this.weapon.adsElapsedMs(nowMs),
        snapPrecisionMs: this.weapon.config.snapPrecisionMs,
        sliding: this.move.sliding, airborne: !this.move.body.grounded,
        horizontalSpeed: this.move.horizontalSpeed(), result: res,
        targets: this.targets, walls: this.arena.solidMeshes,
        maximumAnalysisAngleDeg: shotEchoConfig.maximumAnalysisAngleDeg,
      })
      : null;

    this.cam.kickRecoil(this.weapon.config.recoilKick);
    this.gunKick = 1;
    this.combatFx.shotFor(this.weapon.currentId);
    this.combatFx.muzzle(origin.clone().addScaledVector(dir, 0.8));
    this.combatFx.tracer(origin.clone().addScaledVector(dir, 0.9), res.point);

    if (res.target) {
      const cfg = this.weapon.config;
      const killed = res.target.applyDamage(res.headshot ? cfg.headDamage : cfg.bodyDamage, nowMs);
      const wallKickRecent = nowMs - this.lastWallKickMs < 2500;
      const skills = detectSkillEvents({
        headshot: res.headshot,
        sliding: this.move.sliding,
        airborne: !this.move.body.grounded,
        wallKickRecent,
        distance: res.distance,
        longShotDistance: gameplayConfig.longShotDistance,
        killed,
      });
      this.mode.registerHit({ headshot: res.headshot, skills, distance: res.distance });
      this.telemetry.registerHit(this.weapon.currentId, res.headshot);
      if (res.headshot) this.combatFx.headHit();
      else this.combatFx.bodyHit();
      this.skillFx.show(skills, res.headshot);
      this.combatFx.impact(res.point, res.headshot ? 0xffd60a : 0x00f0ff);
    } else {
      this.mode.registerMiss();
      if (res.blocked) this.combatFx.impact(res.point);
    }
    if (echoSnap) this.presentShotEcho(echoSnap);
  }

  /** Analyse → one message + ghost + sound → debug line. Runs once per real shot. */
  private presentShotEcho(s: ShotSnapshot): void {
    const fb = this.shotEcho.onShot(s);
    if (!fb) return;
    this.echoFx.show(fb, s.fovDeg, s.timeMs);
    if (fb.sound === "tick") this.combatFx.echoTick();
    else if (fb.sound === "corrected") this.combatFx.echoCorrected();
    const a = fb.analysis;
    const d = (v: { x: number; y: number; z: number }): string => `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`;
    const st = this.shotEcho.stats;
    const row = (k: string, v: string): string => `<div class="stat"><span>${k}</span><b>${v}</b></div>`;
    this.debug.setShotEcho(
      row("weapon / ADS", `${s.weaponId} / ${s.ads ? `on ${s.adsElapsedMs.toFixed(0)}ms (snap ${s.snapPrecisionMs})` : "hip"}`) +
      row("aim dir", d(s.aimDir)) +
      row("shot dir", d(s.shotDir)) +
      row("spread", `${s.spreadDeg.toFixed(2)}°`) +
      row("hit", `${a.hit}${s.result.blocked ? " (blocked)" : ""}`) +
      row("target", a.target ? `#${a.target.id} life ${a.target.lifeId}` : "—") +
      row("correction", a.correction ? `h ${a.correction.h.toFixed(2)}° v ${a.correction.v.toFixed(2)}°` : "—") +
      row("class", `${a.kind}${fb.corrected ? " ✓CORRECTED" : ""}`) +
      row("validity", a.target ? `geometric · aimOnHead ${a.aimOnHead} · shotOnHead ${a.shotOnHead}` : "no valid target") +
      row("totals", `n${st.analyzed} hs${st.headshots} body${st.bodyShots} near${st.nearMisses} H${st.horizontalErrors} V${st.verticalErrors} spr${st.spreadLimited} ads${st.adsEarly} ✓${st.corrected}`),
    );
  }

  // ---------------- FFA ----------------

  private playerAliveOrTraining(): boolean {
    if (this.appMode !== "ffa") return true;
    return this.playerAlive;
  }

  private enterTraining(): void {
    this.appMode = "training";
    this.clearPendingQuickshot();
    this.shotEcho.reset();
    this.echoFx.hide();
    for (const t of this.targets) t.group.visible = true;
    for (const b of this.bots) this.scene.remove(b.group);
    this.bots = [];
    this.elMatchEnd.style.display = "none";
  }

  private enterFFA(): void {
    this.appMode = "ffa";
    for (const b of this.bots) this.scene.remove(b.group);
    this.bots = [];
    this.resetFFA(performance.now());
  }

  private resetFFA(nowMs: number): void {
    this.ffa = new FFAMode("YOU", BOT_NAMES);
    this.ffa.start(nowMs);
    this.clearPendingQuickshot();
    this.telemetry = new Telemetry();
    this.matchEndShown = false;
    this.elMatchEnd.style.display = "none";
    this.elKillfeed.innerHTML = "";
    this.playerHealth = 100;
    this.playerAlive = true;
    this.weapon.switchTo("viper", nowMs);
    this.weapon.ammoInMag = this.weapon.config.magazineSize;
    this.refreshWeaponBar();
    const s0 = FFA_SPAWNS[0]!;
    this.move.reset(s0.x, s0.y, s0.z);
    this.cam.yaw = 0;
    this.cam.pitch = 0;
    BOT_NAMES.forEach((name, i) => {
      const spawn = FFA_SPAWNS[(i + 1) % FFA_SPAWNS.length]!;
      const bot = new SimpleBot(i + 1, name, spawn);
      this.bots.push(bot);
      this.scene.add(bot.group);
    });
    this.nextBotDuelMs = nowMs + 1500;
  }

  private safestSpawn(): { x: number; y: number; z: number } {
    let best = FFA_SPAWNS[0]!;
    let bestDist = -1;
    for (const s of FFA_SPAWNS) {
      let minD = Infinity;
      for (const b of this.bots) {
        if (!b.alive) continue;
        const d = Math.hypot(b.pos.x - s.x, b.pos.z - s.z);
        if (d < minD) minD = d;
      }
      if (minD > bestDist) {
        bestDist = minD;
        best = s;
      }
    }
    return best;
  }

  private fireFFA(nowMs: number): void {
    this.ffa.registerShot(0);
    this.telemetry.registerShot(this.weapon.currentId);
    this.weapon.consumeShot(nowMs);

    const spread = this.currentAdsSpread(nowMs);

    const origin = this.camera.position.clone();
    const dir = HitDetection.applySpread(this.cam.forwardDir(), spread);
    const aliveBots = this.bots.filter((b) => b.alive);
    const res = this.hits.resolve(origin, dir, 220, aliveBots, this.arena.solidMeshes);

    this.cam.kickRecoil(this.weapon.config.recoilKick);
    this.gunKick = 1;
    this.combatFx.shotFor(this.weapon.currentId);
    this.combatFx.muzzle(origin.clone().addScaledVector(dir, 0.8));
    this.combatFx.tracer(origin.clone().addScaledVector(dir, 0.9), res.point);

    if (res.target) {
      const bot = res.target as unknown as SimpleBot;
      const cfg = this.weapon.config;
      const headshot = res.headshot;
      const killed = bot.applyDamage(headshot ? cfg.headDamage : cfg.bodyDamage);
      const wallKickRecent = nowMs - this.lastWallKickMs < 2500;
      const skills = detectSkillEvents({
        headshot,
        sliding: this.move.sliding,
        airborne: !this.move.body.grounded,
        wallKickRecent,
        distance: res.distance,
        longShotDistance: gameplayConfig.longShotDistance,
        killed,
      });
      this.ffa.registerHit(0, nowMs, bot.botIndex);
      this.telemetry.registerHit(this.weapon.currentId, headshot);
      if (killed) {
        const ev = this.ffa.registerKill({
          killerIdx: 0, victimIdx: bot.botIndex, headshot, skills,
          weapon: cfg.displayName, nowMs,
        });
        this.telemetry.registerKill(this.weapon.currentId);
        this.combatFx.killConfirm(headshot);
        this.pushKillfeed(ev);
        bot.die(nowMs);
      } else if (headshot) this.combatFx.headHit();
      else this.combatFx.bodyHit();
      this.skillFx.show(skills, headshot);
      this.combatFx.impact(res.point, headshot ? 0xffd60a : 0x00f0ff);
    } else {
      this.ffa.registerMiss(0);
      if (res.blocked) this.combatFx.impact(res.point);
    }
  }

  private updateFFA(dt: number, nowMs: number): void {
    this.ffa.update(dt, nowMs);
    const playerPos = this.camera.position.clone();

    // bots act
    for (const bot of this.bots) {
      // respawn due
      if (!bot.alive && this.ffa.respawnDue(bot.botIndex, nowMs) && this.ffa.state === "playing") {
        const s = FFA_SPAWNS[bot.botIndex % FFA_SPAWNS.length]!;
        bot.respawn({ x: s.x + (Math.random() * 2 - 1), y: s.y, z: s.z + (Math.random() * 2 - 1) }, nowMs);
        this.ffa.consumeRespawn(bot.botIndex);
      }
      if (!bot.alive) continue;
      const intent = bot.update(dt, nowMs, playerPos, this.playerAlive && this.ffa.state === "playing");
      if (intent && this.playerAlive && this.ffa.state === "playing") this.resolveBotShot(bot, intent.origin, intent.dir);
    }

    // abstract bot-vs-bot duels keep the scoreboard alive without full AI
    if (this.ffa.state === "playing" && nowMs >= this.nextBotDuelMs) {
      this.nextBotDuelMs = nowMs + 1100;
      this.duelBots(nowMs);
    }

    // player respawn
    if (!this.playerAlive && this.ffa.state === "playing" && nowMs >= this.playerRespawnAtMs) {
      const s = this.safestSpawn();
      this.move.reset(s.x, s.y, s.z);
      this.playerHealth = 100;
      this.playerAlive = true;
      this.weapon.ammoInMag = this.weapon.config.magazineSize;
      this.telemetry.resetLife();
    }

    if (this.ffa.state === "ended" && !this.matchEndShown) {
      this.matchEndShown = true;
      this.showMatchEnd();
    }
  }

  private resolveBotShot(bot: SimpleBot, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const eye = this.camera.position.clone();
    const toEye = new THREE.Vector3().subVectors(eye, origin);
    const dist = toEye.length();
    if (dist < 0.5 || dist > 60) return;
    const ndir = toEye.normalize();
    // occlusion: wall closer than player blocks
    this.occlusionRay.set(origin, ndir);
    this.occlusionRay.far = dist;
    const blocked = this.occlusionRay.intersectObjects(this.arena.solidMeshes, false);
    const muzzleEnd = origin.clone().addScaledVector(ndir, Math.min(dist, 3));
    if (blocked.length > 0) {
      this.combatFx.tracer(muzzleEnd, blocked[0]!.point.clone());
      return;
    }
    this.combatFx.tracer(muzzleEnd, eye);
    const chance = botHitChance(dist, this.move.horizontalSpeed(), 1);
    if (Math.random() < chance) {
      const headshot = Math.random() < 0.18;
      this.damagePlayer(headshot ? 55 : 30, headshot, bot.botIndex, performance.now());
    }
  }

  private duelBots(nowMs: number): void {
    const alive = this.bots.filter((b) => b.alive);
    if (alive.length < 2) return;
    if (Math.random() > 0.5) return;
    const killer = alive[Math.floor(Math.random() * alive.length)]!;
    let victim = alive[Math.floor(Math.random() * alive.length)]!;
    if (victim === killer) victim = alive[(alive.indexOf(killer) + 1) % alive.length]!;
    const dmg = 40 + Math.random() * 55;
    const headshot = Math.random() < 0.25;
    const killed = victim.applyDamage(headshot ? dmg * 1.6 : dmg);
    if (killed) {
      const weapons = ["VIPER", "TITAN", "PHANTOM"];
      const ev = this.ffa.registerKill({
        killerIdx: killer.botIndex,
        victimIdx: victim.botIndex,
        headshot,
        skills: headshot ? ["headshot"] : [],
        weapon: weapons[Math.floor(Math.random() * weapons.length)]!,
        nowMs,
      });
      this.pushKillfeed(ev);
      victim.die(nowMs);
    }
  }

  private damagePlayer(dmg: number, headshot: boolean, killerIdx: number, nowMs: number): void {
    if (!this.playerAlive || this.ffa.state !== "playing") return;
    this.playerHealth -= dmg;
    this.combatFx.impact(this.camera.position.clone(), 0xff2d55);
    if (this.playerHealth <= 0) {
      this.playerHealth = 0;
      this.playerAlive = false;
      this.clearPendingQuickshot();
      this.playerRespawnAtMs = nowMs + this.ffa.respawnMs;
      const ev = this.ffa.registerKill({
        killerIdx, victimIdx: 0, headshot, skills: headshot ? ["headshot"] : [],
        weapon: "VIPER", nowMs,
      });
      this.telemetry.registerDeath();
      this.combatFx.playerDown();
      this.pushKillfeed(ev);
    }
    void headshot;
  }

  private pushKillfeed(ev: { killer: string; victim: string; weapon: string; headshot: boolean; skills: string[] }): void {
    const div = document.createElement("div");
    div.className = "feed-row" + (ev.headshot ? " hs" : "");
    const skill = ev.skills.length > 0 && !ev.headshot ? "" : ev.skills.length > 1 ? ` · ${String(ev.skills[1]).toUpperCase()}` : "";
    div.textContent = `${ev.killer} [${ev.weapon}${ev.headshot ? "/headshot" : ""}] ${ev.victim}${skill}`;
    this.elKillfeed.prepend(div);
    while (this.elKillfeed.children.length > 5) this.elKillfeed.lastChild?.remove();
    window.setTimeout(() => div.remove(), 6000);
  }

  private renderScoreboard(): void {
    const order = this.ffa.placement();
    const rows = order.map((idx, i) => {
      const s = this.ffa.scores[idx]!;
      return `<tr class="${idx === 0 ? "me" : ""}"><td>${i + 1}</td><td>${s.name}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.headshots}</td><td>${s.skillScore}</td></tr>`;
    }).join("");
    this.elScoreboard.innerHTML =
      `<table><tr><th>#</th><th>player</th><th>K</th><th>D</th><th>HS</th><th>score</th></tr>${rows}</table>` +
      `<div class="sb-hint">TAB — hold to view</div>`;
  }

  private showMatchEnd(): void {
    document.exitPointerLock?.();
    const order = this.ffa.placement();
    const me = this.ffa.scores[0]!;
    const rank = order.indexOf(0) + 1;
    const rows = order.map((idx, i) => {
      const s = this.ffa.scores[idx]!;
      return `<tr class="${idx === 0 ? "me" : ""}"><td>${i + 1}</td><td>${s.name}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.headshots}</td><td>${s.skillScore}</td></tr>`;
    }).join("");
    this.elMatchEnd.innerHTML = `
      <div class="panel">
        <div class="title">MATCH END — ${this.ffa.endReason}</div>
        <div class="sub">YOU placed #${rank} · K/D ${me.kills}/${me.deaths} (${this.ffa.kd(0).toFixed(2)}) · ACC ${(this.ffa.accuracy(0) * 100).toFixed(1)}% · HS ${me.headshots} · BEST ${me.bestSkill ?? "—"} · AVG ENGAGE ${this.ffa.avgEngagementSec().toFixed(1)}s</div>
        <table><tr><th>#</th><th>player</th><th>K</th><th>D</th><th>HS</th><th>score</th></tr>${rows}</table>
        <button id="btn-rematch">REMATCH</button>
      </div>`;
    this.elMatchEnd.style.display = "flex";
    (this.elMatchEnd.querySelector("#btn-rematch") as HTMLElement).onclick = (): void => {
      this.resetFFA(performance.now());
      this.renderer.domElement.requestPointerLock();
    };
  }

  private refreshHud(nowMs: number, precise: boolean, precisionMs: number): void {
    const w = this.weapon;
    this.elAmmoMag.textContent = w.reloading ? "--" : String(w.ammoInMag);
    this.elWeaponName.textContent = `${w.config.displayName} · ${w.config.style.toUpperCase()}`;
    this.elReload.textContent = w.reloading
      ? "RELOADING — movement free"
      : w.ammoInMag === 0
        ? "PRESS R / CLICK TO RELOAD"
        : "";
    this.elScope.classList.toggle("on", w.adsActive);
    this.elScope.classList.toggle("precise", precise);
    this.elCrosshair.style.display = w.adsActive ? "none" : "block";

    const st = classifyState({
      grounded: this.move.body.grounded,
      sliding: this.move.sliding,
      justSlideJumped: this.move.events.justSlideJumped,
      justWallKicked: this.move.events.justWallKicked,
      justFlowLanded: this.move.events.justFlowLanded,
      airborne: !this.move.body.grounded,
    });
    const s = this.mode.stats;
    const acc = s.shots > 0 ? ((s.hits / s.shots) * 100).toFixed(1) : "—";
    if (this.appMode === "ffa") {
      const me = this.ffa.scores[0]!;
      const t = this.telemetry;
      const pw = (id: "viper" | "titan" | "phantom"): string => {
        const p = t.perWeapon[id];
        return `${id.toUpperCase()} <b>${p.shots}/${p.hits}/${p.kills}/${p.headshots}</b>`;
      };
      this.elStats.innerHTML =
        `K <b>${me.kills}</b> · D <b>${me.deaths}</b> · HS <b>${me.headshots}</b> · SCORE <b>${me.skillScore}</b><br/>` +
        `ACC <b>${(this.ffa.accuracy(0) * 100).toFixed(1)}%</b> · MAXSPD <b>${t.maxSpeedThisLife.toFixed(1)}</b> · AVG ENG <b>${this.ffa.avgEngagementSec().toFixed(1)}s</b><br/>` +
        `${pw("viper")}<br/>${pw("titan")}<br/>${pw("phantom")}`;
    } else {
      this.elStats.innerHTML =
        `SHOTS <b>${s.shots}</b> · HITS <b>${s.hits}</b> · ACC <b>${acc}%</b><br/>` +
        `HEADSHOTS <b>${s.headshots}</b> · SCORE <b>${s.skillScore}</b>`;
    }

    const adsMs = this.playing ? w.adsElapsedMs(nowMs) : 0;
    const adsProg = w.adsActive
      ? Math.min(1, adsMs / Math.max(1, w.config.snapPrecisionMs)).toFixed(2)
      : "—";
    const snapReady = w.adsActive && adsMs >= w.config.snapPrecisionMs;
    this.debug.updateStats(
      `<div class="stat"><span>grounded</span><b>${this.move.body.grounded}</b></div>` +
      `<div class="stat"><span>state</span><b>${st}</b></div>` +
      `<div class="stat"><span>sliding</span><b>${this.move.sliding}</b></div>` +
      `<div class="stat"><span>ADS</span><b>${w.adsActive} (${adsMs.toFixed(0)}/${precisionMs}ms)</b></div>` +
      `<div class="stat"><span>ADS progress</span><b>${adsProg}</b></div>` +
      `<div class="stat"><span>snap</span><b>${snapReady} (${w.config.snapPrecisionMs}ms)</b></div>` +
      `<div class="stat"><span>pendingQS</span><b>${this.pendingQuickLmbMs >= 0}</b></div>` +
      `<div class="stat"><span>precision</span><b>${precise}</b></div>` +
      `<div class="stat"><span>speed</span><b>${this.move.horizontalSpeed().toFixed(2)} m/s</b></div>` +
      `<div class="stat"><span>steer dir/wish/Δ/turn</span><b>${this.move.sliding || !this.move.body.grounded ? `${(Math.atan2(this.move.body.vx, -this.move.body.vz) * 180 / Math.PI).toFixed(0)}° / ${Number.isNaN(this.move.steerWishDeg) ? "—" : this.move.steerWishDeg.toFixed(0) + "°"} / ${this.move.steerDiffDeg.toFixed(0)}° / ${this.move.steerTurnDeg.toFixed(1)}°` : "—"}</b></div>` +
      `<div class="stat"><span>slideEntry</span><b>${this.move.lastSlideEntrySpeed.toFixed(1)}→${this.move.lastSlideBoostedSpeed.toFixed(1)}</b></div>` +
      `<div class="stat"><span>land</span><b>${this.move.lastLandSpeedIn.toFixed(1)}→${this.move.lastLandSpeedOut.toFixed(1)}</b></div>` +
      `<div class="stat"><span>slideStarted</span><b>${this.move.events.justStartedSlide}</b></div>` +
      `<div class="stat"><span>flowLanding</span><b>${this.move.events.justFlowLanded}</b></div>` +
      `<div class="stat"><span>maxSpeed(life)</span><b>${this.telemetry.maxSpeedThisLife.toFixed(2)}</b></div>` +
      `<div class="stat"><span>vy</span><b>${this.move.body.vy.toFixed(2)}</b></div>` +
      `<div class="stat"><span>mode</span><b>${this.appMode}${this.appMode === "ffa" ? ` K${this.ffa.scores[0]!.kills} D${this.ffa.scores[0]!.deaths}` : ""}</b></div>` +
      `<div class="stat"><span>weapon</span><b>${w.currentId} ${w.ammoInMag}/${w.config.magazineSize}</b></div>`,
    );

    this.elCenter.textContent =
      !this.playing ? "" : !this.pointerLocked ? "CLICK TO RE-ENGAGE POINTER LOCK" : "";

    // FFA HUD (training keeps the original minimal stats box)
    const inFfa = this.appMode === "ffa";
    this.elHealth.style.display = inFfa ? "block" : "none";
    this.elMatch.style.display = inFfa ? "block" : "none";
    if (inFfa) {
      (this.elHealth.querySelector("#hp") as HTMLElement).textContent = this.playerAlive
        ? String(Math.ceil(this.playerHealth))
        : `RESPAWN…`;
      this.elHealth.classList.toggle("low", this.playerAlive && this.playerHealth <= 35);
      const t = Math.ceil(this.ffa.timeLeftSec(nowMs));
      const mm = Math.floor(t / 60);
      const ss = String(t % 60).padStart(2, "0");
      this.elMatch.textContent = `FFA · YOU ${this.ffa.scores[0]!.kills}/${ffaMatchConfig.killLimit} · ${mm}:${ss}`;
      this.elScoreboard.style.display = this.showScoreboard ? "block" : "none";
      if (this.showScoreboard) this.renderScoreboard();
    } else {
      this.elScoreboard.style.display = "none";
    }

    void nowMs;
  }
}
