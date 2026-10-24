/**
 * assets/src/board3d/meshes.js
 * Procedural Staunton chess piece geometries and beveled tournament chess board.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

export const SQUARE_SIZE = 1.0;
export const BOARD_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const BOARD_RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

/**
 * Converts algebraic square (e.g. 'e4') to 3D board position (Vector3).
 */
export function squareToVector3(square) {
  const file = square[0];
  const rank = square[1];
  const fileIdx = BOARD_FILES.indexOf(file);
  const rankIdx = BOARD_RANKS.indexOf(rank);

  // file 0..7 -> X: -3.5 .. +3.5
  const x = (fileIdx - 3.5) * SQUARE_SIZE;
  // rank 0..7 -> Z: -3.5 .. +3.5
  const z = (rankIdx - 3.5) * SQUARE_SIZE;
  return new BABYLON.Vector3(x, 0, z);
}

/**
 * Converts 3D world position back to algebraic square if inside board bounds.
 */
export function vector3ToSquare(vec) {
  const fileIdx = Math.round(vec.x / SQUARE_SIZE + 3.5);
  const rankIdx = Math.round(vec.z / SQUARE_SIZE + 3.5);
  if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
    return `${BOARD_FILES[fileIdx]}${BOARD_RANKS[rankIdx]}`;
  }
  return null;
}

/**
 * Builds the board squares, mahogany frame, side trays, and coordinate markers.
 */
export function createBoardMesh(scene, materials) {
  const root = new BABYLON.TransformNode('boardRoot', scene);
  const squareMeshes = new Map();

  // 1. 64 Individual Square tiles
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sqName = `${BOARD_FILES[f]}${BOARD_RANKS[r]}`;
      const isDark = (f + r) % 2 === 0; // standard a1 is dark
      const x = (f - 3.5) * SQUARE_SIZE;
      const z = (r - 3.5) * SQUARE_SIZE;

      const tile = BABYLON.MeshBuilder.CreateBox(
        `tile_${sqName}`,
        { width: SQUARE_SIZE * 0.992, depth: SQUARE_SIZE * 0.992, height: 0.15 },
        scene
      );
      tile.position.set(x, -0.075, z);
      tile.material = isDark ? materials.darkSquare : materials.lightSquare;
      tile.parent = root;
      tile.receiveShadows = true;
      tile.metadata = { square: sqName, isSquare: true };

      squareMeshes.set(sqName, tile);
    }
  }

  // 2. Mahogany Border Frame
  const frameWidth = 9.4;
  const frameHeight = 0.4;
  const frame = BABYLON.MeshBuilder.CreateBox(
    'boardFrame',
    { width: frameWidth, depth: frameWidth, height: frameHeight },
    scene
  );
  frame.position.set(0, -0.22, 0);
  frame.material = materials.frame;
  frame.parent = root;
  frame.receiveShadows = true;

  // 3. Side Capture Graveyard Trays
  const trayLeft = BABYLON.MeshBuilder.CreateBox(
    'trayLeft',
    { width: 1.8, depth: 8.6, height: 0.28 },
    scene
  );
  trayLeft.position.set(-5.8, -0.26, 0);
  trayLeft.material = materials.tray;
  trayLeft.parent = root;
  trayLeft.receiveShadows = true;

  const trayRight = BABYLON.MeshBuilder.CreateBox(
    'trayRight',
    { width: 1.8, depth: 8.6, height: 0.28 },
    scene
  );
  trayRight.position.set(5.8, -0.26, 0);
  trayRight.material = materials.tray;
  trayRight.parent = root;
  trayRight.receiveShadows = true;

  // 4. Subtle Brass Trim between squares and outer frame
  const trimInner = BABYLON.MeshBuilder.CreateBox(
    'trimInner',
    { width: 8.16, depth: 8.16, height: 0.16 },
    scene
  );
  trimInner.position.set(0, -0.082, 0);
  trimInner.material = materials.brass;
  trimInner.parent = root;

  // 5. Procedural Brass Coordinate Inlays (a-h, 1-8)
  createCoordinateLabels(root, scene, materials.brass);

  return { root, squareMeshes };
}

/**
 * Creates brass letters and numbers around the board border.
 */
