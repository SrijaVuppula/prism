// Lists the Ring devices RING_ACCESS_TOKEN can see: a quick check that a
// token (for example one from the Ring Developer Playground) works, and a
// way to find a device id for SIMULATOR_DEVICE_ID.
//
// Usage: npm run ring:devices

import { loadEnv } from "../loadEnv";
import { getRingAccessToken } from "./config";
import { RingClient } from "./ringClient";

async function main(): Promise<void> {
  loadEnv();
  const token = getRingAccessToken();
  if (!token) {
    console.error(
      "Set RING_ACCESS_TOKEN in packages/prism-backend/.env first (generate one in the Ring Developer Playground).",
    );
    process.exitCode = 1;
    return;
  }

  const devices = await new RingClient(token).listDevices();
  console.log(`${devices.length} Ring device(s):`);
  for (const device of devices) {
    const status = device.online === undefined ? "" : device.online ? ", online" : ", offline";
    console.log(`  ${device.name}  (id ${device.id}${status})`);
  }
}

main().catch((err) => {
  console.error("Listing Ring devices failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
