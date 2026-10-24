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
    if (typeof window === 'undefined') return;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
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
    osc.stop(t + 0.09);
  } catch {
    // Ignore audio permission/context errors
  }
}

/**
 * Play a move sound - proper move/capture sounds
 */
export function playMoveSound(isCapture = false) {
  playPieceClack(isCapture);
}

/**
 * Animates a piece moving from its current position to target square in a parabolic arc.
 * Uses Babylon Animation system for smooth 60fps animations.
 */
export function animatePieceMove(pieceMesh, targetPos, options = {}) {
  const {
    durationMs = 320,
    isKnight = false,
    capturedPieceMesh = null,
    onComplete = null
  } = options;

  if (!pieceMesh) {
    if (onComplete) onComplete();
    return Promise.resolve();
  }

  if (pieceMesh.physicsAggregate) {
    try {
      pieceMesh.physicsAggregate.body.disablePreStep = false;
    } catch {}
  }

  const scene = pieceMesh.getScene();
  const startPos = pieceMesh.position.clone();
  const target = targetPos.clone ? targetPos.clone() : new BABYLON.Vector3(targetPos.x, targetPos.y, targetPos.z);
  const peakHeight = isKnight ? 1.25 : 0.65;
  const rotY = pieceMesh.metadata?.pieceType === 'n'
    ? (pieceMesh.metadata.color === 'w' ? 0 : Math.PI)
    : 0;

  let captureHandled = false;
  let animGroup = null;

  return new Promise((resolve) => {
    try {
      // Create animation group for better performance and smoother animation
      animGroup = new BABYLON.AnimationGroup('moveAnim_' + Date.now());
      
      const frameRate = 60;
      const totalFrames = Math.max(1, Math.round((durationMs / 1000) * frameRate));
      
      // Position animation with custom easing
      const posAnim = new BABYLON.Animation(
        'movePos',
        'position',
        frameRate,
        BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
        BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
      );
      
      const keys = [];
      for (let i = 0; i <= totalFrames; i++) {
        const progress = i / totalFrames;
        // Smooth ease-in-out curve (cubic bezier-like)
        const easeT = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        const arcY = 4 * peakHeight * progress * (1 - progress);
        
        const x = BABYLON.Scalar.Lerp(startPos.x, target.x, easeT);
        const z = BABYLON.Scalar.Lerp(startPos.z, target.z, easeT);
        const y = arcY;
        keys.push({ frame: i, value: new BABYLON.Vector3(x, y, z) });
      }
      posAnim.setKeys(keys);
      
      // Add easing function for extra smoothness
      const easingFunction = new BABYLON.CubicEase();
      easingFunction.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
      posAnim.setEasingFunction(easingFunction);
      
      animGroup.addTargetedAnimation(posAnim, pieceMesh);
      
      // Rotation animation
      if (pieceMesh.rotationQuaternion || pieceMesh.rotation) {
        const rotAnim = new BABYLON.Animation(
          'moveRot',
          pieceMesh.rotationQuaternion ? 'rotationQuaternion' : 'rotation',
          frameRate,
          pieceMesh.rotationQuaternion ? BABYLON.Animation.ANIMATIONTYPE_QUATERNION : BABYLON.Animation.ANIMATIONTYPE_VECTOR3,
          BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT
        );
        const rotKeys = [];
        for (let i = 0; i <= totalFrames; i++) {
          const progress = i / totalFrames;
          const pitch = Math.sin(Math.PI * progress) * 0.12;
          const dirX = target.x - startPos.x;
          const dirZ = target.z - startPos.z;
          const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
          const pitchX = (dirZ / len) * pitch;
          const rollZ = -(dirX / len) * pitch;
          
          if (pieceMesh.rotationQuaternion) {
            rotKeys.push({ frame: i, value: BABYLON.Quaternion.RotationYawPitchRoll(rotY, pitchX, rollZ) });
          } else {
            rotKeys.push({ frame: i, value: new BABYLON.Vector3(pitchX, rotY, rollZ) });
          }
        }
        rotAnim.setKeys(rotKeys);
        const rotEase = new BABYLON.SineEase();
        rotEase.setEasingMode(BABYLON.EasingFunction.EASINGMODE_EASEINOUT);
        rotAnim.setEasingFunction(rotEase);
        animGroup.addTargetedAnimation(rotAnim, pieceMesh);
      }
      
      // Use time-based progress for capture timing (more reliable than AnimationGroup currentFrame)
      const animStartTime = performance.now();
      let observer = null;
      const checkCapture = () => {
        if (capturedPieceMesh && !captureHandled) {
          const elapsed = performance.now() - animStartTime;
          const progress = Math.min(1.0, elapsed / durationMs);
          if (progress >= 0.60) {
            captureHandled = true;
            try {
              toppleCapturedPiece(capturedPieceMesh, target);
            } catch (e) {
              console.error('toppleCapturedPiece error:', e);
            }
            if (observer) {
              scene.onBeforeRenderObservable.remove(observer);
              observer = null;
            }
          }
        }
      };
      
      observer = scene.onBeforeRenderObservable.add(checkCapture);
      
      animGroup.onAnimationGroupEndObservable.add(() => {
        if (observer) {
          scene.onBeforeRenderObservable.remove(observer);
          observer = null;
        }
        try {
          resetPieceKinematic(pieceMesh, target);
        } catch (e) {
          console.error('resetPieceKinematic error:', e);
        }
        try {
          playPieceClack(!!capturedPieceMesh);
        } catch {}
        if (onComplete) {
          try {
            onComplete();
          } catch {}
        }
        resolve();
      });
      
      animGroup.play(false);
    } catch (err) {
      console.error('Animation error:', err);
      // Fallback to simple time-based animation
      try {
        const startTime = performance.now();
        let captureHandled = false;
        const observer = scene.onBeforeRenderObservable.add(() => {
          const elapsed = performance.now() - startTime;
          const progress = Math.min(1.0, elapsed / durationMs);
          const easeT = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
          const arcY = 4 * peakHeight * progress * (1 - progress);
          pieceMesh.position.x = BABYLON.Scalar.Lerp(startPos.x, target.x, easeT);
          pieceMesh.position.z = BABYLON.Scalar.Lerp(startPos.z, target.z, easeT);
          pieceMesh.position.y = arcY;
          const pitch = Math.sin(Math.PI * progress) * 0.12;
          const dirX = target.x - startPos.x;
          const dirZ = target.z - startPos.z;
          const len = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
          const pitchX = (dirZ / len) * pitch;
          const rollZ = -(dirX / len) * pitch;
          if (pieceMesh.rotationQuaternion) {
            pieceMesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(rotY, pitchX, rollZ);
          } else {
            pieceMesh.rotation.set(pitchX, rotY, rollZ);
          }
          if (capturedPieceMesh && !captureHandled && progress >= 0.60) {
            captureHandled = true;
            try { toppleCapturedPiece(capturedPieceMesh, target); } catch {}
          }
          if (progress >= 1.0) {
            scene.onBeforeRenderObservable.remove(observer);
            try { resetPieceKinematic(pieceMesh, target); } catch {}
            try { playPieceClack(!!capturedPieceMesh); } catch {}
            if (onComplete) { try { onComplete(); } catch {} }
            resolve();
          }
        });
      } catch (e) {
        try { resetPieceKinematic(pieceMesh, target); } catch {}
        try { playPieceClack(!!capturedPieceMesh); } catch {}
        if (onComplete) { try { onComplete(); } catch {} }
        resolve();
      }
    }
  });
}

