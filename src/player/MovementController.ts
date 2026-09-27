import { movementConfig, type MovementConfig } from "../config/movementConfig.js";
import {
  airControlStep,
  applyMomentumRetention,
  canStartSlide,
  canWallKick,
  isFlowLanding,
  slideBoostSpeed,
  slideJumpTakeoff,
  slideJumpVelocity,
  slideSpeedAfter,
} from "./movementRules.js";
import { hasHeadroom, moveAndCollide, probeWalls, type AABB, type KinematicBody } from "../world/physics.js";

export interface MoveInput {
  forward: number; // -1..1 (W+)
  strafe: number; // -1..1 (D+)
  jumpPressed: boolean; // edge
  slideHeld: boolean;
  shiftPressedAtMs: number; // last Shift keydown timestamp
}

export interface MoveEvents {
  justSlideJumped: boolean;
  justWallKicked: boolean;
  justFlowLanded: boolean;
  wallKickNormal: { nx: number; nz: number } | null;
}

/**
 * Frame-rate independent kinematic FPS controller.
 * Owns NO DOM. All tuning comes from MovementConfig (live-mutable).
 */
export class MovementController {
  cfg: MovementConfig = movementConfig;
  body: KinematicBody = {
    x: 0, y: 0.1, z: 42, vx: 0, vy: 0, vz: 0,
    radius: 0.35, height: movementConfig.standingHeight, grounded: true,
  };
  sliding = false;
  wallKickedThisAirtime = false;
  slideCooldownUntilMs = 0;
  lastLandMs = -10_000;
  wasGrounded = true;
  events: MoveEvents = { justSlideJumped: false, justWallKicked: false, justFlowLanded: false, wallKickNormal: null };
  private slideDirX = 0;
  private slideDirZ = 0;

  reset(x: number, y: number, z: number): void {
    this.body = { x, y, z, vx: 0, vy: 0, vz: 0, radius: 0.35, height: this.cfg.standingHeight, grounded: true };
    this.sliding = false;
    this.wallKickedThisAirtime = false;
    this.slideCooldownUntilMs = 0;
    this.lastLandMs = -10_000;
    this.wasGrounded = true;
  }

  horizontalSpeed(): number {
    return Math.hypot(this.body.vx, this.body.vz);
  }

  update(dt: number, nowMs: number, input: MoveInput, yaw: number, colliders: AABB[], adsSlow: number): void {
    const cfg = this.cfg;
    const b = this.body;
    this.events.justSlideJumped = false;
    this.events.justWallKicked = false;
    this.events.justFlowLanded = false;
    this.events.wallKickNormal = null;

    const hSpeed = this.horizontalSpeed();

    // --- wish direction (camera-relative) ---
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // forward on ground plane for yaw: forward = (-sin, -cos)
    let wishX = -sin * input.forward + cos * input.strafe;
    let wishZ = -cos * input.forward - sin * input.strafe;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }
    const hasInput = wishLen > 0.01;

    const topSpeed = cfg.runSpeed * adsSlow;

