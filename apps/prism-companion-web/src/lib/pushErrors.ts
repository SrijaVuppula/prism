// Turns a failed push subscription into a message the user can act on.

/**
 * Chromium-based browsers without a push service -- VS Code's built-in
 * browser and other embedded Chromium views, or Brave with Google push
 * messaging turned off -- reject PushManager.subscribe() with an AbortError
 * reading "Registration failed - push service not available". The raw text
 * suggests a server problem, so say what actually helps.
 */
export const NO_PUSH_SERVICE_MESSAGE =
  "This browser can't receive push notifications. Open Prism in Chrome, Edge, Firefox or Safari to turn them on.";

/** The message of an Error or DOMException (not every DOMException implementation extends Error). */
function messageOf(err: unknown): string | null {
  if (typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return null;
}

export function describePushError(err: unknown): string {
  const message = messageOf(err);
  if (message && /push service not available/i.test(message)) {
    return NO_PUSH_SERVICE_MESSAGE;
  }
  return message || "Failed to enable push notifications.";
}
