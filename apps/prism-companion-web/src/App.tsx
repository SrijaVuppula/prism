// Companion app shell. Receives events in real time over WebSocket/SSE and
// renders the visual context card; triggers the Web Vibration API pattern
// from prism-alert-engine on arrival.
//
// TODO: wire up useRealtimeEvents + useVibration hooks, build
// ContextCard/SignalBadge components, screen-reader-first markup.

export default function App() {
  return (
    <main>
      <h1>Prism</h1>
      <p>Companion app — awaiting first event.</p>
    </main>
  );
}
