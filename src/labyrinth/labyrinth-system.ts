/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  createSystem,
  Grabbed,
  Quaternion,
  Vector3,
  type Entity,
  type Object3D,
  type UIKitMLAsset,
} from '@iwsdk/core';
import { BoardView } from './board-view';
import { CuePlayer } from './cues';
import { formatClock, HudView } from './hud-view';
import {
  HALF_DEPTH,
  HALF_WIDTH,
  LEVELS,
  MARBLE_RADIUS,
  RING_CAPTURE_RADIUS,
  type LevelLayout,
} from './levels';
import {
  LabyrinthState,
  PHASE_CLEARING,
  PHASE_COMPLETE,
  PHASE_IDLE,
  PHASE_PLAYING,
} from './labyrinth-state';
import { MarbleSim } from './marble-sim';
import { createTrayDriver, type DriverInput, type TrayDriver } from './tray-driver';

/**
 * Handheld: a bimanual marble labyrinth.
 *
 * The tray the player holds *is* the physics world. Every frame the system
 * reads the tray's world orientation, rotates gravity into board space and
 * feeds the two in-plane components to {@link MarbleSim}, so the marble
 * accelerates exactly the way a real one would on a surface tilted by the
 * player's own hands. Nothing else moves the marble, which is what makes the
 * two-handed grip the whole game.
 *
 * Frame order: orientation -> hold state -> home return -> state machine ->
 * tip-to-reset -> HUD -> ECS mirror. Physics only runs while a level is live,
 * and every step is a fixed-size substep loop inside {@link MarbleSim}, so a
 * long frame (or a warp in and out of XR) cannot tunnel the marble through a
 * wall or over a trap hole.
 */

const GRAVITY = 9.81;
const RAD_TO_DEG = 180 / Math.PI;

/** Longest frame the simulation will integrate; a hitch becomes slow motion. */
const MAX_FRAME = 0.05;
/** Seconds the marble spends falling out of a trap hole before it comes back. */
const RESPAWN_DELAY = 0.65;
/** Seconds the "level clear" state stays up before the next maze loads. */
const CLEAR_DELAY = 2.7;
/** cos(tilt) below this counts as "tipped over": the marble drops off. */
const TIPPED_COS = 0.45;
/** Seconds the tray must stay tipped before a reset is accepted. */
const TIP_DELAY = 0.45;
/** Time added to the level clock for an intentional tip reset. */
const TIP_PENALTY = 5;
/** Distance from its stand at which a released tray drifts back home. */
const HOME_DISTANCE = 0.55;
/** A released tray below this height is always brought back up. */
const HOME_FLOOR_Y = 0.42;
/** Separation at which a fingertip starts pushing the marble. */
const POKE_REACH = MARBLE_RADIUS + 0.008;
/** Fastest the marble can be flicked by a fingertip, in m/s. */
const POKE_MAX_SPEED = 0.4;
/** How far behind and above the tray the demo camera sits, in world metres. */
const CAMERA_BACK = 0.58;
const CAMERA_UP = 0.28;
/** How far the demo camera aims from the board towards the scoreboard. */
const CAMERA_HUD_AIM = 0.34;

export class LabyrinthSystem extends createSystem({}) {
  private tray!: Object3D;
  private trayEntity!: Entity;
  private view!: BoardView;
  private hud: HudView | null = null;
  private readonly cues = new CuePlayer();
  private readonly sim = new MarbleSim();
  private layout: LevelLayout = LEVELS[0];

  private phase = PHASE_IDLE;
  private levelIndex = 0;
  private levelSeconds = 0;
  private runSeconds = 0;
  private drops = 0;
  private checkpoint = 0;
  private respawnX = 0;
  private respawnZ = 0;
  private respawnTimer = 0;
  private clearTimer = 0;
  private tipTimer = 0;
  private tiltDegrees = 0;
  private tipped = false;
  private holding = false;