function createCoordinateLabels(parent, scene) {
  const coordSize = 64;
  const chars = [...BOARD_FILES, ...BOARD_RANKS];

  chars.forEach((ch) => {
    const tex = new BABYLON.DynamicTexture(`coordTex_${ch}`, { width: coordSize, height: coordSize }, scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, coordSize, coordSize);
    ctx.fillStyle = '#eab308'; // warm brass gold
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, coordSize / 2, coordSize / 2);
    tex.update();
    tex.hasAlpha = true;

    const mat = new BABYLON.StandardMaterial(`coordMat_${ch}`, scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveColor = BABYLON.Color3.FromHexString('#d4af37');
    mat.disableLighting = true;

    if (BOARD_FILES.includes(ch)) {
      const idx = BOARD_FILES.indexOf(ch);
      const x = (idx - 3.5) * SQUARE_SIZE;
      // Bottom border
      const planeB = BABYLON.MeshBuilder.CreatePlane(`lbl_b_${ch}`, { size: 0.35 }, scene);
      planeB.rotation.x = Math.PI / 2;
      planeB.position.set(x, 0.005, -4.25);
      planeB.material = mat;
      planeB.parent = parent;

      // Top border
      const planeT = BABYLON.MeshBuilder.CreatePlane(`lbl_t_${ch}`, { size: 0.35 }, scene);
      planeT.rotation.x = Math.PI / 2;
      planeT.rotation.z = Math.PI;
      planeT.position.set(x, 0.005, 4.25);
      planeT.material = mat;
      planeT.parent = parent;
    } else {
      const idx = BOARD_RANKS.indexOf(ch);
      const z = (idx - 3.5) * SQUARE_SIZE;
      // Left border
      const planeL = BABYLON.MeshBuilder.CreatePlane(`lbl_l_${ch}`, { size: 0.35 }, scene);
      planeL.rotation.x = Math.PI / 2;
      planeL.position.set(-4.25, 0.005, z);
      planeL.material = mat;
      planeL.parent = parent;

      // Right border
      const planeR = BABYLON.MeshBuilder.CreatePlane(`lbl_r_${ch}`, { size: 0.35 }, scene);
      planeR.rotation.x = Math.PI / 2;
      planeR.rotation.z = Math.PI;
      planeR.position.set(4.25, 0.005, z);
      planeR.material = mat;
      planeR.parent = parent;
    }
  });
}

/**
 * Builds master Staunton meshes for each piece type.
 */
