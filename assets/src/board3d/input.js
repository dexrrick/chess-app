/**
 * assets/src/board3d/input.js
 * Unified touch, pointer, tap-to-move, and drag-and-drop controller for iPadOS and desktop.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';
import { squareToVector3, vector3ToSquare, SQUARE_SIZE } from './meshes.js';

export function createInputController(scene, camera, canvas, callbacks) {
  let selectedSquare = null;
  let legalMoves = [];
  let turn = 'w';
  let isInteractive = true;
  let getPieceAtSquare = null;

  // Pointer drag state
  let dragCandidate = null;
  let isDragging = false;
  let dragPiece = null;
  let dragFromSquare = null;
  let currentHoverSquare = null;
  const DRAG_THRESHOLD = 6; // pixels

  // Horizontal raycast drag plane at levitation height
  const dragPlane = BABYLON.Plane.FromPositionAndNormal(
    new BABYLON.Vector3(0, 0.85, 0),
    new BABYLON.Vector3(0, 1, 0)
  );

  function setInteractive(enabled) {
    isInteractive = enabled;
    if (!enabled && isDragging) {
      cancelDrag();
    }
  }

  function setTurn(newTurn) {
    turn = newTurn;
  }

  function setGetPieceFn(fn) {
    getPieceAtSquare = fn;
  }

  function setSelected(sq, legals = []) {
    selectedSquare = sq;
    legalMoves = legals;
  }

  function cancelDrag() {
    if (dragPiece && dragFromSquare) {
      const origPos = squareToVector3(dragFromSquare);
      dragPiece.position.copyFrom(origPos);
      dragPiece.position.y = 0;
    }
    isDragging = false;
    dragCandidate = null;
    dragPiece = null;
    dragFromSquare = null;
    currentHoverSquare = null;
    camera.attachControl(canvas, true);
  }

  function pickSquareOrPiece(pointerX, pointerY) {
    const pickResult = scene.pick(pointerX, pointerY, (mesh) => {
      return (mesh.metadata && (mesh.metadata.isPiece || mesh.metadata.isSquare));
    });

    if (!pickResult || !pickResult.hit || !pickResult.pickedMesh) {
      return null;
    }

    const mesh = pickResult.pickedMesh;
    if (mesh.metadata.isPiece) {
      return { square: mesh.metadata.square, piece: mesh };
    }
    if (mesh.metadata.isSquare) {
      const sq = mesh.metadata.square;
      const piece = getPieceAtSquare ? getPieceAtSquare(sq) : null;
      return { square: sq, piece };
    }
    return null;
  }

  // Pointer event listeners
  const onPointerDown = (evt) => {
    if (!isInteractive || evt.button !== 0) return;

    const hit = pickSquareOrPiece(scene.pointerX, scene.pointerY);
    if (!hit) {
      dragCandidate = null;
      return;
    }

    const { square, piece } = hit;

    // Check if clicked an already selected piece/target
    if (selectedSquare && legalMoves.includes(square)) {
      // Tap-to-move destination
      callbacks.onMoveAttempt(selectedSquare, square);
      return;
    }

    if (piece && piece.metadata.color === turn) {
      dragCandidate = {
        startX: scene.pointerX,
        startY: scene.pointerY,
        piece,
        square
      };
    } else {
      dragCandidate = null;
      if (square) {
        callbacks.onSquareSelect(square);
      }
    }
  };

  const onPointerMove = () => {
    if (!isInteractive) return;

    // Check start of drag
    if (dragCandidate && !isDragging) {
      const dx = scene.pointerX - dragCandidate.startX;
      const dy = scene.pointerY - dragCandidate.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist >= DRAG_THRESHOLD) {
        isDragging = true;
        dragPiece = dragCandidate.piece;
        dragFromSquare = dragCandidate.square;
        dragCandidate = null;

        // Detach camera orbit while dragging piece
        camera.detachControl();

        // Lift piece slightly
        dragPiece.position.y = 0.85;

        // Trigger selection in app
        callbacks.onSquareSelect(dragFromSquare);
      }
    }

    // Active drag raycasting
    if (isDragging && dragPiece) {
      const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, BABYLON.Matrix.Identity(), camera);
      const distance = ray.intersectsPlane(dragPlane);

      if (distance !== null) {
        const intersection = ray.origin.add(ray.direction.scale(distance));
        // Clamp to board perimeter
        dragPiece.position.x = Math.max(-4.2, Math.min(4.2, intersection.x));
        dragPiece.position.z = Math.max(-4.2, Math.min(4.2, intersection.z));

        const hovered = vector3ToSquare(dragPiece.position);
        if (hovered !== currentHoverSquare) {
          currentHoverSquare = hovered;
          callbacks.onHoverSquare?.(hovered);
        }
      }
    }
  };

  const onPointerUp = () => {
    if (!isInteractive) return;

    if (isDragging) {
      const from = dragFromSquare;
      const to = currentHoverSquare;
      const piece = dragPiece;

      isDragging = false;
      dragCandidate = null;
      dragPiece = null;
      dragFromSquare = null;
      currentHoverSquare = null;
      callbacks.onHoverSquare?.(null);

      camera.attachControl(canvas, true);

      if (from && to && legalMoves.includes(to)) {
        // Move attempt
        callbacks.onMoveAttempt(from, to);
      } else {
        // Snap back to starting square
        const origPos = squareToVector3(from);
        piece.position.copyFrom(origPos);
        piece.position.y = 0;
      }
      return;
    }

    if (dragCandidate) {
      // It was a tap / click without drag
      const { square } = dragCandidate;
      dragCandidate = null;
      callbacks.onSquareSelect(square);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', cancelDrag);

  function dispose() {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', cancelDrag);
    cancelDrag();
  }

  return {
    setInteractive,
    setTurn,
    setSelected,
    setGetPieceFn,
    dispose
  };
}
