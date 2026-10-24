/**
 * assets/src/board3d/meshes.js
 * Luxury Staunton chess pieces (Pawn, CSG-crenelated Rook, CSG-slotted Bishop,
 * Queen, King with cross finial, and sculpted Knight) and beveled mahogany tournament table.
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
 * Builds the tournament chess table: beveled mahogany frame, 64 tiles, brass inlay,
 * and elegant felt-lined graveyard trays sunken into the table.
 */
export function createBoardMesh(scene, materials) {
  const root = new BABYLON.TransformNode('boardRoot', scene);
  const squareMeshes = new Map();

  // 1. 64 Square Tiles with gentle bevel
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

  // 2. Inner Brass Fillet Inlay Trim (separating squares from frame)
  const innerTrim = BABYLON.MeshBuilder.CreateBox(
    'innerBrassTrim',
    { width: 8.16, depth: 8.16, height: 0.17 },
    scene
  );
  innerTrim.position.set(0, -0.086, 0);
  innerTrim.material = materials.brass;
  innerTrim.parent = root;

  // 3. Unified Tournament Table Base (Mahogany slab)
  const table = BABYLON.MeshBuilder.CreateBox(
    'tournamentTable',
    { width: 12.0, depth: 9.6, height: 0.44 },
    scene
  );
  table.position.set(0, -0.23, 0);
  table.material = materials.frame;
  table.parent = root;
  table.receiveShadows = true;

  // 4. Recessed Tournament Felt Capture Trays (Sunken into the mahogany table)
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

  // 5. Crisp Brass Coordinate Labels (a-h, 1-8)
  createCoordinateLabels(root, scene, materials.brass);

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
 * Creates high-precision Staunton lathe profile with smooth base plinth and scotia molding.
 */
function makeStauntonBase(rBase = 0.30) {
  return [
    new BABYLON.Vector3(0, 0, 0),
    new BABYLON.Vector3(rBase, 0, 0),
    new BABYLON.Vector3(rBase, 0.035, 0),
    new BABYLON.Vector3(rBase - 0.015, 0.055, 0),
    new BABYLON.Vector3(rBase - 0.045, 0.09, 0), // scotia cove
    new BABYLON.Vector3(rBase - 0.065, 0.13, 0),
    new BABYLON.Vector3(rBase - 0.05, 0.17, 0), // torus bead
    new BABYLON.Vector3(rBase - 0.045, 0.20, 0),
    new BABYLON.Vector3(rBase - 0.07, 0.23, 0),
    new BABYLON.Vector3(rBase - 0.09, 0.26, 0)
  ];
}

/**
 * Builds master Staunton meshes for each piece type.
 */
export function createPieceMasterMeshes(scene) {
  const masters = {};

  const makeLathe = (name, shape, tessellation = 48) => {
    return BABYLON.MeshBuilder.CreateLathe(name, {
      shape,
      tessellation,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
      cap: BABYLON.Mesh.CAP_ALL
    }, scene);
  };

  // 1. PAWN (Height ~ 1.15) Classical Slender Staunton
  {
    const shape = [
      ...makeStauntonBase(0.27),
      // Graceful slender waist
      new BABYLON.Vector3(0.16, 0.30, 0),
      new BABYLON.Vector3(0.135, 0.42, 0),
      new BABYLON.Vector3(0.12, 0.55, 0), // slender waist
      new BABYLON.Vector3(0.125, 0.68, 0),
      new BABYLON.Vector3(0.145, 0.76, 0),
      // Astragal collar ring
      new BABYLON.Vector3(0.185, 0.80, 0),
      new BABYLON.Vector3(0.195, 0.83, 0),
      new BABYLON.Vector3(0.14, 0.86, 0),
      // Spherical head
      new BABYLON.Vector3(0.12, 0.88, 0),
      new BABYLON.Vector3(0.155, 0.93, 0),
      new BABYLON.Vector3(0.165, 0.99, 0),
      new BABYLON.Vector3(0.15, 1.06, 0),
      new BABYLON.Vector3(0.10, 1.12, 0),
      new BABYLON.Vector3(0, 1.15, 0)
    ];
    const pawn = makeLathe('master_p', shape);
    pawn.setEnabled(false);
    masters.p = pawn;
  }

  // 2. ROOK (Height ~ 1.34) Solid Castle Tower with 4 Deep Crenellations
  {
    const shape = [
      ...makeStauntonBase(0.31),
      // Tower Column with gentle concave taper
      new BABYLON.Vector3(0.23, 0.30, 0),
      new BABYLON.Vector3(0.215, 0.48, 0),
      new BABYLON.Vector3(0.20, 0.70, 0),
      new BABYLON.Vector3(0.195, 0.90, 0),
      // Parapet Cornice
      new BABYLON.Vector3(0.22, 0.98, 0),
      new BABYLON.Vector3(0.265, 1.05, 0),
      new BABYLON.Vector3(0.295, 1.12, 0),
      // Outer battlement wall
      new BABYLON.Vector3(0.30, 1.34, 0),
      new BABYLON.Vector3(0.21, 1.34, 0),
      // Recessed inner floor
      new BABYLON.Vector3(0.21, 1.16, 0),
      new BABYLON.Vector3(0, 1.16, 0)
    ];
    const tower = makeLathe('rook_lathe', shape);

    // CSG cut 4 clean crenellation embrasures (notches)
    const towerCSG = BABYLON.CSG.FromMesh(tower);
    const cut1 = BABYLON.MeshBuilder.CreateBox('c1', { width: 0.14, depth: 0.75, height: 0.24 }, scene);
    cut1.position.set(0, 1.28, 0);
    const cut2 = BABYLON.MeshBuilder.CreateBox('c2', { width: 0.75, depth: 0.14, height: 0.24 }, scene);
    cut2.position.set(0, 1.28, 0);

    const c1CSG = BABYLON.CSG.FromMesh(cut1);
    const c2CSG = BABYLON.CSG.FromMesh(cut2);
    cut1.dispose();
    cut2.dispose();
    tower.dispose();

    const rookCSG = towerCSG.subtract(c1CSG).subtract(c2CSG);
    const rook = rookCSG.toMesh('master_r', null, scene);
    rook.setEnabled(false);
    masters.r = rook;
  }

  // 3. KNIGHT (Height ~ 1.54) Sculpted Staunton Horse facing +Z (towards opponent)
  {
    const baseShape = [
      ...makeStauntonBase(0.30),
      new BABYLON.Vector3(0.21, 0.28, 0),
      new BABYLON.Vector3(0.22, 0.33, 0), // collar ring
      new BABYLON.Vector3(0.18, 0.36, 0),
      new BABYLON.Vector3(0, 0.36, 0)
    ];
    const base = makeLathe('knight_pedestal', baseShape);

    // Arched Muscular Neck curving forward towards +Z
    const neck = BABYLON.MeshBuilder.CreateCylinder('k_neck', {
      height: 0.65,
      diameterTop: 0.28,
      diameterBottom: 0.38,
      tessellation: 24
    }, scene);
    neck.rotation.x = 0.32; // arch forward towards +Z
    neck.position.set(0, 0.64, -0.04);

    // Muscular Cheeks
    const cheekL = BABYLON.MeshBuilder.CreateSphere('k_cheek_l', { diameterX: 0.16, diameterY: 0.24, diameterZ: 0.26 }, scene);
    cheekL.position.set(-0.10, 0.94, 0.05);
    const cheekR = BABYLON.MeshBuilder.CreateSphere('k_cheek_r', { diameterX: 0.16, diameterY: 0.24, diameterZ: 0.26 }, scene);
    cheekR.position.set(0.10, 0.94, 0.05);

    // Head / Forehead Bridge (tapered cylinder angled down towards +Z)
    const head = BABYLON.MeshBuilder.CreateCylinder('k_head', {
      height: 0.38,
      diameterTop: 0.20,
      diameterBottom: 0.26,
      tessellation: 20
    }, scene);
    head.rotation.x = -0.45; // tilt down towards +Z
    head.position.set(0, 1.06, 0.09);

    // Muzzle / Snout facing forward towards +Z
    const snout = BABYLON.MeshBuilder.CreateCylinder('k_snout', {
      height: 0.26,
      diameterTop: 0.13,
      diameterBottom: 0.20,
      tessellation: 18
    }, scene);
    snout.rotation.x = -Math.PI / 2 - 0.40;
    snout.position.set(0, 0.92, 0.27);

    // Rounded Nose Tip
    const noseTip = BABYLON.MeshBuilder.CreateSphere('k_nose', {
      diameterX: 0.15,
      diameterY: 0.11,
      diameterZ: 0.14
    }, scene);
    noseTip.position.set(0, 0.86, 0.37);

    // Sculpted Mane Crest along dorsal ridge (-Z spine)
    const mane1 = BABYLON.MeshBuilder.CreateCylinder('k_m1', { height: 0.28, diameter: 0.14, tessellation: 12 }, scene);
    mane1.rotation.x = 0.30;
    mane1.position.set(0, 0.68, -0.19);

    const mane2 = BABYLON.MeshBuilder.CreateCylinder('k_m2', { height: 0.26, diameter: 0.13, tessellation: 12 }, scene);
    mane2.rotation.x = 0.25;
    mane2.position.set(0, 0.92, -0.16);

    const mane3 = BABYLON.MeshBuilder.CreateCylinder('k_m3', { height: 0.22, diameter: 0.12, tessellation: 12 }, scene);
    mane3.rotation.x = 0.15;
    mane3.position.set(0, 1.15, -0.10);

    // Alert Pricked Ears
    const earL = BABYLON.MeshBuilder.CreateCylinder('k_ear_l', {
      height: 0.17,
      diameterTop: 0.01,
      diameterBottom: 0.08,
      tessellation: 12
    }, scene);
    earL.rotation.x = 0.15;
    earL.rotation.z = -0.18;
    earL.position.set(-0.075, 1.32, -0.02);

    const earR = BABYLON.MeshBuilder.CreateCylinder('k_ear_r', {
      height: 0.17,
      diameterTop: 0.01,
      diameterBottom: 0.08,
      tessellation: 12
    }, scene);
    earR.rotation.x = 0.15;
    earR.rotation.z = 0.18;
    earR.position.set(0.075, 1.32, -0.02);

    const knight = BABYLON.Mesh.MergeMeshes(
      [base, neck, cheekL, cheekR, head, snout, noseTip, mane1, mane2, mane3, earL, earR],
      true, true, undefined, false, true
    );
    knight.name = 'master_n';
    knight.setEnabled(false);
    masters.n = knight;
  }

  // 4. BISHOP (Height ~ 1.68) with CSG Mitre Cut & Finial Bead
  {
    const shape = [
      ...makeStauntonBase(0.31),
      // Slender waisted column
      new BABYLON.Vector3(0.19, 0.30, 0),
      new BABYLON.Vector3(0.155, 0.46, 0),
      new BABYLON.Vector3(0.125, 0.68, 0), // graceful waist
      new BABYLON.Vector3(0.135, 0.86, 0),
      new BABYLON.Vector3(0.165, 0.98, 0),
      // Dual Astragal Rings
      new BABYLON.Vector3(0.21, 1.02, 0),
      new BABYLON.Vector3(0.175, 1.05, 0),
      new BABYLON.Vector3(0.20, 1.08, 0),
      new BABYLON.Vector3(0.165, 1.11, 0),
      // Teardrop Mitre Head
      new BABYLON.Vector3(0.185, 1.15, 0),
      new BABYLON.Vector3(0.23, 1.25, 0),
      new BABYLON.Vector3(0.24, 1.35, 0),
      new BABYLON.Vector3(0.21, 1.45, 0),
      new BABYLON.Vector3(0.13, 1.55, 0),
      new BABYLON.Vector3(0.06, 1.59, 0),
      // Finial Spherical Ball
      new BABYLON.Vector3(0.075, 1.63, 0),
      new BABYLON.Vector3(0.065, 1.66, 0),
      new BABYLON.Vector3(0, 1.68, 0)
    ];
    const bishopLathe = makeLathe('bishop_lathe', shape);

    // CSG diagonal mitre cut
    const bishopCSG = BABYLON.CSG.FromMesh(bishopLathe);
    const mitreCutter = BABYLON.MeshBuilder.CreateBox('m_cut', { width: 0.05, depth: 0.35, height: 0.28 }, scene);
    mitreCutter.rotation.z = -0.65; // angled slash
    mitreCutter.position.set(0.13, 1.40, 0);

    const cutterCSG = BABYLON.CSG.FromMesh(mitreCutter);
    mitreCutter.dispose();
    bishopLathe.dispose();

    const bishop = bishopCSG.subtract(cutterCSG).toMesh('master_b', null, scene);
    bishop.setEnabled(false);
    masters.b = bishop;
  }

  // 5. QUEEN (Height ~ 1.84) Regal Coronet & Crown Orb
  {
    const shape = [
      ...makeStauntonBase(0.33),
      // Columnar stem
      new BABYLON.Vector3(0.21, 0.32, 0),
      new BABYLON.Vector3(0.175, 0.52, 0),
      new BABYLON.Vector3(0.15, 0.82, 0), // waist
      new BABYLON.Vector3(0.17, 1.08, 0),
      // Dual Royal Collar
      new BABYLON.Vector3(0.24, 1.14, 0),
      new BABYLON.Vector3(0.20, 1.18, 0),
      new BABYLON.Vector3(0.23, 1.22, 0),
      new BABYLON.Vector3(0.18, 1.26, 0),
      // Flared Coronet Bowl
      new BABYLON.Vector3(0.21, 1.32, 0),
      new BABYLON.Vector3(0.26, 1.48, 0),
      new BABYLON.Vector3(0.30, 1.64, 0), // flared rim
      new BABYLON.Vector3(0.24, 1.64, 0),
      new BABYLON.Vector3(0.12, 1.60, 0),
      // Central Finial Orb
      new BABYLON.Vector3(0.065, 1.65, 0),
      new BABYLON.Vector3(0.095, 1.74, 0),
      new BABYLON.Vector3(0.075, 1.80, 0),
      new BABYLON.Vector3(0, 1.84, 0)
    ];
    const queenLathe = makeLathe('queen_lathe', shape);

    // CSG cut 8 scalloped coronet points around the rim
    let queenCSG = BABYLON.CSG.FromMesh(queenLathe);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const notch = BABYLON.MeshBuilder.CreateCylinder(`q_notch_${i}`, { height: 0.12, diameter: 0.08, tessellation: 12 }, scene);
      notch.position.set(Math.cos(angle) * 0.28, 1.64, Math.sin(angle) * 0.28);
      const nCSG = BABYLON.CSG.FromMesh(notch);
      notch.dispose();
      queenCSG = queenCSG.subtract(nCSG);
    }
    queenLathe.dispose();

    const queen = queenCSG.toMesh('master_q', null, scene);
    queen.setEnabled(false);
    masters.q = queen;
  }

  // 6. KING (Height ~ 2.05) Imperial Crown with Maltese Cross Finial
  {
    const shape = [
      ...makeStauntonBase(0.35),
      // Heavy Stately Column
      new BABYLON.Vector3(0.24, 0.32, 0),
      new BABYLON.Vector3(0.21, 0.58, 0),
      new BABYLON.Vector3(0.185, 0.90, 0), // waist
      new BABYLON.Vector3(0.20, 1.15, 0),
      // Royal Collars
      new BABYLON.Vector3(0.27, 1.22, 0),
      new BABYLON.Vector3(0.23, 1.27, 0),
      new BABYLON.Vector3(0.275, 1.32, 0),
      new BABYLON.Vector3(0.22, 1.38, 0),
      // Crown Dome
      new BABYLON.Vector3(0.24, 1.44, 0),
      new BABYLON.Vector3(0.295, 1.60, 0),
      new BABYLON.Vector3(0.305, 1.72, 0),
      new BABYLON.Vector3(0.24, 1.82, 0),
      new BABYLON.Vector3(0.12, 1.86, 0),
      new BABYLON.Vector3(0.10, 1.90, 0), // cross base
      new BABYLON.Vector3(0, 1.90, 0)
    ];
    const kingBody = makeLathe('king_lathe', shape);

    // Classic Maltese 3D Cross Finial
    const crossV = BABYLON.MeshBuilder.CreateBox('k_cross_v', { width: 0.055, depth: 0.055, height: 0.20 }, scene);
    crossV.position.set(0, 1.99, 0);

    const crossH = BABYLON.MeshBuilder.CreateBox('k_cross_h', { width: 0.16, depth: 0.055, height: 0.055 }, scene);
    crossH.position.set(0, 2.02, 0);

    const king = BABYLON.Mesh.MergeMeshes([kingBody, crossV, crossH], true, true, undefined, false, true);
    king.name = 'master_k';
    king.setEnabled(false);
    masters.k = king;
  }

  return masters;
}

/**
 * Creates an instance of a piece, attaching a green velvet felt pad to its base.
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

  // Base green felt pad
  const feltBase = BABYLON.MeshBuilder.CreateCylinder(`felt_${id}`, { diameter: 0.60, height: 0.015, tessellation: 24 }, scene);
  feltBase.material = materials.felt;
  feltBase.position.y = 0.007;
  feltBase.parent = mesh;
  feltBase.isPickable = false;

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
