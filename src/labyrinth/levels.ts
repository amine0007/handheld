/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Procedural marble-labyrinth layouts for Handheld.
 *
 * Every level uses the same 8 x 6 cell tray, so the board a player grips never
 * changes size; difficulty comes from the maze inside it. Generation is fully
 * deterministic (seeded RNG, fixed start corner), which keeps runs comparable
 * and makes a layout reproducible when it is reviewed or tested.
 *
 * Board-local coordinates are metres: +X is right, +Z points back towards the
 * player, +Y is up, and (0, 0) is the centre of the play surface.
 */

export const CELL = 0.042;
export const COLS = 8;
export const ROWS = 6;
export const BOARD_WIDTH = COLS * CELL;
export const BOARD_DEPTH = ROWS * CELL;
export const HALF_WIDTH = BOARD_WIDTH / 2;
export const HALF_DEPTH = BOARD_DEPTH / 2;

export const MARBLE_RADIUS = 0.007;
export const WALL_THICKNESS = 0.006;
export const WALL_HEIGHT = 0.013;

/** Radius drawn for a trap hole. The marble drops well before it reaches that. */
export const HOLE_RADIUS = 0.0095;
/** How far the marble centre may drift into a hole before it drops. */
export const HOLE_CAPTURE_RADIUS = 0.006;
/** Distance of a hole centre from the corridor centreline. */
export const HOLE_OFFSET = 0.0085;

export const GOAL_RADIUS = 0.016;
export const CHECKPOINT_RADIUS = 0.0135;
/**
 * How close the marble has to get to a ring's centre to score it.
 *
 * Wider than the drawn ring on purpose: the marble can hug a wall at the edge
 * of a corridor, and a player should never be denied a checkpoint they clearly
 * drove through.
 */
export const RING_CAPTURE_RADIUS = CELL * 0.55;

/**
 * One generated level. Geometry is packed into typed arrays so the marble
 * simulation can walk it every frame without allocating or chasing objects.
 */
export interface LevelLayout {
  readonly index: number;
  readonly name: string;
  /** Four floats per wall: minX, maxX, minZ, maxZ. */
  readonly walls: Float32Array;
  readonly wallCount: number;
  /** Three floats per hole: x, z, radius. */
  readonly holes: Float32Array;
  readonly holeCount: number;
  /** Two floats per checkpoint: x, z. Ordered from the start to the goal. */
  readonly checkpoints: Float32Array;
  readonly checkpointCount: number;
  /**
   * Two floats per cell: the solution route from the start to the goal, at
   * cell centres. Used by the attract mode to drive the tray along a level
   * without a player, and handy for any future hint or ghost marble.
   */
  readonly route: Float32Array;
  readonly startX: number;
  readonly startZ: number;
  readonly goalX: number;
  readonly goalZ: number;
  /** Solution length in cells; the main difficulty dial. */
  readonly pathLength: number;
}

interface LevelDefinition {
  readonly name: string;
  readonly seed: number;
  /** Preferred BFS distance between the start cell and the goal cell. */
  readonly targetPath: number;
  /** Extra walls removed after the perfect maze is carved, creating loops. */
  readonly braid: number;
  readonly holes: number;
}

const LEVEL_DEFINITIONS: readonly LevelDefinition[] = [
  { name: 'First Steps', seed: 1109, targetPath: 7, braid: 9, holes: 1 },
  { name: 'Long Way Round', seed: 2213, targetPath: 11, braid: 7, holes: 2 },
  { name: 'Sluice', seed: 3319, targetPath: 15, braid: 5, holes: 2 },
  { name: 'Crosswind', seed: 4421, targetPath: 18, braid: 4, holes: 3 },
  { name: 'Needle', seed: 5527, targetPath: 22, braid: 3, holes: 3 },
  { name: 'Summit', seed: 6631, targetPath: 26, braid: 2, holes: 4 },
];

/** Small, fast, deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cellCenterX(column: number): number {
  return (column + 0.5) * CELL - HALF_WIDTH;
}

function cellCenterZ(row: number): number {
  return (row + 0.5) * CELL - HALF_DEPTH;
}

/**
 * Carve one level: recursive-backtracker maze, optional braiding, a goal at a
 * target distance, an ordered checkpoint trail along the solution, and trap
 * holes offset to one side of the corridor so a careful marble can pass.
 */
