/**
 * assets/src/board3d/materials.js
 * PBR materials for 3D chess pieces, board squares, mahogany frame, and interactive overlays.
 */

import * as BABYLON from '../../vendor/babylon/babylon.js';

/**
 * Creates a procedural wood grain texture using HTML Canvas.
 */
function createProceduralWoodTexture(name, baseColor, grainColor, scene, isDark = false) {
  const size = 512;
  const dynTex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, false);
  const ctx = dynTex.getContext();

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);

  // Draw natural wavy wood fibers
  ctx.fillStyle = grainColor;
  const lines = isDark ? 90 : 70;
  for (let i = 0; i < lines; i++) {
    const y = Math.random() * size;
    const thickness = 1 + Math.random() * (isDark ? 2.5 : 1.8);
    const alpha = 0.04 + Math.random() * (isDark ? 0.08 : 0.06);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, y);

    const freq = 0.01 + Math.random() * 0.015;
    const amp = 4 + Math.random() * 8;
    for (let x = 0; x <= size; x += 8) {
      const ny = y + Math.sin(x * freq + i) * amp + (Math.random() - 0.5) * 1.5;
      ctx.lineTo(x, ny);
    }
    ctx.lineWidth = thickness;
    ctx.strokeStyle = grainColor;
    ctx.stroke();
    ctx.restore();
  }

  // Soft noise specks for pores
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = isDark ? '#000000' : '#4a2c11';
  for (let j = 0; j < 400; j++) {
    const rx = Math.random() * size;
    const ry = Math.random() * size;
    ctx.fillRect(rx, ry, 1 + Math.random() * 3, 1);
  }
  ctx.restore();

  dynTex.update();
  dynTex.uScale = 1.5;
  dynTex.vScale = 1.5;
  return dynTex;
}

