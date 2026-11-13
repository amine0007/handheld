/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { PHASE_COMPLETE } from './labyrinth-state';
import { CELL, MARBLE_RADIUS, type LevelLayout } from './levels';

/**
 * Stand-ins for the player's hands, for machines that cannot pinch.
 *
 * Both drivers write the tray's world pose and nothing else. The system still
 * derives board-local gravity from that pose, so the marble is moved by the
 * exact same code it uses under a real two-handed grip: these are hands, not a
 * replay of recorded positions.
 *
 * - {@link DemoDriver} (`?demo`) is the attract mode. It waits on the stand,
 *   lifts the tray, then steers the marble along the level's solution route
 *   with a damped velocity controller, deliberately dropping into a hole and
 *   tipping the tray over at scripted beats. It exists so a run can be filmed
 *   or watched start to finish without anyone touching a controller.
 * - {@link KeyDriver} (`?keys`) is the manual fallback: arrow keys tilt the
 *   tray, space tips it over to reset. Clumsier than a real grip, but it makes
 *   the game playable on a keyboard-only laptop.
 */

const GRAVITY = 9.81;
const DEG = Math.PI / 180;

/** How far the tray floats above its stand while it is being held. */
const LIFT_HEIGHT = 0.16;
/** How far the held tray is drawn towards the player, in metres. */
const HOLD_FORWARD = 0.05;
/** Seconds the tray sits on the stand before the demo lifts it. */
const REST_TIME = 2.6;
/** Seconds the lift itself takes. */
const LIFT_TIME = 0.8;

/** Steepest tilt the demo uses while chasing a waypoint. */
const STEER_TILT = 11 * DEG;
/** Fastest the demo rolls the marble, in m/s. */
const STEER_SPEED = 0.12;
/** Velocity error to acceleration gain, in 1/s. */
const STEER_GAIN = 5.5;
/** A marble on a rolling sphere only gets 5/7 of the plane's gravity. */
const ROLL_FACTOR = 7 / 5;
/**
 * Sideways nudge of the aim point past a hole, in metres.
 *
 * Holes sit a couple of millimetres outside the marble's capture radius when it
 * rolls down the centre of a corridor, so it passes them with almost no margin.
 * A fifth of a cell of aim offset roughly doubles that margin, which is what
 * keeps a one-take recording from ending in a drop it did not script.
 */
const HOLE_CLEARANCE = CELL * 0.2;
/** Distance at which the demo starts short-aiming and dodging a hole. */
const HOLE_REACH = CELL * 1.6;
/**
 * Smallest acceleration the demo ever asks for while a target is out of reach,
 * in m/s^2. The marble has static friction, so a timid request leaves it
 * parked and the controller would keep asking for the same timid request.
 */
const MIN_ACCEL = 0.9;
/**
 * Speed under which the marble counts as parked, in m/s.
 *
 * The breakaway boost above is a discontinuity, so it is only allowed where it
 * is needed: a marble that is already rolling is steered by the velocity error
 * alone. Applying it all the time makes the tray bang between a level pose and
 * a full tilt every frame, which reads as a shake.
 */
const BREAKAWAY_SPEED = 0.02;
/** Shortest and longest look-ahead used near and away from a hole. */
const AIM_NEAR = CELL * 0.6;
const AIM_FAR = CELL * 1.4;
/** Time constant of the aim glide, in seconds. */
const AIM_SMOOTH = 0.07;
/** Time constant of the hole-proximity blend, in seconds. */
const HOLE_BLEND = 0.12;
/** Time constant of the tilt smoothing, in seconds: hands have inertia too. */
const TILT_SMOOTH = 0.05;
/**
 * Time constant of the tip gesture, in seconds. Rolling a tray right over is
 * the one move a hand takes its time with, and a snap here reads as a glitch.
 */
const TIP_SMOOTH = 0.12;
/** Tilt held to demonstrate the tip-to-reset gesture. */
const TIP_TILT = 78 * DEG;
/** Steepest tilt the arrow keys produce. */
const KEY_TILT = 9 * DEG;
/** How fast key tilt ramps, in m/s^2 of in-plane gravity per second. */
const KEY_SLEW = 8;
/** Seconds per frame of stall before the demo backs out and retries. */
const STALL_LIMIT = 3.5;
/** Seconds the demo spends backing out of a stuck corner. */
const RECOVER_TIME = 1.4;

