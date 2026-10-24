/**
 * assets/src/board3d/animations.js
 * Kinematic move arcs, Havok physical capture impulses, king topple, and sound synthesis.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';
import { resetPieceKinematic } from './physics.js';

let audioCtx = null;

/**
 * Procedural wooden piece "clack" using Web Audio API.
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
    filter.frequency.setValueAtTime(isCapture ? 360 : 540, t);
    filter.Q.setValueAtTime(3.5, t);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isCapture ? 210 : 280, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.08);

    gain.gain.setValueAtTime(isCapture ? 0.45 : 0.28, t);
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

  if (pieceMesh.physicsAggregate) {
    pieceMesh.physicsAggregate.body.disablePreStep = false;
  }

  const startPos = pieceMesh.position.clone();
  const startTime = performance.now();
  const peakHeight = isKnight ? 1.25 : 0.65;
  const rotY = pieceMesh.metadata?.pieceType === 'n'
    ? (pieceMesh.metadata.color === 'w' ? 0 : Math.PI)
    : 0;

  let captureHandled = false;

  return new Promise((resolve) => {
    const scene = pieceMesh.getScene();
    const observer = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / durationMs);

      // Smooth ease-in-out curve
      const easeT = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      // Parabolic vertical lift
      const arcY = 4 * peakHeight * progress * (1 - progress);

      pieceMesh.position.x = BABYLON.Scalar.Lerp(startPos.x, targetPos.x, easeT);
      pieceMesh.position.z = BABYLON.Scalar.Lerp(startPos.z, targetPos.z, easeT);
      pieceMesh.position.y = arcY;

      // Gentle forward pitch during move
      const pitch = Math.sin(Math.PI * progress) * 0.12;
      const dirX = targetPos.x - startPos.x;
      const dirZ = targetPos.z - startPos.z;
      const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      const pitchX = (dirZ / len) * pitch;
      const rollZ = -(dirX / len) * pitch;

      if (pieceMesh.rotationQuaternion) {
        pieceMesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(rotY, pitchX, rollZ);
      } else {
        pieceMesh.rotation.set(pitchX, rotY, rollZ);
      }

      // Trigger capture physical knockdown midway through the arc
      if (capturedPieceMesh && !captureHandled && progress >= 0.60) {
        captureHandled = true;
        toppleCapturedPiece(capturedPieceMesh, targetPos);
      }

      if (progress >= 1.0) {
        scene.onBeforeRenderObservable.remove(observer);
        resetPieceKinematic(pieceMesh, targetPos);
        playPieceClack(!!capturedPieceMesh);

        if (onComplete) onComplete();
        resolve();
      }
    });
  });
}

/**
 * Applies dynamic Havok impulse to a captured piece, tossing it realistically into the side felt tray.
 */
export function toppleCapturedPiece(pieceMesh, attackerPos) {
  if (!pieceMesh) return;

  if (pieceMesh.physicsAggregate) {
    const body = pieceMesh.physicsAggregate.body;
    body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);

    // Direction away from board center towards outer felt trays
    const trayDirection = pieceMesh.position.x >= 0 ? 1 : -1;
    body.setLinearVelocity(new BABYLON.Vector3(
      trayDirection * (2.4 + Math.random() * 1.0),
      1.8 + Math.random() * 0.8,
      (Math.random() - 0.5) * 1.5
    ));

    const impulse = new BABYLON.Vector3(
      trayDirection * (2.8 + Math.random() * 1.2),
      2.0 + Math.random() * 1.0,
      (Math.random() - 0.5) * 1.8
    );

    // Hit high on the piece body to cause dramatic toppling torque
    const contactPoint = pieceMesh.position.clone().add(new BABYLON.Vector3(0, 0.65, 0));
    body.applyImpulse(impulse, contactPoint);

    // Add spin torque
    body.applyAngularImpulse(new BABYLON.Vector3(
      (Math.random() - 0.5) * 2.5,
      Math.random() * 1.5,
      (Math.random() - 0.5) * 2.5
    ));
  } else {
    // Non-physics smooth slide fallback
    const targetX = pieceMesh.position.x >= 0 ? 5.15 : -5.15;
    const targetZ = (Math.random() - 0.5) * 6.0;
    const scene = pieceMesh.getScene();
    const startP = pieceMesh.position.clone();
    const startR = pieceMesh.rotation.clone();
    const startT = performance.now();

    const slideObserver = scene.onBeforeRenderObservable.add(() => {
      const p = Math.min(1.0, (performance.now() - startT) / 450);
      pieceMesh.position.x = BABYLON.Scalar.Lerp(startP.x, targetX, p);
      pieceMesh.position.z = BABYLON.Scalar.Lerp(startP.z, targetZ, p);
      pieceMesh.position.y = Math.sin(p * Math.PI) * 0.4 - 0.05 * p;
      pieceMesh.rotation.z = BABYLON.Scalar.Lerp(startR.z, Math.PI / 2.2, p);
      if (p >= 1.0) {
        scene.onBeforeRenderObservable.remove(slideObserver);
      }
    });
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
    // Angular impulse to tip over
    body.applyImpulse(
      new BABYLON.Vector3((Math.random() - 0.5) * 0.6, 0.15, (Math.random() - 0.5) * 0.6),
      kingMesh.position.clone().add(new BABYLON.Vector3(0, 1.9, 0))
    );
  } else {
    kingMesh.rotation.z = Math.PI / 2.25;
  }
}
