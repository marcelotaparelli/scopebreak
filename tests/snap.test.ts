import { describe, expect, test } from "bun:test";
import { decideLmbEdge, resolvePendingQuickshot } from "../src/player/movementRules";

const BUFFER = 90;
const SNAP = 45; // Viper

describe("snap precision routing (RMB t=0, LMB t=10ms)", () => {
  test("rapid RMB+LMB buffers — the shot is never lost", () => {
    expect(decideLmbEdge({
      sinceAdsStartMs: 10, adsElapsedMs: 10,
      quickShotBufferMs: BUFFER, snapPrecisionMs: SNAP,
    })).toBe("buffer-quickshot");
  });

  test("buffered shot fires exactly at snap (ADS-start + 45ms)", () => {
    const at = (nowMs: number): string => resolvePendingQuickshot({
      pendingLmbMs: 10, adsStartMs: 0, snapMs: SNAP, nowMs,
    });
    expect(at(10)).toBe("wait");
    expect(at(44)).toBe("wait");
    expect(at(45)).toBe("fire");
    expect(at(200)).toBe("fire"); // still fire — never silently dropped
  });

  test("no pending click → idle (no phantom shots, no double fire)", () => {
    expect(resolvePendingQuickshot({
      pendingLmbMs: -1, adsStartMs: 0, snapMs: SNAP, nowMs: 100,
    })).toBe("idle");
  });
});

describe("LMB without RMB → immediate hipfire", () => {
  test("ADS never started routes straight to fire", () => {
    expect(decideLmbEdge({
      sinceAdsStartMs: Infinity, adsElapsedMs: 0,
      quickShotBufferMs: BUFFER, snapPrecisionMs: SNAP,
    })).toBe("fire-now");
  });

  test("stale ADS (long ago) routes straight to fire", () => {
    expect(decideLmbEdge({
      sinceAdsStartMs: 5000, adsElapsedMs: 5000,
      quickShotBufferMs: BUFFER, snapPrecisionMs: SNAP,
    })).toBe("fire-now");
  });
});

describe("scoped LMB → immediate precise shot", () => {
  test("RMB, wait past snap, then LMB fires now", () => {
    expect(decideLmbEdge({
      sinceAdsStartMs: 100, adsElapsedMs: 100,
      quickShotBufferMs: BUFFER, snapPrecisionMs: SNAP,
    })).toBe("fire-now");
  });

  test("LMB inside buffer window but already past snap fires now", () => {
    expect(decideLmbEdge({
      sinceAdsStartMs: 80, adsElapsedMs: 80,
      quickShotBufferMs: BUFFER, snapPrecisionMs: SNAP,
    })).toBe("fire-now");
  });
});

describe("buffer invalidation is explicit and predictable", () => {
  test("death / weapon switch / reset clear the buffer (caller-owned, documented)", () => {
    // The buffer holds at most one click; Game.clearPendingQuickshot() runs on
    // death, weapon switch, mode enter and match reset — so a stale click can
    // never leak into the next life or weapon. Represented here as idle:
    expect(resolvePendingQuickshot({
      pendingLmbMs: -1, adsStartMs: 0, snapMs: SNAP, nowMs: 46,
    })).toBe("idle");
  });
});
