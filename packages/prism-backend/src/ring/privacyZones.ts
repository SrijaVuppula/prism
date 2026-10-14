// Ring privacy zones: areas of a camera's view that the owner marked private
// in the Ring app. Ring's guidance for partners is to always obscure them or
// avoid processing them, so Prism blacks them out of a Ring snapshot before
// the image is classified, embedded or shown in the companion app (see
// snapshots.ts).
//
// Zones come from GET /v1/devices/{id}/configurations, under
// image_enhancements.privacy_zones: polygons whose vertices are normalized
// to the frame, (0, 0) top-left to (1, 1) bottom-right.

import sharp from "sharp";
import type { RingImage } from "./ringClient";

export interface ZoneVertex {
  x: number;
  y: number;
}

export interface PrivacyZone {
  id?: string;
  vertices: ZoneVertex[];
}

export interface DevicePrivacyZones {
  zones: PrivacyZone[];
  /**
   * On a multi-camera device, the camera module the zones belong to. Ring
   * reports zones for one module only (motion_detection.component_id).
   */
  componentId?: string;
}

/** A privacy-zone setting Prism can't read or apply, so the image isn't used. */
export class PrivacyZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivacyZoneError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseZone(value: unknown): PrivacyZone {
  const zone = asRecord(value);
  const vertices = zone?.vertices;
  if (!Array.isArray(vertices)) {
    throw new PrivacyZoneError("Ring returned a privacy zone without vertices");
  }
  return {
    ...(typeof zone?.id === "string" ? { id: zone.id } : {}),
    vertices: vertices.map((vertex) => {
      const { x, y } = asRecord(vertex) ?? {};
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new PrivacyZoneError("Ring returned a privacy zone vertex that isn't a pair of numbers");
      }
      return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
    }),
  };
}

/**
 * The privacy zones in a device configurations response. A device without
 * the setting has none; a zone Prism can't read throws, so a private area is
 * never left visible because of a parsing gap.
 */
export function parsePrivacyZones(body: unknown): DevicePrivacyZones {
  const attributes = asRecord(asRecord(asRecord(body)?.data)?.attributes);
  const zones = asRecord(attributes?.image_enhancements)?.privacy_zones;
  if (zones !== undefined && !Array.isArray(zones)) {
    throw new PrivacyZoneError("Ring returned privacy_zones that isn't a list");
  }
  const componentId = asRecord(attributes?.motion_detection)?.component_id;
  return {
    zones: (zones ?? []).map(parseZone),
    ...(typeof componentId === "string" || typeof componentId === "number" ? { componentId: String(componentId) } : {}),
  };
}

/**
 * The zones that apply to a snapshot from `componentId`. Throws when the
 * snapshot is from a camera module Ring reports no zones for, since its
 * private areas are unknown.
 */
export function zonesForComponent(device: DevicePrivacyZones, componentId: string | undefined): PrivacyZone[] {
  if (componentId !== undefined && device.componentId !== undefined && componentId !== device.componentId) {
    throw new PrivacyZoneError(
      `Ring reports privacy zones for camera module ${device.componentId} only, so the image from module ${componentId} isn't used`,
    );
  }
  return device.zones;
}

/** The image with every zone filled in black. Returns it unchanged when there are none. */
export async function maskPrivacyZones(image: RingImage, zones: PrivacyZone[]): Promise<RingImage> {
  const polygons = zones.filter((zone) => zone.vertices.length >= 3);
  if (polygons.length === 0) return image;

  const { width, height } = await sharp(image.bytes).metadata();
  if (!width || !height) {
    throw new PrivacyZoneError("Couldn't read the snapshot's size to apply its privacy zones");
  }
  const points = (zone: PrivacyZone) =>
    zone.vertices.map((vertex) => `${(vertex.x * width).toFixed(1)},${(vertex.y * height).toFixed(1)}`).join(" ");
  // The stroke widens each zone by a pixel so anti-aliased edges don't let
  // a sliver of the private area through.
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<g fill="#000" stroke="#000" stroke-width="2">${polygons.map((zone) => `<polygon points="${points(zone)}"/>`).join("")}</g>` +
    `</svg>`;

  const bytes = await sharp(image.bytes)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
  return { bytes, mediaType: "image/jpeg" };
}
