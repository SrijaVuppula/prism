import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  maskPrivacyZones,
  parsePrivacyZones,
  PrivacyZoneError,
  zonesForComponent,
} from "../../src/ring/privacyZones";

// The shape of GET /v1/devices/{id}/configurations in Ring's Partner API docs.
function configurations(imageEnhancements: Record<string, unknown> | undefined, componentId: unknown = "0") {
  return {
    meta: { time: "2026-02-14T23:37:48Z" },
    data: {
      type: "device-configurations",
      id: "ava1.ring.device.configurations.XXXYYY",
      attributes: {
        motion_detection: { enabled: "on", motion_zones: [], component_id: componentId },
        ...(imageEnhancements ? { image_enhancements: imageEnhancements } : {}),
      },
    },
  };
}

const LEFT_HALF = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0 },
  { x: 0.5, y: 1 },
  { x: 0, y: 1 },
];

describe("parsePrivacyZones", () => {
  it("reads zones, including whole-number vertices, and the camera module they belong to", () => {
    const parsed = parsePrivacyZones(configurations({ hdr: "off", privacy_zones: [{ id: "z1", vertices: LEFT_HALF }] }));
    expect(parsed).toEqual({ zones: [{ id: "z1", vertices: LEFT_HALF }], componentId: "0" });
  });

  it("treats a device without the setting as having no zones", () => {
    expect(parsePrivacyZones(configurations({ privacy_zones: [] }))).toEqual({ zones: [], componentId: "0" });
    expect(parsePrivacyZones(configurations(undefined, null))).toEqual({ zones: [] });
    expect(parsePrivacyZones({})).toEqual({ zones: [] });
  });

  it("keeps vertices inside the frame and reads a numeric module id", () => {
    const parsed = parsePrivacyZones(
      configurations({ privacy_zones: [{ vertices: [{ x: -0.1, y: 0 }, { x: 1.2, y: 0.5 }, { x: 0.5, y: 1 }] }] }, 3),
    );
    expect(parsed.zones[0].vertices).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }]);
    expect(parsed.componentId).toBe("3");
  });

  it("refuses zones it can't read, rather than leaving a private area visible", () => {
    for (const zones of ["all", [{ id: "z1" }], [{ vertices: [{ x: "0", y: 0 }] }], [{ vertices: [null] }]]) {
      expect(() => parsePrivacyZones(configurations({ privacy_zones: zones }))).toThrow(PrivacyZoneError);
    }
  });
});

describe("zonesForComponent", () => {
  const device = { zones: [{ vertices: LEFT_HALF }], componentId: "0" };

  it("applies the zones to their own camera module, or when no module is named", () => {
    expect(zonesForComponent(device, "0")).toEqual(device.zones);
    expect(zonesForComponent(device, undefined)).toEqual(device.zones);
    expect(zonesForComponent({ zones: [] }, "2")).toEqual([]);
  });

  it("refuses a frame from another camera module, whose zones Ring doesn't report", () => {
    expect(() => zonesForComponent(device, "1")).toThrow(PrivacyZoneError);
  });
});

describe("maskPrivacyZones", () => {
  async function whiteImage() {
    const bytes = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .jpeg()
      .toBuffer();
    return { bytes, mediaType: "image/jpeg" };
  }

  async function brightnessAt(bytes: Buffer, x: number, y: number): Promise<number> {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const offset = (y * info.width + x) * info.channels;
    return (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
  }

  it("fills each zone in black and leaves the rest of the frame alone", async () => {
    const masked = await maskPrivacyZones(await whiteImage(), [{ vertices: LEFT_HALF }]);

    expect(masked.mediaType).toBe("image/jpeg");
    const { width, height } = await sharp(masked.bytes).metadata();
    expect([width, height]).toEqual([200, 100]);
    expect(await brightnessAt(masked.bytes, 20, 50)).toBeLessThan(10);
    expect(await brightnessAt(masked.bytes, 98, 50)).toBeLessThan(10);
    expect(await brightnessAt(masked.bytes, 180, 50)).toBeGreaterThan(245);
  });

  it("returns the frame untouched when there's nothing to cover", async () => {
    const image = await whiteImage();
    expect(await maskPrivacyZones(image, [])).toBe(image);
    expect(await maskPrivacyZones(image, [{ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }])).toBe(image);
  });
});
