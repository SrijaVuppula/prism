import { usePushSubscription } from "../hooks/usePushSubscription";

export function EnablePushButton() {
  const { status, error, subscribe } = usePushSubscription();

  if (status === "unsupported") {
    return (
      <p className="push-status" role="status">
        Push notifications aren't supported in this browser.
      </p>
    );
  }

  if (status === "subscribed") {
    return (
      <p className="push-status" role="status">
        Push notifications are on.
      </p>
    );
  }

  return (
    <div className="push-control">
      <button type="button" onClick={subscribe} disabled={status === "subscribing"}>
        {status === "subscribing" ? "Enabling…" : "Enable push notifications"}
      </button>
      {status === "denied" && (
        <p className="push-status push-status--error" role="alert">
          Notification permission was denied. Allow notifications for this site to enable push alerts.
        </p>
      )}
      {error && (
        <p className="push-status push-status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
