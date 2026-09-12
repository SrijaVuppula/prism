import { describe, expect, it, vi } from "vitest";
import { PushSubscriptionStore } from "../../src/push/subscriptionStore";

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) } as any;
}

const subscription = { endpoint: "https://push.example.com/abc", p256dh: "p256dh-value", auth: "auth-value" };

describe("PushSubscriptionStore", () => {
  it("upserts a subscription keyed on endpoint", async () => {
    const pool = fakePool();
    const store = new PushSubscriptionStore(pool);

    await store.save(subscription);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(endpoint\) DO UPDATE/);
    expect(params).toEqual([subscription.endpoint, subscription.p256dh, subscription.auth]);
  });

  it("removes a subscription by endpoint", async () => {
    const pool = fakePool();
    const store = new PushSubscriptionStore(pool);

    await store.remove(subscription.endpoint);

    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM push_subscriptions/), [
      subscription.endpoint,
    ]);
  });

  it("lists all stored subscriptions", async () => {
    const pool = fakePool([subscription]);
    const store = new PushSubscriptionStore(pool);

    expect(await store.list()).toEqual([subscription]);
  });
});