  private readonly homePosition = new Vector3();
  private readonly homeQuaternion = new Quaternion();
  /** Optional stand-in for the player's hands: `?demo` or `?keys`. */
  private driver: TrayDriver | null = null;
  private readonly driverInput: DriverInput = {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    phase: PHASE_IDLE,
    checkpoint: 0,
    dropping: false,
  };
  private readonly boardQuaternion = new Quaternion();
  private readonly inverseQuaternion = new Quaternion();
  private readonly gravityLocal = new Vector3();
  private readonly tipPoint = new Vector3();
  private readonly cameraGoal = new Vector3();
  private readonly cameraLook = new Vector3();
  private readonly cameraAim = new Vector3();
  private readonly cameraAnchor = new Vector3();
  private readonly hudPoint = new Vector3();
  private scoreboard: Object3D | null = null;
  private cameraFramed = false;

  // Last values mirrored into LabyrinthState; writes only happen on change.
  private stateLevel = -1;
  private statePhase = -1;
  private stateDrops = -1;
  private stateCheckpoint = -1;
  private stateSeconds = -1;
  private stateTilt = -1;

  init(): void {
    const tray = this.world.getSceneObject('tray');
    if (tray === undefined) {
      throw new Error('[handheld] the scene is missing its "tray" node');
    }
    this.tray = tray;
    this.trayEntity = this.world.requireSceneEntity('tray');
    if (!this.trayEntity.hasComponent(LabyrinthState)) {
      this.trayEntity.addComponent(LabyrinthState);
    }

    this.view = new BoardView(tray);

    const scoreboard = this.world.getSceneObject<UIKitMLAsset>('scoreboard');
    if (scoreboard !== undefined) {
      this.scoreboard = scoreboard;
      try {
        this.hud = new HudView(scoreboard);
      } catch {
        // A missing UIKit document must not take the game down with it.
        this.hud = null;
      }
    }

    this.homePosition.copy(tray.position);
    this.homeQuaternion.copy(tray.quaternion);
    this.driver = createTrayDriver(tray, this.homePosition, this.homeQuaternion);
    if (this.driver !== null && this.driver.framesCamera) {
      // The attract mode is filmed from closer than a player stands, so lift
      // the title card clear of the scoreboard in that view.
      const card = this.world.getSceneObject('welcome-panel');
      if (card !== undefined) {
        card.position.y += 0.26;
      }
    }

    this.loadLevel(0);
    this.phase = PHASE_IDLE;
    this.updateHud();
    this.pushState();
  }

  update(delta: number): void {
    const dt = Math.min(MAX_FRAME, Math.max(0, delta));
    // A driver, when present, poses the tray before the tilt is read, so the
    // marble is driven by the very same gravity path a real grip produces.
    const driven = this.driveTray(dt);
    this.readTilt();
    this.holding = driven || this.trayEntity.hasComponent(Grabbed);
    this.updateHome(dt);
    this.updateFlow(dt);
    this.updateTip(dt);
    this.updateHud();
    this.pushState();
    this.frameCamera(dt);
  }

  /**
   * Frame the tray for a screen recording.
   *
   * The attract mode exists to be filmed, and the page's own first-person view
   * leaves the board small and low in frame. Only the page camera moves: while
   * an immersive session is presenting, the headset keeps its own pose.
   */
  private frameCamera(dt: number): void {
    const driver = this.driver;
    if (driver === null || !driver.framesCamera || this.world.renderer.xr.isPresenting) {
      this.cameraFramed = false;
      return;
    }
    const camera = this.world.camera;
    this.tray.getWorldPosition(this.cameraAnchor);
    // Aim between the board and the scoreboard so both stay in shot.
    this.cameraLook.copy(this.cameraAnchor);
    if (this.scoreboard !== null) {
      this.scoreboard.getWorldPosition(this.hudPoint);
      this.cameraLook.lerp(this.hudPoint, CAMERA_HUD_AIM);
    }
    this.cameraGoal.set(
      this.cameraAnchor.x,
      this.cameraAnchor.y + CAMERA_UP,
      this.cameraAnchor.z + CAMERA_BACK,
    );
    const parent = camera.parent;
    if (parent === null) {
      return;
    }
    parent.updateWorldMatrix(true, false);
    parent.worldToLocal(this.cameraGoal);
    if (this.cameraFramed) {
      camera.position.lerp(this.cameraGoal, 1 - Math.exp(-6 * dt));
      // Ease the aim as well. Pointing straight at the live tray position puts
      // every bit of tray jitter into the frame's rotation, which reads as the
      // whole shot shaking even when the camera itself is steady.
      this.cameraAim.lerp(this.cameraLook, 1 - Math.exp(-5 * dt));
    } else {
      this.cameraFramed = true;
      camera.position.copy(this.cameraGoal);
      this.cameraAim.copy(this.cameraLook);
    }
    // lookAt takes world space, so the board stays centred on the player rig.
    camera.lookAt(this.cameraAim);
  }

