/**
 * assets/src/board3d/meshes.js
 * Clean Staunton chess pieces built with pure meshes (no CSG) and correct proportions.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

export const SQUARE_SIZE = 1.0;
export const BOARD_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const BOARD_RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];

export function squareToVector3(square) {
  const file = square[0];
  const rank = square[1];
  const fileIdx = BOARD_FILES.indexOf(file);
  const rankIdx = BOARD_RANKS.indexOf(rank);
  const x = (fileIdx - 3.5) * SQUARE_SIZE;
  const z = (rankIdx - 3.5) * SQUARE_SIZE;
  return new BABYLON.Vector3(x, 0, z);
}

export function vector3ToSquare(vec) {
  const fileIdx = Math.round(vec.x / SQUARE_SIZE + 3.5);
  const rankIdx = Math.round(vec.z / SQUARE_SIZE + 3.5);
  if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
    return `${BOARD_FILES[fileIdx]}${BOARD_RANKS[rankIdx]}`;
  }
  return null;
}

/**
 * Builds the tournament chess table.
 */
export function createBoardMesh(scene, materials) {
  const root = new BABYLON.TransformNode('boardRoot', scene);
  const squareMeshes = new Map();

  // 1. 64 Square Tiles
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sqName = `${BOARD_FILES[f]}${BOARD_RANKS[r]}`;
      const isDark = (f + r) % 2 === 0; // a1 is dark
      const x = (f - 3.5) * SQUARE_SIZE;
      const z = (r - 3.5) * SQUARE_SIZE;

      const tile = BABYLON.MeshBuilder.CreateBox(
        `tile_${sqName}`,
        { width: SQUARE_SIZE * 0.995, depth: SQUARE_SIZE * 0.995, height: 0.16 },
        scene
      );
      tile.position.set(x, -0.08, z);
      tile.material = isDark ? materials.darkSquare : materials.lightSquare;
      tile.parent = root;
      tile.receiveShadows = true;
      tile.metadata = { square: sqName, isSquare: true };

      squareMeshes.set(sqName, tile);
    }
  }

  // 2. Inner Brass Fillet Inlay Trim
  const innerTrim = BABYLON.MeshBuilder.CreateBox(
    'innerBrassTrim',
    { width: 8.16, depth: 8.16, height: 0.17 },
    scene
  );
  innerTrim.position.set(0, -0.086, 0);
  innerTrim.material = materials.brass;
  innerTrim.parent = root;

  // 3. Unified Tournament Table Base
  const table = BABYLON.MeshBuilder.CreateBox(
    'tournamentTable',
    { width: 12.0, depth: 9.6, height: 0.44 },
    scene
  );
  table.position.set(0, -0.23, 0);
  table.material = materials.frame;
  table.parent = root;
  table.receiveShadows = true;

  // 4. Recessed Tournament Felt Capture Trays
  const trayLeftFelt = BABYLON.MeshBuilder.CreateBox(
    'trayLeftFelt',
    { width: 1.5, depth: 8.3, height: 0.05 },
    scene
  );
  trayLeftFelt.position.set(-4.95, -0.06, 0);
  trayLeftFelt.material = materials.felt;
  trayLeftFelt.parent = root;
  trayLeftFelt.receiveShadows = true;

  const trayRightFelt = BABYLON.MeshBuilder.CreateBox(
    'trayRightFelt',
    { width: 1.5, depth: 8.3, height: 0.05 },
    scene
  );
  trayRightFelt.position.set(4.95, -0.06, 0);
  trayRightFelt.material = materials.felt;
  trayRightFelt.parent = root;
  trayRightFelt.receiveShadows = true;

  // Brass inner rims around the felt trays
  [-4.95, 4.95].forEach((tx, idx) => {
    const rim = BABYLON.MeshBuilder.CreateBox(
      `trayRim_${idx}`,
      { width: 1.58, depth: 8.38, height: 0.06 },
      scene
    );
    rim.position.set(tx, -0.07, 0);
    rim.material = materials.brass;
    rim.parent = root;
  });

  // 5. Crisp Brass Coordinate Labels
  createCoordinateLabels(root, scene);

  return { root, squareMeshes };
}

