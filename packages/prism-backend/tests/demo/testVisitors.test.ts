import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { buildSimulatedWebhook, fixtureSnapshotUrl, lateNight, SAMPLE_EVENTS } from "../../src/demo/testVisitors";
import { parseRingWebhook, toRingAlert } from "../../src/ring/webhookHandler";

afterEach(() => {
  delete process.env.SIMULATOR_DEVICE_ID;
  delete process.env.SIMULATOR_SNAPSHOT_BASE_URL;
});

describe("simulated events", () => {
  it("are Ring v1.1 webhooks the receiver turns into the intended kind of alert, with an existing fixture photo", () => {
    for (const sample of SAMPLE_EVENTS) {
      const alert = toRingAlert(parseRingWebhook(buildSimulatedWebhook(sample, new Date("2026-10-14T12:00:00Z"))));
      expect(alert?.kind).toBe(sample.kind);
      expect(alert?.deviceName).toBe("Front Door (simulator)");
      expect(existsSync(fileURLToPath(alert!.event.snapshotUrl))).toBe(true);
    }
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
