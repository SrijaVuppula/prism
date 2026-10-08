import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRingSnapshotUrl } from "../../src/ring/snapshots";
import {
  parseRingWebhook,
  RingWebhookValidationError,
  toRingAlert,
  verifyHmacSignature,
} from "../../src/ring/webhookHandler";

// The motion payload from the Motion Detection section of Ring's Partner API docs.
const MOTION = {
  meta: {
    version: "1.1",
    time: "2026-02-13T13:39:57.200155525Z",
    request_id: "2ad45ade-1818-4154-813b-afdd8bcd8085",
    account_id: "ava1.ring.account.XXXYYY",
  },
  data: {
    id: "ava1.ring.device.a_motion_1786715596787",
    type: "motion_detected",
    attributes: {
      source: "ava1.ring.device.a",
      source_type: "devices",
      timestamp: 1786715596787,
      timestamp_readable: "2026-08-14 08:53:16",
      sub_type: "motion",
      component_ids: ["0"],
    },
    relationships: { devices: { links: { self: "/v1/devices/ava1.ring.device.a" } } },
  },
};

function withAttributes(attributes: Record<string, unknown>, type = "motion_detected") {
  return parseRingWebhook({ ...MOTION, data: { ...MOTION.data, type, attributes: { ...MOTION.data.attributes, ...attributes } } });
}

describe("verifyHmacSignature", () => {
  const key = "fake-signing-key-for-tests";
  const body = Buffer.from(JSON.stringify(MOTION));
  // Matches the docs' reference: hmac.new(signing_key.encode(), raw_body, sha256).hexdigest()
  const digest = createHmac("sha256", Buffer.from(key, "utf8")).update(body).digest("hex");

  it("accepts Ring's sha256=<hex> header, keyed with the signing key as given", () => {
    expect(verifyHmacSignature(body, `sha256=${digest}`, key)).toBe(true);
    expect(verifyHmacSignature(body, digest, key)).toBe(true);
  });

  it("rejects a wrong key, a changed body, and malformed signatures", () => {
    expect(verifyHmacSignature(body, `sha256=${digest}`, "another-key")).toBe(false);
    expect(verifyHmacSignature(Buffer.concat([body, Buffer.from(" ")]), `sha256=${digest}`, key)).toBe(false);
    expect(verifyHmacSignature(body, "sha256=not-hex", key)).toBe(false);
    expect(verifyHmacSignature(body, `sha256=${digest.slice(0, 10)}`, key)).toBe(false);
  });
});

describe("parseRingWebhook", () => {
  it("reads the v1.1 meta and data", () => {
    const webhook = parseRingWebhook(MOTION);
    expect(webhook.meta).toEqual(MOTION.meta);
    expect(webhook.data.type).toBe("motion_detected");
    expect(webhook.data.attributes.sub_type).toBe("motion");
  });

  it("rejects bodies missing the fields every event needs", () => {
    const missingAccount = { ...MOTION, meta: { ...MOTION.meta, account_id: undefined } };
    for (const body of [null, [], { kind: "ding" }, { meta: {}, data: {} }, missingAccount]) {
      expect(() => parseRingWebhook(body)).toThrow(RingWebhookValidationError);
    }
  });
});

describe("toRingAlert", () => {
  it("turns a doorbell press into a ding with Ring's snapshot of that moment", () => {
    const alert = toRingAlert(withAttributes({ sub_type: undefined, component_ids: undefined }, "button_press"));

    expect(alert?.kind).toBe("ding");
    expect(alert?.event).toMatchObject({
      id: MOTION.data.id,
      occurredAt: new Date(1786715596787).toISOString(),
      deviceId: "ava1.ring.device.a",
    });
    expect(parseRingSnapshotUrl(alert!.event.snapshotUrl)).toEqual({
      deviceId: "ava1.ring.device.a",
      timestamp: 1786715596787,
      accountId: "ava1.ring.account.XXXYYY",
    });
    expect(alert?.fallbackClassification).toMatchObject({ category: "person" });
  });

  it("maps Smart Alerts sub_types, with a stand-in classification where Ring's says enough", () => {
    expect(toRingAlert(withAttributes({ sub_type: "human" }))).toMatchObject({
      kind: "person-detected",
      fallbackClassification: { category: "person" },
    });
    expect(toRingAlert(withAttributes({ sub_type: "package_delivery" }))).toMatchObject({
      kind: "package-detected",
      fallbackClassification: { category: "package" },
    });
    expect(toRingAlert(withAttributes({ sub_type: "vehicle" }))).toMatchObject({
      kind: "motion",
      fallbackClassification: { category: "vehicle" },
    });
    for (const subType of ["motion", "other_motion", "something_new", undefined]) {
      const alert = toRingAlert(withAttributes({ sub_type: subType }));
      expect(alert?.kind).toBe("motion");
      expect(alert?.fallbackClassification).toBeUndefined();
    }
  });

  it("asks a multi-camera device for the camera module that saw the event", () => {
    const alert = toRingAlert(withAttributes({ component_ids: ["1", "0"] }));
    expect(parseRingSnapshotUrl(alert!.event.snapshotUrl)?.componentId).toBe("1");
  });

  it("uses the simulator's snapshot and label when present", () => {
    const alert = toRingAlert(
      withAttributes({ simulator: { snapshot_url: "file:///fixtures/cat.jpg", device_name: "Front Door (simulator)" } }),
    );
    expect(alert?.event.snapshotUrl).toBe("file:///fixtures/cat.jpg");
    expect(alert?.deviceName).toBe("Front Door (simulator)");
  });

  it("returns null for events Prism doesn't alert on", () => {
    for (const type of ["device_added", "device_removed", "device_online", "app_integration_removed", "subscription_activated"]) {
      expect(toRingAlert(withAttributes({}, type))).toBeNull();
    }
  });

  it("rejects an alert event without a device or a valid timestamp", () => {
    expect(() => toRingAlert(withAttributes({ source: undefined }))).toThrow(/source/);
    expect(() => toRingAlert(withAttributes({ timestamp: "2026-08-14" }))).toThrow(/timestamp/);
  });
});
