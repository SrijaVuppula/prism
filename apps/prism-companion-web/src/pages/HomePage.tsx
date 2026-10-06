// Companion app's single view: connection status, push opt-in, the latest
// alert as a live-announced context card with its score and delivery
// details beside it, a summary and short history of earlier alerts, and a
// Settings toggle for personalization preferences (quiet hours,
// known-visitor tagging, haptic overrides).

import { useState } from "react";
import { AlertDetails } from "../components/AlertDetails";
import { AlertSummary } from "../components/AlertSummary";
import { ClassGuide } from "../components/ClassGuide";
import { ConnectionStatus } from "../components/ConnectionStatus";
import { ContextCard } from "../components/ContextCard";
import { EnablePushButton } from "../components/EnablePushButton";
import { PrismMark } from "../components/PrismMark";
import { SettingsPanel } from "../components/SettingsPanel";
import { useRealtimeEvents } from "../hooks/useRealtimeEvents";
import { useVibration } from "../hooks/useVibration";
import { usePreferences } from "../hooks/usePreferences";

export function HomePage() {
  const { status, events, latestEvent } = useRealtimeEvents();
  useVibration(latestEvent);
  const { preferences } = usePreferences();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const visualEvents = events.filter((message) => message.channels.visual);
  const history = events.slice(1).filter((message) => message.channels.visual);

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <PrismMark size={36} />
          <div>
            <h1 className="brand__name">Prism</h1>
            <p className="brand__tagline">Doorbell alerts you can see and feel</p>
          </div>
        </div>
        <div className="app__header-actions">
          <ConnectionStatus status={status} />
          <EnablePushButton />
          <button type="button" className="button button--ghost" onClick={() => setSettingsOpen((open) => !open)}>
            <span aria-hidden="true" className="button__icon">
              ⚙
            </span>
            {settingsOpen ? "Close settings" : "Settings"}
          </button>
        </div>
      </header>

      <main className="app__main">
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}

        <div className="layout">
          <section className="layout__primary" aria-label="Latest alert">
            <h2 className="section-title">Latest alert</h2>
            {latestEvent?.channels.visual ? (
              <div className={`hero hero--${latestEvent.channels.visual.signalClass.toLowerCase()}`}>
                {/* Re-keyed per alert so its arrival glow replays; the live card itself is
                    reused so screen readers announce each new alert. */}
                <span className="hero__glow" key={latestEvent.event.id} aria-hidden="true" />
                <ContextCard
                  card={latestEvent.channels.visual}
                  event={latestEvent.event}
                  live
                  knownVisitorTaggingEnabled={preferences.knownVisitorTaggingEnabled}
                />
                <AlertDetails event={latestEvent.event} channels={latestEvent.channels} />
              </div>
            ) : (
              <div className="empty-state">
                <PrismMark size={56} />
                <p className="empty-state__title" role="status">
                  Waiting for the first alert…
                </p>
                <p className="empty-state__text">
                  When your doorbell camera sees something, it appears here within seconds, scored and delivered
                  the way it matters:
                </p>
                <ClassGuide />
              </div>
            )}
          </section>

          <div className="layout__secondary">
            <AlertSummary events={visualEvents} />
            {latestEvent?.channels.visual && (
              <section aria-label="How alerts are delivered">
                <h2 className="section-title">How alerts are delivered</h2>
                <ClassGuide />
              </section>
            )}
          </div>
        </div>

        <section aria-label="Earlier alerts">
          <h2 className="section-title">Earlier</h2>
          {history.length > 0 ? (
            <ul className="history-list">
              {history.map((message) => (
                <li key={message.event.id}>
                  <ContextCard
                    card={message.channels.visual!}
                    event={message.event}
                    variant="compact"
                    knownVisitorTaggingEnabled={preferences.knownVisitorTaggingEnabled}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="history-empty">Earlier alerts will be listed here.</p>
          )}
        </section>
      </main>
    </div>
  );
}
