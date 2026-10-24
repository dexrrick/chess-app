/**
 * assets/src/board3d/physics.js
 * Havok physics world initialization, table surface colliders, sunken felt tray colliders,
 * and piece physics aggregates.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

let havokPromise = null;

async function getHavokInstance() {
  if (!havokPromise) {
    havokPromise = (async () => {
      const mod = await import('../../vendor/babylon/HavokPhysics_es.js');
      const HavokPhysics = mod.default;
      return HavokPhysics({
        locateFile: (path) => `/vendor/babylon/${path}`
      });
    })();
  }
  return havokPromise;
}

export async function initPhysics(scene) {
  try {
    const havokInstance = await getHavokInstance();
    const hkPlugin = new BABYLON.HavokPlugin(true, havokInstance);
    // Gravity: realistic downward pull
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81 * 2.5, 0), hkPlugin);

    // 1. Static Chess Board Ground Collider
    const boardGround = BABYLON.MeshBuilder.CreateBox(
      'physics_board_ground',
      { width: 8.3, depth: 8.3, height: 0.2 },
      scene
    );
    boardGround.position.set(0, -0.10, 0);
    boardGround.isVisible = false;
    new BABYLON.PhysicsAggregate(
      boardGround,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 0, restitution: 0.15, friction: 0.65 },
      scene
    );

    // 2. Left and Right Sunken Felt Tray Colliders (high friction so captured pieces settle)
    const trayL = BABYLON.MeshBuilder.CreateBox('physics_tray_l', { width: 1.8, depth: 8.5, height: 0.2 }, scene);
    trayL.position.set(-4.95, -0.12, 0);
    trayL.isVisible = false;
    new BABYLON.PhysicsAggregate(trayL, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.85, restitution: 0.1 }, scene);

    const trayR = BABYLON.MeshBuilder.CreateBox('physics_tray_r', { width: 1.8, depth: 8.5, height: 0.2 }, scene);
    trayR.position.set(4.95, -0.12, 0);
    trayR.isVisible = false;
    new BABYLON.PhysicsAggregate(trayR, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.85, restitution: 0.1 }, scene);

    // 3. Perimeter Lips around the table edges to contain tumbled pieces
    const lips = [
      { name: 'lip_n', pos: [0, 0.25, 4.85], size: [12.4, 0.6, 0.4] },
      { name: 'lip_s', pos: [0, 0.25, -4.85], size: [12.4, 0.6, 0.4] },
      { name: 'lip_w', pos: [-6.05, 0.25, 0], size: [0.4, 0.6, 10.0] },
      { name: 'lip_e', pos: [6.05, 0.25, 0], size: [0.4, 0.6, 10.0] }
    ];
    lips.forEach(({ name, pos, size }) => {
      const lip = BABYLON.MeshBuilder.CreateBox(`physics_${name}`, { width: size[0], height: size[1], depth: size[2] }, scene);
      lip.position.set(pos[0], pos[1], pos[2]);
      lip.isVisible = false;
      new BABYLON.PhysicsAggregate(lip, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);
    });

    return hkPlugin;
  } catch (err) {
    console.error('Failed to initialize Havok physics:', err);
    return null;
  }
}

/**
 * Attaches a hybrid kinematic/dynamic Havok PhysicsAggregate to a piece.
 */
export function attachPiecePhysics(pieceMesh, scene) {
  if (!scene.isPhysicsEnabled()) return null;

  try {
    const agg = new BABYLON.PhysicsAggregate(
      pieceMesh,
      BABYLON.PhysicsShapeType.CYLINDER,
      {
        mass: 1.0,
        restitution: 0.18,
        friction: 0.60
      },
      scene
    );

    // Standing pieces are ANIMATED (kinematic): strictly anchored to algebraic squares
    agg.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
    agg.body.disablePreStep = false; // Allow manual transform updates from JavaScript tweens
    pieceMesh.physicsAggregate = agg;
    return agg;
  } catch (err) {
    console.warn('attachPiecePhysics error:', err);
    return null;
  }
}

/**
 * Resets a piece back to kinematic mode standing upright at target position.
 */
export function resetPieceKinematic(pieceMesh, targetPos) {
  if (pieceMesh.physicsAggregate) {
    const body = pieceMesh.physicsAggregate.body;
    body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
    body.disablePreStep = false;
    body.setLinearVelocity(BABYLON.Vector3.Zero());
    body.setAngularVelocity(BABYLON.Vector3.Zero());
  }

  pieceMesh.position.copyFrom(targetPos);
  // Knights face opponent; all other pieces face forward
  const rotY = pieceMesh.metadata?.pieceType === 'n'
    ? (pieceMesh.metadata.color === 'w' ? 0 : Math.PI)
    : 0;

  if (pieceMesh.rotationQuaternion) {
    pieceMesh.rotationQuaternion = BABYLON.Quaternion.RotationYawPitchRoll(rotY, 0, 0);
  } else {
    pieceMesh.rotation.set(0, rotY, 0);
  }
}
