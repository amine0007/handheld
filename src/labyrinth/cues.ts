/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * All game audio is synthesised with Web Audio, so the experience ships with no
 * audio files and works offline. The context is created lazily on the first
 * audible event (by then the player has already pressed a button to enter XR,
 * which satisfies the autoplay gesture requirement).
 */
export class CuePlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastTap = 0;
  private failed = false;

  private ensure(): AudioContext | null {
    if (this.failed) {
      return null;
    }
    if (this.context !== null) {
      if (this.context.state === 'suspended') {
        this.context.resume().catch(() => undefined);
      }
      return this.context;
    }
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0.7;
      master.connect(context.destination);

      const length = Math.floor(context.sampleRate * 0.06);
      const noise = context.createBuffer(1, length, context.sampleRate);
      const samples = noise.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const decay = 1 - i / length;
        samples[i] = (Math.random() * 2 - 1) * decay * decay;
      }

      this.context = context;
      this.master = master;
      this.noise = noise;
      return context;
    } catch {
      this.failed = true;
      return null;
    }
  }

  /** Marble clacking into a wall. `strength` is the impact speed, in m/s. */
  tap(strength: number): void {
    const context = this.ensure();
    if (context === null || this.noise === null || this.master === null) {
      return;
    }
    const now = context.currentTime;
    if (now - this.lastTap < 0.03 || strength < 0.03) {
      return;
    }
    this.lastTap = now;

    const level = Math.min(0.5, 0.08 + strength * 1.6);
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500 + strength * 1800;
    filter.Q.value = 1.4;
    const gain = context.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + 0.1);
  }

  /** Marble dropping into a trap hole. */
  drop(): void {
    if (this.ensure() === null) {
      return;
    }
    this.tone(520, 90, 0.42, 0.22, 0, 'triangle');
  }

  /** Checkpoint collected. */
  checkpoint(): void {
    if (this.ensure() === null) {
      return;
    }
    this.tone(784, 784, 0.12, 0.16, 0);
    this.tone(1174, 1174, 0.18, 0.12, 0.07);
  }

  /** Level or run complete. */
  fanfare(): void {
    if (this.ensure() === null) {
      return;
    }
    const notes = [523.25, 659.25, 783.99, 1046.5];
    for (let i = 0; i < notes.length; i++) {
      this.tone(notes[i], notes[i], 0.3, 0.14, i * 0.09);
    }
  }

  /** Win chime for the whole run. */
  victory(): void {
    if (this.ensure() === null) {
      return;
    }
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (let i = 0; i < notes.length; i++) {
      this.tone(notes[i], notes[i], 0.36, 0.15, i * 0.11);
    }
    this.tone(261.63, 261.63, 1.1, 0.1, 0.2, 'triangle');
  }

  private tone(
    startFrequency: number,
    endFrequency: number,
    duration: number,
    level: number,
    delay: number,
    type: OscillatorType = 'sine',
  ): void {
    const context = this.context;
    const master = this.master;
    if (context === null || master === null) {
      return;
    }
    const now = context.currentTime + delay;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    if (endFrequency !== startFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, endFrequency),
        now + duration,
      );
    }
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
