/**
 * assets/src/board3d/bridge.js
 * 2D <-> 3D Mode Lifecycle, dynamic lazy loading of Babylon.js/Havok,
 * and state synchronization between chess-app and the 3D subsystem.
 */

const STORAGE_KEY = 'chess_view_mode';

export function createBoard3DBridge(appCallbacks) {
  const toggleBtn = document.querySelector('#view-mode-toggle');
  const container3D = document.querySelector('#board-3d-container');

  let currentMode = '2d';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '3d' || saved === '2d') {
      currentMode = saved;
    }
  } catch {
    currentMode = '2d';
  }

  let sceneWorld = null;
  let isLoading = false;

  function updateToggleUI() {
    if (!toggleBtn) return;
    if (currentMode === '3d') {
      toggleBtn.textContent = '2D View';
      toggleBtn.setAttribute('aria-label', 'Switch to 2D view');
    } else {
      toggleBtn.textContent = '3D View';
      toggleBtn.setAttribute('aria-label', 'Switch to 3D view');
    }
  }

  async function switchTo3D() {
    if (isLoading) return;
    currentMode = '3d';
    try {
      localStorage.setItem(STORAGE_KEY, '3d');
    } catch {}

    document.documentElement.dataset.viewMode = '3d';
    updateToggleUI();

    if (container3D) {
      container3D.removeAttribute('hidden');
      container3D.setAttribute('aria-hidden', 'false');
    }

    if (!sceneWorld) {
      isLoading = true;
      try {
        const { createBoard3DWorld } = await import('./scene.js');
        sceneWorld = await createBoard3DWorld(container3D, {
          onSquareSelect: (sq) => appCallbacks.onSquareSelect(sq),
          onMoveAttempt: (from, to, promo) => appCallbacks.onMoveAttempt(from, to, promo)
        });
        window.__board3dSceneWorld = sceneWorld;
      } catch (err) {
        console.error('Failed to initialize 3D scene:', err);
        switchTo2D();
        return;
      } finally {
        isLoading = false;
      }
    } else {
      sceneWorld.startRender();
    }

    // Sync latest game state
    if (appCallbacks.getGameState) {
      const state = appCallbacks.getGameState();
      sceneWorld.syncState(state);
    }
  }

  function switchTo2D() {
    currentMode = '2d';
    try {
      localStorage.setItem(STORAGE_KEY, '2d');
    } catch {}

    document.documentElement.dataset.viewMode = '2d';
    updateToggleUI();

    if (sceneWorld) {
      sceneWorld.stopRender();
    }

    if (container3D) {
      container3D.setAttribute('hidden', '');
      container3D.setAttribute('aria-hidden', 'true');
    }

    if (appCallbacks.onRefresh2D) {
      appCallbacks.onRefresh2D();
    }
  }

  // Bind toggle button
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (currentMode === '2d') {
        switchTo3D();
      } else {
        switchTo2D();
      }
    });
  }

  // Ensure default 2D mode attributes on initial load
  updateToggleUI();
  document.documentElement.dataset.viewMode = currentMode;
  if (currentMode === '3d') {
    // If user explicitly had 3D saved previously, initialize 3D
    switchTo3D();
  } else {
    // 2D by default: ensure container is hidden and no 3D scripts are loaded
    if (container3D) {
      container3D.setAttribute('hidden', '');
      container3D.setAttribute('aria-hidden', 'true');
    }
  }

  return {
    getMode: () => currentMode,
    switchTo2D,
    switchTo3D,
    syncState: (state) => {
      if (currentMode === '3d' && sceneWorld) {
        sceneWorld.syncState(state);
      }
    },
    animateMove: (moveObj, newFen) => {
      if (currentMode === '3d' && sceneWorld) {
        return sceneWorld.animateMove(moveObj, newFen);
      }
    }
  };
}
