import * as THREE from "three";
import { gameplayConfig } from "../config/gameplayConfig.js";
import { weaponConfigs, weaponOrder, type WeaponId } from "../config/weaponConfigs.js";
import { CameraController } from "../player/CameraController.js";
import { MovementController } from "../player/MovementController.js";
import { classifyState } from "../player/PlayerState.js";
import { detectSkillEvents, isPrecisionReady } from "../player/movementRules.js";
import { HitDetection } from "../combat/HitDetection.js";
import { TrainingMode } from "../modes/TrainingMode.js";
import { WeaponController } from "../weapons/WeaponController.js";
import { TrainingArena } from "../world/TrainingArena.js";
import { buildTargets } from "../world/TrainingTarget.js";
import { CombatFeedback } from "../feedback/CombatFeedback.js";
import { SkillFeedback } from "../feedback/SkillFeedback.js";
import { DebugPanel } from "../debug/DebugPanel.js";
import { GameLoop } from "./GameLoop.js";

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
  private lastWallKickMs = -10_000;
  private adsWasPrecise = false;
  private lastHudMs = 0;

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
  private combatFx: CombatFeedback;
  private skillFx: SkillFeedback;
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
      <div id="stats-box"></div>`;
    this.container.appendChild(hud);

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
      <button class="menu-btn primary" id="btn-play">PLAY — TRAINING</button>
      <button class="menu-btn" disabled>FREE FOR ALL — COMING SOON</button>
      <button class="menu-btn" disabled>TEAM DEATHMATCH — COMING SOON</button>
      <div class="hint"><b>WASD</b> move · <b>MOUSE</b> aim · <b>SPACE</b> jump / wall-kick · <b>SHIFT</b> slide · <b>RMB</b> ADS · <b>LMB</b> fire · <b>R</b> reload · <b>1/2/3</b> snipers · <b>F1</b> tuning<br/>RUN → SLIDE → JUMP → AIR-STRAFE → WALL-KICK → QUICKSCOPE → LAND → SLIDE</div>`;
    this.container.appendChild(menu);
    const btn = menu.querySelector("#btn-play") as HTMLElement;
    btn.onclick = (): void => {
      menu.style.display = "none";
      this.playing = true;
      this.renderer.domElement.requestPointerLock();
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
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === "Space") this.jumpQueued = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.shiftPressedAtMs = performance.now();
      if (e.code === "KeyR" && this.playing) {
        if (this.weapon.startReload(performance.now())) this.combatFx.reload();
      }
      if (this.playing && (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3")) {
        const idx = Number(e.code.slice(-1)) - 1;
        const id: WeaponId | undefined = weaponOrder[idx];
        if (id) {
          this.weapon.switchTo(id, performance.now());
          this.adsWasPrecise = false;
          this.refreshWeaponBar();
        }
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
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

    const { forward, strafe } = this.moveInput();
    const jumpPressed = this.jumpQueued;
    this.jumpQueued = false;
    const slideHeld = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
    const adsSlow = this.weapon.adsActive ? this.weapon.config.moveSpeedMultiplier : 1;

    this.move.update(
      dt, nowMs,
      { forward, strafe, jumpPressed, slideHeld, shiftPressedAtMs: this.shiftPressedAtMs },
      this.cam.yaw, this.arena.colliders, adsSlow,
    );
    if (this.move.events.justWallKicked) this.lastWallKickMs = nowMs;

    // camera pose
    const b = this.move.body;
    this.camera.position.set(b.x, b.y + this.cam.eyeHeight(this.move.sliding), b.z);
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

    // targets
    for (const t of this.targets) t.update(nowMs, nowMs / 1000);

    // shooting
    const wantFire = this.weapon.config.boltAction ? this.triggerEdge : this.triggerHeld;
    if (this.playing && wantFire) {
      this.triggerEdge = false;
      if (this.weapon.canFireNow(nowMs)) this.fire(nowMs, precise);
      else if (this.weapon.ammoInMag <= 0 && !this.weapon.reloading) {
        this.combatFx.dryFire();
        this.weapon.startReload(nowMs);
        this.triggerEdge = false;
      }
    }

    this.mode.update(dt);
    this.combatFx.update(nowMs);

    // DOM @ ~15Hz (never per-substep full refresh)
    if (nowMs - this.lastHudMs > 66) {
      this.lastHudMs = nowMs;
      this.refreshHud(nowMs, precise, precisionMs);
    }
    this.debug.recordFrame(performance.now() - frameStart);
  }

  private fire(nowMs: number, precise: boolean): void {
    this.mode.registerShot();
    this.weapon.consumeShot(nowMs);

    const ads = this.weapon.adsActive;
    const spread = ads
      ? precise
        ? gameplayConfig.adsSpreadDeg
        : this.weapon.config.hipSpreadDeg * 0.45
      : Math.max(gameplayConfig.hipfireSpreadDeg, this.weapon.config.hipSpreadDeg);

    const origin = this.camera.position.clone();
    const dir = HitDetection.applySpread(this.cam.forwardDir(), spread);
    const res = this.hits.resolve(origin, dir, 220, this.targets, this.arena.solidMeshes);

    this.cam.kickRecoil(this.weapon.config.recoilKick);
    this.gunKick = 1;
    this.combatFx.shot();
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
      if (res.headshot) this.combatFx.headHit();
      else this.combatFx.bodyHit();
      this.skillFx.show(skills, res.headshot);
      this.combatFx.impact(res.point, res.headshot ? 0xffd60a : 0x00f0ff);
    } else {
      this.mode.registerMiss();
      if (res.blocked) this.combatFx.impact(res.point);
    }
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
    this.elStats.innerHTML =
      `SHOTS <b>${s.shots}</b> · HITS <b>${s.hits}</b> · ACC <b>${acc}%</b><br/>` +
      `HEADSHOTS <b>${s.headshots}</b> · SCORE <b>${s.skillScore}</b>`;

    const adsMs = this.playing ? w.adsElapsedMs(nowMs) : 0;
    this.debug.updateStats(
      `<div class="stat"><span>grounded</span><b>${this.move.body.grounded}</b></div>` +
      `<div class="stat"><span>state</span><b>${st}</b></div>` +
      `<div class="stat"><span>sliding</span><b>${this.move.sliding}</b></div>` +
      `<div class="stat"><span>ADS</span><b>${w.adsActive} (${adsMs.toFixed(0)}/${precisionMs}ms)</b></div>` +
      `<div class="stat"><span>precision</span><b>${precise}</b></div>` +
      `<div class="stat"><span>speed</span><b>${this.move.horizontalSpeed().toFixed(2)} m/s</b></div>` +
      `<div class="stat"><span>vy</span><b>${this.move.body.vy.toFixed(2)}</b></div>` +
      `<div class="stat"><span>weapon</span><b>${w.currentId} ${w.ammoInMag}/${w.config.magazineSize}</b></div>`,
    );

    this.elCenter.textContent =
      !this.playing ? "" : !this.pointerLocked ? "CLICK TO RE-ENGAGE POINTER LOCK" : "";
    void nowMs;
  }
}
