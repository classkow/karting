# AGENTS.md

> Instructions for AI coding agents working in the Karting repository.
> This file is the project-level equivalent of a README for automated contributors:
> it documents the build, the conventions, and the landmines encountered in this codebase.
> Human-facing quick start lives in README.md; this file covers what agents additionally need.

## 1. Project overview

Karting is an interactive 3D explainer of kart mechanical principles and a
playable track mode (solo practice + 3-kart races vs AI). Everything is
generated at runtime with Three.js 0.169.0 (pinned) — zero model files, zero
texture files, single-file build output that opens offline via `file://`.

- **Live site**: <https://classkow.github.io/karting/>
- **Repository root**: this directory
- **Deployment**: GitHub Pages, auto-deployed by CI on every push to `main`
- **Non-negotiable product principle**: real physical behaviour. Kinematics
  and vehicle dynamics are solved, not animated; every displayed quantity is
  traceable to a physical model. When "game feel" and "physical realism"
  conflict, realism wins — and the trade-off must be documented in the PR/commit.

## 2. Setup commands

Requirements: Node.js 24 (CI runs Node 24; the Windows dev box matches).

```sh
# 1. Install dependencies.
npm install

# 2. Day-to-day commands (all four are the release gate; run them all).
npm test          # node --test over an EXPLICIT list of test files (see §5)
npm run lint      # eslint, zero warnings tolerated
npm run build     # vite build → dist/index.html (single inlined file)
npm run smoke     # zero-dependency headless-Chrome E2E (CDP), needs local Chrome/Edge
```

Notes:

- `npm test` enumerates test files one by one. **Never replace the explicit
  list with `node --test tests/`** — directory form misresolves on this
  Windows setup (verified: exits with an error). When adding a test file,
  append it to the `test` script in `package.json`.