export function createPieceMasterMeshes(scene) {
  const masters = {};

  // Helper for lathe revolution
  const makeLathe = (name, shape, tessellation = 32) => {
    return BABYLON.MeshBuilder.CreateLathe(name, {
      shape,
      tessellation,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      cap: BABYLON.Mesh.CAP_ALL
    }, scene);
  };

  // 1. PAWN (Height ~ 1.15)
  {
    const shape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.32, 0, 0),
      new BABYLON.Vector3(0.33, 0.06, 0),
      new BABYLON.Vector3(0.28, 0.12, 0),
      new BABYLON.Vector3(0.23, 0.20, 0),
      new BABYLON.Vector3(0.18, 0.35, 0),
      new BABYLON.Vector3(0.14, 0.55, 0),
      new BABYLON.Vector3(0.13, 0.70, 0),
      new BABYLON.Vector3(0.20, 0.76, 0),
      new BABYLON.Vector3(0.21, 0.80, 0),
      new BABYLON.Vector3(0.15, 0.84, 0),
      new BABYLON.Vector3(0.13, 0.88, 0),
      new BABYLON.Vector3(0.19, 0.95, 0),
      new BABYLON.Vector3(0.21, 1.04, 0),
      new BABYLON.Vector3(0.16, 1.13, 0),
      new BABYLON.Vector3(0, 1.16, 0)
    ];
    const pawn = makeLathe('master_p', shape);
    pawn.setEnabled(false);
    masters.p = pawn;
  }

  // 2. ROOK (Height ~ 1.35) with crenelated battlements
  {
    const shape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.34, 0, 0),
      new BABYLON.Vector3(0.35, 0.06, 0),
      new BABYLON.Vector3(0.31, 0.12, 0),
      new BABYLON.Vector3(0.27, 0.22, 0),
      new BABYLON.Vector3(0.25, 0.40, 0),
      new BABYLON.Vector3(0.23, 0.65, 0),
      new BABYLON.Vector3(0.22, 0.90, 0),
      new BABYLON.Vector3(0.26, 0.98, 0),
      new BABYLON.Vector3(0.31, 1.05, 0),
      new BABYLON.Vector3(0.32, 1.30, 0),
      new BABYLON.Vector3(0.24, 1.30, 0),
      new BABYLON.Vector3(0.24, 1.16, 0),
      new BABYLON.Vector3(0, 1.16, 0)
    ];
    const tower = makeLathe('rook_body', shape);

    // 4 Turret battlement notches
    const crenellations = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const b = BABYLON.MeshBuilder.CreateBox(`cren_${i}`, { width: 0.12, depth: 0.12, height: 0.14 }, scene);
      b.position.set(Math.cos(angle) * 0.27, 1.32, Math.sin(angle) * 0.27);
      crenellations.push(b);
    }
    const rook = BABYLON.Mesh.MergeMeshes([tower, ...crenellations], true, true, undefined, false, true);
    rook.name = 'master_r';
    rook.setEnabled(false);
    masters.r = rook;
  }

  // 3. KNIGHT (Height ~ 1.48) sculpted Staunton horse
  {
    const baseShape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.34, 0, 0),
      new BABYLON.Vector3(0.35, 0.06, 0),
      new BABYLON.Vector3(0.31, 0.14, 0),
      new BABYLON.Vector3(0.26, 0.24, 0),
      new BABYLON.Vector3(0.24, 0.38, 0),
      new BABYLON.Vector3(0, 0.38, 0)
    ];
    const base = makeLathe('knight_base', baseShape);

    // Arched neck
    const neck = BABYLON.MeshBuilder.CreateCylinder('knight_neck', {
      height: 0.65,
      diameterTop: 0.32,
      diameterBottom: 0.42,
      tessellation: 16
    }, scene);
    neck.rotation.x = -0.32; // arch forward
    neck.position.set(0, 0.62, 0.06);

    // Horse Head & Muzzle
    const head = BABYLON.MeshBuilder.CreateBox('knight_head', {
      width: 0.26,
      height: 0.38,
      depth: 0.44
    }, scene);
    head.rotation.x = 0.42; // tilt down
    head.position.set(0, 1.05, -0.08);

    // Muzzle tip
    const snout = BABYLON.MeshBuilder.CreateBox('knight_snout', {
      width: 0.22,
      height: 0.22,
      depth: 0.26
    }, scene);
    snout.rotation.x = 0.48;
    snout.position.set(0, 0.88, -0.28);

    // Mane
    const mane = BABYLON.MeshBuilder.CreateBox('knight_mane', {
      width: 0.12,
      height: 0.65,
      depth: 0.22
    }, scene);
    mane.rotation.x = -0.32;
    mane.position.set(0, 0.72, 0.22);

    // Left and Right Ears
    const earL = BABYLON.MeshBuilder.CreateCylinder('knight_ear_l', {
      height: 0.18,
      diameterTop: 0.02,
      diameterBottom: 0.09,
      tessellation: 8
    }, scene);
    earL.rotation.x = -0.2;
    earL.rotation.z = -0.2;
    earL.position.set(-0.08, 1.30, 0.08);

    const earR = BABYLON.MeshBuilder.CreateCylinder('knight_ear_r', {
      height: 0.18,
      diameterTop: 0.02,
      diameterBottom: 0.09,
      tessellation: 8
    }, scene);
    earR.rotation.x = -0.2;
    earR.rotation.z = 0.2;
    earR.position.set(0.08, 1.30, 0.08);

    const knight = BABYLON.Mesh.MergeMeshes(
      [base, neck, head, snout, mane, earL, earR],
      true, true, undefined, false, true
    );
    knight.name = 'master_n';
    knight.setEnabled(false);
    masters.n = knight;
  }

  // 4. BISHOP (Height ~ 1.65) mitre teardrop & finial
  {
    const shape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.35, 0, 0),
      new BABYLON.Vector3(0.36, 0.06, 0),
      new BABYLON.Vector3(0.32, 0.12, 0),
      new BABYLON.Vector3(0.26, 0.22, 0),
      new BABYLON.Vector3(0.21, 0.40, 0),
      new BABYLON.Vector3(0.18, 0.65, 0),
      new BABYLON.Vector3(0.16, 0.90, 0),
      new BABYLON.Vector3(0.24, 0.98, 0),
      new BABYLON.Vector3(0.25, 1.04, 0),
      new BABYLON.Vector3(0.18, 1.08, 0),
      new BABYLON.Vector3(0.22, 1.15, 0),
      new BABYLON.Vector3(0.27, 1.30, 0),
      new BABYLON.Vector3(0.24, 1.46, 0),
      new BABYLON.Vector3(0.15, 1.56, 0),
      new BABYLON.Vector3(0.06, 1.60, 0),
      new BABYLON.Vector3(0.09, 1.66, 0),
      new BABYLON.Vector3(0, 1.72, 0)
    ];
    const bishop = makeLathe('master_b', shape);
    bishop.setEnabled(false);
    masters.b = bishop;
  }

  // 5. QUEEN (Height ~ 1.86) coronet & crown ball
  {
    const shape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.38, 0, 0),
      new BABYLON.Vector3(0.39, 0.06, 0),
      new BABYLON.Vector3(0.35, 0.14, 0),
      new BABYLON.Vector3(0.29, 0.26, 0),
      new BABYLON.Vector3(0.24, 0.45, 0),
      new BABYLON.Vector3(0.20, 0.75, 0),
      new BABYLON.Vector3(0.18, 1.05, 0),
      new BABYLON.Vector3(0.28, 1.14, 0),
      new BABYLON.Vector3(0.29, 1.20, 0),
      new BABYLON.Vector3(0.21, 1.25, 0),
      new BABYLON.Vector3(0.24, 1.34, 0),
      new BABYLON.Vector3(0.34, 1.60, 0),
      new BABYLON.Vector3(0.36, 1.72, 0),
      new BABYLON.Vector3(0.28, 1.72, 0),
      new BABYLON.Vector3(0.14, 1.68, 0),
      new BABYLON.Vector3(0.08, 1.74, 0),
      new BABYLON.Vector3(0.11, 1.80, 0),
      new BABYLON.Vector3(0, 1.88, 0)
    ];
    const queen = makeLathe('master_q', shape);
    queen.setEnabled(false);
    masters.q = queen;
  }

  // 6. KING (Height ~ 2.06) finial cross
  {
    const shape = [
      new BABYLON.Vector3(0, 0, 0),
      new BABYLON.Vector3(0.40, 0, 0),
      new BABYLON.Vector3(0.41, 0.06, 0),
      new BABYLON.Vector3(0.37, 0.15, 0),
      new BABYLON.Vector3(0.30, 0.28, 0),
      new BABYLON.Vector3(0.26, 0.50, 0),
      new BABYLON.Vector3(0.23, 0.85, 0),
      new BABYLON.Vector3(0.21, 1.20, 0),
      new BABYLON.Vector3(0.31, 1.30, 0),
      new BABYLON.Vector3(0.32, 1.36, 0),
      new BABYLON.Vector3(0.25, 1.42, 0),
      new BABYLON.Vector3(0.32, 1.48, 0),
      new BABYLON.Vector3(0.30, 1.54, 0),
      new BABYLON.Vector3(0.32, 1.66, 0),
      new BABYLON.Vector3(0.34, 1.80, 0),
      new BABYLON.Vector3(0.26, 1.92, 0),
      new BABYLON.Vector3(0.12, 1.95, 0),
      new BABYLON.Vector3(0, 1.98, 0)
    ];
    const kingBody = makeLathe('king_body', shape);

    // Cross finial
    const crossV = BABYLON.MeshBuilder.CreateBox('crossV', { width: 0.07, depth: 0.07, height: 0.24 }, scene);
    crossV.position.set(0, 2.06, 0);
    const crossH = BABYLON.MeshBuilder.CreateBox('crossH', { width: 0.19, depth: 0.07, height: 0.07 }, scene);
    crossH.position.set(0, 2.11, 0);

    const king = BABYLON.Mesh.MergeMeshes([kingBody, crossV, crossH], true, true, undefined, false, true);
    king.name = 'master_k';
    king.setEnabled(false);
    masters.k = king;
  }

  return masters;
}

/**
 * Creates an instance/clone of a piece for the board.
 */
export function instantiatePiece(type, color, id, masters, materials, shadowGen, scene) {
  const master = masters[type.toLowerCase()];
  if (!master) return null;

  const mesh = master.clone(`piece_${color}_${type}_${id}`);
  mesh.setEnabled(true);
  mesh.material = color === 'w' ? materials.whitePiece : materials.blackPiece;
  mesh.receiveShadows = true;

  // Face Knight towards opponent
  if (type.toLowerCase() === 'n') {
    mesh.rotation.y = color === 'w' ? 0 : Math.PI;
  }

  if (shadowGen) {
    shadowGen.addShadowCaster(mesh);
  }

  mesh.metadata = {
    pieceType: type.toLowerCase(),
    color,
    id,
    square: null,
    isPiece: true
  };

  return mesh;
}
