// A stand-in for the Web Audio API's AudioContext, which jsdom doesn't
// have: it records each oscillator's pitch and start and stop times.

import { vi } from "vitest";

export class FakeOscillator {
  type = "sine";
  frequency = { setValueAtTime: vi.fn() };
  startedAt?: number;
  stoppedAt?: number;
  connect = vi.fn();
  start(at: number) {
    this.startedAt = at;
  }
  stop(at: number) {
    this.stoppedAt = at;
  }
}

export class FakeAudioContext {
  state: "suspended" | "running" = "suspended";
  currentTime = 10;
  destination = {};
  oscillators: FakeOscillator[] = [];

  /** Whether the browser lets this context start, as after a tap on the page. */
  constructor(private readonly allowed = true) {}

  resume = vi.fn(async () => {
    if (this.allowed) this.state = "running";
  });

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  }
}