function createCoordinateLabels(parent, scene) {
  const coordSize = 64;
  const chars = [...BOARD_FILES, ...BOARD_RANKS];

  chars.forEach((ch) => {
    const tex = new BABYLON.DynamicTexture(`coordTex_${ch}`, { width: coordSize, height: coordSize }, scene, false);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, coordSize, coordSize);
    ctx.fillStyle = '#eab308';
    ctx.font = 'bold 46px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
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

      const planeB = BABYLON.MeshBuilder.CreatePlane(`lbl_b_${ch}`, { size: 0.32 }, scene);
      planeB.rotation.x = Math.PI / 2;
      planeB.position.set(x, 0.005, -4.22);
      planeB.material = mat;
      planeB.parent = parent;

      const planeT = BABYLON.MeshBuilder.CreatePlane(`lbl_t_${ch}`, { size: 0.32 }, scene);
      planeT.rotation.x = Math.PI / 2;
      planeT.rotation.z = Math.PI;
      planeT.position.set(x, 0.005, 4.22);
      planeT.material = mat;
      planeT.parent = parent;
    } else {
      const idx = BOARD_RANKS.indexOf(ch);
      const z = (idx - 3.5) * SQUARE_SIZE;

      const planeL = BABYLON.MeshBuilder.CreatePlane(`lbl_l_${ch}`, { size: 0.32 }, scene);
      planeL.rotation.x = Math.PI / 2;
      planeL.position.set(-4.22, 0.005, z);
      planeL.material = mat;
      planeL.parent = parent;

      const planeR = BABYLON.MeshBuilder.CreatePlane(`lbl_r_${ch}`, { size: 0.32 }, scene);
      planeR.rotation.x = Math.PI / 2;
      planeR.rotation.z = Math.PI;
      planeR.position.set(4.22, 0.005, z);
      planeR.material = mat;
      planeR.parent = parent;
    }
  });
}

/**
 * Staunton base profile
 */
function makeStauntonBase(rBase = 0.28) {
  return [
    new BABYLON.Vector3(0, 0, 0),
    new BABYLON.Vector3(rBase, 0, 0),
    new BABYLON.Vector3(rBase, 0.03, 0),
    new BABYLON.Vector3(rBase - 0.012, 0.048, 0),
    new BABYLON.Vector3(rBase - 0.038, 0.08, 0),
    new BABYLON.Vector3(rBase - 0.058, 0.115, 0),
    new BABYLON.Vector3(rBase - 0.048, 0.155, 0),
    new BABYLON.Vector3(rBase - 0.042, 0.19, 0),
    new BABYLON.Vector3(rBase - 0.062, 0.22, 0),
    new BABYLON.Vector3(rBase - 0.08, 0.245, 0)
  ];
}

/**
 * Builds master Staunton meshes for each piece type.
 */
