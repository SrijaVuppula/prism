import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildSimulatedWebhook, fixtureSnapshotUrl, lateNight, SAMPLE_EVENTS, TEST_VISITORS } from "../../src/demo/testVisitors";
import { parseRingWebhook, toRingAlert } from "../../src/ring/webhookHandler";

afterEach(() => {
  delete process.env.SIMULATOR_DEVICE_ID;
  delete process.env.SIMULATOR_SNAPSHOT_BASE_URL;
});

describe("simulated events", () => {
  it("are Ring v1.1 webhooks the receiver turns into the intended kind of alert, with an existing fixture photo", () => {
    for (const sample of TEST_VISITORS) {
      const alert = toRingAlert(parseRingWebhook(buildSimulatedWebhook(sample, new Date("2026-10-14T12:00:00Z"))));
      expect(alert?.kind).toBe(sample.kind);
      expect(alert?.deviceName).toBe("Front Door (simulator)");
      expect(existsSync(fileURLToPath(alert!.event.snapshotUrl))).toBe(true);
    }
  });

  it("cover people, packages, vehicles and animals, by day and at night, with no photo used twice after the samples", () => {
    const extra = TEST_VISITORS.slice(SAMPLE_EVENTS.length);
    const fixtures = extra.map((sample) => sample.fixture);
    expect(new Set(fixtures).size).toBe(fixtures.length);
    for (const category of ["person", "package", "vehicle", "animal"]) {
      expect(fixtures.some((fixture) => fixture.startsWith(`${category}-`))).toBe(true);
    }
    expect(extra.some((sample) => sample.atNight)).toBe(true);
  });

  it("send vehicles as motion with Ring's Smart Alerts vehicle sub_type", () => {
    const truck = TEST_VISITORS.find((sample) => sample.fixture === "vehicle-delivery-truck")!;
    const webhook = buildSimulatedWebhook(truck, new Date("2026-10-14T12:00:00Z"));
    expect(webhook.data).toMatchObject({ type: "motion_detected", attributes: { sub_type: "vehicle" } });
    expect(toRingAlert(parseRingWebhook(webhook))?.kind).toBe("motion");
  });

  it("come from SIMULATOR_DEVICE_ID when set, and read photos from SIMULATOR_SNAPSHOT_BASE_URL", () => {
    process.env.SIMULATOR_DEVICE_ID = "ava1.ring.device.playground";
    process.env.SIMULATOR_SNAPSHOT_BASE_URL = "https://fixtures.example.test/";
    const webhook = buildSimulatedWebhook(SAMPLE_EVENTS[0], new Date(5));
    expect(webhook.data.attributes.source).toBe("ava1.ring.device.playground");
    expect(fixtureSnapshotUrl("cat")).toBe("https://fixtures.example.test/cat.jpg");
  });

  it("put the night-time visit late at night in the household's time zone", () => {
    const afternoon = new Date("2026-10-14T21:30:00Z"); // 2:30 PM in Los Angeles
    expect(lateNight(afternoon, "America/Los_Angeles").toISOString()).toBe("2026-10-14T06:30:00.000Z");
    const night = new Date("2026-10-14T07:00:00Z"); // midnight in Los Angeles
    expect(lateNight(night, "America/Los_Angeles")).toBe(night);
  });
});