    if (b.grounded) {
      // landing detection (was air, now ground contact kept from previous integrate)
      if (!this.wasGrounded) {
        this.wallKickedThisAirtime = false;
        this.lastLandMs = nowMs;
        // FLOW LANDING: Shift buffered before touchdown OR pressed just after
        const sinceShift = nowMs - input.shiftPressedAtMs;
        const sinceLand = 0;
        if (
          isFlowLanding({ timeSinceShiftMs: sinceShift, timeSinceLandMs: sinceLand, windowMs: cfg.flowLandingWindowMs }) &&
          (input.slideHeld || sinceShift <= cfg.flowLandingWindowMs) &&
          this.horizontalSpeed() >= cfg.minimumSlideSpeed * 0.6
        ) {
          this.startSlide(nowMs);
          this.events.justFlowLanded = true;
          // preserve momentum explicitly
          const s = this.horizontalSpeed();
          if (s > 0.01) {
            const k = cfg.flowLandingRetention / 1; // entry already boosted; keep
            b.vx *= k; b.vz *= k;
          }
        }
      }

      if (this.sliding) {
        // --- SLIDE: boosted entry, gentle decay, limited steering ---
        const sp = this.horizontalSpeed();
        const decayed = slideSpeedAfter(sp, cfg.slideFriction, dt);
        if (sp > 0.01) {
          const nx = b.vx / sp;
          const nz = b.vz / sp;
          // steer: blend slide dir toward wish
          const steer = cfg.slideControl * dt * (hasInput ? 1 : 0);
          let dx = nx + wishX * steer * 2.2;
          let dz = nz + wishZ * steer * 2.2;
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl; dz /= dl;
          b.vx = dx * decayed;
          b.vz = dz * decayed;
        }
        b.height = cfg.slideHeight;
        // exit conditions
        if (input.jumpPressed) {
          this.doSlideJump(nowMs);
        } else if (!input.slideHeld || decayed < 2.2) {
          this.endSlide(colliders);
        }
      } else {
        b.height = cfg.standingHeight;
        // --- slide entry FIRST: boost reads pre-frame momentum, before
        // accel/friction touch it (Shift must amplify current speed) ---
        const enteredSlide =
          input.slideHeld &&
          canStartSlide({
            grounded: true, alreadySliding: false, horizontalSpeed: hSpeed,
            minimumSlideSpeed: cfg.minimumSlideSpeed, cooldownRemainingMs: this.slideCooldownUntilMs - nowMs,
          });
        if (enteredSlide) this.startSlide(nowMs);
        // Shift+Space on the same frame: entry converts straight into takeoff
        if (input.jumpPressed && enteredSlide) {
          this.doSlideJump(nowMs);
        }
        // --- RUN: accelerate / friction (skipped while sliding) ---
        if (!this.sliding) {
          if (hasInput) {
            const cur = b.vx * wishX + b.vz * wishZ;
            const remaining = topSpeed - cur;
            if (remaining > 0) {
              const add = Math.min(cfg.groundAcceleration * dt, remaining);
              b.vx += wishX * add;
              b.vz += wishZ * add;
            }
            // extra handling: oppose perpendicular drift for crisp strafing
            const perpX = -wishZ;
            const perpZ = wishX;
            const lat = b.vx * perpX + b.vz * perpZ;
            const latFix = Math.min(Math.abs(lat), cfg.groundDeceleration * dt) * Math.sign(lat);
            b.vx -= perpX * latFix * 0.5;
            b.vz -= perpZ * latFix * 0.5;
          } else {
            const sp0 = this.horizontalSpeed();
            if (sp0 > 0) {
              const drop = Math.min(sp0, cfg.groundFriction * sp0 * dt + cfg.groundDeceleration * 0.25 * dt);
              b.vx *= (sp0 - drop) / sp0;
              b.vz *= (sp0 - drop) / sp0;
            }
          }
          // safety ceiling only: legit tech speed (slide chains) is preserved,
          // only impossible excess bleeds off — never clamp back to runSpeed.
          const gsp = this.horizontalSpeed();
          if (gsp > cfg.maxMovementSpeed) {
            const over = gsp - cfg.maxMovementSpeed;
            const bleed = Math.min(over, over * 3 * dt + 2 * dt);
            const k = (gsp - bleed) / gsp;
            b.vx *= k;
            b.vz *= k;
          }
          // jump
          if (input.jumpPressed) {
            b.vy = cfg.jumpForce;
            b.grounded = false;
          }
        }
      }
    } else {
      // --- AIRBORNE: gradual air strafe, no hard cap abuse ---
      // NOTE: excess air speed is never snapped to runSpeed — airControlStep
      // only decays it gently toward maxAirSpeed, so slide-jump momentum survives.
      b.height = cfg.standingHeight;
      if (this.sliding) this.endSlide(colliders);
      if (hasInput) {
        const r = airControlStep(b.vx, b.vz, wishX, wishZ, cfg.airAcceleration, cfg.airControl, cfg.maxAirSpeed, dt);
        b.vx = r.vx;
        b.vz = r.vz;
      }
      // wall kick
      if (input.jumpPressed) {
        const probe = probeWalls(b.x, b.y, b.z, b.radius, b.height, cfg.wallKickRange, colliders);
        if (
          probe.hit &&
          canWallKick({ airborne: true, wallAvailable: true, alreadyKickedThisAirtime: this.wallKickedThisAirtime })
        ) {
          b.vx = probe.nx * cfg.wallKickHorizontalImpulse + b.vx * 0.35;
          b.vz = probe.nz * cfg.wallKickHorizontalImpulse + b.vz * 0.35;
          b.vy = Math.max(b.vy + cfg.wallKickVerticalImpulse * 0.6, cfg.wallKickVerticalImpulse);
          this.wallKickedThisAirtime = true;
          this.events.justWallKicked = true;
          this.events.wallKickNormal = { nx: probe.nx, nz: probe.nz };
        }
      }
      // late flow-landing buffer is handled on touchdown
    }

