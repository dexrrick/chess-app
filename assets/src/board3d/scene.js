/**
 * assets/src/board3d/scene.js
 * Babylon Engine, Scene, Studio 3-Point Lighting, Rim Light, PCF Shadows,
 * PBR Materials, Post-Processing Pipeline, and Move Physics/Animation Orchestration.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';
import { createMaterials } from './materials.js';
import { createBoardMesh, createPieceMasterMeshes, instantiatePiece, squareToVector3, BOARD_FILES, BOARD_RANKS } from './meshes.js';
import { initPhysics, attachPiecePhysics, resetPieceKinematic } from './physics.js';
import { animatePieceMove, toppleCapturedPiece, toppleKing } from './animations.js';
import { createInputController } from './input.js';

export async function createBoard3DWorld(containerEl, appCallbacks) {
  // 1. Create canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'board-3d-canvas';
  canvas.setAttribute('touch-action', 'none');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.outline = 'none';
  containerEl.innerHTML = '';
  containerEl.appendChild(canvas);

  // 2. Babylon Engine with high-performance preferences
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    powerPreference: 'high-performance'
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));

  // 3. Scene setup
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.06, 0.09, 0.15, 1.0);

  // 4. ArcRotateCamera with smooth inertia and limits - better framing
  const camera = new BABYLON.ArcRotateCamera(
    'camera3d',
    -Math.PI / 2, // Facing white by default
    Math.PI / 3.2, // Slightly lower angle for better board framing
    12.5,          // Closer to frame board better in square container
    new BABYLON.Vector3(0, 0, 0),
    scene
  );
  camera.minZ = 0.2;
  camera.attachControl(canvas, true);
  camera.inertia = 0.85;
  camera.lowerBetaLimit = 0.25;
  camera.upperBetaLimit = Math.PI / 2.2;
  camera.lowerRadiusLimit = 7.5;
  camera.upperRadiusLimit = 18.0;
  camera.wheelPrecision = 28;
  camera.pinchPrecision = 28;

  // 5. Studio 3-Point Lighting Setup with Soft PCF Shadows & Rim Light
  // Ambient Hemispheric Fill - increased for contrast
  const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.72;
  hemiLight.groundColor = new BABYLON.Color3(0.22, 0.24, 0.30);

  // Key Light (Warm sunlight from upper left)
  const keyLight = new BABYLON.DirectionalLight('keyLight', new BABYLON.Vector3(0.5, -1.3, 0.7), scene);
  keyLight.position = new BABYLON.Vector3(-5.0, 14.0, -7.0);
  keyLight.intensity = 1.25;
  keyLight.diffuse = BABYLON.Color3.FromHexString('#fff7ed');
  keyLight.specular = new BABYLON.Color3(0.4, 0.4, 0.4);

  const shadowGen = new BABYLON.ShadowGenerator(1024, keyLight);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.002;
  shadowGen.normalBias = 0.010;

  // Fill Light (More direct fill for better definition)
  const fillLight = new BABYLON.DirectionalLight('fillLight', new BABYLON.Vector3(-0.4, -0.9, -0.6), scene);
  fillLight.position = new BABYLON.Vector3(6.0, 11.0, 7.0);
  fillLight.intensity = 0.85;
  fillLight.diffuse = BABYLON.Color3.FromHexString('#fff4e6');
  fillLight.specular = new BABYLON.Color3(0.25, 0.25, 0.25);

  // Rim Light (Stronger contour)
  const rimLight = new BABYLON.DirectionalLight('rimLight', new BABYLON.Vector3(0, -0.75, -1.0), scene);
  rimLight.position = new BABYLON.Vector3(0, 9.0, 10.0);
  rimLight.intensity = 0.65;
  rimLight.diffuse = BABYLON.Color3.FromHexString('#e6f0ff');
  rimLight.specular = new BABYLON.Color3(0.1, 0.1, 0.1);

  // 6. Post-Processing Pipeline (ACES tone mapping, subtle bloom, FXAA)
  const pipeline = new BABYLON.DefaultRenderingPipeline('pipeline', true, scene, [camera]);
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.78;
  pipeline.bloomWeight = 0.08;
  pipeline.bloomKernel = 32;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipeline.imageProcessing.contrast = 1.18;
  pipeline.imageProcessing.exposure = 1.02;

  // 7. Initialize Havok Physics
  await initPhysics(scene);

  // 8. Materials, Board, and Piece Masters
  const materials = createMaterials(scene);
  const { squareMeshes } = createBoardMesh(scene, materials);
  const masterMeshes = createPieceMasterMeshes(scene);

  // 9. Interactive Highlight Meshes
  const highlightSelected = BABYLON.MeshBuilder.CreateBox('hl_selected', { width: 0.96, depth: 0.96, height: 0.04 }, scene);
  highlightSelected.material = materials.selectedSquare;
  highlightSelected.isVisible = false;
  highlightSelected.isPickable = false;

  const highlightLastFrom = BABYLON.MeshBuilder.CreateBox('hl_last_from', { width: 0.96, depth: 0.96, height: 0.035 }, scene);
  highlightLastFrom.material = materials.lastMove;
  highlightLastFrom.isVisible = false;
  highlightLastFrom.isPickable = false;

  const highlightLastTo = BABYLON.MeshBuilder.CreateBox('hl_last_to', { width: 0.96, depth: 0.96, height: 0.035 }, scene);
  highlightLastTo.material = materials.lastMove;
  highlightLastTo.isVisible = false;
  highlightLastTo.isPickable = false;

  const highlightCheck = BABYLON.MeshBuilder.CreateCylinder('hl_check', { diameter: 0.88, height: 0.04 }, scene);
  highlightCheck.material = materials.checkPulse;
  highlightCheck.isVisible = false;
  highlightCheck.isPickable = false;

  const highlightHover = BABYLON.MeshBuilder.CreateBox('hl_hover', { width: 0.96, depth: 0.96, height: 0.042 }, scene);
  highlightHover.material = materials.hoverSquare;
  highlightHover.isVisible = false;
  highlightHover.isPickable = false;

  // Pool of legal move dot meshes
  const legalDotsPool = [];
  function getLegalDot(index) {
    if (!legalDotsPool[index]) {
      const dot = BABYLON.MeshBuilder.CreateCylinder(`hl_legal_${index}`, { diameter: 0.36, height: 0.04 }, scene);
      dot.material = materials.legalMoveDot;
      dot.isPickable = false;
      legalDotsPool[index] = dot;
    }
    return legalDotsPool[index];
  }

  // Active Pieces Tracking: Map square -> pieceMesh
  let pieceBySquare = new Map();
  let graveyardPieces = [];
  let pieceIdCounter = 0;
  let currentOrientation = 'white';
  let isMoveAnimating = false;
  let activeAnimationPromise = null;
  let animatingMoveKey = null;
  let lastKnownFen = null;

  function getPieceAt(sq) {
    return pieceBySquare.get(sq) || null;
  }

  // 10. Input Controller
  const inputCtrl = createInputController(scene, camera, canvas, {
    onSquareSelect: (sq) => {
      appCallbacks.onSquareSelect(sq);
    },
    onMoveAttempt: (from, to) => {
      appCallbacks.onMoveAttempt(from, to);
    },
    onHoverSquare: (sq) => {
      if (sq) {
        const pos = squareToVector3(sq);
        highlightHover.position.set(pos.x, 0.02, pos.z);
        highlightHover.isVisible = true;
      } else {
        highlightHover.isVisible = false;
      }
    }
  });
  inputCtrl.setGetPieceFn(getPieceAt);

  // 11. Move Animation with Havok Knockdown
  async function animateMove(moveObj, newFen) {
    if (!moveObj || !moveObj.from || !moveObj.to) {
      if (newFen) {
        lastKnownFen = newFen;
        try {
          syncPiecesFromFen(newFen);
        } catch {}
      }
      return;
    }

    const { from, to } = moveObj;
    const moveKey = `${from}-${to}`;

    // If this move is already in flight, return the active promise to avoid duplicate triggers
    if (isMoveAnimating && animatingMoveKey === moveKey && activeAnimationPromise) {
      return activeAnimationPromise;
    }

    const movingPiece = pieceBySquare.get(from);
    if (!movingPiece) {
      if (newFen) {
        lastKnownFen = newFen;
        try {
          syncPiecesFromFen(newFen);
        } catch {}
      }
      return;
    }

    const pieceType = movingPiece.metadata?.pieceType;
    const pieceColor = movingPiece.metadata?.color;

    // Detect castling (king moves two squares horizontally)
    let isCastling = false;
    let rookFrom = null;
    let rookTo = null;
    if (pieceType === 'k') {
      const fromFile = from.charCodeAt(0);
      const toFile = to.charCodeAt(0);
      if (Math.abs(toFile - fromFile) === 2) {
        isCastling = true;
        if (to === 'g1' || (pieceColor === 'w' && to === 'g1')) { rookFrom = 'h1'; rookTo = 'f1'; }
        else if (to === 'c1' || (pieceColor === 'w' && to === 'c1')) { rookFrom = 'a1'; rookTo = 'd1'; }
        else if (to === 'g8' || (pieceColor === 'b' && to === 'g8')) { rookFrom = 'h8'; rookTo = 'f8'; }
        else if (to === 'c8' || (pieceColor === 'b' && to === 'c8')) { rookFrom = 'a8'; rookTo = 'd8'; }
        // Fallback based on position
        if (!rookFrom) {
          if (pieceColor === 'w') {
            if (to === 'g1') { rookFrom = 'h1'; rookTo = 'f1'; }
            else if (to === 'c1') { rookFrom = 'a1'; rookTo = 'd1'; }
          } else {
            if (to === 'g8') { rookFrom = 'h8'; rookTo = 'f8'; }
            else if (to === 'c8') { rookFrom = 'a8'; rookTo = 'd8'; }
          }
        }
      }
    }

    // Detect en passant
    let isEnPassant = false;
    let enPassantCaptured = null;
    let enPassantCapturedSquare = null;
    if (pieceType === 'p' && !pieceBySquare.get(to)) {
      // If pawn moves diagonally to empty square, it might be en passant
      const fromFile = from.charCodeAt(0) - 97; // 'a' to 0
      const toFile = to.charCodeAt(0) - 97;
      const fromRank = parseInt(from[1]);
      const toRank = parseInt(to[1]);
      if (Math.abs(toFile - fromFile) === 1 && Math.abs(toRank - fromRank) === 1) {
        // Check if there's a pawn to capture en passant
        if (pieceColor === 'w') {
          // White moves up in rank? Wait - in chess, white moves from rank 2 to rank 8, so increasing rank number
          // But looking at how squares work - in our coords, rank increases upward? Let us check
          enPassantCapturedSquare = String.fromCharCode(97 + toFile) + fromRank;
        } else {
          enPassantCapturedSquare = String.fromCharCode(97 + toFile) + fromRank;
        }
        enPassantCaptured = pieceBySquare.get(enPassantCapturedSquare);
        if (enPassantCaptured && enPassantCaptured.metadata?.pieceType === 'p' && enPassantCaptured.metadata?.color !== pieceColor) {
          isEnPassant = true;
        }
      }
    }

    const capturedPiece = isEnPassant ? enPassantCaptured : pieceBySquare.get(to);
    const movingRook = isCastling && rookFrom ? pieceBySquare.get(rookFrom) : null;

    isMoveAnimating = true;
    animatingMoveKey = moveKey;
    try {
      pieceBySquare.delete(from);
      if (movingRook && rookFrom) {
        pieceBySquare.delete(rookFrom);
      }
    } catch {}

    // If a piece was captured on target square (not castling), remove it
    if (capturedPiece && capturedPiece !== movingPiece && !isCastling) {
      if (isEnPassant && enPassantCapturedSquare) {
        try { pieceBySquare.delete(enPassantCapturedSquare); } catch {}
      } else {
        try { pieceBySquare.delete(to); } catch {}
      }
      // Clear square metadata so it's recognized as captured/graveyard
      if (capturedPiece.metadata) capturedPiece.metadata.square = null;
      try { graveyardPieces.push(capturedPiece); } catch {}
    }

    const targetPos = squareToVector3(to);
    const isKnight = pieceType === 'n';

    const kingAnimPromise = animatePieceMove(movingPiece, targetPos, {
      isKnight,
      capturedPieceMesh: (capturedPiece && capturedPiece !== movingPiece && !isCastling) ? capturedPiece : null,
      durationMs: 340
    });

    let rookAnimPromise = null;
    if (isCastling && movingRook && rookTo) {
      try {
        const rookTargetPos = squareToVector3(rookTo);
        rookAnimPromise = animatePieceMove(movingRook, rookTargetPos, {
          isKnight: false,
          capturedPieceMesh: null,
          durationMs: 320
        });
      } catch (e) {
        console.error('rook anim error:', e);
      }
    }

    activeAnimationPromise = Promise.all([kingAnimPromise, rookAnimPromise].filter(Boolean)).then(() => {
      try {
        if (movingPiece && movingPiece.metadata) {
          movingPiece.metadata.square = to;
        }
        pieceBySquare.set(to, movingPiece);
      } catch {}
      if (isCastling && movingRook && rookTo) {
        try {
          if (movingRook.metadata) movingRook.metadata.square = rookTo;
          pieceBySquare.set(rookTo, movingRook);
        } catch {}
      }
      isMoveAnimating = false;
      animatingMoveKey = null;
      activeAnimationPromise = null;

      if (newFen) {
        lastKnownFen = newFen;
        try {
          syncPiecesFromFen(newFen);
        } catch {}
      }
    }).catch((err) => {
      console.error('Move animation error:', err);
      isMoveAnimating = false;
      animatingMoveKey = null;
      activeAnimationPromise = null;
      if (newFen) {
        lastKnownFen = newFen;
        try {
          syncPiecesFromFen(newFen);
        } catch {}
      }
    });

    return activeAnimationPromise;
  }

  // 12. Smart State Synchronization
  function syncState(stateObj) {
    const {
      fen,
      turn = 'w',
      lastMove = null,
      inCheck = false,
      gameOver = false,
      orientation = 'white',
      selectedSquare = null,
      legalMoves = []
    } = stateObj;

    inputCtrl.setTurn(turn);
    inputCtrl.setSelected(selectedSquare, legalMoves.map((m) => (typeof m === 'string' ? m : m.to)));

    // Camera orientation flip
    if (orientation !== currentOrientation) {
      currentOrientation = orientation;
      const targetAlpha = orientation === 'black' ? Math.PI / 2 : -Math.PI / 2;
      BABYLON.Animation.CreateAndStartAnimation(
        'camOrbit',
        camera,
        'alpha',
        60,
        24,
        camera.alpha,
        targetAlpha,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
    }

    // Pending move check:
    // When app.js executes a move, it calls renderAll() (which invokes syncState)
    // immediately prior to calling board3d.animateMove().
    // If lastMove is present and pieceBySquare has the piece at lastMove.from,
    // this move is about to be animated by animateMove(). Do NOT wipe pieces with syncPiecesFromFen()!
    let isPendingMove = lastMove && lastMove.from && lastMove.to && pieceBySquare.has(lastMove.from);
    // Also check for castling - king moves from from to to (2 squares)
    if (!isPendingMove && lastMove && lastMove.from && lastMove.to) {
      const movingPiece = pieceBySquare.get(lastMove.from);
      if (movingPiece && movingPiece.metadata?.pieceType === 'k') {
        const fromFile = lastMove.from.charCodeAt(0);
        const toFile = lastMove.to.charCodeAt(0);
        if (Math.abs(toFile - fromFile) === 2) {
          isPendingMove = true;
        }
      }
    }

    if (fen && fen !== lastKnownFen && !isMoveAnimating && !isPendingMove) {
      lastKnownFen = fen;
      syncPiecesFromFen(fen);
    }

    // Highlights: Selected square
    if (selectedSquare) {
      const pos = squareToVector3(selectedSquare);
      highlightSelected.position.set(pos.x, 0.015, pos.z);
      highlightSelected.isVisible = true;
    } else {
      highlightSelected.isVisible = false;
    }

    // Highlights: Legal move dots / capture rings
    legalDotsPool.forEach((dot) => { dot.isVisible = false; });
    const targetSquares = legalMoves.map((m) => (typeof m === 'string' ? m : m.to));
    targetSquares.forEach((sq, i) => {
      const dot = getLegalDot(i);
      const pos = squareToVector3(sq);
      dot.position.set(pos.x, 0.02, pos.z);
      const isCap = !!pieceBySquare.get(sq);
      dot.material = isCap ? materials.captureRing : materials.legalMoveDot;
      dot.isVisible = true;
    });

    // Highlights: Last move
    if (lastMove && lastMove.from && lastMove.to) {
      const posFrom = squareToVector3(lastMove.from);
      highlightLastFrom.position.set(posFrom.x, 0.01, posFrom.z);
      highlightLastFrom.isVisible = true;

      const posTo = squareToVector3(lastMove.to);
      highlightLastTo.position.set(posTo.x, 0.01, posTo.z);
      highlightLastTo.isVisible = true;
    } else {
      highlightLastFrom.isVisible = false;
      highlightLastTo.isVisible = false;
    }

    // Highlights: Check pulse
    if (inCheck) {
      for (const [sq, piece] of pieceBySquare.entries()) {
        if (piece.metadata.pieceType === 'k' && piece.metadata.color === turn) {
          const pos = squareToVector3(sq);
          highlightCheck.position.set(pos.x, 0.012, pos.z);
          highlightCheck.isVisible = true;
          break;
        }
      }
    } else {
      highlightCheck.isVisible = false;
    }

    // Defeated King topple on Checkmate
    if (gameOver && inCheck) {
      for (const [, piece] of pieceBySquare.entries()) {
        if (piece.metadata.pieceType === 'k' && piece.metadata.color === turn) {
          toppleKing(piece);
          break;
        }
      }
    }
  }

  function syncPiecesFromFen(fen) {
    const fenBoard = fen.split(' ')[0];
    const ranks = fenBoard.split('/');
    const targetBoard = new Map();

    for (let r = 0; r < 8; r++) {
      const rankStr = ranks[r];
      const rankNum = BOARD_RANKS[7 - r]; // rank '8' is r=0
      let f = 0;
      for (const ch of rankStr) {
        if (ch >= '1' && ch <= '8') {
          f += parseInt(ch, 10);
        } else {
          const fileLetter = BOARD_FILES[f];
          const sq = `${fileLetter}${rankNum}`;
          const color = ch === ch.toUpperCase() ? 'w' : 'b';
          const type = ch.toLowerCase();
          targetBoard.set(sq, { type, color });
          f++;
        }
      }
    }

    // If starting a fresh full game (32 pieces), clear old graveyard pieces
    if (targetBoard.size === 32 && ranks[0] === 'rnbqkbnr' && ranks[7] === 'RNBQKBNR') {
      graveyardPieces.forEach((p) => {
        try { p.dispose(); } catch {}
      });
      graveyardPieces = [];
    }

    const newPieceBySquare = new Map();
    const remainingTargets = new Map(targetBoard);

    // Keep pieces that already match their square
    for (const [sq, piece] of pieceBySquare.entries()) {
      const target = remainingTargets.get(sq);
      if (target && piece.metadata.pieceType === target.type && piece.metadata.color === target.color) {
        newPieceBySquare.set(sq, piece);
        remainingTargets.delete(sq);
      } else {
        piece.dispose();
      }
    }

    // Instantiate pieces for empty target squares
    for (const [sq, target] of remainingTargets.entries()) {
      pieceIdCounter++;
      const mesh = instantiatePiece(target.type, target.color, pieceIdCounter, masterMeshes, materials, shadowGen, scene);
      if (mesh) {
        mesh.metadata.square = sq;
        const targetPos = squareToVector3(sq);
        mesh.position.copyFrom(targetPos);
        attachPiecePhysics(mesh, scene);
        newPieceBySquare.set(sq, mesh);
      }
    }

    pieceBySquare = newPieceBySquare;
  }

  // 13. Render Loop & Resize Handling
  let renderLoopRunning = true;
  engine.runRenderLoop(() => {
    if (renderLoopRunning) {
      scene.render();
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    engine.resize();
  });
  resizeObserver.observe(containerEl);

  window.addEventListener('resize', () => {
    engine.resize();
  });

  function stopRender() {
    renderLoopRunning = false;
  }

  function startRender() {
    renderLoopRunning = true;
    engine.resize();
  }

  function dispose() {
    stopRender();
    resizeObserver.disconnect();
    inputCtrl.dispose();
    scene.dispose();
    engine.dispose();
    containerEl.innerHTML = '';
  }

  return {
    syncState,
    animateMove,
    stopRender,
    startRender,
    dispose,
    engine,
    scene
  };
}
