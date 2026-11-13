/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createComponent, Types } from '@iwsdk/core';

/** The tray starts idle: nothing moves until the player lifts it. */
export const PHASE_IDLE = 0;
/** A level is live and the marble is being driven by the tray tilt. */
export const PHASE_PLAYING = 1;
/** The goal was reached and the next level is about to load. */
export const PHASE_CLEARING = 2;
/** Every level is finished; tip the tray to start a fresh run. */
export const PHASE_COMPLETE = 3;

/**
 * Author-facing run state, mirrored onto the tray entity.
 *
 * The system keeps its authoritative values in plain fields so the hot loop
 * never touches the ECS; this component exists so the state is inspectable
 * (editor, MCP queries, debugging) and so other systems could react to it.
 */
export const LabyrinthState = createComponent('LabyrinthState', {
  level: { type: Types.Int8, default: 0 },
  phase: { type: Types.Int8, default: PHASE_IDLE },
  drops: { type: Types.Int16, default: 0 },
  checkpoint: { type: Types.Int8, default: 0 },
  /** Current level clock, in seconds. */
  seconds: { type: Types.Float32, default: 0 },
  /** How far the tray is tilted away from level, in degrees. */
  tiltDegrees: { type: Types.Float32, default: 0 },
});
