// Companion app's single view: connection status, push opt-in, the latest
// alert as a live-announced context card, and a short history below it.

import { ConnectionStatus } from "../components/ConnectionStatus";
import { ContextCard } from "../components/ContextCard";
import { EnablePushButton } from "../components/EnablePushButton";
import { useRealtimeEvents } from "../hooks/useRealtimeEvents";
import { useVibration } from "../hooks/useVibration";

export function HomePage() {
  const { status, events, latestEvent } = useRealtimeEvents();
  useVibration(latestEvent);

  const history = events.slice(1).filter((message) => message.channels.visual);

  return (
    <main className="app">
      <header className="app__header">
        <h1>Prism</h1>
        <ConnectionStatus status={status} />
      </header>

      <EnablePushButton />

      <section aria-label="Latest alert">
        {latestEvent?.channels.visual ? (
          <ContextCard card={latestEvent.channels.visual} live />
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
                <ContextCard card={message.channels.visual!} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
