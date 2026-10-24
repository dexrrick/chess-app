/**
 * assets/src/board3d/materials.js
 * High-fidelity PBR materials for luxury tournament chess pieces, board squares,
 * beveled mahogany table, felt-lined capture trays, and interactive overlays.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

/**
 * Creates high-detail procedural wood grain texture for chess squares and furniture-grade mahogany.
 */
function createProceduralWoodTexture(name, baseHex, grainHex, scene, options = {}) {
  const { isDark = false, lines = 90, scale = 2.0 } = options;
  const size = 512;
  const dynTex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = dynTex.getContext();

  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, size, size);

  // Soft wood growth rings & organic fibers
  for (let i = 0; i < lines; i++) {
    const y = Math.random() * size;
    const thickness = 1 + Math.random() * (isDark ? 2.2 : 1.6);
    const alpha = 0.03 + Math.random() * (isDark ? 0.07 : 0.05);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, y);

    const freq = 0.008 + Math.random() * 0.012;
    const amp = 5 + Math.random() * 10;
    for (let x = 0; x <= size; x += 6) {
      const ny = y + Math.sin(x * freq + i * 0.5) * amp + (Math.random() - 0.5) * 1.2;
      ctx.lineTo(x, ny);
    }
    ctx.lineWidth = thickness;
    ctx.strokeStyle = grainHex;
    ctx.stroke();
    ctx.restore();
  }

  // Micro-pores
  ctx.save();
  ctx.globalAlpha = 0.025;
  ctx.fillStyle = isDark ? '#050302' : '#5c3a1e';
  for (let j = 0; j < 350; j++) {
    const rx = Math.random() * size;
    const ry = Math.random() * size;
    ctx.fillRect(rx, ry, 1 + Math.random() * 3, 1);
  }
  ctx.restore();

  dynTex.update();
  dynTex.uScale = scale;
  dynTex.vScale = scale;
  return dynTex;
}

