// Client for the Ring Partner API, for calls beyond webhooks. Requests carry
// a Bearer access token and responses are JSON:API documents (`data` holding
// resources with `id` and `attributes`), except media downloads, which
// redirect to the binary file. See Ring's Partner API documentation
// (developer.amazon.com/docs/ring/api-documentation.html).

import { getRingApiBaseUrl } from "./config";

export interface RingDevice {
  id: string;
  /** The name the owner gave the device in the Ring app, e.g. "Front Door". */
  name: string;
  online?: boolean;
}

export interface RingImage {
  bytes: Buffer;
  mediaType: string;
}

export class RingApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    /** Ring's error code, e.g. RECORDING_NOT_READY, when the response carried one. */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "RingApiError";
  }
}

interface JsonApiResource {
  id?: unknown;
  attributes?: Record<string, unknown>;
}

function deviceName(attributes: Record<string, unknown> | undefined): string {
  for (const key of ["name", "description"]) {
    const value = attributes?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Ring device";
}

export class RingClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string = getRingApiBaseUrl(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Every device the access token can see: GET /v1/devices. */
  async listDevices(): Promise<RingDevice[]> {
    const body = (await this.requestJson("GET", "/v1/devices")) as { data?: unknown };
    const resources = Array.isArray(body?.data) ? (body.data as JsonApiResource[]) : [];
    return resources
      .filter((resource): resource is JsonApiResource & { id: string } => typeof resource?.id === "string")
      .map((resource) => {
        const online = resource.attributes?.online;
        return {
          id: resource.id,
          name: deviceName(resource.attributes),
          ...(typeof online === "boolean" ? { online } : {}),
        };
      });
  }

  /**
   * The frame a device captured at `timestampMs` (epoch milliseconds):
   * POST /v1/devices/{id}/media/image/download. Ring answers with a 303
   * redirect to a short-lived pre-signed URL, which fetch follows (without
   * the Authorization header, since it's another origin). No resolution is
   * requested, so the image comes at full size, where Ring's watermark is
   * smallest. `componentId` picks the camera module on a multi-camera device.
   */
  async downloadImage(deviceId: string, timestampMs: number, componentId?: string): Promise<RingImage> {
    const response = await this.request("POST", `/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`, {
      type: "at_timestamp",
      timestamp: timestampMs,
      image_options: { format: "jpeg" },
      ...(componentId !== undefined ? { components: [{ component_id: componentId }] } : {}),
    });
    const contentType = response.headers.get("content-type");
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      mediaType: contentType && contentType.startsWith("image/") ? contentType : "image/jpeg",
    };
  }

  private async requestJson(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.request(method, path, body);
    try {
      return await response.json();
    } catch {
      throw new RingApiError(`Ring API ${method} ${path} returned a body that isn't JSON`, response.status);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new RingApiError(`Ring API ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      const code = await ringErrorCode(response);
      const hint = response.status === 401 ? " (the access token is missing, expired or revoked)" : "";
      throw new RingApiError(
        `Ring API ${method} ${path} returned ${response.status}${code ? ` ${code}` : ""}${hint}`,
        response.status,
        code,
      );
    }
    return response;
  }
}

/** The `code` of the first entry in a Ring error response (`{ errors: [{ status, code, detail }] }`), if any. */
async function ringErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { errors?: Array<{ code?: unknown }> };
    const code = body?.errors?.[0]?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}
