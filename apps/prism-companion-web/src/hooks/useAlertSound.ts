// Plays the latest live alert's sound (see lib/alertSound.ts): a tone for
// each pulse of its vibration pattern, for Notable and Urgent alerts, when
// sounds are on for this device. Keyed on event id like useVibration, so two
// alerts of the same class in a row both play.
//
// Browsers only let a page play sound after the person has interacted with
// it, so the audio is started on the first tap or key press anywhere on the
// page. An alert that arrives before then is silent; the card, vibration
// and push still carry it.

import { useEffect, useRef } from "react";
import { playTones, readAlertSoundsEnabled, tonesForPattern, TONE_FREQUENCY } from "../lib/alertSound";
import type { CompanionEventMessage } from "../types";

type AudioContextFactory = () => AudioContext | null;

function browserAudioContext(): AudioContext | null {
  const Context =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context() : null;
}

export function useAlertSound(
  message: CompanionEventMessage | null,
  createContext: AudioContextFactory = browserAudioContext,
): void {
  const context = useRef<AudioContext | null>(null);
  const lastEventId = useRef<string | null>(null);

  useEffect(() => {
    const unlock = () => {
      context.current ??= createContext();
      void context.current?.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [createContext]);

  useEffect(() => {
    const pattern = message?.channels.haptic;
    const signalClass = message?.channels.visual?.signalClass ?? message?.event.scoring?.signalClass;
    const frequency = signalClass ? TONE_FREQUENCY[signalClass] : undefined;
    if (!message || !pattern || pattern.length === 0 || !frequency) return;
    if (message.event.id === lastEventId.current) return;
    lastEventId.current = message.event.id;
    if (!readAlertSoundsEnabled()) return;

    const audio = context.current;
    if (!audio) return;
    const tones = tonesForPattern(pattern);
    // Scheduling on a suspended context would play the tones late, whenever
    // it resumed, so only play once it's running.
    void audio
      .resume()
      .then(() => {
        if (audio.state === "running") playTones(audio, tones, frequency);
      })
      .catch(() => {});
  }, [message]);
}