  /** Hand the tray to the scripted or keyboard driver, if one is active. */
  private driveTray(dt: number): boolean {
    const driver = this.driver;
    if (driver === null) {
      return false;
    }
    const input = this.driverInput;
    input.x = this.sim.x;
    input.z = this.sim.z;
    input.vx = this.sim.vx;
    input.vz = this.sim.vz;
    input.phase = this.phase;
    input.checkpoint = this.checkpoint;
    input.dropping = this.sim.falling || this.respawnTimer > 0;
    return driver.update(dt, this.layout, input);
  }

  /** World tilt of the tray, expressed as board-local gravity. */
  private readTilt(): void {
    this.tray.updateWorldMatrix(true, false);
    this.tray.getWorldQuaternion(this.boardQuaternion);
    this.inverseQuaternion.copy(this.boardQuaternion).invert();
    this.gravityLocal.set(0, -GRAVITY, 0).applyQuaternion(this.inverseQuaternion);

    const cosine = Math.max(-1, Math.min(1, -this.gravityLocal.y / GRAVITY));
    this.tiltDegrees = Math.acos(cosine) * RAD_TO_DEG;
    this.tipped = cosine < TIPPED_COS;
  }

  /** Bring an abandoned tray back to its stand instead of losing it. */
  private updateHome(dt: number): void {
    if (this.holding) {
      return;
    }
    const strayed = this.tray.position.distanceTo(this.homePosition) > HOME_DISTANCE;
    if (!strayed && this.tray.position.y >= HOME_FLOOR_Y) {
      return;
    }
    // Frame-rate independent ease: 1 - e^(-k dt).
    const t = 1 - Math.exp(-3.2 * dt);
    this.tray.position.lerp(this.homePosition, t);
    this.tray.quaternion.slerp(this.homeQuaternion, t);
  }

  private updateFlow(dt: number): void {
    switch (this.phase) {
      case PHASE_IDLE:
        // Lifting the tray is the only way to start; no buttons, no menus.
        if (this.holding) {
          this.startRun();
        }
        break;
      case PHASE_PLAYING:
        this.updatePlaying(dt);
        break;
      case PHASE_CLEARING:
        this.clearTimer -= dt;
        if (this.clearTimer <= 0) {
          this.loadLevel(this.levelIndex + 1);
          this.phase = PHASE_PLAYING;
        }
        break;
      case PHASE_COMPLETE:
        // Hold off for a moment so the summary can be read before a tip
        // is allowed to restart the run.
        this.clearTimer = Math.max(0, this.clearTimer - dt);
        break;
      default:
        break;
    }
  }

  /** Tipping the tray over is the hands-only reset gesture. */
  private updateTip(dt: number): void {
    if (!this.tipped) {
      this.tipTimer = 0;
      return;
    }
    this.tipTimer += dt;
    if (this.tipTimer < TIP_DELAY) {
      return;
    }
    this.tipTimer = 0;
    if (this.phase === PHASE_PLAYING) {
      this.resetFromTip();
    } else if (this.phase === PHASE_COMPLETE && this.clearTimer <= 0) {
      this.startRun();
    }
  }

