// Companion app shell. Receives events in real time over WebSocket
// (useRealtimeEvents), triggers the Web Vibration API pattern from
// prism-alert-engine on arrival (useVibration), and renders the visual
// context card and push opt-in via HomePage.

import { HomePage } from "./pages/HomePage";

export default function App() {
  return <HomePage />;
}
