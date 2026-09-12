// Thin wrapper around the `web-push` library: configures VAPID details once,
// sends a single notification, and classifies delivery failures so a dead
// subscription (the push service returns 404/410 because the browser
// unsubscribed or the endpoint expired) can be told apart from a transient
// failure that's simply worth logging.

import webPush from "web-push";
import type { PushSubscriptionRecord } from "./subscriptionStore";
import { getWebPushConfig } from "./config";

export class PushDeliveryError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number | undefined,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PushDeliveryError";
  }
}

let vapidConfigured = false;

function ensureVapidConfigured(): void {
  if (vapidConfigured) return;
  const { publicKey, privateKey, subject } = getWebPushConfig();
  webPush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/** True when the push service reports this subscription no longer exists and it should be dropped. */
export function isExpiredSubscriptionError(err: unknown): boolean {
  return err instanceof PushDeliveryError && (err.statusCode === 404 || err.statusCode === 410);
}

export async function sendPushNotification(
  subscription: PushSubscriptionRecord,
  payloadJson: string,
): Promise<void> {
  ensureVapidConfigured();
  try {
    await webPush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payloadJson,
    );
  } catch (err) {
    const statusCode =
      typeof (err as { statusCode?: unknown })?.statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : undefined;
    throw new PushDeliveryError(`Web Push delivery failed for endpoint ${subscription.endpoint}`, statusCode, err);
  }
}

/** Test-only: lets tests force re-configuration after mocking web-push. */
export function __resetVapidConfigurationForTests(): void {
  vapidConfigured = false;
}
