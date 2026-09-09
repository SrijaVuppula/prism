// Replays a realistic sequence of Ring-shaped events at the local webhook
// receiver so downstream code can be iterated on without live device activity.
// TODO: fill in the real payload shape once confirmed against the Ring
// sandbox/simulator, and POST each to the local webhook endpoint.

const SAMPLE_EVENTS = [
  { kind: "ding", description: "doorbell pressed" },
  { kind: "motion", description: "motion detected" },
  { kind: "person-detected", description: "person detected at front door" },
  { kind: "package-detected", description: "package left at front door" },
];

async function main() {
  for (const event of SAMPLE_EVENTS) {
    console.log("TODO: POST event to local webhook receiver:", event);
    // await fetch("http://localhost:3000/webhooks/ring", { method: "POST", body: JSON.stringify(event) });
  }
}

main();
