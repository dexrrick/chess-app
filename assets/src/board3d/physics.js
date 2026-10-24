/**
 * assets/src/board3d/physics.js
 * Havok physics world initialization, colliders, and piece physics aggregates.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

let havokPromise = null;

async function getHavokInstance() {
  if (!havokPromise) {
    havokPromise = (async () => {
      const mod = await import('../../vendor/babylon/HavokPhysics_es.js');
      const HavokPhysics = mod.default;
      return HavokPhysics({
        locateFile: (path) => {
          // Absolute path works with local serve & worker
          return `/vendor/babylon/${path}`;
        }
      });
    })();
  }
  return havokPromise;
}

export async function initPhysics(scene) {
  try {
    const havokInstance = await getHavokInstance();
    const hkPlugin = new BABYLON.HavokPlugin(true, havokInstance);
    scene.enablePhysics(new BABYLON.Vector3(0, -9.81 * 2, 0), hkPlugin);

    // 1. Static Board Surface Collider
    const boardGround = BABYLON.MeshBuilder.CreateBox(
      'physics_board_ground',
      { width: 8.4, depth: 8.4, height: 0.2 },
      scene
    );
    boardGround.position.set(0, -0.1, 0);
    boardGround.isVisible = false;
    new BABYLON.PhysicsAggregate(
      boardGround,
      BABYLON.PhysicsShapeType.BOX,
      { mass: 0, restitution: 0.1, friction: 0.7 },
      scene
    );

    // 2. Graveyard Trays Colliders (left and right)
    const trayL = BABYLON.MeshBuilder.CreateBox('physics_tray_l', { width: 2.2, depth: 8.8, height: 0.3 }, scene);
    trayL.position.set(-5.8, -0.15, 0);
    trayL.isVisible = false;
    new BABYLON.PhysicsAggregate(trayL, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);

    const trayR = BABYLON.MeshBuilder.CreateBox('physics_tray_r', { width: 2.2, depth: 8.8, height: 0.3 }, scene);
    trayR.position.set(5.8, -0.15, 0);
    trayR.isVisible = false;
    new BABYLON.PhysicsAggregate(trayR, BABYLON.PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, scene);

    // 3. Perimeter Lips to prevent tumbling pieces from falling into infinite void
    const lips = [
      { name: 'lip_n', pos: [0, 0.2, 4.8], size: [14.0, 0.6, 0.4] },
      { name: 'lip_s', pos: [0, 0.2, -4.8], size: [14.0, 0.6, 0.4] },
      { name: 'lip_w', pos: [-7.0, 0.2, 0], size: [0.4, 0.6, 10.0] },
      { name: 'lip_e', pos: [7.0, 0.2, 0], size: [0.4, 0.6, 10.0] }
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
 * Attaches a kinematic/dynamic Havok PhysicsAggregate to a piece.
 */
export function attachPiecePhysics(pieceMesh, scene) {
  if (!scene.isPhysicsEnabled()) return null;

  try {
    const agg = new BABYLON.PhysicsAggregate(
      pieceMesh,
      BABYLON.PhysicsShapeType.CYLINDER,
      {
        mass: 1.0,
        restitution: 0.12,
        friction: 0.65
      },
      scene
    );

    // Kinematic by default — avoids drift, snapping precisely to algebraic coordinates
    agg.body.setMotionType(BABYLON.PhysicsMotionType.ANIMATED);
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
    body.setLinearVelocity(BABYLON.Vector3.Zero());
    body.setAngularVelocity(BABYLON.Vector3.Zero());
  }

  pieceMesh.position.copyFrom(targetPos);
  // Restore upright orientation
  const rotY = pieceMesh.metadata?.pieceType === 'n'
    ? (pieceMesh.metadata.color === 'w' ? 0 : Math.PI)
    : 0;
  pieceMesh.rotationQuaternion = null;
  pieceMesh.rotation.set(0, rotY, 0);
}
