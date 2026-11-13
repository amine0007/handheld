/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  GOAL_RADIUS,
  HOLE_RADIUS,
  LEVELS,
  MARBLE_RADIUS,
  WALL_HEIGHT,
  type LevelLayout,
} from './levels';

/**
 * Draws a level inside the tray.
 *
 * All the repeating pieces (walls, holes, checkpoint rings) are instanced
 * meshes sized once for the worst case, so changing level rewrites instance
 * matrices instead of creating objects. That keeps level transitions instant
 * and allocation-free while a player is holding the board.
 */

const MAX_WALLS = 128;
const MAX_HOLES = 16;
const MAX_RINGS = 8;

const WALL_COLOR = 0x2b2723;
const HOLE_COLOR = 0x090909;
const COPPER_COLOR = 0x9a5c2a;
const MARBLE_COLOR = 0xc9762f;
const RING_IDLE = 0x3c4753;
const RING_DONE = 0x4ad991;
const GOAL_IDLE = 0xd8a24a;
const GOAL_DONE = 0x4ad991;

const wallMaterial = new MeshStandardMaterial({
  color: WALL_COLOR,
  roughness: 0.58,
  metalness: 0.22,
});

const holeMaterial = new MeshStandardMaterial({
  color: HOLE_COLOR,
  roughness: 0.95,
  metalness: 0,
});

const copperMaterial = new MeshStandardMaterial({
  color: COPPER_COLOR,
  roughness: 0.32,
  metalness: 0.9,
  envMapIntensity: 1.8,
});

const ringMaterial = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.35,
  metalness: 0.15,
  envMapIntensity: 1.4,
});

const marbleMaterial = new MeshPhysicalMaterial({
  color: MARBLE_COLOR,
  roughness: 0.16,
  metalness: 1,
  clearcoat: 0.8,
  clearcoatRoughness: 0.1,
  envMapIntensity: 1.7,
});

const goalMaterial = new MeshStandardMaterial({
  color: GOAL_IDLE,
  roughness: 0.3,
  metalness: 0.85,
  envMapIntensity: 2,
});

export class BoardView {
  /** Root of everything this view owns; parented to the tray's maze pivot. */
  readonly group = new Group();

  private readonly walls: InstancedMesh;
  private readonly holeDiscs: InstancedMesh;
  private readonly holeRims: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly startRing: Mesh;
  private readonly marble: Mesh;
  private readonly goalRing: Mesh;
  private readonly goalPlate: Mesh;

  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly identity = new Quaternion();
  private readonly flat = new Quaternion();
  private readonly color = new Color();

  private layout: LevelLayout = LEVELS[0];

  constructor(parent: Object3D) {
    this.flat.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

    this.walls = new InstancedMesh(
      new BoxGeometry(1, WALL_HEIGHT, 1),
      wallMaterial,
      MAX_WALLS,
    );
    this.holeDiscs = new InstancedMesh(
      new CylinderGeometry(1, 1, 0.0006, 20, 1),
      holeMaterial,
      MAX_HOLES,
    );
    this.holeRims = new InstancedMesh(
      new TorusGeometry(HOLE_RADIUS, 0.0016, 6, 24),
      copperMaterial,
      MAX_HOLES,
    );
    this.rings = new InstancedMesh(
      new TorusGeometry(1, 0.1, 6, 26),
      ringMaterial,
      MAX_RINGS,
    );
    this.startRing = new Mesh(new TorusGeometry(1, 0.1, 6, 26), ringMaterial.clone());
    this.goalRing = new Mesh(new TorusGeometry(GOAL_RADIUS, 0.0022, 8, 32), goalMaterial);
    this.goalPlate = new Mesh(
      new CylinderGeometry(GOAL_RADIUS * 0.94, GOAL_RADIUS * 0.94, 0.0008, 28, 1),
      goalMaterial,
    );
    this.marble = new Mesh(
      new SphereGeometry(MARBLE_RADIUS, 24, 16),
      marbleMaterial,
    );

    this.startRing.rotation.x = -Math.PI / 2;
    this.startRing.scale.setScalar(0.0165);
    this.startRing.position.y = 0.0008;
    (this.startRing.material as MeshStandardMaterial).color.setHex(0x3a6785);

    this.goalRing.rotation.x = -Math.PI / 2;
    this.goalRing.position.y = 0.0012;
    this.goalPlate.position.y = 0.0005;

    for (const mesh of [this.walls, this.holeDiscs, this.holeRims, this.rings]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
    }
    this.walls.castShadow = true;
    this.walls.receiveShadow = true;
    this.marble.castShadow = true;

    this.group.add(
      this.walls,
      this.holeDiscs,
      this.holeRims,
      this.rings,
      this.startRing,
      this.goalPlate,
      this.goalRing,
      this.marble,
    );
    parent.add(this.group);
  }

