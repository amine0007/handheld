/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createSceneMaterial,
  createScenePrimitiveObject,
  Group,
  Mesh,
} from '@iwsdk/core';
import { BOARD_DEPTH, BOARD_WIDTH, HALF_DEPTH, HALF_WIDTH } from './levels';

/**
 * The physical tray the player holds with both hands.
 *
 * The origin sits in the middle of the play surface with +Y out of the board,
 * so the marble simulation can use board-local metres directly and every wall
 * the physics knows about lines up with the geometry the player sees. The rim
 * is exactly `HALF_WIDTH` / `HALF_DEPTH` away from the centre, and the grip
 * pads sit outside the play area so pinching them never disturbs the marble.
 */

const RAIL = 0.012;
const RAIL_HEIGHT = 0.022;
const BASE_THICKNESS = 0.014;
/** Height of the rail tops above the play surface. */
export const TRAY_RIM_TOP = RAIL_HEIGHT * 0.5 + 0.002;

const deckMaterial = createSceneMaterial({
  id: 'tray-deck',
  model: 'standard',
  // Pale stone deck: the dark maze walls, black trap holes and copper marble
  // all read clearly against it, and it matches the studio's clay palette.
  baseColor: '#cbbfa8',
  roughness: 0.74,
  metalness: 0.06,
});

const brassMaterial = createSceneMaterial({
  id: 'tray-brass',
  model: 'physical',
  baseColor: '#b98d4e',
  roughness: 0.29,
  metalness: 0.92,
  clearcoat: 0.35,
  clearcoatRoughness: 0.2,
  envMapIntensity: 2.4,
});

const gripMaterial = createSceneMaterial({
  id: 'tray-grip',
  model: 'physical',
  baseColor: '#3b3f47',
  roughness: 0.34,
  metalness: 0,
  clearcoat: 0.7,
  clearcoatRoughness: 0.14,
  envMapIntensity: 2.2,
});

function slab(
  size: [number, number, number],
  material: ReturnType<typeof createSceneMaterial>,
  radius = 0.004,
): Mesh {
  return createScenePrimitiveObject(
    {
      geometry: {
        type: 'roundedBox',
        size,
        radius,
        segments: 4,
      },
    },
    material,
  );
}

export function createHandheldTray(): Group {
  const tray = new Group();

  // Deck: its top face is the play surface at y = 0.
  const deck = slab(
    [BOARD_WIDTH + RAIL * 2, BASE_THICKNESS, BOARD_DEPTH + RAIL * 2],
    deckMaterial,
    0.005,
  );
  deck.position.y = -BASE_THICKNESS / 2;

  // Rim: inner faces sit on the board bounds, so the marble never clips them.
  const rimLong = slab(
    [BOARD_WIDTH + RAIL * 2, RAIL_HEIGHT, RAIL],
    brassMaterial,
    0.0035,
  );
  rimLong.position.set(0, TRAY_RIM_TOP - RAIL_HEIGHT / 2, HALF_DEPTH + RAIL / 2);
  const rimLongBack = rimLong.clone();
  rimLongBack.position.z = -(HALF_DEPTH + RAIL / 2);

  const rimShort = slab(
    [RAIL, RAIL_HEIGHT, BOARD_DEPTH],
    brassMaterial,
    0.0035,
  );
  rimShort.position.set(HALF_WIDTH + RAIL / 2, TRAY_RIM_TOP - RAIL_HEIGHT / 2, 0);
  const rimShortLeft = rimShort.clone();
  rimShortLeft.position.x = -(HALF_WIDTH + RAIL / 2);

  // Grip pads: outside the rim, so a pinch on a pad is never a marble poke.
  const grip = slab([0.026, 0.03, 0.104], gripMaterial, 0.009);
  grip.position.set(HALF_WIDTH + RAIL + 0.013, 0.005, 0);
  const gripLeft = grip.clone();
  gripLeft.position.x = -grip.position.x;

  // Thin brass spine under each pad ties the grips to the frame.
  const spine = slab([0.03, 0.008, 0.03], brassMaterial, 0.003);
  spine.position.set(HALF_WIDTH + RAIL + 0.002, 0.005, 0);
  const spineLeft = spine.clone();
  spineLeft.position.x = -spine.position.x;

  const parts = [
    deck,
    rimLong,
    rimLongBack,
    rimShort,
    rimShortLeft,
    grip,
    gripLeft,
    spine,
    spineLeft,
  ];
  for (const part of parts) {
    part.castShadow = true;
    part.receiveShadow = true;
    tray.add(part);
  }

  return tray;
}