/** Per-frame snapshot of the game the drivers are allowed to read. */
export interface DriverInput {
  /** Marble position and velocity in board space. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  phase: number;
  checkpoint: number;
  /** True while the marble is falling through a hole or waiting to respawn. */
  dropping: boolean;
}

export interface TrayDriver {
  /** True when the driver also wants the page camera framed on the tray. */
  readonly framesCamera: boolean;
  /** Pose the tray for this frame; true while it counts as held. */
  update(delta: number, layout: LevelLayout, input: DriverInput): boolean;
}

const approach = (value: number, target: number, step: number): number => {
  if (value < target) {
    return Math.min(target, value + step);
  }
  if (value > target) {
    return Math.max(target, value - step);
  }
  return value;
};

const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/**
 * Poses the tray as a pair of hands would.
 *
 * Given the board-local gravity the game should feel, the tray is rotated so
 * that gravity is exactly what its world quaternion delivers. That keeps the
 * drivers honest: they can only tilt, never push the marble.
 */
class TrayPose {
  private readonly restGravity = new Vector3();
  private readonly wanted = new Vector3();
  private readonly tilt = new Quaternion();

  constructor(
    private readonly tray: Object3D,
    private readonly home: Vector3,
    private readonly homeQuaternion: Quaternion,
  ) {
    this.restGravity
      .set(0, -GRAVITY, 0)
      .applyQuaternion(this.homeQuaternion.clone().invert())
      .normalize();
  }

  /** Tilt so board-local gravity becomes (gx, gy, gz), lifted by `lift`. */
  apply(gx: number, gz: number, lift: number): void {
    const flat = gx * gx + gz * gz;
    const gy = -Math.sqrt(Math.max(0.01 * GRAVITY * GRAVITY, GRAVITY * GRAVITY - flat));
    this.wanted.set(gx, gy, gz).normalize();
    this.tilt.setFromUnitVectors(this.wanted, this.restGravity);
    this.tray.quaternion.copy(this.homeQuaternion).multiply(this.tilt);
    this.tray.position.copy(this.home);
    this.tray.position.y += lift;
    // A held tray sits a little closer to the player than its stand does,
    // which keeps the whole board inside a headset's field of view.
    this.tray.position.z += (lift / LIFT_HEIGHT) * HOLD_FORWARD;
  }
}

/**
 * Attract mode: lift the tray, then play the maze with a damped controller
 * that follows the level's solution route.
 */
export class DemoDriver implements TrayDriver {
  /** The attract mode is filmed, so it also frames the page camera. */
  readonly framesCamera = true;
  private readonly pose: TrayPose;
  private readonly target = new Vector3();
  /** Aim point after gliding, so a step in the target never steps the tray. */
  private aimX = 0;
  private aimZ = 0;
  private aimReady = false;
  /** Smoothed tilt demand, in m/s^2 of in-plane gravity. */
  private gx = 0;
  private gz = 0;
  /** How strongly the look-ahead is hugging the corridor, 0..1. */
  private holeBlend = 0;
  /** True once the scripted hole beat has actually dropped the marble. */
  private holeDropped = false;
  private elapsed = 0;
  private lift = 0;
  private held = false;
  private level = -1;
  /** Bitmask of levels whose scripted beat already played in this run. */
  private beats = 0;
  private mode: 'route' | 'hole' | 'tip' | 'recover' = 'route';
  private modeTime = 0;
  private completeTime = 0;
  private segment = 0;
  /** How far along `segment` the marble projects, 0..1. */
  private along = 0;
  /** Route progress in segments; only ever used to detect a stall. */
  private progress = 0;
  private stallTime = 0;
  private recoverIndex = 0;

  constructor(tray: Object3D, home: Vector3, homeQuaternion: Quaternion) {
    this.pose = new TrayPose(tray, home, homeQuaternion);
  }

