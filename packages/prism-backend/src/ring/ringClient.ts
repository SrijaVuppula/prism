// Client for the Ring Partner API, for calls beyond webhooks. Requests carry
// a Bearer access token and responses are JSON:API documents (`data` holding
// resources with `id` and `attributes`), as in Ring's sample app
// (github.com/AmazonAppDev/ring-api-helloworld).

import { getRingApiBaseUrl } from "./config";

export interface RingDevice {
  id: string;
  /** The name the owner gave the device in the Ring app, e.g. "Front Door". */
  name: string;
  online?: boolean;
}

export class RingApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
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
    const body = (await this.get("/v1/devices")) as { data?: unknown };
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

  private async get(path: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
      });
    } catch (err) {
      throw new RingApiError(`Ring API GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
      const hint = response.status === 401 ? " (the access token is missing, expired or revoked)" : "";
      throw new RingApiError(`Ring API GET ${path} returned ${response.status}${hint}`, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new RingApiError(`Ring API GET ${path} returned a body that isn't JSON`, response.status);
    }
  }
}