export function createPieceMasterMeshes(scene) {
  const masters = {};

  const makeLathe = (name, shape, tessellation = 28) => {
    return BABYLON.MeshBuilder.CreateLathe(name, {
      shape,
      tessellation,
      sideOrientation: BABYLON.Mesh.DEFAULTSIDE,
      cap: BABYLON.Mesh.CAP_ALL
    }, scene);
  };

  // PAWN - ~0.95 height
  {
    const shape = [
      ...makeStauntonBase(0.25),
      new BABYLON.Vector3(0.16, 0.29, 0),
      new BABYLON.Vector3(0.138, 0.40, 0),
      new BABYLON.Vector3(0.122, 0.52, 0),
      new BABYLON.Vector3(0.128, 0.64, 0),
      new BABYLON.Vector3(0.148, 0.72, 0),
      new BABYLON.Vector3(0.17, 0.76, 0),
      new BABYLON.Vector3(0.13, 0.79, 0),
      new BABYLON.Vector3(0.11, 0.83, 0),
      new BABYLON.Vector3(0.14, 0.88, 0),
      new BABYLON.Vector3(0.15, 0.92, 0),
      new BABYLON.Vector3(0.12, 0.94, 0),
      new BABYLON.Vector3(0, 0.95, 0)
    ];
    const pawn = makeLathe('master_p', shape, 28);
    pawn.setEnabled(false);
    masters.p = pawn;
  }

  // ROOK - ~1.4 height, pure lathe profile with crenellations built as merged parts
  {
    // Main body lathe
    const bodyShape = [
      ...makeStauntonBase(0.29),
      new BABYLON.Vector3(0.22, 0.29, 0),
      new BABYLON.Vector3(0.205, 0.48, 0),
      new BABYLON.Vector3(0.195, 0.72, 0),
      new BABYLON.Vector3(0.19, 0.95, 0),
      new BABYLON.Vector3(0.21, 1.05, 0),
      new BABYLON.Vector3(0.25, 1.12, 0),
      new BABYLON.Vector3(0.275, 1.19, 0),
      new BABYLON.Vector3(0.285, 1.28, 0),
      new BABYLON.Vector3(0.285, 1.32, 0),
      new BABYLON.Vector3(0.23, 1.32, 0),
      new BABYLON.Vector3(0.23, 1.22, 0),
      new BABYLON.Vector3(0, 1.22, 0)
    ];
    const body = makeLathe('rook_body', bodyShape, 28);

    // Add crenellations as merged boxes around top
    const parts = [body];
    const crenHeight = 0.14;
    const crenWidth = 0.09;
    const outerR = 0.285;
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const merlon = BABYLON.MeshBuilder.CreateBox(`rook_merlon_${i}`, { width: crenWidth, height: crenHeight, depth: crenWidth }, scene);
      merlon.position.x = Math.cos(angle) * (outerR - crenWidth * 0.4);
      merlon.position.z = Math.sin(angle) * (outerR - crenWidth * 0.4);
      merlon.position.y = 1.32 + crenHeight / 2;
      parts.push(merlon);
    }
    // Add connecting ring segments
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const embrasure = BABYLON.MeshBuilder.CreateBox(`rook_embrasure_${i}`, { width: 0.08, height: 0.08, depth: 0.08 }, scene);
      embrasure.position.x = Math.cos(angle) * (outerR - 0.12);
      embrasure.position.z = Math.sin(angle) * (outerR - 0.12);
      embrasure.position.y = 1.32 + 0.04;
      // Make them smaller/indented effect by scaling
      embrasure.scaling = new BABYLON.Vector3(1.2, 1.0, 1.2);
      parts.push(embrasure);
    }

    const rook = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (rook) {
      rook.name = 'master_r';
      rook.setEnabled(false);
      masters.r = rook;
    }
  }

  // KNIGHT - ~1.45 height, proper horse head/neck
  {
    const baseShape = [
      ...makeStauntonBase(0.28),
      new BABYLON.Vector3(0.20, 0.28, 0),
      new BABYLON.Vector3(0.21, 0.33, 0),
      new BABYLON.Vector3(0.17, 0.36, 0),
      new BABYLON.Vector3(0, 0.36, 0)
    ];
    const base = makeLathe('knight_base', baseShape, 28);

    // Neck
    const neck = BABYLON.MeshBuilder.CreateCylinder('k_neck', {
      height: 0.58,
      diameterTop: 0.26,
      diameterBottom: 0.36,
      tessellation: 24
    }, scene);
    neck.rotation.x = 0.28;
    neck.position.set(0, 0.60, -0.03);

    // Head
    const head = BABYLON.MeshBuilder.CreateCylinder('k_head', {
      height: 0.34,
      diameterTop: 0.18,
      diameterBottom: 0.24,
      tessellation: 24
    }, scene);
    head.rotation.x = -0.42;
    head.position.set(0, 1.00, 0.08);

    // Muzzle
    const muzzle = BABYLON.MeshBuilder.CreateCylinder('k_muzzle', {
      height: 0.24,
      diameterTop: 0.12,
      diameterBottom: 0.18,
      tessellation: 22
    }, scene);
    muzzle.rotation.x = -Math.PI / 2 - 0.38;
    muzzle.position.set(0, 0.88, 0.24);

    // Jowls
    const jowlL = BABYLON.MeshBuilder.CreateSphere('k_jowl_l', { diameterX: 0.14, diameterY: 0.22, diameterZ: 0.24 }, scene);
    jowlL.position.set(-0.09, 0.90, 0.05);
    const jowlR = BABYLON.MeshBuilder.CreateSphere('k_jowl_r', { diameterX: 0.14, diameterY: 0.22, diameterZ: 0.24 }, scene);
    jowlR.position.set(0.09, 0.90, 0.05);

    // Nose
    const nose = BABYLON.MeshBuilder.CreateSphere('k_nose', { diameterX: 0.14, diameterY: 0.10, diameterZ: 0.13 }, scene);
    nose.position.set(0, 0.84, 0.34);

    // Ears
    const earL = BABYLON.MeshBuilder.CreateCylinder('k_ear_l', { height: 0.16, diameterTop: 0.01, diameterBottom: 0.07, tessellation: 16 }, scene);
    earL.rotation.x = 0.14;
    earL.rotation.z = -0.16;
    earL.position.set(-0.07, 1.26, -0.01);
    const earR = BABYLON.MeshBuilder.CreateCylinder('k_ear_r', { height: 0.16, diameterTop: 0.01, diameterBottom: 0.07, tessellation: 16 }, scene);
    earR.rotation.x = 0.14;
    earR.rotation.z = 0.16;
    earR.position.set(0.07, 1.26, -0.01);

    // Mane
    const mane1 = BABYLON.MeshBuilder.CreateCylinder('k_mane1', { height: 0.26, diameter: 0.13, tessellation: 16 }, scene);
    mane1.rotation.x = 0.28;
    mane1.position.set(0, 0.66, -0.17);
    const mane2 = BABYLON.MeshBuilder.CreateCylinder('k_mane2', { height: 0.24, diameter: 0.12, tessellation: 16 }, scene);
    mane2.rotation.x = 0.22;
    mane2.position.set(0, 0.88, -0.15);
    const mane3 = BABYLON.MeshBuilder.CreateCylinder('k_mane3', { height: 0.20, diameter: 0.11, tessellation: 16 }, scene);
    mane3.rotation.x = 0.14;
    mane3.position.set(0, 1.10, -0.09);

    const knight = BABYLON.Mesh.MergeMeshes(
      [base, neck, head, muzzle, jowlL, jowlR, nose, earL, earR, mane1, mane2, mane3],
      true, true, undefined, false, true
    );
    if (knight) {
      knight.name = 'master_n';
      knight.setEnabled(false);
      masters.n = knight;
    }
  }

  // BISHOP - ~1.5 height, mitre shape built with lathe + merged parts
  {
    const bodyShape = [
      ...makeStauntonBase(0.29),
      new BABYLON.Vector3(0.185, 0.29, 0),
      new BABYLON.Vector3(0.15, 0.46, 0),
      new BABYLON.Vector3(0.125, 0.68, 0),
      new BABYLON.Vector3(0.135, 0.88, 0),
      new BABYLON.Vector3(0.16, 1.02, 0),
      new BABYLON.Vector3(0.19, 1.08, 0),
      new BABYLON.Vector3(0.17, 1.12, 0),
      new BABYLON.Vector3(0.19, 1.16, 0),
      new BABYLON.Vector3(0.17, 1.20, 0),
      new BABYLON.Vector3(0.19, 1.24, 0)
    ];
    const body = makeLathe('bishop_body', bodyShape, 28);

    const mitre = BABYLON.MeshBuilder.CreateCylinder('bishop_mitre', {
      height: 0.26,
      diameterTop: 0.08,
      diameterBottom: 0.22,
      tessellation: 28
    }, scene);
    mitre.rotation.x = 0;
    mitre.position.set(0, 1.37, 0);

    // Add diagonal cut effect with a wedge
    const wedge = BABYLON.MeshBuilder.CreateBox('bishop_wedge', { width: 0.24, height: 0.16, depth: 0.01 }, scene);
    wedge.rotation.y = Math.PI / 4;
    wedge.position.set(0.05, 1.38, 0.05);
    wedge.scaling = new BABYLON.Vector3(1, 1, 6);

    const finial = BABYLON.MeshBuilder.CreateSphere('bishop_finial', { diameter: 0.12 }, scene);
    finial.position.set(0, 1.52, 0);

    const bishop = BABYLON.Mesh.MergeMeshes([body, mitre, finial], true, true, undefined, false, true);
    if (bishop) {
      bishop.name = 'master_b';
      bishop.setEnabled(false);
      masters.b = bishop;
    }
  }

  // QUEEN - ~1.65 height
  {
    const bodyShape = [
      ...makeStauntonBase(0.31),
      new BABYLON.Vector3(0.205, 0.31, 0),
      new BABYLON.Vector3(0.175, 0.52, 0),
      new BABYLON.Vector3(0.15, 0.82, 0),
      new BABYLON.Vector3(0.17, 1.08, 0),
      new BABYLON.Vector3(0.22, 1.16, 0),
      new BABYLON.Vector3(0.19, 1.22, 0),
      new BABYLON.Vector3(0.22, 1.28, 0)
    ];
    const body = makeLathe('queen_body', bodyShape, 28);

    // Coronet
    const crownBase = BABYLON.MeshBuilder.CreateCylinder('queen_crown_base', {
      height: 0.08,
      diameterTop: 0.28,
      diameterBottom: 0.22,
      tessellation: 28
    }, scene);
    crownBase.position.set(0, 1.36, 0);

    const crownRim = BABYLON.MeshBuilder.CreateCylinder('queen_crown_rim', {
      height: 0.12,
      diameterTop: 0.32,
      diameterBottom: 0.28,
      tessellation: 28
    }, scene);
    crownRim.position.set(0, 1.46, 0);

    // Add points
    const parts = [body, crownBase, crownRim];
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const point = BABYLON.MeshBuilder.CreateCylinder(`queen_pt_${i}`, { height: 0.1, diameterTop: 0.02, diameterBottom: 0.06, tessellation: 12 }, scene);
      point.position.x = Math.cos(angle) * 0.3;
      point.position.z = Math.sin(angle) * 0.3;
      point.position.y = 1.57;
      parts.push(point);
    }

    const orb = BABYLON.MeshBuilder.CreateSphere('queen_orb', { diameter: 0.14 }, scene);
    orb.position.set(0, 1.59, 0);
    parts.push(orb);

    const queen = BABYLON.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
    if (queen) {
      queen.name = 'master_q';
      queen.setEnabled(false);
      masters.q = queen;
    }
  }

  // KING - ~1.8 height
  {
    const bodyShape = [
      ...makeStauntonBase(0.33),
      new BABYLON.Vector3(0.235, 0.32, 0),
      new BABYLON.Vector3(0.21, 0.58, 0),
      new BABYLON.Vector3(0.185, 0.9, 0),
      new BABYLON.Vector3(0.20, 1.15, 0),
      new BABYLON.Vector3(0.255, 1.25, 0),
      new BABYLON.Vector3(0.23, 1.32, 0),
      new BABYLON.Vector3(0.26, 1.39, 0)
    ];
    const body = makeLathe('king_body', bodyShape, 28);

    const crownBase = BABYLON.MeshBuilder.CreateCylinder('king_crown_base', {
      height: 0.1,
      diameterTop: 0.3,
      diameterBottom: 0.26,
      tessellation: 28
    }, scene);
    crownBase.position.set(0, 1.5, 0);

    const crownBand = BABYLON.MeshBuilder.CreateCylinder('king_crown_band', {
      height: 0.14,
      diameterTop: 0.34,
      diameterBottom: 0.3,
      tessellation: 28
    }, scene);
    crownBand.position.set(0, 1.62, 0);

    // Cross finial
    const crossV = BABYLON.MeshBuilder.CreateBox('k_cross_v', { width: 0.05, depth: 0.05, height: 0.18 }, scene);
    crossV.position.set(0, 1.78, 0);
    const crossH = BABYLON.MeshBuilder.CreateBox('k_cross_h', { width: 0.14, depth: 0.05, height: 0.05 }, scene);
    crossH.position.set(0, 1.81, 0);
    const crossOrb = BABYLON.MeshBuilder.CreateSphere('k_cross_orb', { diameter: 0.08 }, scene);
    crossOrb.position.set(0, 1.87, 0);

    const king = BABYLON.Mesh.MergeMeshes([body, crownBase, crownBand, crossV, crossH, crossOrb], true, true, undefined, false, true);
    if (king) {
      king.name = 'master_k';
      king.setEnabled(false);
      masters.k = king;
    }
  }

  return masters;
}

/**
 * Creates an instance of a piece
 */
export function instantiatePiece(type, color, id, masters, materials, shadowGen, scene) {
  const master = masters[type.toLowerCase()];
  if (!master) return null;

  const mesh = master.clone(`piece_${color}_${type}_${id}`);
  mesh.setEnabled(true);
  mesh.material = color === 'w' ? materials.whitePiece : materials.blackPiece;
  mesh.receiveShadows = true;

  // Face Knights towards opponent
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