    // gravity
    b.vy -= cfg.gravity * dt;
    if (b.vy < -30) b.vy = -30;

    // integrate + collide
    this.wasGrounded = b.grounded;
    moveAndCollide(b, dt, colliders);
    if (b.grounded && !this.wasGrounded) {
      // touchdown happened inside integrate; record + maybe flow-slide next frame via buffer
      this.lastLandMs = nowMs;
      this.wallKickedThisAirtime = false;
      // post-landing buffered slide (press Shift slightly after landing)
      // handled next frame through lastLandMs; also instant-check here:
      const sinceShift = nowMs - input.shiftPressedAtMs;
      if (
        input.slideHeld && sinceShift <= cfg.flowLandingWindowMs &&
        this.horizontalSpeed() >= cfg.minimumSlideSpeed * 0.6 &&
        nowMs >= this.slideCooldownUntilMs
      ) {
        this.startSlide(nowMs);
        this.events.justFlowLanded = true;
      }
    }
    if (!b.grounded && this.wasGrounded && b.vy > 0.1) {
      // left ground via jump — nothing extra
    }
  }

  /** Slide-jump takeoff: keep ~all horizontal momentum, own LOW vertical. */
  private doSlideJump(nowMs: number): void {
    const b = this.body;
    const cur = this.horizontalSpeed();
    const sj = slideJumpTakeoff(cur, this.cfg.slideJumpMomentumRetention, this.cfg.slideJumpVerticalForce);
    const sp2 = Math.hypot(b.vx, b.vz);
    if (sp2 > 0.01) {
      b.vx = (b.vx / sp2) * sj.horizontal;
      b.vz = (b.vz / sp2) * sj.horizontal;
    }
    b.vy = sj.vertical;
    b.grounded = false;
    this.sliding = false;
    b.height = this.cfg.standingHeight;
    this.events.justSlideJumped = true;
    this.slideCooldownUntilMs = nowMs + this.cfg.slideCooldownMs;
  }

  private startSlide(nowMs: number): void {
    const sp = this.horizontalSpeed();
    if (sp > 0.01) {
      // Boost along the REAL momentum direction (not the camera),
      // applied exactly once per entry — never per frame.
      const boosted = slideBoostSpeed(sp, this.cfg.slideBoost, this.cfg.minimumSlideBoostSpeed);
      this.slideDirX = this.body.vx / sp;
      this.slideDirZ = this.body.vz / sp;
      this.body.vx = this.slideDirX * boosted;
      this.body.vz = this.slideDirZ * boosted;
    }
    this.sliding = true;
    this.body.height = this.cfg.slideHeight;
    this.slideCooldownUntilMs = nowMs + this.cfg.slideCooldownMs * 0.4;
    void nowMs;
  }

  /**
   * Stand up only with headroom: under a low obstacle the player stays
   * low instead of clipping geometry. Returns true when standing.
   */
  private endSlide(colliders: AABB[]): boolean {
    if (!this.sliding) return true;
    const b = this.body;
    if (!hasHeadroom(b.x, b.y, b.z, b.radius, this.cfg.standingHeight, colliders)) {
      return false; // no space above — remain in low slide stance
    }
    this.sliding = false;
    b.height = this.cfg.standingHeight;
    const sp = this.horizontalSpeed();
    if (sp > 0.01) {
      const k = applyMomentumRetention(1, this.cfg.momentumRetention);
      b.vx *= k;
      b.vz *= k;
      void sp;
    }
    return true;
  }
}
