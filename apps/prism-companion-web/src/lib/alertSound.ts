// Alert sounds: a tone for each pulse of an alert's vibration pattern, so
// the sound has the same rhythm as the vibration and can be heard on a
// device that can't vibrate (a laptop, or iOS Safari). Only Notable and
// Urgent alerts make a sound, as only they vibrate.
//
// The tones are generated with the Web Audio API, so there are no audio
// files. They're low-pitched, since high frequencies are usually the first
// to go with hearing loss, and Urgent is lower than Notable.
//
// Whether to play them is a choice for this device, not the household (a
// kitchen laptop and a phone by the bed may differ), so it's kept in
// localStorage rather than in the household's preferences. Storage can be
// unavailable (private windows, blocked site data); sounds then stay on.

import type { SignalClass } from "prism-alert-engine";

export const ALERT_SOUNDS_KEY = "prism.alertSounds";

/** Tone pitch in Hz for each Signal Class that makes a sound. */
export const TONE_FREQUENCY: Partial<Record<SignalClass, number>> = { Notable: 523, Urgent: 392 };

/** Ramp in and out of each tone, in seconds, so tones don't click. */
const RAMP_SECONDS = 0.01;
const VOLUME = 0.3;

export function readAlertSoundsEnabled(): boolean {
  try {
    return window.localStorage.getItem(ALERT_SOUNDS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeAlertSoundsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ALERT_SOUNDS_KEY, enabled ? "on" : "off");
  } catch {
    // Nothing to do: sounds stay on for this page.
  }
}

export interface Tone {
  /** Seconds after the first tone starts. */
  start: number;
  duration: number;
}

/**
 * The tones for a vibration pattern: navigator.vibrate()'s alternating
 * on/off durations in milliseconds, where every "on" becomes a tone.
 */
export function tonesForPattern(pattern: number[]): Tone[] {
  const tones: Tone[] = [];
  let atMs = 0;
  pattern.forEach((value, index) => {
    const ms = Math.max(0, value);
    if (index % 2 === 0 && ms > 0) tones.push({ start: atMs / 1000, duration: ms / 1000 });
    atMs += ms;
  });
  return tones;
}

/** Schedules the tones on `context`, starting now. */
export function playTones(context: AudioContext, tones: Tone[], frequency: number): void {
  const now = context.currentTime;
  for (const tone of tones) {
    const start = now + tone.start;
    const end = start + tone.duration;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(VOLUME, start + Math.min(RAMP_SECONDS, tone.duration / 2));
    gain.gain.setValueAtTime(VOLUME, Math.max(start, end - RAMP_SECONDS));
    gain.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end);
  }
}
