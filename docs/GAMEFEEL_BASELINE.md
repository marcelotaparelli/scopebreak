# SCOPEBREAK — Game Feel Baseline (v1, playable)

Data: 2026-09-27. NÃO alterar sem evidência. Comparar qualquer mudança futura contra estes valores.

## Movement (`src/config/movementConfig.ts`)
- runSpeed: 9.0
- groundAcceleration: 70 / groundDeceleration: 55 / groundFriction: 9.5
- jumpForce: 8.2 / gravity: 23
- airAcceleration: 32 / airControl: 0.85 / maxAirSpeed: 16 (soft cap com decay, sem 180 instantâneo)
- slide: minSpeed 3.5, friction 1.6, control 0.45, boost 1.12, momentumRetention 0.92, cooldown 250ms
- slideJump: horizontal x1.07, vertical 8.6
- flowLanding: janela 200ms, retention 0.95
- wallKick: horizontal 10.5, vertical 7.5, range 1.6
- feel: baseFov 92, adsFovViper 32, speedFovGain 8

## Viper (`src/config/weaponConfigs.ts`)
- boltAction: true / mag 5 / cooldown 1050ms / reload 2100ms (non-blocking, movimento livre)
- adsMs: 130 / body 80 / head 150 (head kill 100hp, body não)
- hipSpread 5.5° / moveMult ADS 0.92 / recoil 2.2° / scopeFov 32

## ADS / Quickscope (`src/config/gameplayConfig.ts` + `Game.ts:fire`)
- precisionWindowMs: 100; efetivo Viper = max(100, 130) = 130ms
- spread atual (binário, preservado como referência):
  - hip: max(5.5, 5.5) = 5.5°
  - ADS em transição: hip*0.45 = 2.475°
  - ADS preciso (>=130ms): 0.0°
- quickscope feel: pre-aim com crosshair comum → RMB (ADS) → LMB rápido = precisão sem ficar scoped.
  Full precision ocorre antes do scope visual completar (FOV damp 14/s no ADS).
- crosshair alignment: `setAds()` nunca toca yaw/pitch; raio usa `cam.forwardDir()` — scope aparece centrado no ponto do pre-aim. Garantia essencial p/ quickscope por habilidade.

## Câmera / Sensação
- sensibilidade 0.0023, ADS x0.55; recoil com recovery damp 9/s; FOV speed kick até +8.
- slide roll -0.07, strafe lean -0.02.

## Regra de ouro
Game feel atual > números teóricos. Mudanças em slide/jump/air-strafe/ADS/quickscope só com justificativa documentada.