  update(delta: number, layout: LevelLayout, input: DriverInput): boolean {
    this.elapsed += delta;
    if (!this.held) {
      // The tray starts on its stand: that first beat is the tutorial.
      if (this.elapsed < REST_TIME) {
        this.pose.apply(0, 0, 0);
        return false;
      }
      this.held = true;
    }

    const liftProgress = Math.min(1, (this.elapsed - REST_TIME) / LIFT_TIME);
    // A slow bob keeps a scripted grip from looking welded to the air.
    const bob = Math.sin(this.elapsed * 1.3) * 0.0015 * liftProgress;
    this.lift = easeOutCubic(liftProgress) * LIFT_HEIGHT + bob;

    if (layout.index !== this.level) {
      if (layout.index === 0 && this.level >= 0) {
        this.beats = 0; // a fresh run
      }
      this.level = layout.index;
      this.segment = 0;
      this.along = 0;
      this.progress = 0;
      this.stallTime = 0;
      // The marble appears somewhere new, so the aim snaps instead of gliding
      // across the whole board.
      this.aimReady = false;
      this.holeBlend = 0;
      this.enter('route');
    }
    this.modeTime += delta;

    if (this.mode === 'route' && !input.dropping) {
      // The run summary gets a few seconds to read, then a tip restarts it.
      if (input.phase === PHASE_COMPLETE) {
        this.completeTime += delta;
        if (this.completeTime > 3.2) {
          this.completeTime = 0;
          this.enter('tip');
        }
      } else {
        this.completeTime = 0;
      }
      if (this.mode === 'route') {
        this.checkBeats(layout, input);
      }
    }

    switch (this.mode) {
      case 'tip':
        this.tilt(GRAVITY * Math.sin(TIP_TILT), 0, delta, TIP_SMOOTH);
        if (this.modeTime > 0.9) {
          this.enter('route');
        }
        break;
      case 'hole':
        if (input.dropping) {
          // Hold the tray level while it falls: the drop counter is the beat.
          this.holeDropped = true;
          this.holeBlend = 1;
          this.tilt(0, 0, delta);
          break;
        }
        if (this.holeDropped || this.modeTime > 6) {
          // One drop is the show. Carrying on towards the hole would just drop
          // the marble again -- and again -- until the timeout ran out.
          this.holeDropped = false;
          this.enter('route');
          break;
        }
        this.aimAtHole(layout, input);
        this.steer(input, delta, 0.08);
        break;
      case 'recover':
        if (this.modeTime > RECOVER_TIME) {
          this.enter('route');
          break;
        }
        this.pullBack(layout, input);
        this.steer(input, delta, 0.05);
        break;
      default:
        if (input.dropping) {
          // Come back hugging the corridor centreline: a respawn usually lands
          // beside the hole that swallowed the marble.
          this.holeBlend = 1;
          this.tilt(0, 0, delta);
          break;
        }
        this.followRoute(layout, input, delta);
        this.steer(input, delta, STEER_SPEED);
        break;
    }

    return true;
  }

  private enter(mode: 'route' | 'hole' | 'tip' | 'recover'): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  /** Scripted moments that show off the drop counter and the tip reset. */
  private checkBeats(layout: LevelLayout, input: DriverInput): void {
    const beat = 1 << layout.index;
    if (input.checkpoint < 1 || (this.beats & beat) !== 0) {
      return;
    }
    if (layout.index === 1) {
      this.beats |= beat;
      this.enter('hole');
    } else if (layout.index === 2) {
      this.beats |= beat;
      this.enter('tip');
    }
  }