- `npm run smoke` spawns its own headless Chrome via CDP (ports and profile
  dir are pid-unique, so parallel runs don't collide). It needs a Chrome or
  Edge binary at the standard install paths or via `CHROME_PATH`.
- The build must stay a single self-contained HTML file
  (`vite-plugin-singlefile`). Do not add runtime dependencies that fetch
  remote assets; the site must keep working offline from `file://`.

## 3. Project structure

```text
index.html            Page shell: top bar, panels, HUD/menu containers (all divs start hidden)
src/
  main.js             Entry: boots createApp(), owns the ?debug=1 diagnostic overlay
  app.js              Assembly + main loop + mode switching (showroom ↔ track)
                      Dependency rule: app → {core, kart, sim, interaction, ui};
                      kart/ and sim/ must never import from interaction/ or ui/.
  core/               stage.js (scene/lights/world-mode switch) · postfx.js ·
                      textures.js (all canvas-generated) · trackScene.js (track world) ·
                      audio.js (WebAudio-synthesised engine + driving sounds) · fpsGuard.js
  kart/               builder.js (assembles the kart) · registry.js (parts + frame-order
                      update registry) · layout.js (SINGLE SOURCE OF TRUTH for geometry
                      constants) · materials.js · parts/*.js (one file per system)
                      · parts/driver.js (track-mode-only seated driver, NOT in registry)
  sim/                Pure math, zero rendering deps, node --test'able:
                      state.js (rpm state machine) · kinematics.js (mechanism kinematics,
                      RED LINE: do not modify) · cycle.js (two-stroke gas exchange,
                      RED LINE) · track.js (spline track geometry) · driving.js (vehicle
                      dynamics: centrifugal clutch, tyre friction circle, drift) ·
                      ai.js (pure-pursuit AI, same physics as the player) · race.js
                      (grid / SAT collision / ranking) · touchInput.js (touch input shaping)
  interaction/        picking · explode · cameraRig · driveCamera · shortcuts.js
                      (dual-mode keyboard/touch input, per-input-source semantics)
  ui/                 panels.js · hud.js (track HUD) · trackMenu.js (mode menu/results)
                      · demoPlayer.js · demoScripts.js · icons.js
tests/                node --test suites, one per sim module (see §5)
scripts/smoke.mjs     Headless E2E gate (see §6)
docs/                 Git-ignored working documents (investigations, review notes)
missions/             Git-ignored task packets and delivery notes (workflow artifacts)
```

## 4. Architecture conventions (do not break these)

- **Frame order = registry order.** Parts register updaters in
  `registry.js`; the driving pose updater is registered last so the solved
  mechanism pose and the driving pose land in the same frame. Adding an
  updater means justifying its position in that order.
- **`layout.js` is the single source of geometry truth.** Never hardcode a
  distance that exists in `L` — import it (tie-rod length is derived, not
  stored). Changing a layout constant must update dependent tests.
- **Mechanism math red line**: `src/sim/kinematics.js`, `src/sim/cycle.js`,
  and `src/kart/parts/engine.js` implement the exhibition-mode mechanics and
  are frozen unless the task explicitly authorises a change. Verify with:
  `git diff HEAD -- src/sim/kinematics.js src/sim/cycle.js src/kart/parts/engine.js`
- **Input is single-channel.** Keyboard, touch buttons, and headless tests
  all go through `shortcuts.js` `press(dir, on, src)`. `src` distinguishes
  'key' (instant full brake — desktop legacy behaviour, frozen) from 'touch'
  (pedal travel). Never add a second input path.
- **Dual-mode semantics.** Showroom (exhibition) and track mode have
  separate key maps and CSS (`body.track-mode`). Showroom behaviour is
  historical and frozen; regressions there are release blockers.
- **HUD/DOM writes are throttled** (10Hz text, 30Hz canvas, on-change for
  counters). Keep it that way; mobile FPS depends on it.
- **Determinism where it matters.** Scene decoration uses a seeded LCG, not
  `Math.random()` (screenshots/smoke must be reproducible). Audio synthesis
  may use Math.random (not asserted on).

## 5. Testing instructions

- `tests/` mirrors `src/sim/`: one suite per pure-math module, plus
  `steering.test.js` (input-direction contract) and `touchInput.test.js`.
  The suites run through the explicit list in `package.json` — appending a
  new file to that list is part of adding the file.
- Physics assertions anchor to **explainable physical intervals** (e.g.
  brake deceleration under rear-axle adhesion ≤0.78g, top speed within the
  torque-curve window), not snapshot numbers. When adding a test, derive the
  bound in a comment; do not copy a measured value as an expectation without
  justification.
- **New-behaviour tests must fail before the fix** (red) and pass after
  (green); record both runs when fixing a bug. This is the project's
  counter-factual evidence discipline.
- `node --test` on Windows: always via the explicit file list (see §2).

## 6. Headless smoke gate (`scripts/smoke.mjs`)

- Structure: boot → showroom mechanism assertions (frozen set) → track mode
  (practice → race → exit) → mobile-viewport group (390×844 @3x, touch,
  Edge-Android UA, `?debug=1`) → "hidden class audit" (every element with
  the `hidden` class must actually compute `display: none`) → console-error
  sweep. Exit code non-zero = failed.
- Assert **behaviour, not existence**: "the element is in the DOM" is not a
  pass condition — press the button / pump the physics / measure the rect.
  Mobile-viewport assertions include overlap checks (bounding-box
  intersection between HUD elements) and real input-path checks
  (PointerEvent → sim state).
- The smoke rig pumps frames via `__kart.step(dt, n)` instead of waiting for
  rAF (headless Chrome does not drive rAF at natural rate). Any new
  assertion must work under this model.
- `__kart` (window handle) exposes `sim/driving/track/race/mode/driveKeys/
  enterTrack/exitTrack/step/drawCalls` for tests and debugging.
- `?debug=1` adds an on-screen diagnostic overlay (viewport/DPR/touch/
  WebGL2/mode/Edge version) for real-device triage. It ships in production.

## 7. Known pitfalls (learned the hard way — read before touching)

- **`node --test tests/` (directory form) is broken on this machine** —
  always keep the explicit file list in `package.json`.
- **`.hidden` is per-element CSS, not a utility class.** Every element that
  toggles a `hidden` class needs its own `X.hidden { display: none }` rule;
  the smoke "hidden audit" assertion enforces this. When adding a toggled
  overlay, add the rule and check the audit.
- **`backdrop-filter` is banned in track-mode UI.** On real mobile GPUs a
  full-screen backdrop-filter layer caused the compositor to drop the
  subtree (user-visible "frosted glass with nothing clickable"). Track HUD
  and menus use solid translucent backgrounds. See `docs/` investigation
  notes from 2026-09-12 (git-ignored) for the full case study.
- **`mergeGeometries` returns `null` (does not throw) when mixing indexed
  and non-indexed geometries** — the failure surfaces later at render time
  as a null dereference. Normalise with `toNonIndexed()` before merging.
- **`Object3D.clone(true)` JSON-ifies `userData`** — object references do
  not survive. Look children up by name (`getObjectByName`) after cloning;
  the AI kart clones and the driver rely on this.
- **Touch is a distinct input source, not a synthetic keyboard.** Brake on
  touch uses pedal travel (`sim/touchInput.js`); keyboard keeps instant
  full brake. If you touch the input layer, run both contract tests and the
  smoke desktop-guard assertion.
- **Reverse gear is signed physics**: kinematic yaw rate uses signed `vz`
  (reversing steers "rear-first", per real vehicles). Do not "simplify"
  with `Math.abs(vz)` — that was the shipped bug this line replaced.
- **Auto-throttle defaults OFF on touch** (manual dual-pedal is the default
  experience); the preference persists in localStorage (`kart.autoThrottle`).
  Do not reintroduce always-on throttle.
- **Reverse-aux freeze guard**: braking during launch lock must never
  engage reverse assist (`driving.js` `reversing` requires `!launchLock`);
  the countdown lock test pins this.
- **Showroom regression is a release blocker.** The showroom smoke group
  (mechanism poses, kingpin jacking lift, demo player, exploded view) is the
  frozen baseline; if your change breaks any of it, the change is wrong.

## 8. Commit discipline

- Commit messages describe **what** changed, **why**, and **how it was
  verified** (name the gate numbers, e.g. "97/97 unit, 81/81 smoke, console
  clean"). They do not narrate the authoring process, mention any AI
  assistant or automation tool by name, or use first-person framing.
- Keep commits small and topic-coherent; do not bundle unrelated refactors
  into a feature commit.
- The author identity for automated commits is the account's GitHub
  noreply email.
- **Do not commit**: `dist/`, `docs/`, `missions/`, `.tmp/`, `.zcode/` —
  internal working documents and artifacts stay out of the public
  repository (all are git-ignored already; keep it that way).
- Gates before any commit: all four commands in §2 green, console-error
  sweep included. If a change alters an existing assertion, the old value's
  red-run evidence is part of the change (counter-factual discipline, §5).
