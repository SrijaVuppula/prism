import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushPayload } from "prism-alert-engine";

vi.mock("../../src/push/pushService", () => ({
  sendPushNotification: vi.fn(),
  isExpiredSubscriptionError: vi.fn(),
}));

import { isExpiredSubscriptionError, sendPushNotification } from "../../src/push/pushService";
import { dispatchPushNotifications } from "../../src/push/dispatchPush";
import type { PushSubscriptionStore } from "../../src/push/subscriptionStore";

const payload: PushPayload = {
  title: "Prism — Urgent",
  body: "A person at the door.",
  data: { eventId: "evt_1", signalClass: "Urgent", snapshotUrl: "https://cdn.ring.com/snap/evt_1.jpg" },
};

function fakeStore(subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>): PushSubscriptionStore {
  return {
    list: vi.fn().mockResolvedValue(subscriptions),
    remove: vi.fn().mockResolvedValue(undefined),
    save: vi.fn(),
  } as unknown as PushSubscriptionStore;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(sendPushNotification).mockReset();
  vi.mocked(isExpiredSubscriptionError).mockReset();
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("dispatchPushNotifications", () => {
  it("sends to every subscription and does nothing else when all succeed", async () => {
    const store = fakeStore([
      { endpoint: "ep-1", p256dh: "p1", auth: "a1" },
      { endpoint: "ep-2", p256dh: "p2", auth: "a2" },
    ]);
    vi.mocked(sendPushNotification).mockResolvedValue(undefined);

    await dispatchPushNotifications(payload, store);

    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(sendPushNotification).toHaveBeenCalledWith(
      { endpoint: "ep-1", p256dh: "p1", auth: "a1" },
      JSON.stringify(payload),
    );
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("prunes a subscription the push service reports as expired", async () => {
    const store = fakeStore([{ endpoint: "ep-dead", p256dh: "p1", auth: "a1" }]);
    const expiredError = new Error("gone");
    vi.mocked(sendPushNotification).mockRejectedValue(expiredError);
    vi.mocked(isExpiredSubscriptionError).mockReturnValue(true);

    await dispatchPushNotifications(payload, store);

    expect(store.remove).toHaveBeenCalledWith("ep-dead");
  });

  it("logs, but does not prune, a non-expiry delivery failure", async () => {
    const store = fakeStore([{ endpoint: "ep-flaky", p256dh: "p1", auth: "a1" }]);
    vi.mocked(sendPushNotification).mockRejectedValue(new Error("network blip"));
    vi.mocked(isExpiredSubscriptionError).mockReturnValue(false);

    await dispatchPushNotifications(payload, store);

    expect(store.remove).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("does nothing and sends to no one when there are no subscriptions", async () => {
    const store = fakeStore([]);

    await dispatchPushNotifications(payload, store);

    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});
