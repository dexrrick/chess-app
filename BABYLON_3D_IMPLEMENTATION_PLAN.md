# Babylon.js + Havok 3D Mode Implementation Plan (`chess-app`)

This document tracks the end-to-end design, implementation, and verification progress for the 3D mode in `chess-app`.

---

## 1. Architectural Guardrails & Invariants
- [x] **Branch Isolation**: Created feature branch `feature/babylon-3d-mode`. Do NOT merge to `main` until testing is 100% complete and approved by the user.
- [x] **Zero Core/Engine Regression**:
  - `assets/src/engine.js`, `assets/src/coach.js`, `assets/src/drills.js`, `assets/src/practice/*`, `assets/vendor/chess.js`, `assets/vendor/stockfish*`, and `src/index.js` remain completely untouched.
- [x] **Zero 2D (E-Ink) Regression**:
  - `assets/src/pieces.js` and existing 2D board DOM/CSS rules remain untouched.
  - Default mode is always `2d` on initial load; 0 bytes of Babylon/Havok assets downloaded until user toggles 3D.
- [x] **Lazy-Loaded 3D Isolation**:
  - Babylon.js and Havok WASM are only loaded via dynamic `import()` upon user switching to 3D.
- [x] **COOP/COEP Compliance**:
  - Vendored locally under `assets/vendor/babylon/` complying with strict Cross-Origin-Embedder-Policy.
- [x] **iPadOS & Mobile First-Class Support**:
  - Unified Pointer Events (`pointerdown`, `pointermove`, `pointerup`), `touch-action: none`, and hardware scaling capped at `2x` DPR.

---

## 2. Target File Structure

```text
assets/
├── index.html                        # [MODIFY] Add 2D/3D toggle button & #board-3d-container
├── style.css                         # [MODIFY] Append scoped [data-view-mode="3d"] UI styles only
├── app.js                            # [MODIFY] Add thin state-sync hook (~25 lines) for 3D bridge
├── sw.js                             # [MODIFY] Register runtime caching for /vendor/babylon/*
├── src/
│   └── board3d/                      # [NEW] Isolated 3D subsystem
│       ├── bridge.js                 # Mode lifecycle, lazy loader, 2D <-> 3D event synchronization
│       ├── scene.js                  # Babylon Engine, Camera, Lights, Shadows, Post-Processing
│       ├── physics.js                # Havok WASM initialization, board & piece PhysicsAggregates
│       ├── materials.js              # PBR materials (wood grain, marble, clearcoat, felt base)
│       ├── meshes.js                 # Procedural high-detail Staunton piece & beveled board builder
│       ├── animations.js             # Kinematic move arcs, physical capture impulses, king topple
│       └── input.js                  # iPad touch/drag raycasting, camera orbit lock, square highlights
└── vendor/
    └── babylon/                      # [NEW] Locally vendored ESM bundles
        ├── babylon.js
        ├── HavokPhysics_es.js
        └── HavokPhysics.wasm
```

---

## 3. Progress Tracking Checklist

### Phase 1: Vendoring Babylon.js & Havok Assets
- [x] Install `@babylonjs/core` and `@babylonjs/havok` in `devDependencies`.
- [x] Create `scripts/vendor-babylon.mjs` to bundle/vendor ESM entry points and `HavokPhysics.wasm` into `assets/vendor/babylon/`.
- [x] Verify `scripts/serve.mjs` and worker serve `.wasm` with `application/wasm`.
- [x] Checkpoint 1: Run `node worker-test.mjs` and `node smoke-test.mjs`.

### Phase 2: 2D / 3D UI Shell & Scoped Styling
- [x] `assets/index.html`: Add `#view-mode-toggle` in top bar and `<div id="board-3d-container" hidden aria-hidden="true"></div>`.
- [x] `assets/style.css`: Append scoped styles under `html[data-view-mode="3d"]` (dark glassmorphic theme, iPad responsiveness, `#board-3d-container` layout, hiding 2D board when in 3D).
- [x] Checkpoint 2: Run `node a11y-test.mjs` and `node smoke-test.mjs`.

### Phase 3: The 2D ↔ 3D Bridge (`bridge.js` & `app.js`)
- [x] Create `assets/src/board3d/bridge.js` with `createBoard3DBridge(appCallbacks)`.
  - LocalStorage persistence (`chess_view_mode`, default `'2d'`).
  - Switching to 3D: dynamic `import('./scene.js')`, mounts canvas, syncs FEN/turn/moves/highlights.
  - Switching to 2D: stops render loop, hides container, restores 2D board state.
- [x] In `assets/app.js`: Add thin state hooks (`board3d?.syncState(...)`, `board3d?.animateMove(...)`, callbacks `{ onSquareSelect, onMoveAttempt }`).
- [x] Checkpoint 3: Verify 2D/3D toggle preserves exact board state mid-game and during drills.