/**
 * Applies dynamic Havok impulse to a captured piece, tossing it realistically into the side felt tray.
 */
export function toppleCapturedPiece(pieceMesh, attackerPos) {
  if (!pieceMesh) return;

  const scene = pieceMesh.getScene();
  const trayDirection = pieceMesh.position.x >= 0 ? 1 : -1;
  const targetX = trayDirection * 5.15;
  const targetZ = (Math.random() - 0.5) * 6.0;
  const startPos = pieceMesh.position.clone();
  const startRot = pieceMesh.rotationQuaternion ? pieceMesh.rotationQuaternion.clone() : pieceMesh.rotation.clone();
  const startTime = performance.now();
  const duration = 600; // ms

  // Always animate position to tray for guaranteed visual movement
  const posObserver = scene.onBeforeRenderObservable.add(() => {
    const elapsed = performance.now() - startTime;
    const p = Math.min(1.0, elapsed / duration);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    pieceMesh.position.x = BABYLON.Scalar.Lerp(startPos.x, targetX, ease);
    pieceMesh.position.z = BABYLON.Scalar.Lerp(startPos.z, targetZ, ease);
    // Arc up then down
    pieceMesh.position.y = startPos.y + Math.sin(p * Math.PI) * 0.5;
    if (p >= 1.0) {
      scene.onBeforeRenderObservable.remove(posObserver);
      // Ensure piece stays in graveyard
      if (pieceMesh.physicsAggregate) {
        pieceMesh.physicsAggregate.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
      }
    }
  });

  // Also apply physics impulses for tumbling effect (if physics available)
  try {
    if (pieceMesh.physicsAggregate && pieceMesh.physicsAggregate.body) {
      const body = pieceMesh.physicsAggregate.body;
      body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);
      try {
        body.setLinearVelocity(BABYLON.Vector3.Zero());
        body.setAngularVelocity(BABYLON.Vector3.Zero());
      } catch {}

      // Linear impulse toward tray
      body.setLinearVelocity(new BABYLON.Vector3(
        trayDirection * (3.4 + Math.random() * 1.4),
        2.4 + Math.random() * 1.0,
        (Math.random() - 0.5) * 2.0
      ));

      // Impulse at high point for toppling torque
      const contactPoint = pieceMesh.position.clone().add(new BABYLON.Vector3(0, 0.75, 0));
      body.applyImpulse(new BABYLON.Vector3(
        trayDirection * (3.8 + Math.random() * 1.6),
        2.6 + Math.random() * 1.2,
        (Math.random() - 0.5) * 2.2
      ), contactPoint);

      // Spin torque for tumbling
      body.applyAngularImpulse(new BABYLON.Vector3(
        (Math.random() - 0.5) * 3.2,
        Math.random() * 2.0,
        (Math.random() - 0.5) * 3.2
      ));

      // Also animate rotation for guaranteed topple visual
      const rotObserver = scene.onBeforeRenderObservable.add(() => {
        const elapsed = performance.now() - startTime;
        const p = Math.min(1.0, elapsed / duration);
        if (pieceMesh.rotationQuaternion) {
          const targetRot = BABYLON.Quaternion.RotationYawPitchRoll(
            pieceMesh.metadata?.color === 'w' ? 0 : Math.PI,
            Math.PI / 2.2,
            (Math.random() - 0.5) * 0.5
          );
          BABYLON.Quaternion.SlerpToRef(startRot, targetRot, p, pieceMesh.rotationQuaternion);
        } else {
          pieceMesh.rotation.z = BABYLON.Scalar.Lerp(startRot.z || 0, Math.PI / 2.2, p);
        }
        if (p >= 1.0) {
          scene.onBeforeRenderObservable.remove(rotObserver);
        }
      });
    }
  } catch (e) {
    console.error('Physics topple error:', e);
    // Physics failed, but position animation still runs
  }
}