  /**
   * Project the marble onto the solution route.
   *
   * Records the nearest segment and how far along it the marble sits. The aim
   * point is then taken a fixed distance *ahead* of that projection: aiming by
   * arc length instead of at a cell centre is what stops the controller from
   * chasing the spot the marble already occupies, which would leave it
   * standing still on every waypoint. It also keeps the aim walking forward
   * when the marble drifts into a braided side opening.
   */
  private projectOnRoute(layout: LevelLayout, input: DriverInput): void {
    const count = layout.route.length / 2;
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestAlong = 0;
    for (let i = 0; i < count - 1; i += 1) {
      const ax = layout.route[i * 2];
      const az = layout.route[i * 2 + 1];
      const ex = layout.route[i * 2 + 2] - ax;
      const ez = layout.route[i * 2 + 3] - az;
      const lengthSq = ex * ex + ez * ez;
      let along = lengthSq > 0 ? ((input.x - ax) * ex + (input.z - az) * ez) / lengthSq : 0;
      along = Math.max(0, Math.min(1, along));
      const dx = input.x - (ax + ex * along);
      const dz = input.z - (az + ez * along);
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
        bestAlong = along;
      }
    }
    this.segment = best;
    this.along = bestAlong;
  }

  /** Aim `distance` metres further along the route than the projection. */
  private lookAhead(layout: LevelLayout, distance: number): void {
    const count = layout.route.length / 2;
    let segment = this.segment;
    let along = this.along;
    let remaining = distance;
    while (segment < count - 2) {
      const ax = layout.route[segment * 2];
      const az = layout.route[segment * 2 + 1];
      const bx = layout.route[segment * 2 + 2];
      const bz = layout.route[segment * 2 + 3];
      const length = Math.hypot(bx - ax, bz - az);
      const available = length * (1 - along);
      if (available >= remaining) {
        const t = length > 0 ? along + remaining / length : 1;
        this.target.set(ax + (bx - ax) * t, 0, az + (bz - az) * t);
        return;
      }
      remaining -= available;
      segment += 1;
      along = 0;
    }
    const last = count - 1;
    this.target.set(layout.route[last * 2], 0, layout.route[last * 2 + 1]);
  }

  /** Follow the level's solution route, backing out of a stall. */
  private followRoute(layout: LevelLayout, input: DriverInput, delta: number): void {
    this.projectOnRoute(layout, input);
    const progress = this.segment + this.along;
    if (progress < this.progress - 0.5) {
      // A hole respawn or a level reset put the marble back on the route.
      this.progress = progress;
      this.stallTime = 0;
    } else if (progress > this.progress) {
      this.progress = progress;
      this.stallTime = 0;
    } else {
      this.stallTime += delta;
      if (this.stallTime > STALL_LIMIT) {
        this.stallTime = 1;
        this.recoverIndex = Math.max(0, this.segment - 1);
        this.enter('recover');
        return;
      }
    }
    // Holes sit just off the corridor centreline, so a short look-ahead there
    // hugs the centreline and leaves the marble a safe margin to pass. The
    // distance is blended rather than switched: a step in the aim point is a
    // step in the tray's tilt, and this happens once per hole.
    const reach = HOLE_REACH * 1.6;
    const gap = this.holeGap(layout, input);
    const near = gap < reach ? 1 - gap / reach : 0;
    this.holeBlend += (near - this.holeBlend) * (1 - Math.exp(-delta / HOLE_BLEND));
    this.aim(layout, input, AIM_FAR + (AIM_NEAR - AIM_FAR) * this.holeBlend);
    this.dodgeHoles(layout, input);
  }

  /**
   * Slide the aim point off a hole's line.
   *
   * Holes sit a few millimetres off the corridor centre, so a marble rolling
   * down the centreline passes with almost no margin. Nudging the *aim point*
   * sideways -- rather than shoving the marble -- bends the path past the hole
   * while the controller keeps driving forward, and a target cannot wedge the
   * marble against a wall the way a lateral force can. The side comes from the
   * segment's own geometry, so it never flips while the marble goes by.
   */
  private dodgeHoles(layout: LevelLayout, input: DriverInput): void {
    const count = layout.route.length / 2;
    const segment = Math.max(0, Math.min(this.segment, count - 1));
    const ax = layout.route[segment * 2];
    const az = layout.route[segment * 2 + 1];
    if (segment >= count - 1) {
      return;
    }
    const ex = layout.route[segment * 2 + 2] - ax;
    const ez = layout.route[segment * 2 + 3] - az;
    const length = Math.hypot(ex, ez);
    if (length < 1e-6) {
      return;
    }
    const dirX = ex / length;
    const dirZ = ez / length;
    for (let i = 0; i < layout.holeCount; i += 1) {
      const hx = layout.holes[i * 3];
      const hz = layout.holes[i * 3 + 1];
      const gap = Math.hypot(hx - input.x, hz - input.z);
      if (gap > HOLE_REACH) {
        continue;
      }
      const lateral = (hx - ax) * -dirZ + (hz - az) * dirX;
      if (Math.abs(lateral) < 1e-5) {
        continue; // Dead on the line: either side is as good as the other.
      }
      const push = (lateral > 0 ? -1 : 1) * HOLE_CLEARANCE * (1 - gap / HOLE_REACH);
      this.target.x += -dirZ * push;
      this.target.z += dirX * push;
    }
  }

  /**
   * Pick the furthest point down the route the marble can roll at in a
   * straight line.
   *
   * A plain arc-length look-ahead cuts corners diagonally and can press the
   * marble into the inside corner of a turn, where both walls push it back and
   * it never gets round. Falling back until the aim point is in line of sight
   * keeps every target reachable, so corners are taken cell by cell instead.
   */
  private aim(layout: LevelLayout, input: DriverInput, distance: number): void {
    const candidates = [distance, distance * 0.7, distance * 0.45, CELL * 0.3];
    for (let i = 0; i < candidates.length; i += 1) {
      this.lookAhead(layout, candidates[i]);
      if (!this.blocked(layout, input.x, input.z, this.target.x, this.target.z)) {
        return;
      }
    }
    // Nothing is visible: head for the end of the current segment, which sits
    // along the corridor the marble is already in.
    const end = Math.min(layout.route.length / 2 - 1, this.segment + 1);
    this.target.set(layout.route[end * 2], 0, layout.route[end * 2 + 1]);
  }

  /** Does a wall stand between two board-space points? */
  private blocked(layout: LevelLayout, x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.005));
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const px = x0 + dx * t;
      const pz = z0 + dz * t;
      for (let i = 0; i < layout.wallCount; i += 1) {
        if (
          px > layout.walls[i * 4] - MARBLE_RADIUS &&
          px < layout.walls[i * 4 + 1] + MARBLE_RADIUS &&
          pz > layout.walls[i * 4 + 2] - MARBLE_RADIUS &&
          pz < layout.walls[i * 4 + 3] + MARBLE_RADIUS
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** Distance from the marble to the closest trap hole, in metres. */
  private holeGap(layout: LevelLayout, input: DriverInput): number {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.holeCount; i += 1) {
      const dx = input.x - layout.holes[i * 3];
      const dz = input.z - layout.holes[i * 3 + 1];
      best = Math.min(best, Math.hypot(dx, dz));
    }
    return best;
  }

  /** Aim straight at the nearest hole: this beat is the drop counter. */
  private aimAtHole(layout: LevelLayout, input: DriverInput): void {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < layout.holeCount; i += 1) {
      const dx = layout.holes[i * 3] - input.x;
      const dz = layout.holes[i * 3 + 1] - input.z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        this.target.set(layout.holes[i * 3], 0, layout.holes[i * 3 + 1]);
      }
    }
  }

  /** Back out one cell along the route before retrying a corner. */
  private pullBack(layout: LevelLayout, input: DriverInput): void {
    const count = layout.route.length / 2;
    let index = Math.max(0, Math.min(count - 1, this.recoverIndex));
    const dx = layout.route[index * 2] - input.x;
    const dz = layout.route[index * 2 + 1] - input.z;
    if (dx * dx + dz * dz < 0.004 * 0.004) {
      // Already sitting on that cell: aim one further back so the marble
      // actually reverses instead of being asked to stay put.
      index = Math.max(0, index - 1);
    }
    this.target.set(layout.route[index * 2], 0, layout.route[index * 2 + 1]);
  }

  /** Turn "reach this point at this speed" into a tray tilt. */
  private steer(input: DriverInput, delta: number, speed: number): void {
    // Glide the aim point. A corner fallback or a braided segment flip can move
    // it a whole cell in one frame, and a hand would never twitch like that.
    if (this.aimReady) {
      const glide = 1 - Math.exp(-delta / AIM_SMOOTH);
      this.aimX += (this.target.x - this.aimX) * glide;
      this.aimZ += (this.target.z - this.aimZ) * glide;
    } else {
      this.aimReady = true;
      this.aimX = this.target.x;
      this.aimZ = this.target.z;
    }

    const dx = this.aimX - input.x;
    const dz = this.aimZ - input.z;
    const distance = Math.hypot(dx, dz);
    const wanted = Math.min(speed, distance * 3.2);
    const scale = distance > 1e-5 ? wanted / distance : 0;
    let ax = STEER_GAIN * (dx * scale - input.vx);
    let az = STEER_GAIN * (dz * scale - input.vz);

    // Below the marble's breakaway pull nothing happens, so never ask for a
    // token nudge: keep the direction but make it strong enough to move. Only
    // worth doing while it is stopped -- on a rolling marble the boost would
    // turn every small correction into a full-tilt bang.
    const demand = Math.hypot(ax, az);
    const rolling = Math.hypot(input.vx, input.vz) > BREAKAWAY_SPEED;
    if (demand > 1e-6 && demand < MIN_ACCEL && !rolling && distance > 0.004) {
      const boost = MIN_ACCEL / demand;
      ax *= boost;
      az *= boost;
    }

    this.applyAcceleration(ax, az, delta);
  }

  /** Tilt the tray enough to request (ax, az) of marble acceleration. */
  private applyAcceleration(ax: number, az: number, delta: number): void {
    const limit = GRAVITY * Math.sin(STEER_TILT);
    let gx = ax * ROLL_FACTOR;
    let gz = az * ROLL_FACTOR;
    const magnitude = Math.hypot(gx, gz);
    if (magnitude > limit) {
      const scale = limit / magnitude;
      gx *= scale;
      gz *= scale;
    }
    this.tilt(gx, gz, delta);
  }

  /**
   * Ease the tray towards an in-plane gravity (gx, gz).
   *
   * Every pose goes through here, including the scripted ones, so nothing the
   * driver does can snap the board. Hands have inertia: a tilt that arrives in
   * one frame is the one thing that reads as a glitch on camera.
   */
  private tilt(gx: number, gz: number, delta: number, smoothing = TILT_SMOOTH): void {
    const settle = 1 - Math.exp(-delta / smoothing);
    this.gx += (gx - this.gx) * settle;
    this.gz += (gz - this.gz) * settle;
    this.pose.apply(this.gx, this.gz, this.lift);
  }
}

