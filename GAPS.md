# Afterburn: Gap Analysis

This project is a playable browser PvP prototype. Compared with more serious air-combat games like War Thunder or Battlefield, the biggest remaining gaps are in flight physics, weapons, damage modeling, feedback, visual fidelity, and production robustness.

## Major Gaps

### Flight Model

The current flight model is still mostly arcade movement along the aircraft forward vector. A more serious dogfighting game needs lift, drag, gravity, stall behavior, energy retention, turn-rate limits by speed, control surface authority, inertia, and meaningful differences between pitch, roll, yaw, and throttle.

### Weapon Systems

Weapons need more physical behavior. Guns should support ballistic travel, convergence, spread, tracer cadence, muzzle offsets, lead computation, and impact feedback. Missiles need seeker behavior, arming distance, turn-rate limits, lock tones, aspect/heat strength, flare probability, and clearer countermeasure logic.

### Damage Model

The current damage model is health-based. A more serious game needs location/module damage: engine damage, wing damage, control surface failure, fuel/fire, smoke, degraded handling, and distinct kill states.

### Networking Polish

The server is authoritative, and the client now has local aircraft prediction, smoothed reconciliation, server-time snapshot interpolation for remote/world state, adaptive jitter buffering, reconnect rejoin support, reconnect grace on the server, detailed RTT/snapshot/prediction telemetry, and stricter socket payload handling. Serious PvP still needs lag-compensated combat validation, packet-loss/load testing, bandwidth optimization, deeper server-side validation, and better behavior at very high cross-region latency.

### Feedback And Game Feel

The game now has initial synthesized audio for engine thrust, afterburner, weapons, missile warnings, lock tones, hits, damage, kills, and explosions. The remaining gap is higher-fidelity authored audio, spatial mixing, near-miss cues, screen/camera shake, damage direction, smoke, fire, and debris.

### Visual Fidelity

The visuals are procedural and stylized. Higher fidelity would require authored aircraft models, better materials, improved shadows, terrain LOD, atmospheric haze, improved water, volumetric-style clouds, contrails, vapor trails, debris, and better scale cues.

### Aircraft Identity

All aircraft are currently functionally similar. Serious air combat needs aircraft classes with different acceleration, top speed, climb, turn rate, durability, weapon loadouts, missile capability, gun placement, and handling.

### Modes And Objectives

Free-for-all sandbox is useful for testing, but serious multiplayer needs team modes, capture points, ticket bleed, air superiority, ground attack objectives, spawn waves, match flow, and spectator support.

### UI And HUD Depth

The HUD needs more combat instrumentation: airspeed ladder, altitude ladder, heading tape, throttle/afterburner state, angle-of-attack or stall warning, weapon selected, ammo, target box, target range, closure rate, lead-computed gunsight, threat direction, and missile state.

### Production Features

The game still needs settings, input rebinding, joystick/gamepad support, graphics options, accessibility checks, deployment hardening, room lifecycle cleanup, anti-cheat basics, production metrics, and telemetry.

## Highest-Leverage Next Steps

1. Replace the pure forward-vector movement with a lightweight energy-based flight model.
2. Add a proper lead-computed gunsight and make guns converge toward the aim point.
3. Improve missile behavior with stronger lock feedback, flare probability, arming distance, and turn limits.
4. Add module-like damage states for engine, wings, and controls.
5. Upgrade the initial synthesized audio into authored/spatialized audio with near-miss and damage-direction cues.
6. Improve aircraft model readability and terrain collision fidelity.
7. Add team mode and clearer round structure.

## Implementation Principle

The next realism pass should improve physical readability without trying to become a full simulator. The target is still browser-friendly arcade dogfighting: believable energy, readable weapons, obvious feedback, and stable multiplayer behavior.
