// Central movement tuning. All magic numbers live here so game feel
// can be iterated in one place (and live-tuned via the debug panel).

export interface MovementConfig {
  runSpeed: number;
  groundAcceleration: number;
  groundDeceleration: number;
  groundFriction: number;
  groundOverspeedDecay: number; // 1/s: excess above runSpeed bleeds off while running (no permanent ratchet)
  jumpForce: number;
  gravity: number;
  // air
  airAcceleration: number;
  airControl: number; // 0..1 fraction of wish applied per second curve
  maxAirSpeed: number; // soft cap for added air velocity
  // slide
  minimumSlideSpeed: number;
  slideFriction: number;
  slideControl: number; // steering authority while sliding (0..1)
  slideBoostTargetSpeed: number; // slide entry pulls speed toward this (never pulls down); above it = preserve
  slideBoostStrength: number; // 0..1 fraction of the gap to the target added on entry (diminishing returns)
  momentumRetention: number; // fraction of horizontal speed kept on slide exit
  slideCooldownMs: number;
  // slide jump (own takeoff: LOW + LONG, less vertical than a normal jump)
  slideJumpHorizontalMultiplier: number; // legacy ground-slide-hop factor (kept for compat)
  slideJumpMomentumRetention: number; // fraction of horizontal speed kept on slide-jump (0.95..1.0)
  slideJumpVerticalForce: number;
  // flow landing
  flowLandingWindowMs: number;
  flowLandingRetention: number;
  // wall kick
  wallKickHorizontalImpulse: number;
  wallKickVerticalImpulse: number;
  wallKickRange: number;
  // feel
  baseFov: number;
  adsFovViper: number;
  speedFovGain: number;
  // stance (slide must read as visibly LOW)
  standingHeight: number;
  slideHeight: number;
  standingEyeHeight: number;
  slideEyeHeight: number;
  slideCameraTransitionMs: number; // fast + smooth camera drop (no snap)
  // speed ceilings: tech may exceed runSpeed, exploits may not explode
  maxMovementSpeed: number; // ground safety cap, well above any legit chain
}

export const movementConfig: MovementConfig = {
  runSpeed: 9.0,
  groundAcceleration: 70,
  groundDeceleration: 55,
  groundFriction: 9.5,
  groundOverspeedDecay: 2.5,
  jumpForce: 8.2,
  gravity: 23,

  airAcceleration: 32,
  airControl: 0.85,
  maxAirSpeed: 18,

  minimumSlideSpeed: 3.5,
  slideFriction: 0.55,
  slideControl: 0.45,
  slideBoostTargetSpeed: 12.8,
  slideBoostStrength: 0.75,
  momentumRetention: 0.92,
  slideCooldownMs: 250,

  slideJumpHorizontalMultiplier: 1.07,
  slideJumpMomentumRetention: 0.98,
  slideJumpVerticalForce: 6.2,

  flowLandingWindowMs: 200,
  flowLandingRetention: 0.95,

  wallKickHorizontalImpulse: 10.5,
  wallKickVerticalImpulse: 7.5,
  wallKickRange: 1.6,

  baseFov: 92,
  adsFovViper: 32,
  speedFovGain: 8,

  standingHeight: 1.7,
  slideHeight: 1.15,
  standingEyeHeight: 1.62,
  slideEyeHeight: 0.95,
  slideCameraTransitionMs: 120,

  maxMovementSpeed: 22,
};
