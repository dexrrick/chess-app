/**
 * assets/src/board3d/scene.js
 * Babylon Engine, Scene, ArcRotateCamera, PCF Shadows, PBR Materials, Post-Processing,
 * and Piece State Synchronization.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';
import { createMaterials } from './materials.js';
import { createBoardMesh, createPieceMasterMeshes, instantiatePiece, squareToVector3, BOARD_FILES, BOARD_RANKS } from './meshes.js';
import { initPhysics, attachPiecePhysics, resetPieceKinematic } from './physics.js';
import { animatePieceMove, toppleKing } from './animations.js';
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

  // 2. Babylon Engine
  const engine = new BABYLON.Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    powerPreference: 'high-performance'
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

  // 3. Scene
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.04, 0.07, 0.12, 1.0);

  // 4. ArcRotateCamera with smooth inertia and limits
  const camera = new BABYLON.ArcRotateCamera(
    'camera3d',
    -Math.PI / 2, // Facing white by default
    Math.PI / 3.0, // ~60 degrees angle down
    14.6,
    new BABYLON.Vector3(0, 0, 0),
    scene
  );
  camera.attachControl(canvas, true);
  camera.inertia = 0.82;
  camera.lowerBetaLimit = 0.22;
  camera.upperBetaLimit = Math.PI / 2.25; // Prevents clipping under table
  camera.lowerRadiusLimit = 8.0;
  camera.upperRadiusLimit = 22.0;
  camera.wheelPrecision = 28;
  camera.pinchPrecision = 28;

  // 5. Lights & PCF Shadows
  const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.65;
  hemiLight.groundColor = new BABYLON.Color3(0.12, 0.15, 0.2);

  const dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.6, -1.4, -0.75), scene);
  dirLight.position = new BABYLON.Vector3(6.5, 14, 8.0);
  dirLight.intensity = 1.35;

  const shadowGen = new BABYLON.ShadowGenerator(2048, dirLight);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.filteringQuality = BABYLON.ShadowGenerator.QUALITY_MEDIUM;
  shadowGen.bias = 0.0018;
  shadowGen.normalBias = 0.01;

  // 6. Post-Processing Pipeline (ACES tone mapping, bloom, FXAA)
  const pipeline = new BABYLON.DefaultRenderingPipeline('pipeline', true, scene, [camera]);
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.72;
  pipeline.bloomWeight = 0.16;
  pipeline.bloomKernel = 32;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;

  // 7. Initialize Havok Physics
  await initPhysics(scene);

  // 8. Materials & Meshes
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
  let pieceIdCounter = 0;
  let currentOrientation = 'white';

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

  // 11. State Synchronization
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

    // Sync board orientation camera rotation smoothly
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

    // Sync FEN layout
    if (fen) {
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

    // Highlights: Legal move dots
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

    // Highlights: Check pulse under King
    if (inCheck) {
      // Find King square of current turn
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

    // Checkmate topple
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

    // Clean up or move existing pieces
    const newPieceBySquare = new Map();
    const remainingTargets = new Map(targetBoard);

    // Keep pieces that already match their square
    for (const [sq, piece] of pieceBySquare.entries()) {
      const target = remainingTargets.get(sq);
      if (target && piece.metadata.pieceType === target.type && piece.metadata.color === target.color) {
        newPieceBySquare.set(sq, piece);
        remainingTargets.delete(sq);
      } else {
        // Recycle or dispose mesh
        piece.dispose();
      }
    }

    // Instantiate newly arrived pieces
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

  /**
   * Animate move from moveObj { from, to, promotion }
   */
  async function animateMove(moveObj, newFen) {
    if (!moveObj || !moveObj.from || !moveObj.to) {
      if (newFen) syncPiecesFromFen(newFen);
      return;
    }

    const { from, to } = moveObj;
    const movingPiece = pieceBySquare.get(from);
    const capturedPiece = pieceBySquare.get(to);

    if (movingPiece) {
      const targetPos = squareToVector3(to);
      const isKnight = movingPiece.metadata.pieceType === 'n';

      await animatePieceMove(movingPiece, targetPos, {
        isKnight,
        capturedPieceMesh: capturedPiece,
        durationMs: 300
      });
    }

    if (newFen) {
      syncPiecesFromFen(newFen);
    }
  }

  // 12. Render Loop & Resize Handling
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
