// Thin client around the Ring Partner API for calls beyond webhooks
// (e.g. fetching device metadata). Populate as needs come up.

export class RingClient {
  constructor(private readonly accessToken: string) {}

  // TODO: implement calls as needed (device list, snapshot fetch, etc.)
}
