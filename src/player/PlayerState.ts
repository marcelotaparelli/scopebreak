export type MoveState =
  | "running"
  | "grounded"
  | "airborne"
  | "sliding"
  | "slideJump"
  | "wallKick"
  | "flowLanding";

export interface PlayerSnapshot {
  grounded: boolean;
  sliding: boolean;
  airborne: boolean;
  ads: boolean;
  precisionReady: boolean;
  speed: number;
  horizontalSpeed: number;
  verticalSpeed: number;
  weaponId: string;
}

/** Single source of truth for mutually-exclusive movement classification. */
export function classifyState(o: {
  grounded: boolean;
  sliding: boolean;
  justSlideJumped: boolean;
  justWallKicked: boolean;
  justFlowLanded: boolean;
  airborne: boolean;
}): MoveState {
  if (o.sliding && o.grounded) return "sliding";
  if (o.justFlowLanded) return "flowLanding";
  if (o.justWallKicked) return "wallKick";
  if (o.justSlideJumped) return "slideJump";
  if (o.airborne || !o.grounded) return "airborne";
  return "grounded";
}
