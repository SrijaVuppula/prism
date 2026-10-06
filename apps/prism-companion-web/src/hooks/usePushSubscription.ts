// Subscribes this browser to Web Push: registers the service worker, fetches
// the backend's VAPID public key, subscribes via PushManager, and registers
// the subscription with prism-backend/src/push/routes.ts so the backend can
// dispatch to it later (prism-backend/src/push/dispatchPush.ts).

import { useCallback, useState } from "react";
import { urlBase64ToUint8Array } from "../lib/applicationServerKey";
import { describePushError } from "../lib/pushErrors";

export type PushSubscriptionStatus = "idle" | "subscribing" | "subscribed" | "unsupported" | "denied";

export interface UsePushSubscriptionResult {
  status: PushSubscriptionStatus;
  error: string | null;
  subscribe: () => Promise<void>;
}

function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

function resolveApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "";
}

export function usePushSubscription(): UsePushSubscriptionResult {
  const [status, setStatus] = useState<PushSubscriptionStatus>(() => (isPushSupported() ? "idle" : "unsupported"));
  const [error, setError] = useState<string | null>(null);

  const subscribe = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("unsupported");
      return;
    }

    setStatus("subscribing");
    setError(null);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");

      const keyResponse = await fetch(`${resolveApiBase()}/push/vapid-public-key`);
      if (!keyResponse.ok) {
        throw new Error(`Failed to fetch the push public key (${keyResponse.status})`);
      }
      const { publicKey } = (await keyResponse.json()) as { publicKey: string };

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const subscribeResponse = await fetch(`${resolveApiBase()}/push/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!subscribeResponse.ok) {
        throw new Error(`Failed to register the subscription with the backend (${subscribeResponse.status})`);
      }

      setStatus("subscribed");
    } catch (err) {
      console.error("[push] subscription failed:", err);
      setError(describePushError(err));
      setStatus("idle");
    }
  }, []);

  return { status, error, subscribe };
}
