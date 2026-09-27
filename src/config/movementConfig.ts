// Central movement tuning. All magic numbers live here so game feel
// can be iterated in one place (and live-tuned via the debug panel).

export interface MovementConfig {
  runSpeed: number;
  groundAcceleration: number;
  groundDeceleration: number;
  groundFriction: number;
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
  slideBoost: number; // multiplier applied to entry speed on slide start
  momentumRetention: number; // fraction of horizontal speed kept on slide exit
  slideCooldownMs: number;
  // slide jump
  slideJumpHorizontalMultiplier: number;
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
}

export const movementConfig: MovementConfig = {
  runSpeed: 9.0,
  groundAcceleration: 70,
  groundDeceleration: 55,
  groundFriction: 9.5,
  jumpForce: 8.2,
  gravity: 23,

  airAcceleration: 32,
  airControl: 0.85,
  maxAirSpeed: 16,

  minimumSlideSpeed: 3.5,
  slideFriction: 1.6,
  slideControl: 0.45,
  slideBoost: 1.12,
  momentumRetention: 0.92,
  slideCooldownMs: 250,

  slideJumpHorizontalMultiplier: 1.07,
  slideJumpVerticalForce: 8.6,

  flowLandingWindowMs: 200,
  flowLandingRetention: 0.95,

  wallKickHorizontalImpulse: 10.5,
  wallKickVerticalImpulse: 7.5,
  wallKickRange: 1.6,

  baseFov: 92,
  adsFovViper: 32,
  speedFovGain: 8,
};