  private updatePlaying(dt: number): void {
    this.levelSeconds += dt;
    this.runSeconds += dt;

    if (this.respawnTimer > 0) {
      // The marble is already falling; keep integrating the drop, then
      // return it to the last checkpoint.
      this.respawnTimer -= dt;
      this.stepFalling(dt);
      if (this.respawnTimer <= 0) {
        this.sim.reset(this.respawnX, this.respawnZ);
        this.view.placeMarble(this.respawnX, this.respawnZ);
      }
      return;
    }

    this.sim.step(
      dt,
      this.gravityLocal.x,
      this.gravityLocal.z,
      this.layout.walls,
      this.layout.wallCount,
      this.layout.holes,
      this.layout.holeCount,
    );
    if (this.sim.impactSpeed > 0.04) {
      this.cues.tap(this.sim.impactSpeed);
    }

    this.pokeMarble();
    this.view.setMarblePose(
      this.sim.x,
      this.sim.y,
      this.sim.z,
      this.sim.vx,
      this.sim.vz,
      dt,
    );

    if (this.sim.holeHit >= 0) {
      this.dropIntoHole();
      return;
    }
    this.checkProgress();
  }

  private stepFalling(dt: number): void {
    this.sim.step(
      dt,
      0,
      0,
      this.layout.walls,
      this.layout.wallCount,
      this.layout.holes,
      this.layout.holeCount,
    );
    this.view.setMarblePose(this.sim.x, this.sim.y, this.sim.z, 0, 0, 0);
    if (this.sim.isLost) {
      this.view.setMarbleVisible(false);
    }
  }

  /**
   * A fingertip inside the rim nudges the marble.
   *
   * This is the one place where hands act on the marble directly: the tray
   * becomes something you can reach into, and a stalled marble can be saved
   * without tipping the whole tray over.
   */
  private pokeMarble(): void {
    if (this.sim.falling) {
      return;
    }
    const spaces = this.world.playerSpaceEntities.indexTipSpaces;
    this.pokeWith(spaces.left.object3D);
    this.pokeWith(spaces.right.object3D);
  }

  private pokeWith(tip: Object3D | undefined): void {
    if (tip === undefined) {
      return;
    }
    tip.getWorldPosition(this.tipPoint);
    this.tray.worldToLocal(this.tipPoint);

    const x = this.tipPoint.x;
    const y = this.tipPoint.y;
    const z = this.tipPoint.z;
    // The grips sit outside the rim, so holding the tray never pokes.
    if (Math.abs(x) > HALF_WIDTH - 0.002 || Math.abs(z) > HALF_DEPTH - 0.002) {
      return;
    }
    if (y < -0.004 || y > 0.03) {
      return;
    }

    const dx = this.sim.x - x;
    const dz = this.sim.z - z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq > POKE_REACH * POKE_REACH) {
      return;
    }