function buildLevel(definition: LevelDefinition, index: number): LevelLayout {
  const cols = COLS;
  const rows = ROWS;
  const count = cols * rows;
  const rng = mulberry32(definition.seed);

  // Edge flags: openEast[i] joins cell i to i + 1, openSouth[i] to i + cols.
  const openEast = new Uint8Array(count);
  const openSouth = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const stack = new Int32Array(count);
  const order = new Int32Array(4);

  // Near-left corner: the cell closest to the player's left hand.
  const startIdx = (rows - 1) * cols;

  visited[startIdx] = 1;
  stack[0] = startIdx;
  let stackSize = 1;
  while (stackSize > 0) {
    const current = stack[stackSize - 1];
    const column = current % cols;
    const row = (current - column) / cols;
    let candidates = 0;
    if (column + 1 < cols && visited[current + 1] === 0) {
      order[candidates++] = current + 1;
    }
    if (column > 0 && visited[current - 1] === 0) {
      order[candidates++] = current - 1;
    }
    if (row + 1 < rows && visited[current + cols] === 0) {
      order[candidates++] = current + cols;
    }
    if (row > 0 && visited[current - cols] === 0) {
      order[candidates++] = current - cols;
    }
    if (candidates === 0) {
      stackSize -= 1;
      continue;
    }
    const next = order[Math.floor(rng() * candidates)];
    if (next === current + 1) {
      openEast[current] = 1;
    } else if (next === current - 1) {
      openEast[next] = 1;
    } else if (next === current + cols) {
      openSouth[current] = 1;
    } else {
      openSouth[next] = 1;
    }
    visited[next] = 1;
    stack[stackSize++] = next;
  }

  // Braiding: punching extra doorways turns dead ends into loops, which makes
  // a maze forgiving to steer by tilting a tray.
  const eastPool: number[] = [];
  const southPool: number[] = [];
  for (let i = 0; i < count; i++) {
    const column = i % cols;
    const row = (i - column) / cols;
    if (column + 1 < cols && openEast[i] === 0) {
      eastPool.push(i);
    }
    if (row + 1 < rows && openSouth[i] === 0) {
      southPool.push(i);
    }
  }
  for (let i = 0; i < definition.braid; i++) {
    const pool = i % 2 === 0 ? eastPool : southPool;
    if (pool.length === 0) {
      continue;
    }
    const pick = Math.floor(rng() * pool.length);
    const cell = pool[pick];
    pool[pick] = pool[pool.length - 1];
    pool.pop();
    if (i % 2 === 0) {
      openEast[cell] = 1;
    } else {
      openSouth[cell] = 1;
    }
  }

  // Breadth-first search from the start: distances choose the goal, parents
  // recover the solution path.
  const distance = new Int16Array(count).fill(-1);
  const parent = new Int16Array(count).fill(-1);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  distance[startIdx] = 0;
  queue[tail++] = startIdx;
  while (head < tail) {
    const current = queue[head++];
    const column = current % cols;
    const row = (current - column) / cols;
    let links = 0;
    if (column + 1 < cols && openEast[current] === 1) {
      order[links++] = current + 1;
    }
    if (column > 0 && openEast[current - 1] === 1) {
      order[links++] = current - 1;
    }
    if (row + 1 < rows && openSouth[current] === 1) {
      order[links++] = current + cols;
    }
    if (row > 0 && openSouth[current - cols] === 1) {
      order[links++] = current - cols;
    }
    for (let i = 0; i < links; i++) {
      const neighbour = order[i];
      if (distance[neighbour] !== -1) {
        continue;
      }
      distance[neighbour] = distance[current] + 1;
      parent[neighbour] = current;
      queue[tail++] = neighbour;
    }
  }

  let goalIdx = startIdx;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < count; i++) {
    const cellDistance = distance[i];
    if (cellDistance < 3) {
      continue;
    }
    const score = Math.abs(cellDistance - definition.targetPath) + rng() * 0.75;
    if (score < bestScore) {
      bestScore = score;
      goalIdx = i;
    }
  }

  const path: number[] = [];
  for (let cell = goalIdx; cell !== -1; cell = parent[cell]) {
    path.push(cell);
    if (cell === startIdx) {
      break;
    }
  }
  path.reverse();

  // Checkpoints sit along the solution so they reward steady progress and act
  // as respawn points after a drop.
  const checkpointCells: number[] = [];
  const checkpointCount = path.length >= 14 ? 3 : path.length >= 9 ? 2 : 1;
  for (let i = 1; i <= checkpointCount; i++) {
    const along = Math.round((path.length - 1) * (i / (checkpointCount + 1)));
    const cell = path[Math.min(path.length - 2, Math.max(1, along))];
    if (cell === startIdx || cell === goalIdx || checkpointCells.includes(cell)) {
      continue;
    }
    checkpointCells.push(cell);
  }
  checkpointCells.sort((a, b) => path.indexOf(a) - path.indexOf(b));

  // Trap holes sit on corridor cells of the solution, so they must be steered
  // around instead of being skipped. Straight runs are preferred: a hole in a
  // corner would be unfair at this scale.
  const straightCells: number[] = [];
  const cornerCells: number[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const cell = path[i];
    if (checkpointCells.includes(cell)) {
      continue;
    }
    const column = cell % cols;
    const row = (cell - column) / cols;
    const north = row > 0 && openSouth[cell - cols] === 1;
    const south = row + 1 < rows && openSouth[cell] === 1;
    const west = column > 0 && openEast[cell - 1] === 1;
    const east = column + 1 < cols && openEast[cell] === 1;
    const links =
      (north ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0) + (east ? 1 : 0);
    if (links !== 2) {
      continue;
    }
    if ((north && south) || (west && east)) {
      straightCells.push(cell);
    } else {
      cornerCells.push(cell);
    }
  }

  const holePool =
    straightCells.length >= definition.holes
      ? straightCells
      : straightCells.concat(cornerCells);
  const holeCells: number[] = [];
  const holeData: number[] = [];
  for (let i = 0; i < definition.holes; i++) {
    if (holePool.length === 0) {
      break;
    }
    const anchor = Math.floor(((i + 0.5) / definition.holes) * holePool.length);
    let pick = holePool[anchor];
    for (let step = 0; step < holePool.length && holeCells.includes(pick); step++) {
      pick = holePool[(anchor + step + 1) % holePool.length];
    }
    if (holeCells.includes(pick)) {
      continue;
    }
    holeCells.push(pick);
    const column = pick % cols;
    const row = (pick - column) / cols;
    const runsAlongZ =
      (row > 0 && openSouth[pick - cols] === 1) ||
      (row + 1 < rows && openSouth[pick] === 1);
    holeData.push(
      cellCenterX(column) + (runsAlongZ ? HOLE_OFFSET : 0),
      cellCenterZ(row) + (runsAlongZ ? 0 : HOLE_OFFSET),
      HOLE_RADIUS,
    );
  }

  // Internal walls only: the tray rim is the outer boundary, so border cells
  // stay contained without extra geometry.
  const wallData: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < cols; column++) {
      const cell = row * cols + column;
      if (column + 1 < cols && openEast[cell] === 0) {
        const x = (column + 1) * CELL - HALF_WIDTH;
        wallData.push(
          x - WALL_THICKNESS / 2,
          x + WALL_THICKNESS / 2,
          row * CELL - HALF_DEPTH - WALL_THICKNESS / 2,
          (row + 1) * CELL - HALF_DEPTH + WALL_THICKNESS / 2,
        );
      }
      if (row + 1 < rows && openSouth[cell] === 0) {
        const z = (row + 1) * CELL - HALF_DEPTH;
        wallData.push(
          column * CELL - HALF_WIDTH - WALL_THICKNESS / 2,
          (column + 1) * CELL - HALF_WIDTH + WALL_THICKNESS / 2,
          z - WALL_THICKNESS / 2,
          z + WALL_THICKNESS / 2,
        );
      }
    }
  }

  const checkpointData = new Float32Array(checkpointCells.length * 2);
  for (let i = 0; i < checkpointCells.length; i++) {
    const cell = checkpointCells[i];
    const column = cell % cols;
    checkpointData[i * 2] = cellCenterX(column);
    checkpointData[i * 2 + 1] = cellCenterZ((cell - column) / cols);
  }

  const routeData = new Float32Array(path.length * 2);
  for (let i = 0; i < path.length; i++) {
    const cell = path[i];
    const column = cell % cols;
    routeData[i * 2] = cellCenterX(column);
    routeData[i * 2 + 1] = cellCenterZ((cell - column) / cols);
  }

  const startColumn = startIdx % cols;
  const goalColumn = goalIdx % cols;

  return {
    index,
    name: definition.name,
    walls: new Float32Array(wallData),
    wallCount: wallData.length / 4,
    holes: new Float32Array(holeData),
    holeCount: holeData.length / 3,
    checkpoints: checkpointData,
    checkpointCount: checkpointCells.length,
    route: routeData,
    startX: cellCenterX(startColumn),
    startZ: cellCenterZ((startIdx - startColumn) / cols),
    goalX: cellCenterX(goalColumn),
    goalZ: cellCenterZ((goalIdx - goalColumn) / cols),
    pathLength: path.length,
  };
}

/** Generated once at module load; deterministic and side-effect free. */
export const LEVELS: readonly LevelLayout[] = LEVEL_DEFINITIONS.map(
  (definition, index) => buildLevel(definition, index),
);