export function createMaterials(scene) {
  // 1. Procedural Wood Textures
  const lightWoodTex = createProceduralWoodTexture('lightWoodTex', '#ebd7bb', '#caa77b', scene, { isDark: false, lines: 75, scale: 1.8 });
  const darkWoodTex = createProceduralWoodTexture('darkWoodTex', '#4c2e1b', '#2e190d', scene, { isDark: true, lines: 110, scale: 1.8 });
  const tableWoodTex = createProceduralWoodTexture('tableWoodTex', '#542615', '#32140a', scene, { isDark: true, lines: 120, scale: 2.2 });

  // 2. Light Squares: Warm Satin Maple (Matte-satin finish to prevent glare)
  const lightSquare = new BABYLON.PBRMaterial('mat_light_square', scene);
  lightSquare.albedoColor = BABYLON.Color3.FromHexString('#ecd8bb');
  lightSquare.albedoTexture = lightWoodTex;
  lightSquare.roughness = 0.44;
  lightSquare.metallic = 0.0;
  lightSquare.clearCoat.isEnabled = false;

  // 3. Dark Squares: Roasted Walnut / Deep Espresso Wood
  const darkSquare = new BABYLON.PBRMaterial('mat_dark_square', scene);
  darkSquare.albedoColor = BABYLON.Color3.FromHexString('#4e2f1d');
  darkSquare.albedoTexture = darkWoodTex;
  darkSquare.roughness = 0.40;
  darkSquare.metallic = 0.01;
  darkSquare.clearCoat.isEnabled = false;

  // 4. Mahogany Board Frame & Tournament Table
  const frame = new BABYLON.PBRMaterial('mat_frame', scene);
  frame.albedoColor = BABYLON.Color3.FromHexString('#5c2b18');
  frame.albedoTexture = tableWoodTex;
  frame.roughness = 0.32;
  frame.metallic = 0.01;
  frame.clearCoat.isEnabled = true;
  frame.clearCoat.roughness = 0.28;
  frame.clearCoat.intensity = 0.25;

  // 5. Inlay Borders & Coordinates: Brushed Brass Gold
  const brass = new BABYLON.PBRMaterial('mat_brass', scene);
  brass.albedoColor = BABYLON.Color3.FromHexString('#d4af37');
  brass.metallic = 0.85;
  brass.roughness = 0.24;

  // 6. White Pieces: Polished Honey Boxwood / Natural Ivory
  const whitePiece = new BABYLON.PBRMaterial('mat_white_piece', scene);
  whitePiece.albedoColor = BABYLON.Color3.FromHexString('#f4e8d3');
  whitePiece.roughness = 0.26;
  whitePiece.metallic = 0.01;
  whitePiece.clearCoat.isEnabled = true;
  whitePiece.clearCoat.roughness = 0.22;
  whitePiece.clearCoat.intensity = 0.35;
  whitePiece.subSurface.isTranslucencyEnabled = true;
  whitePiece.subSurface.translucencyIntensity = 0.22;
  whitePiece.subSurface.tintColor = BABYLON.Color3.FromHexString('#ffeed0');

  // 7. Black Pieces: Rich Roasted Walnut / Ebonized Hardwood
  const blackPiece = new BABYLON.PBRMaterial('mat_black_piece', scene);
  blackPiece.albedoColor = BABYLON.Color3.FromHexString('#3a261a');
  blackPiece.roughness = 0.24;
  blackPiece.metallic = 0.03;
  blackPiece.clearCoat.isEnabled = true;
  blackPiece.clearCoat.roughness = 0.20;
  blackPiece.clearCoat.intensity = 0.40;
  blackPiece.subSurface.isTranslucencyEnabled = true;
  blackPiece.subSurface.translucencyIntensity = 0.16;
  blackPiece.subSurface.tintColor = BABYLON.Color3.FromHexString('#5c3016');

  // 8. Tournament Green Velvet Felt (for piece bases & capture trays)
  const felt = new BABYLON.PBRMaterial('mat_felt', scene);
  felt.albedoColor = BABYLON.Color3.FromHexString('#1a5330');
  felt.roughness = 0.95;
  felt.metallic = 0.0;

  // 9. Interactive Overlays
  const selectedSquare = new BABYLON.StandardMaterial('mat_highlight_selected', scene);
  selectedSquare.diffuseColor = BABYLON.Color3.FromHexString('#38bdf8');
  selectedSquare.emissiveColor = BABYLON.Color3.FromHexString('#0284c7');
  selectedSquare.alpha = 0.70;
  selectedSquare.disableLighting = true;

  const legalMoveDot = new BABYLON.StandardMaterial('mat_highlight_legal', scene);
  legalMoveDot.diffuseColor = BABYLON.Color3.FromHexString('#38bdf8');
  legalMoveDot.emissiveColor = BABYLON.Color3.FromHexString('#38bdf8');
  legalMoveDot.alpha = 0.80;
  legalMoveDot.disableLighting = true;

  const captureRing = new BABYLON.StandardMaterial('mat_highlight_capture', scene);
  captureRing.diffuseColor = BABYLON.Color3.FromHexString('#f43f5e');
  captureRing.emissiveColor = BABYLON.Color3.FromHexString('#e11d48');
  captureRing.alpha = 0.88;
  captureRing.disableLighting = true;

  const lastMove = new BABYLON.StandardMaterial('mat_highlight_lastmove', scene);
  lastMove.diffuseColor = BABYLON.Color3.FromHexString('#f59e0b');
  lastMove.emissiveColor = BABYLON.Color3.FromHexString('#d97706');
  lastMove.alpha = 0.40;
  lastMove.disableLighting = true;

  const checkPulse = new BABYLON.StandardMaterial('mat_highlight_check', scene);
  checkPulse.diffuseColor = BABYLON.Color3.FromHexString('#ef4444');
  checkPulse.emissiveColor = BABYLON.Color3.FromHexString('#dc2626');
  checkPulse.alpha = 0.82;
  checkPulse.disableLighting = true;

  const hoverSquare = new BABYLON.StandardMaterial('mat_highlight_hover', scene);
  hoverSquare.diffuseColor = BABYLON.Color3.FromHexString('#ffffff');
  hoverSquare.emissiveColor = BABYLON.Color3.FromHexString('#93c5fd');
  hoverSquare.alpha = 0.30;
  hoverSquare.disableLighting = true;

  return {
    lightSquare,
    darkSquare,
    frame,
    brass,
    whitePiece,
    blackPiece,
    felt,
    selectedSquare,
    legalMoveDot,
    captureRing,
    lastMove,
    checkPulse,
    hoverSquare
  };
}
