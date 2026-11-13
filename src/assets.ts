/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';
import {
  createGallerySet,
  createSideboardSet,
} from './scene-assets/decor.scene-asset.js';
import {
  createPlinth,
  createStage,
  createStudioFloor,
} from './scene-assets/studio.scene-asset.js';
import { createHandheldTray } from './labyrinth/tray.scene-asset.js';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const uikitml = (fileName: string, name: string) => ({
  url: publicAssetUrl(`ui/${fileName}`),
  type: AssetType.UIKitML,
  name,
});

export default defineAssets({
  'studio-floor': createStudioFloor(),
  stage: createStage(),
  // Slim, tall stand the tray rests on before the player picks it up.
  'tray-stand': createPlinth(0.95, 0.46),
  'handheld-tray': createHandheldTray(),
  'gallery-set': createGallerySet(),
  'sideboard-set': createSideboardSet(),
  'welcome-panel': uikitml('welcome.uikitml', 'Handheld Title Card'),
  scoreboard: uikitml('handheld.uikitml', 'Handheld Scoreboard'),
});