### Phase 4: High-Fidelity Graphics (`scene.js`, `materials.js`, `meshes.js`)
- [x] `scene.js`: Babylon Engine setup, Retina hardware scaling clamp (`Math.min(devicePixelRatio, 2)`), `ResizeObserver`, context loss/restore handling.
- [x] Camera: `ArcRotateCamera` with limits, inertia, and smooth flip transition between White/Black.
- [x] Lights & Shadows: Studio environment lighting, directional key light with PCF shadows.
- [x] `materials.js`: Satin maple light squares, walnut dark squares, mahogany beveled frame, boxwood white pieces, polished obsidian black pieces, emissive highlight rings.
- [x] `meshes.js`: High-detail procedural lathe Staunton pieces (Pawn, Rook turret, Bishop mitre, Queen coronet, King cross, Knight).

### Phase 5: Havok Physics & Dynamic Animations (`physics.js`, `animations.js`)
- [x] `physics.js`: Initialize Havok WASM from `/vendor/babylon/HavokPhysics.wasm`, static board/border colliders.
- [x] `animations.js`: Hybrid kinematic (`ANIMATED`) + rigid body (`DYNAMIC`).
  - Smooth move arcs with subtle landing bounce and clack audio.
  - Dynamic capture impulse: captured piece knocked off square into side tray/graveyard.
  - Checkmate: Defeated King transitions to dynamic and tips over.
  - Instant reset/sync for undos and new game.

### Phase 6: iPad Touch & Pointer Interaction (`input.js`)
- [x] Tap-to-select and tap-to-move square navigation.
- [x] Pointer drag-and-drop: temporary camera orbit unlock/lock, horizontal plane raycasting, piece levitation, hover square indicator.
- [x] Integration with pawn promotion dialog.

### Phase 7: Service Worker & Offline Caching (`sw.js`)
- [x] Keep 2D core precache untouched.
- [x] Add runtime cache rule for `/vendor/babylon/*` and `/src/board3d/*` (Cache-First).

### Phase 8: Comprehensive Verification & Acceptance Testing
- [x] Run full test suite:
  - `node worker-test.mjs`
  - `node engine-test.mjs`
  - `node coach-test.mjs`
  - `node drills-test.mjs`
  - `node sw-test.mjs`
  - `node smoke-test.mjs`
  - `node a11y-test.mjs`
  - `node test-3d-toggle.mjs`
  - `node e2e-test.mjs`
- [x] Add 3D-specific smoke & toggle tests in `test-3d-toggle.mjs` (registered in `test-all.mjs`).
- [ ] User review and manual sign-off before any merge.

---

## 4. Visual & Physics Refinement Log

### 1. Staunton Geometry & Orientation Refinements
- **Knight Orientation**: White Knights on b1/g1 now face $+Z$ (directly towards Black), and Black Knights on b8/g8 with `Math.PI` rotation face $-Z$ (directly towards White).
- **Knight Carving**: Replaced flat geometric boxes with contoured forward-arching neck, anatomical cheek masses, tapered muzzle, alert pricked ears, and fluted dorsal mane crest.
- **Pawn Proportions**: Refined lathe silhouette to classic 1849 Jacques of London Staunton proportions (radius 0.27 base, slender waist at 0.55, astragal double collar at 0.80, and spherical head at 0.99).
- **Rook**: Tower column with gentle concave taper, flared cornice, recessed stone floor, and 4 clean CSG-cut embrasures.
- **Bishop**: Slender waisted pedestal, dual astragal rings, teardrop flame mitre head, 45-degree CSG mitre cleft, and finial bead.
- **Queen**: Regal flared coronet with 8 CSG-cut fluted points around the rim and central royal orb.
- **King**: Triple royal collars, imperial dome crown, and stately Maltese cross finial.

### 2. Glare Elimination & PBR Materials
- **Board Tiles**: Disabled clearcoat on light/dark square tiles and tuned roughness to 0.44/0.40 for a luxury satin wood finish.
- **Lighting**: Disabled specular reflection on the cool rim backlight (`rimLight.specular = Color3(0, 0, 0)`), completely eliminating the white glare hotspot on the board.
- **Tournament Table**: Unified beveled mahogany tournament table (`#5c2b18`) with sunken tournament green felt capture trays (`#1a5330`) and brushed brass gold inlay borders (`#d4af37`).
- **Wood Tones**: White pieces in warm polished honey boxwood (`#f4e8d3`); Black pieces in warm roasted walnut / ebonized hardwood (`#3a261a`) with enhanced fill lighting.

### 3. Havok WASM Transform Sync & Physics Knockdown
- **WASM Transform Sync**: Configured `body.disablePreStep = false` and properly updated `rotationQuaternion` on `ANIMATED` (kinematic) piece bodies, resolving the Havok snapback issue.
- **Move Animation & Knockdown**:
  - Parabolic kinematic arcs with Web Audio wooden clack on touchdown.
  - At 60% of the move arc, `toppleCapturedPiece` triggers a dynamic Havok impulse that physically knocks the captured piece over and tumbles it towards the side felt tray.
  - Deduplicated `animateMove` calls and prevented premature `syncPiecesFromFen` from interrupting active move tweens.
  - Automatic disposal of old graveyard pieces upon starting a new game.