export function createMaterials(scene) {
  // Wood textures
  const lightWoodTex = createProceduralWoodTexture('lightWoodTex', '#e6ceaa', '#c4a678', scene, false);
  const darkWoodTex = createProceduralWoodTexture('darkWoodTex', '#402416', '#261309', scene, true);
  const frameWoodTex = createProceduralWoodTexture('frameWoodTex', '#2d160e', '#160904', scene, true);

  // 1. Light Squares: Satin Maple PBR
  const lightSquare = new BABYLON.PBRMaterial('mat_light_square', scene);
  lightSquare.albedoColor = BABYLON.Color3.FromHexString('#f1dfc3');
  lightSquare.albedoTexture = lightWoodTex;
  lightSquare.roughness = 0.35;
  lightSquare.metallic = 0.02;

  // 2. Dark Squares: Deep Walnut / Ebony PBR
  const darkSquare = new BABYLON.PBRMaterial('mat_dark_square', scene);
  darkSquare.albedoColor = BABYLON.Color3.FromHexString('#51311f');
  darkSquare.albedoTexture = darkWoodTex;
  darkSquare.roughness = 0.28;
  darkSquare.metallic = 0.04;

  // 3. Board Frame: Mahogany with Clearcoat
  const frame = new BABYLON.PBRMaterial('mat_frame', scene);
  frame.albedoColor = BABYLON.Color3.FromHexString('#33170e');
  frame.albedoTexture = frameWoodTex;
  frame.roughness = 0.22;
  frame.metallic = 0.05;
  frame.clearCoat.isEnabled = true;
  frame.clearCoat.roughness = 0.12;

  // 4. Inlay Letters & Border Trim: Brushed Brass
  const brass = new BABYLON.PBRMaterial('mat_brass', scene);
  brass.albedoColor = BABYLON.Color3.FromHexString('#d4af37');
  brass.metallic = 0.85;
  brass.roughness = 0.25;

  // 5. White Pieces: Polished Boxwood / Ivory with Clearcoat
  const whitePiece = new BABYLON.PBRMaterial('mat_white_piece', scene);
  whitePiece.albedoColor = BABYLON.Color3.FromHexString('#f8f2e7');
  whitePiece.roughness = 0.18;
  whitePiece.metallic = 0.02;
  whitePiece.clearCoat.isEnabled = true;
  whitePiece.clearCoat.roughness = 0.14;
  whitePiece.subSurface.isTranslucencyEnabled = true;
  whitePiece.subSurface.translucencyIntensity = 0.2;

  // 6. Black Pieces: Polished Ebonized Wood / Obsidian
  const blackPiece = new BABYLON.PBRMaterial('mat_black_piece', scene);
  blackPiece.albedoColor = BABYLON.Color3.FromHexString('#1c2024');
  blackPiece.roughness = 0.22;
  blackPiece.metallic = 0.08;
  blackPiece.clearCoat.isEnabled = true;
  blackPiece.clearCoat.roughness = 0.16;

  // 7. Green Felt Base
  const felt = new BABYLON.PBRMaterial('mat_felt', scene);
  felt.albedoColor = BABYLON.Color3.FromHexString('#134e32');
  felt.roughness = 0.95;
  felt.metallic = 0.0;

  // 8. Graveyard / Capture Tray
  const tray = new BABYLON.PBRMaterial('mat_tray', scene);
  tray.albedoColor = BABYLON.Color3.FromHexString('#1e2229');
  tray.roughness = 0.5;
  tray.metallic = 0.1;

  // 9. Interactive Highlight Overlays (StandardMaterial with emissive & alpha)
  const selectedSquare = new BABYLON.StandardMaterial('mat_highlight_selected', scene);
  selectedSquare.diffuseColor = BABYLON.Color3.FromHexString('#38bdf8');
  selectedSquare.emissiveColor = BABYLON.Color3.FromHexString('#0284c7');
  selectedSquare.alpha = 0.65;
  selectedSquare.disableLighting = true;

  const legalMoveDot = new BABYLON.StandardMaterial('mat_highlight_legal', scene);
  legalMoveDot.diffuseColor = BABYLON.Color3.FromHexString('#38bdf8');
  legalMoveDot.emissiveColor = BABYLON.Color3.FromHexString('#38bdf8');
  legalMoveDot.alpha = 0.75;
  legalMoveDot.disableLighting = true;

  const captureRing = new BABYLON.StandardMaterial('mat_highlight_capture', scene);
  captureRing.diffuseColor = BABYLON.Color3.FromHexString('#f43f5e');
  captureRing.emissiveColor = BABYLON.Color3.FromHexString('#e11d48');
  captureRing.alpha = 0.85;
  captureRing.disableLighting = true;

  const lastMove = new BABYLON.StandardMaterial('mat_highlight_lastmove', scene);
  lastMove.diffuseColor = BABYLON.Color3.FromHexString('#fbbf24');
  lastMove.emissiveColor = BABYLON.Color3.FromHexString('#d97706');
  lastMove.alpha = 0.38;
  lastMove.disableLighting = true;

  const checkPulse = new BABYLON.StandardMaterial('mat_highlight_check', scene);
  checkPulse.diffuseColor = BABYLON.Color3.FromHexString('#ef4444');
  checkPulse.emissiveColor = BABYLON.Color3.FromHexString('#dc2626');
  checkPulse.alpha = 0.75;
  checkPulse.disableLighting = true;

  const hoverSquare = new BABYLON.StandardMaterial('mat_highlight_hover', scene);
  hoverSquare.diffuseColor = BABYLON.Color3.FromHexString('#ffffff');
  hoverSquare.emissiveColor = BABYLON.Color3.FromHexString('#93c5fd');
  hoverSquare.alpha = 0.28;
  hoverSquare.disableLighting = true;

  return {
    lightSquare,
    darkSquare,
    frame,
    brass,
    whitePiece,
    blackPiece,
    felt,
    tray,
    selectedSquare,
    legalMoveDot,
    captureRing,
    lastMove,
    checkPulse,
    hoverSquare
  };
}
