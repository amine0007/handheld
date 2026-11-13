/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  HALF_DEPTH,
  HALF_WIDTH,
  HOLE_CAPTURE_RADIUS,
  MARBLE_RADIUS,
} from './levels';

/**
 * Planar marble physics for the tray.
 *
 * The marble is a point rolling on the board plane: the board's tilt is fed in
 * as a local gravity vector, walls are axis-aligned boxes resolved per axis,
 * and trap holes are captured inside the substep loop so a fast marble cannot
 * skip over one. Everything is plain numbers in board-local space, so a frame
 * costs no allocations and the whole simulation is deterministic.
 */

const GRAVITY = 9.81;
/** A solid sphere converts 5/7 of the slope's pull into linear acceleration. */
const ROLL_FACTOR = 5 / 7;
const MAX_SPEED = 0.55;
const RESTITUTION = 0.26;
const WALL_FRICTION = 0.88;
/** Exponential velocity decay, in 1/s. */
const ROLLING_DRAG = 1.3;
const STOP_SPEED = 0.006;
const STOP_ACCEL = 0.45;
const MAX_SUBSTEP = 1 / 360;
const MAX_SUBSTEPS = 12;
const FALL_GRAVITY = GRAVITY * 2.4;

export class MarbleSim {
  /** Board-local position of the marble centre. */
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** True once the marble has dropped into a hole and is falling off. */
  falling = false;
  /** Index of the hole captured this step, or -1. */
  holeHit = -1;
  /** Fastest impact against a wall during the last step, in m/s. */
  impactSpeed = 0;

  reset(x: number, z: number): void {
    this.x = x;
    this.y = 0;
    this.z = z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.falling = false;
    this.holeHit = -1;
    this.impactSpeed = 0;
  }

  /** True when the marble has fallen far enough to be off the board. */
  get isLost(): boolean {
    return this.falling && this.y < -0.08;
  }

  /**
   * Send the marble over the edge without a trap hole: the tray was tipped or
   * the player asked for a reset.
   */
  knockOff(): void {
    if (this.falling) {
      return;
    }
    this.falling = true;
    this.holeHit = -1;
    this.vx *= 0.2;
    this.vz *= 0.2;
    this.vy = -0.02;
  }

  /**
   * Advance the marble.
   *
   * @param delta Seconds since the previous step.
   * @param gravityX Gravity along board +X, i.e. the downhill pull.
   * @param gravityZ Gravity along board +Z.
   * @param walls Flat wall boxes: minX, maxX, minZ, maxZ.
   * @param wallCount Number of walls in the flat array.
   * @param holes Flat holes: x, z, radius.
   * @param holeCount Number of holes in the flat array.
   */
  step(
    delta: number,
    gravityX: number,
    gravityZ: number,
    walls: Float32Array,
    wallCount: number,
    holes: Float32Array,
    holeCount: number,
  ): void {
    this.impactSpeed = 0;

    if (this.falling) {
      this.vy -= FALL_GRAVITY * delta;
      this.y += this.vy * delta;
      return;
    }

    const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(delta / MAX_SUBSTEP)));
    const dt = delta / steps;
    const ax = gravityX * ROLL_FACTOR;
    const az = gravityZ * ROLL_FACTOR;
    const drag = Math.max(0, 1 - ROLLING_DRAG * dt);
    const radius = MARBLE_RADIUS;
    this.holeHit = -1;

    for (let step = 0; step < steps; step++) {
      this.vx = (this.vx + ax * dt) * drag;
      this.vz = (this.vz + az * dt) * drag;

      const speed = Math.hypot(this.vx, this.vz);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        this.vx *= scale;
        this.vz *= scale;
      } else if (speed < STOP_SPEED && Math.hypot(ax, az) < STOP_ACCEL) {
        this.vx = 0;
        this.vz = 0;
      }

      // X axis, then Z axis: cheap, stable, and each axis is resolved
      // independently so the marble is never trapped between two walls.
      this.x += this.vx * dt;
      for (let i = 0; i < wallCount; i++) {
        const offset = i * 4;
        const minX = walls[offset];
        const maxX = walls[offset + 1];
        if (
          this.z <= walls[offset + 2] - radius ||
          this.z >= walls[offset + 3] + radius
        ) {
          continue;
        }
        if (this.x <= minX - radius || this.x >= maxX + radius) {
          continue;
        }
        if (this.x < (minX + maxX) * 0.5) {
          this.x = minX - radius;
          if (this.vx > 0) {
            this.impactSpeed = Math.max(this.impactSpeed, this.vx);
            this.vx = -this.vx * RESTITUTION;
          }
        } else {
          this.x = maxX + radius;
          if (this.vx < 0) {
            this.impactSpeed = Math.max(this.impactSpeed, -this.vx);
            this.vx = -this.vx * RESTITUTION;
          }
        }
        this.vz *= WALL_FRICTION;
      }

      this.z += this.vz * dt;
      for (let i = 0; i < wallCount; i++) {
        const offset = i * 4;
        const minZ = walls[offset + 2];
        const maxZ = walls[offset + 3];
        if (
          this.x <= walls[offset] - radius ||
          this.x >= walls[offset + 1] + radius
        ) {
          continue;
        }
        if (this.z <= minZ - radius || this.z >= maxZ + radius) {
          continue;
        }
        if (this.z < (minZ + maxZ) * 0.5) {
          this.z = minZ - radius;
          if (this.vz > 0) {
            this.impactSpeed = Math.max(this.impactSpeed, this.vz);
            this.vz = -this.vz * RESTITUTION;
          }
        } else {
          this.z = maxZ + radius;
          if (this.vz < 0) {
            this.impactSpeed = Math.max(this.impactSpeed, -this.vz);
            this.vz = -this.vz * RESTITUTION;
          }
        }
        this.vx *= WALL_FRICTION;
      }

      // The tray rim is the outer boundary.
      const limitX = HALF_WIDTH - radius;
      if (this.x > limitX) {
        this.x = limitX;
        if (this.vx > 0) {
          this.vx = -this.vx * RESTITUTION;
        }
      } else if (this.x < -limitX) {
        this.x = -limitX;
        if (this.vx < 0) {
          this.vx = -this.vx * RESTITUTION;
        }
      }
      const limitZ = HALF_DEPTH - radius;
      if (this.z > limitZ) {
        this.z = limitZ;
        if (this.vz > 0) {
          this.vz = -this.vz * RESTITUTION;
        }
      } else if (this.z < -limitZ) {
        this.z = -limitZ;
        if (this.vz < 0) {
          this.vz = -this.vz * RESTITUTION;
        }
      }

      for (let i = 0; i < holeCount; i++) {
        const offset = i * 3;
        const dx = this.x - holes[offset];
        const dz = this.z - holes[offset + 1];
        const capture = Math.min(HOLE_CAPTURE_RADIUS, holes[offset + 2]);
        if (dx * dx + dz * dz > capture * capture) {
          continue;
        }
        this.knockOff();
        this.holeHit = i;
        return;
      }
    }
  }
}