    const distance = Math.sqrt(distanceSq);
    const nx = distance > 1e-5 ? dx / distance : 0;
    const nz = distance > 1e-5 ? dz / distance : 0;
    const target = Math.min(POKE_MAX_SPEED, (POKE_REACH - distance) * 30);
    const along = this.sim.vx * nx + this.sim.vz * nz;
    if (along >= target) {
      return;
    }
    const boost = target - along;
    this.sim.vx += nx * boost;
    this.sim.vz += nz * boost;
  }

  private checkProgress(): void {
    const layout = this.layout;
    const next = this.checkpoint;
    const capture = RING_CAPTURE_RADIUS * RING_CAPTURE_RADIUS;
    if (next < layout.checkpointCount) {
      const dx = this.sim.x - layout.checkpoints[next * 2];
      const dz = this.sim.z - layout.checkpoints[next * 2 + 1];
      if (dx * dx + dz * dz <= capture) {
        this.checkpoint = next + 1;
        this.respawnX = layout.checkpoints[next * 2];
        this.respawnZ = layout.checkpoints[next * 2 + 1];
        this.view.setRingProgress(this.checkpoint);
        this.cues.checkpoint();
      }
    }

    const gx = this.sim.x - layout.goalX;
    const gz = this.sim.z - layout.goalZ;
    if (gx * gx + gz * gz <= capture) {
      this.completeLevel();
    }
  }

  private dropIntoHole(): void {
    this.drops += 1;
    this.respawnTimer = RESPAWN_DELAY;
    this.cues.drop();
  }

  private completeLevel(): void {
    this.view.setGoalDone(true);
    this.view.setMarbleVisible(false);
    if (this.levelIndex >= LEVELS.length - 1) {
      this.phase = PHASE_COMPLETE;
      // Window where the summary is up before a tip may restart the run.
      this.clearTimer = 2.4;
      this.cues.victory();
      return;
    }
    this.phase = PHASE_CLEARING;
    this.clearTimer = CLEAR_DELAY;
    this.cues.fanfare();
  }

  /** Tray tipped over: drop the marble and restart the level's route. */
  private resetFromTip(): void {
    this.levelSeconds += TIP_PENALTY;
    this.checkpoint = 0;
    this.respawnX = this.layout.startX;
    this.respawnZ = this.layout.startZ;
    this.view.setRingProgress(0);
    this.sim.knockOff();
    this.respawnTimer = RESPAWN_DELAY;
    this.cues.drop();
  }

  private startRun(): void {
    this.runSeconds = 0;
    this.drops = 0;
    this.loadLevel(0);
    this.phase = PHASE_PLAYING;
    this.cues.checkpoint();
  }

  private loadLevel(index: number): void {
    const clamped = Math.max(0, Math.min(LEVELS.length - 1, index));
    this.levelIndex = clamped;
    this.layout = LEVELS[clamped];
    this.view.build(this.layout);

    this.checkpoint = 0;
    this.respawnX = this.layout.startX;
    this.respawnZ = this.layout.startZ;
    this.levelSeconds = 0;
    this.respawnTimer = 0;
    this.sim.reset(this.layout.startX, this.layout.startZ);
    this.view.placeMarble(this.layout.startX, this.layout.startZ);
  }

  private updateHud(): void {
    const hud = this.hud;
    if (hud === null) {
      return;
    }
    hud.setLevel(this.levelIndex, LEVELS.length, this.layout.name);
    hud.setTime(this.levelSeconds);
    hud.setDrops(this.drops);
    hud.setCheckpoints(this.checkpoint, this.layout.checkpointCount);
    hud.setHint(this.hint());
  }

  private hint(): string {
    switch (this.phase) {
      case PHASE_IDLE:
        return this.holding
          ? 'Roll the marble into the green ring'
          : 'Pinch both grips and lift the tray to start';
      case PHASE_PLAYING:
        if (this.respawnTimer > 0) {
          return 'Marble dropped - back to the last checkpoint';
        }
        if (this.tipped) {
          return 'Too steep - tip it back or the marble falls off';
        }
        return 'Tilt with both hands - a fingertip can nudge too';
      case PHASE_CLEARING:
        return `Level clear in ${formatClock(this.levelSeconds)}`;
      case PHASE_COMPLETE:
        return `Run complete in ${formatClock(this.runSeconds)} - tip the tray to play again`;
      default:
        return '';
    }
  }

  /** Mirror the hot-loop state onto the tray entity, only when it changes. */
  private pushState(): void {
    const entity = this.trayEntity;
    if (this.stateLevel !== this.levelIndex) {
      this.stateLevel = this.levelIndex;
      entity.setValue(LabyrinthState, 'level', this.levelIndex);
    }
    if (this.statePhase !== this.phase) {
      this.statePhase = this.phase;
      entity.setValue(LabyrinthState, 'phase', this.phase);
    }
    if (this.stateDrops !== this.drops) {
      this.stateDrops = this.drops;
      entity.setValue(LabyrinthState, 'drops', this.drops);
    }
    if (this.stateCheckpoint !== this.checkpoint) {
      this.stateCheckpoint = this.checkpoint;
      entity.setValue(LabyrinthState, 'checkpoint', this.checkpoint);
    }
    const seconds = Math.round(this.levelSeconds * 10) / 10;
    if (this.stateSeconds !== seconds) {
      this.stateSeconds = seconds;
      entity.setValue(LabyrinthState, 'seconds', seconds);
    }
    const tilt = Math.round(this.tiltDegrees * 10) / 10;
    if (this.stateTilt !== tilt) {
      this.stateTilt = tilt;
      entity.setValue(LabyrinthState, 'tiltDegrees', tilt);
    }
  }
}
