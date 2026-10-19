import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAlertSound } from "../../src/hooks/useAlertSound";
import { writeAlertSoundsEnabled } from "../../src/lib/alertSound";
import type { CompanionEventMessage } from "../../src/types";
import { FakeAudioContext } from "../lib/fakeAudioContext";

function alert(id: string, signalClass: "Routine" | "Notable" | "Urgent", haptic?: number[]): CompanionEventMessage {
  return {
    type: "prism-event",
    event: {
      id,
      occurredAt: "2026-10-18T06:00:00Z",
      snapshotUrl: "https://example.test/snap.jpg",
      scoring: { signalScore: 80, signalClass, breakdown: {} },
    },
    channels: { haptic },
  };
}

const URGENT = [300, 150, 300, 150, 300];

/** Renders the hook with a fake audio context, after a tap on the page if `tapped`. */
function setup({ tapped = true, allowed = true } = {}) {
  const context = new FakeAudioContext(allowed);
  const hook = renderHook(({ message }) => useAlertSound(message, () => context as unknown as AudioContext), {
    initialProps: { message: null as CompanionEventMessage | null },
  });
  if (tapped) act(() => void window.dispatchEvent(new Event("pointerdown")));
  return { context, ...hook };
}

describe("useAlertSound", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("plays an Urgent alert as low tones in its vibration rhythm", async () => {
    const { context, rerender } = setup();
    rerender({ message: alert("a1", "Urgent", URGENT) });

    await waitFor(() => expect(context.oscillators).toHaveLength(3));
    expect(context.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(392, 10);
  });

  it("plays Notable higher than Urgent, and keeps Routine silent", async () => {
    const { context, rerender } = setup();
    rerender({ message: alert("r1", "Routine", [100]) });
    rerender({ message: alert("n1", "Notable", [150, 100, 150]) });

    await waitFor(() => expect(context.oscillators).toHaveLength(2));
    expect(context.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(523, 10);
  });

  it("plays each alert once, even when the same alert is passed again", async () => {
    const { context, rerender } = setup();
    const message = alert("a1", "Urgent", URGENT);
    rerender({ message });
    await waitFor(() => expect(context.oscillators).toHaveLength(3));
    rerender({ message: { ...message } });
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(3);
  });

  it("stays silent when sounds are switched off on this device", async () => {
    writeAlertSoundsEnabled(false);
    const { context, rerender } = setup();
    rerender({ message: alert("a1", "Urgent", URGENT) });
    await Promise.resolve();
    expect(context.oscillators).toHaveLength(0);
  });

  it("stays silent until the page has been tapped, and when the browser won't start audio", async () => {
    const untapped = setup({ tapped: false });
    untapped.rerender({ message: alert("a1", "Urgent", URGENT) });
    await Promise.resolve();
    expect(untapped.context.oscillators).toHaveLength(0);

    const blocked = setup({ allowed: false });
    blocked.rerender({ message: alert("a2", "Urgent", URGENT) });
    await waitFor(() => expect(blocked.context.resume).toHaveBeenCalledTimes(2));
    expect(blocked.context.oscillators).toHaveLength(0);
  });
});
