// Companion app's single view: connection status, push opt-in, the latest
// alert as a live-announced context card, a short history below it, and a
// Settings toggle for personalization preferences (quiet hours,
// known-visitor tagging, haptic overrides).

import { useState } from "react";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { ContextCard } from "../components/ContextCard";
import { EnablePushButton } from "../components/EnablePushButton";
import { SettingsPanel } from "../components/SettingsPanel";
import { useRealtimeEvents } from "../hooks/useRealtimeEvents";
import { useVibration } from "../hooks/useVibration";
import { usePreferences } from "../hooks/usePreferences";

export function HomePage() {
  const { status, events, latestEvent } = useRealtimeEvents();
  useVibration(latestEvent);
  const { preferences } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const history = events.slice(1).filter((message) => message.channels.visual);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Prism</h1>
        <div className="app__header-actions">
          <ConnectionStatus status={status} />
          <button type="button" onClick={() => setSettingsOpen((open) => !open)}>
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
        </div>
      </header>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

      <EnablePushButton />

      <section aria-label="Latest alert">
        {latestEvent?.channels.visual ? (
          <ContextCard
            card={latestEvent.channels.visual}
            event={latestEvent.event}
            live
            knownVisitorTaggingEnabled={preferences.knownVisitorTaggingEnabled}
          />
        ) : (
          <p className="app__empty" role="status">
            Waiting for the first alert…
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section aria-label="Earlier alerts">
          <h2>Earlier</h2>
          <ul className="history-list">
            {history.map((message) => (
              <li key={message.event.id}>
                <ContextCard
                  card={message.channels.visual!}
                  event={message.event}
                  knownVisitorTaggingEnabled={preferences.knownVisitorTaggingEnabled}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
