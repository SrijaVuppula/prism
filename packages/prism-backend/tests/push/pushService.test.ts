import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webPush from "web-push";
import {
  __resetVapidConfigurationForTests,
  isExpiredSubscriptionError,
  PushDeliveryError,
  sendPushNotification,
} from "../../src/push/pushService";

const ENV = {
  VAPID_PUBLIC_KEY: "public-key",
  VAPID_PRIVATE_KEY: "private-key",
  VAPID_SUBJECT: "mailto:ops@example.com",
};

const subscription = { endpoint: "https://push.example.com/abc", p256dh: "p256dh-value", auth: "auth-value" };

beforeEach(() => {
  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
  __resetVapidConfigurationForTests();
  vi.mocked(webPush.setVapidDetails).mockReset();
  vi.mocked(webPush.sendNotification).mockReset().mockResolvedValue({} as never);
});

describe("sendPushNotification", () => {
  it("configures VAPID details once and sends the notification", async () => {
    await sendPushNotification(subscription, JSON.stringify({ title: "Prism" }));
    await sendPushNotification(subscription, JSON.stringify({ title: "Prism 2" }));

    expect(webPush.setVapidDetails).toHaveBeenCalledTimes(1);
    expect(webPush.setVapidDetails).toHaveBeenCalledWith(ENV.VAPID_SUBJECT, ENV.VAPID_PUBLIC_KEY, ENV.VAPID_PRIVATE_KEY);
    expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(webPush.sendNotification).mock.calls[0][0]).toEqual({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    });
  });

  it("wraps a delivery failure in PushDeliveryError, preserving the status code", async () => {
    const underlying = Object.assign(new Error("gone"), { statusCode: 410 });
    vi.mocked(webPush.sendNotification).mockRejectedValue(underlying);

    await expect(sendPushNotification(subscription, "{}")).rejects.toThrow(PushDeliveryError);
    try {
      await sendPushNotification(subscription, "{}");
      throw new Error("expected sendPushNotification to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PushDeliveryError);
      expect((err as PushDeliveryError).statusCode).toBe(410);
      expect((err as PushDeliveryError).cause).toBe(underlying);
    }
  });
});

describe("isExpiredSubscriptionError", () => {
  it("is true for 404 and 410 PushDeliveryErrors", () => {
    expect(isExpiredSubscriptionError(new PushDeliveryError("x", 404))).toBe(true);
    expect(isExpiredSubscriptionError(new PushDeliveryError("x", 410))).toBe(true);
  });

  it("is false for other status codes or non-PushDeliveryError values", () => {
    expect(isExpiredSubscriptionError(new PushDeliveryError("x", 500))).toBe(false);
    expect(isExpiredSubscriptionError(new Error("plain error"))).toBe(false);
  });
});
