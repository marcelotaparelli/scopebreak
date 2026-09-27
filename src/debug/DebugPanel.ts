import { gameplayConfig } from "../config/gameplayConfig.js";
import { movementConfig } from "../config/movementConfig.js";
import { weaponConfigs, weaponOrder } from "../config/weaponConfigs.js";
import type { MovementController } from "../player/MovementController.js";
import type { WeaponController } from "../weapons/WeaponController.js";

/** Collapsible runtime tuning panel. Mutates the live config objects. */
export class DebugPanel {
  private root: HTMLElement;
  private statsEl: HTMLElement;
  private fpsSamples: number[] = [];

  constructor(
    private move: MovementController,
    private weapon: WeaponController,
  ) {
    this.root = document.createElement("div");
    this.root.id = "debug-panel";
    this.root.className = "hidden";
    document.getElementById("app")?.appendChild(this.root);

    const toggle = document.createElement("button");
    toggle.id = "debug-toggle";
    toggle.textContent = "DEBUG [F1]";
    toggle.onclick = (): void => {
      this.root.classList.toggle("hidden");
    };
    document.getElementById("app")?.appendChild(toggle);
    window.addEventListener("keydown", (e) => {
      if (e.code === "F1") {
        e.preventDefault();
        this.root.classList.toggle("hidden");
      }
    });

    this.statsEl = document.createElement("div");
    this.build();
  }

  private num(
    section: HTMLElement,
    label: string,
    get: () => number,
    set: (v: number) => void,
    min: number,
    max: number,
    step: number,
  ): void {
    const row = document.createElement("div");
    row.className = "row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const val = document.createElement("span");
    val.className = "val";
    val.textContent = String(get());
    input.oninput = (): void => {
      const v = Number(input.value);
      set(v);
      val.textContent = String(v);
    };
    row.append(lab, input, val);
    section.appendChild(row);
  }

  private section(title: string): HTMLElement {
    const h = document.createElement("h3");
    h.textContent = title;
    this.root.appendChild(h);
    const div = document.createElement("div");
    this.root.appendChild(div);
    return div;
  }

