// Fans a PushPayload out to every stored Web Push subscription. Delivery
// failures are isolated per-subscription -- one dead subscription must never
// stop the rest of the household's devices from being notified -- and a
// subscription the push service reports as gone is pruned from storage so
// future dispatches stop paying for it.

import type { PushPayload } from "prism-alert-engine";
import { getPushSubscriptionStore, type PushSubscriptionStore } from "./subscriptionStore";
import { isExpiredSubscriptionError, sendPushNotification } from "./pushService";

export async function dispatchPushNotifications(
  payload: PushPayload,
  store: PushSubscriptionStore = getPushSubscriptionStore(),
): Promise<void> {
  const startedAt = Date.now();
  const subscriptions = await store.list();
  const payloadJson = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map((subscription) => sendPushNotification(subscription, payloadJson)),
  );

  let delivered = 0;
  let pruned = 0;
  await Promise.all(
    results.map(async (result, index) => {
      if (result.status === "fulfilled") {
        delivered += 1;
        return;
      }
      const subscription = subscriptions[index];
      if (isExpiredSubscriptionError(result.reason)) {
        await store.remove(subscription.endpoint);
        pruned += 1;
      } else {
        console.error(`[push] delivery failed for endpoint ${subscription.endpoint}:`, result.reason);
      }
    }),
  );

  console.log(
    `[push] dispatchPushNotifications recipients=${subscriptions.length} delivered=${delivered} ` +
      `pruned=${pruned} latencyMs=${Date.now() - startedAt}`,
  );
}
