// Service worker for Prism's companion web app: handles Web Push events and
// notification clicks so alerts land even when the app isn't in focus.
// Registered from src/hooks/usePushSubscription.ts.
//
// Kept as a plain, unbundled script (not run through Vite) so it stays a
// predictable static file the browser fetches directly from /sw.js.

self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    payload = { title: "Prism", body: event.data.text() };
  }

  const title = payload.title || "Prism";
  const options = {
    body: payload.body,
    data: payload.data || {},
    tag: payload.data && payload.data.eventId,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("/");
      }
      return undefined;
    }),
  );
});
