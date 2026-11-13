/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { findUIKitDocument, type Object3D } from '@iwsdk/core';

type HudDocument = NonNullable<ReturnType<typeof findUIKitDocument>>;

/** "0:07", "1:42" — level clock as the player reads it. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`;
}

/**
 * Thin wrapper over the HUD's UIKitML document.
 *
 * Every setter caches the last string it wrote: UIKit re-lays out text on
 * every property write, so only real changes are pushed even though the system
 * calls these every frame.
 */
export class HudView {
  private readonly document: HudDocument;

  private levelCount = '';
  private levelName = '';
  private timeValue = '';
  private dropsValue = '';
  private checkValue = '';
  private hintValue = '';

  constructor(sceneObject: Object3D) {
    const document = findUIKitDocument(sceneObject);
    if (document === null) {
      throw new Error('[handheld] scoreboard HUD is missing its UIKit document');
    }
    this.document = document;
  }

  setLevel(index: number, total: number, name: string): void {
    const count = `${index + 1}/${total}`;
    if (count !== this.levelCount) {
      this.levelCount = count;
      this.write('level-count', count);
    }
    const label = name.toUpperCase();
    if (label !== this.levelName) {
      this.levelName = label;
      this.write('level-name', label);
    }
  }

  setTime(seconds: number): void {
    const text = formatClock(seconds);
    if (text !== this.timeValue) {
      this.timeValue = text;
      this.write('time-value', text);
    }
  }

  setDrops(count: number): void {
    const text = `${count}`;
    if (text !== this.dropsValue) {
      this.dropsValue = text;
      this.write('drops-value', text);
    }
  }

  setCheckpoints(done: number, total: number): void {
    const text = `${done}/${total}`;
    if (text !== this.checkValue) {
      this.checkValue = text;
      this.write('check-value', text);
    }
  }

  setHint(text: string): void {
    if (text !== this.hintValue) {
      this.hintValue = text;
      this.write('hint-value', text);
    }
  }

  private write(id: string, value: string): void {
    // Element ids are authored in public/ui/handheld.uikitml.
    const element = this.document.getElementById(id);
    element?.setProperties({ text: value });
  }
}
