/**
 * assets/src/board3d/animations.js
 * Kinematic move arcs, Havok physical capture impulses, king topple, and sound synthesis.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';
import { resetPieceKinematic } from './physics.js';

let audioCtx = null;

/**
 * Procedural wooden piece "clack" using Web Audio API (zero external sound files).
 */
export function playPieceClack(isCapture = false) {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isCapture ? 340 : 520, t);
    filter.Q.setValueAtTime(3.8, t);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isCapture ? 190 : 260, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.08);

    gain.gain.setValueAtTime(isCapture ? 0.42 : 0.26, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(t);
    osc.stop(t + 0.08);
  } catch {
    // Ignore audio permission/context errors
  }
}

/**
 * Animates a piece moving from its current position to target square in a parabolic arc.
 */
export function animatePieceMove(pieceMesh, targetPos, options = {}) {
  const {
    durationMs = 320,
    isKnight = false,
    capturedPieceMesh = null,
    onComplete = null
  } = options;

  const startPos = pieceMesh.position.clone();
  const startTime = performance.now();
  const peakHeight = isKnight ? 1.3 : 0.65;

  let captureHandled = false;

  return new Promise((resolve) => {
    const observer = pieceMesh.getScene().onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / durationMs);

      // Smooth ease in-out quadratic
      const easeT = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Parabolic arc Y
      const arcY = 4 * peakHeight * progress * (1 - progress);

      pieceMesh.position.x = BABYLON.Scalar.Lerp(startPos.x, targetPos.x, easeT);
      pieceMesh.position.z = BABYLON.Scalar.Lerp(startPos.z, targetPos.z, easeT);
      pieceMesh.position.y = arcY;

      // Trigger capture physical tumble just before landing
      if (capturedPieceMesh && !captureHandled && progress >= 0.72) {
        captureHandled = true;
        toppleCapturedPiece(capturedPieceMesh, targetPos);
      }

      if (progress >= 1.0) {
        pieceMesh.getScene().onBeforeRenderObservable.remove(observer);
        resetPieceKinematic(pieceMesh, targetPos);
        playPieceClack(!!capturedPieceMesh);

        if (onComplete) onComplete();
        resolve();
      }
    });
  });
}

/**
 * Applies dynamic Havok impulse to a captured piece, tossing it into side graveyard.
 */
export function toppleCapturedPiece(pieceMesh, attackerPos) {
  if (!pieceMesh) return;

  if (pieceMesh.physicsAggregate) {
    const body = pieceMesh.physicsAggregate.body;
    body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);

    // Direction away from attacker towards outer board flanks
    const trayDirection = pieceMesh.position.x >= 0 ? 1 : -1;
    const impulse = new BABYLON.Vector3(
      trayDirection * (2.8 + Math.random() * 1.5),
      2.2 + Math.random() * 1.2,
      (Math.random() - 0.5) * 2.0
    );

    const contactPoint = pieceMesh.position.clone().add(new BABYLON.Vector3(0, 0.4, 0));
    body.applyImpulse(impulse, contactPoint);

    // Add spin torque
    body.applyAngularImpulse(new BABYLON.Vector3(
      (Math.random() - 0.5) * 1.8,
      Math.random() * 1.2,
      (Math.random() - 0.5) * 1.8
    ));
  } else {
    // Non-physics fallback slide to graveyard
    const sideX = pieceMesh.position.x >= 0 ? 5.8 : -5.8;
    pieceMesh.position.set(sideX, -0.2, (Math.random() - 0.5) * 6.0);
  }
}

/**
 * Defeated King topple animation on checkmate.
 */
export function toppleKing(kingMesh) {
  if (!kingMesh) return;

  if (kingMesh.physicsAggregate) {
    const body = kingMesh.physicsAggregate.body;
    body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);
    // Gentle tipping impulse
    body.applyImpulse(
      new BABYLON.Vector3((Math.random() - 0.5) * 0.4, 0.1, (Math.random() - 0.5) * 0.4),
      kingMesh.position.clone().add(new BABYLON.Vector3(0, 1.8, 0))
    );
  } else {
    // Fallback rotation
    kingMesh.rotation.z = Math.PI / 2.3;
  }
}
