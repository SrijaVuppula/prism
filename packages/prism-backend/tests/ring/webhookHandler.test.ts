import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeRingEvent,
  RingWebhookValidationError,
  verifyHmacSignature,
} from "../../src/ring/webhookHandler";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyHmacSignature", () => {
  const secret = "test-secret";

  it("accepts a valid bare-hex signature", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const signature = sign(body.toString(), secret);
    expect(verifyHmacSignature(body, signature, secret)).toBe(true);
  });

  it("accepts a valid sha256=-prefixed signature", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const signature = `sha256=${sign(body.toString(), secret)}`;
    expect(verifyHmacSignature(body, signature, secret)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const signature = sign(body.toString(), secret);
    const tampered = Buffer.from(JSON.stringify({ hello: "mallory" }));
    expect(verifyHmacSignature(tampered, signature, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const signature = sign(body.toString(), secret);
    expect(verifyHmacSignature(body, signature, "wrong-secret")).toBe(false);
  });

  it("rejects a malformed signature header instead of throwing", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyHmacSignature(body, "not-hex-!!", secret)).toBe(false);
  });
});

describe("normalizeRingEvent", () => {
  const base = {
    event_id: "evt_123",
    device: { id: "dev_1", description: "Front Door" },
    created_at: "2026-01-01T12:00:00.000Z",
    snapshot_url: "https://cdn.ring.com/snap/evt_123.jpg",
  };

  it.each(["ding", "motion", "person-detected", "package-detected"] as const)(
    "normalizes a %s event into a PrismEvent",
    (kind) => {
      const event = normalizeRingEvent({ ...base, kind });
      expect(event).toEqual({
        id: "evt_123",
        occurredAt: "2026-01-01T12:00:00.000Z",
        snapshotUrl: base.snapshot_url,
        deviceId: base.device.id,
      });
    },
  );

  it("throws on an unknown event kind", () => {
    expect(() => normalizeRingEvent({ ...base, kind: "unknown" })).toThrow(
      RingWebhookValidationError,
    );
  });

  it("throws when snapshot_url is missing", () => {
    const { snapshot_url: _omit, ...rest } = base;
    expect(() => normalizeRingEvent({ ...rest, kind: "ding" })).toThrow(
      RingWebhookValidationError,
    );
  });

  it("throws on an invalid created_at", () => {
    expect(() =>
      normalizeRingEvent({ ...base, kind: "ding", created_at: "not-a-date" }),
    ).toThrow(RingWebhookValidationError);
  });

  it("throws on a non-object body", () => {
    expect(() => normalizeRingEvent("not-json")).toThrow(RingWebhookValidationError);
  });
});