/**
 * Keyboard fallback: arrow keys tilt the tray, space tips it over.
 *
 * Tilt slews toward the key direction and back to level when released, which
 * is close enough to a two-handed tilt to learn in a few seconds.
 */
export class KeyDriver implements TrayDriver {
  /** The keyboard fallback keeps the game's own first-person view. */
  readonly framesCamera = false;
  private readonly pose: TrayPose;
  private readonly keys = new Set<string>();
  private elapsed = 0;
  private held = false;
  private lift = 0;
  private gx = 0;
  private gz = 0;

  constructor(tray: Object3D, home: Vector3, homeQuaternion: Quaternion) {
    this.pose = new TrayPose(tray, home, homeQuaternion);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code);
    if (event.code === 'Space') {
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  update(delta: number, _layout: LevelLayout, _input: DriverInput): boolean {
    this.elapsed += delta;
    if (!this.held) {
      if (this.elapsed < 0.6) {
        this.pose.apply(0, 0, 0);
        return false;
      }
      this.held = true;
    }
    const liftProgress = Math.min(1, (this.elapsed - 0.6) / LIFT_TIME);
    this.lift = easeOutCubic(liftProgress) * LIFT_HEIGHT;

    const keys = this.keys;
    const tipping = keys.has('Space');
    let targetX = 0;
    let targetZ = 0;
    if (tipping) {
      targetX = GRAVITY * Math.sin(TIP_TILT);
    } else {
      const right = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
      const back = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
      const length = Math.hypot(right, back);
      if (length > 0) {
        const pull = (GRAVITY * Math.sin(KEY_TILT)) / length;
        targetX = right * pull;
        targetZ = back * pull;
      }
    }

    const step = (tipping ? KEY_SLEW * 2 : KEY_SLEW) * delta;
    this.gx = approach(this.gx, targetX, step);
    this.gz = approach(this.gz, targetZ, step);
    this.pose.apply(this.gx, this.gz, this.lift);
    return true;
  }
}

/**
 * Pick a driver from the page URL, if one was asked for.
 *
 * Both are opt-in so the shipped game stays hands-only: `?demo` for filming or
 * an attract mode, `?keys` for a keyboard, nothing at all for a headset.
 */
export function createTrayDriver(
  tray: Object3D,
  home: Vector3,
  homeQuaternion: Quaternion,
): TrayDriver | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has('demo')) {
    return new DemoDriver(tray, home, homeQuaternion);
  }
  if (params.has('keys')) {
    return new KeyDriver(tray, home, homeQuaternion);
  }
  return null;
}