/**
 * Defeated King topple animation on checkmate.
 */
export function toppleKing(kingMesh) {
  if (!kingMesh) return;

  const scene = kingMesh.getScene();
  const startRot = kingMesh.rotationQuaternion ? kingMesh.rotationQuaternion.clone() : kingMesh.rotation.clone();
  const startTime = performance.now();
  const duration = 800;

  // Guaranteed rotation animation
  const rotObserver = scene.onBeforeRenderObservable.add(() => {
    const p = Math.min(1.0, (performance.now() - startTime) / duration);
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    if (kingMesh.rotationQuaternion) {
      const targetRot = BABYLON.Quaternion.RotationYawPitchRoll(0, 0, Math.PI / 2.25);
      BABYLON.Quaternion.SlerpToRef(startRot, targetRot, ease, kingMesh.rotationQuaternion);
    } else {
      kingMesh.rotation.z = BABYLON.Scalar.Lerp(startRot.z || 0, Math.PI / 2.25, ease);
    }
    if (p >= 1.0) {
      scene.onBeforeRenderObservable.remove(rotObserver);
    }
  });

  // Also apply physics impulse if available
  try {
    if (kingMesh.physicsAggregate && kingMesh.physicsAggregate.body) {
      const body = kingMesh.physicsAggregate.body;
      body.setMotionType(BABYLON.PhysicsMotionType.DYNAMIC);
      try {
        body.setLinearVelocity(BABYLON.Vector3.Zero());
        body.setAngularVelocity(BABYLON.Vector3.Zero());
      } catch {}
      body.applyImpulse(
        new BABYLON.Vector3((Math.random() - 0.5) * 1.2, 0.4, (Math.random() - 0.5) * 1.2),
        kingMesh.position.clone().add(new BABYLON.Vector3(0, 2.0, 0))
      );
      body.applyAngularImpulse(new BABYLON.Vector3((Math.random() - 0.5) * 2.5, Math.random() * 0.5, (Math.random() - 0.5) * 2.5));
    }
  } catch (e) {
    console.error('toppleKing physics error:', e);
  }
}