  private build(): void {
    const m = this.section("MOVEMENT");
    const mc = (): typeof movementConfig => this.move.cfg;
    this.num(m, "runSpeed", () => mc().runSpeed, (v) => (mc().runSpeed = v), 4, 14, 0.1);
    this.num(m, "groundAccel", () => mc().groundAcceleration, (v) => (mc().groundAcceleration = v), 10, 140, 1);
    this.num(m, "groundDecel", () => mc().groundDeceleration, (v) => (mc().groundDeceleration = v), 5, 120, 1);
    this.num(m, "groundFriction", () => mc().groundFriction, (v) => (mc().groundFriction = v), 0, 20, 0.1);
    this.num(m, "jumpForce", () => mc().jumpForce, (v) => (mc().jumpForce = v), 4, 14, 0.1);
    this.num(m, "gravity", () => mc().gravity, (v) => (mc().gravity = v), 10, 40, 0.5);

    const a = this.section("AIR");
    this.num(a, "airAccel", () => mc().airAcceleration, (v) => (mc().airAcceleration = v), 5, 80, 1);
    this.num(a, "airControl", () => mc().airControl, (v) => (mc().airControl = v), 0, 1.5, 0.05);
    this.num(a, "maxAirSpeed", () => mc().maxAirSpeed, (v) => (mc().maxAirSpeed = v), 8, 26, 0.5);

    const s = this.section("SLIDE");
    this.num(s, "minSlideSpeed", () => mc().minimumSlideSpeed, (v) => (mc().minimumSlideSpeed = v), 0, 8, 0.1);
    this.num(s, "boostTarget", () => mc().slideBoostTargetSpeed, (v) => (mc().slideBoostTargetSpeed = v), 9, 16, 0.1);
    this.num(s, "boostStrength", () => mc().slideBoostStrength, (v) => (mc().slideBoostStrength = v), 0, 1, 0.05);
    this.num(s, "slideFriction", () => mc().slideFriction, (v) => (mc().slideFriction = v), 0, 6, 0.05);
    this.num(s, "slideSteering", () => mc().slideControl, (v) => (mc().slideControl = v), 0, 1, 0.05);
    this.num(s, "momentumRet", () => mc().momentumRetention, (v) => (mc().momentumRetention = v), 0.5, 1, 0.01);
    this.num(s, "slideHeight", () => mc().slideHeight, (v) => (mc().slideHeight = v), 0.8, 1.6, 0.05);
    this.num(s, "slideCamMs", () => mc().slideCameraTransitionMs, (v) => (mc().slideCameraTransitionMs = v), 40, 400, 10);
    this.num(s, "maxMoveSpeed", () => mc().maxMovementSpeed, (v) => (mc().maxMovementSpeed = v), 12, 30, 0.5);

    const sj = this.section("SLIDE JUMP / FLOW / WALL");
    this.num(sj, "sjMomentumRet", () => mc().slideJumpMomentumRetention, (v) => (mc().slideJumpMomentumRetention = v), 0.9, 1.05, 0.01);
    this.num(sj, "sjVertForce", () => mc().slideJumpVerticalForce, (v) => (mc().slideJumpVerticalForce = v), 3, 14, 0.1);
    this.num(sj, "flowWindowMs", () => mc().flowLandingWindowMs, (v) => (mc().flowLandingWindowMs = v), 50, 500, 10);
    this.num(sj, "flowRet", () => mc().flowLandingRetention, (v) => (mc().flowLandingRetention = v), 0.5, 1, 0.01);
    this.num(sj, "wallHoriz", () => mc().wallKickHorizontalImpulse, (v) => (mc().wallKickHorizontalImpulse = v), 4, 18, 0.5);
    this.num(sj, "wallVert", () => mc().wallKickVerticalImpulse, (v) => (mc().wallKickVerticalImpulse = v), 3, 14, 0.5);

    const w = this.section("WEAPON (applies to all)");
    this.num(w, "precisionMs", () => gameplayConfig.precisionWindowMs, (v) => (gameplayConfig.precisionWindowMs = v), 0, 400, 5);
    this.num(w, "hipSpread", () => gameplayConfig.hipfireSpreadDeg, (v) => (gameplayConfig.hipfireSpreadDeg = v), 0, 12, 0.1);
    for (const id of weaponOrder) {
      const cfg = weaponConfigs[id];
      this.num(w, `${id}.body`, () => cfg.bodyDamage, (v) => (cfg.bodyDamage = v), 10, 120, 1);
      this.num(w, `${id}.head`, () => cfg.headDamage, (v) => (cfg.headDamage = v), 20, 200, 1);
      this.num(w, `${id}.cooldown`, () => cfg.fireCooldownMs, (v) => (cfg.fireCooldownMs = v), 100, 2500, 10);
      this.num(w, `${id}.adsMs`, () => cfg.adsMs, (v) => (cfg.adsMs = v), 40, 500, 10);
    }

    const q = this.section("QUICKSCOPE / SNAP");
    this.num(q, "quickShotBufferMs", () => gameplayConfig.quickShotBufferMs, (v) => (gameplayConfig.quickShotBufferMs = v), 0, 250, 5);
    this.num(q, "snapSpread", () => gameplayConfig.adsSpreadDeg, (v) => (gameplayConfig.adsSpreadDeg = v), 0, 2, 0.05);
    this.num(q, "fullAdsReadyMs", () => gameplayConfig.precisionWindowMs, (v) => (gameplayConfig.precisionWindowMs = v), 0, 400, 5);
    for (const id of weaponOrder) {
      const cfg = weaponConfigs[id];
      this.num(q, `${id}.snapMs`, () => cfg.snapPrecisionMs, (v) => (cfg.snapPrecisionMs = v), 0, 250, 5);
    }

    const st = this.section("STATE");
    st.appendChild(this.statsEl);
  }

  recordFrame(dtMs: number): void {
    this.fpsSamples.push(dtMs);
    if (this.fpsSamples.length > 40) this.fpsSamples.shift();
  }

  updateStats(html: string): void {
    const avg = this.fpsSamples.length > 0
      ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
      : 16;
    const fps = avg > 0 ? Math.round(1000 / avg) : 0;
    this.statsEl.innerHTML =
      `<div class="stat"><span>FPS</span><b>${fps}</b></div>` + html;
  }
}