  /** Rebuild the instanced maze for a new layout. Allocation free. */
  build(layout: LevelLayout): void {
    this.layout = layout;

    for (let i = 0; i < layout.wallCount; i++) {
      const offset = i * 4;
      const minX = layout.walls[offset];
      const maxX = layout.walls[offset + 1];
      const minZ = layout.walls[offset + 2];
      const maxZ = layout.walls[offset + 3];
      this.position.set((minX + maxX) * 0.5, WALL_HEIGHT * 0.5, (minZ + maxZ) * 0.5);
      this.scale.set(maxX - minX, 1, maxZ - minZ);
      this.matrix.compose(this.position, this.identity, this.scale);
      this.walls.setMatrixAt(i, this.matrix);
    }
    this.walls.count = layout.wallCount;
    this.walls.instanceMatrix.needsUpdate = true;

    this.scale.set(1, 1, 1);
    for (let i = 0; i < layout.holeCount; i++) {
      const offset = i * 3;
      const x = layout.holes[offset];
      const z = layout.holes[offset + 1];
      const radius = layout.holes[offset + 2];
      this.position.set(x, 0.0002, z);
      this.scale.set(radius, 1, radius);
      this.matrix.compose(this.position, this.identity, this.scale);
      this.holeDiscs.setMatrixAt(i, this.matrix);
      this.position.set(x, 0.001, z);
      this.scale.set(1, 1, 1);
      this.matrix.compose(this.position, this.flat, this.scale);
      this.holeRims.setMatrixAt(i, this.matrix);
    }
    this.holeDiscs.count = layout.holeCount;
    this.holeDiscs.instanceMatrix.needsUpdate = true;
    this.holeRims.count = layout.holeCount;
    this.holeRims.instanceMatrix.needsUpdate = true;

    const ringScale = 0.0135 / 1.1;
    for (let i = 0; i < layout.checkpointCount; i++) {
      this.position.set(layout.checkpoints[i * 2], 0.0011, layout.checkpoints[i * 2 + 1]);
      this.scale.setScalar(ringScale);
      this.matrix.compose(this.position, this.flat, this.scale);
      this.rings.setMatrixAt(i, this.matrix);
      this.rings.setColorAt(i, this.color.setHex(RING_IDLE));
    }
    this.rings.count = layout.checkpointCount;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor !== null) {
      this.rings.instanceColor.needsUpdate = true;
    }

    this.startRing.position.set(layout.startX, 0.0008, layout.startZ);
    this.goalRing.position.set(layout.goalX, 0.0012, layout.goalZ);
    this.goalPlate.position.set(layout.goalX, 0.0005, layout.goalZ);
    // `build` repaints every ring idle, so the cached progress restarts at 0.
    this.reached = 0;
    this.setGoalDone(false);
    this.resetMarble();
  }

  /** Colour checkpoints up to `reached` green. */
  setRingProgress(reached: number): void {
    if (reached === this.reached) {
      return;
    }
    this.reached = reached;
    for (let i = 0; i < this.layout.checkpointCount; i++) {
      this.rings.setColorAt(i, this.color.setHex(i < reached ? RING_DONE : RING_IDLE));
    }
    if (this.rings.instanceColor !== null) {
      this.rings.instanceColor.needsUpdate = true;
    }
  }

  /** Place the marble and spin it by the distance it rolled this frame. */
  setMarblePose(x: number, y: number, z: number, vx: number, vz: number, delta: number): void {
    this.marble.position.set(x, y + MARBLE_RADIUS, z);
    if (delta <= 0) {
      return;
    }
    this.marble.rotation.z += (vx * delta) / MARBLE_RADIUS;
    this.marble.rotation.x -= (vz * delta) / MARBLE_RADIUS;
  }

  setMarbleVisible(visible: boolean): void {
    this.marble.visible = visible;
  }

  resetMarble(): void {
    this.placeMarble(this.layout.startX, this.layout.startZ);
  }

  /** Drop the marble back onto the board at a board-local point. */
  placeMarble(x: number, z: number): void {
    this.marble.position.set(x, MARBLE_RADIUS, z);
    this.marble.rotation.set(0, 0, 0);
    this.marble.visible = true;
  }

  setGoalDone(done: boolean): void {
    goalMaterial.color.setHex(done ? GOAL_DONE : GOAL_IDLE);
    this.goalRing.scale.setScalar(done ? 1.12 : 1);
  }

  private reached = -1;
}
