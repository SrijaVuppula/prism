import type { ConnectionStatus as Status } from "../hooks/useRealtimeEvents";

const STATUS_META: Record<Status, { label: string; className: string }> = {
  connecting: { label: "Connecting…", className: "connection-status--connecting" },
  open: { label: "Live", className: "connection-status--open" },
  closed: { label: "Reconnecting…", className: "connection-status--closed" },
};

export function ConnectionStatus({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <p className={`connection-status ${meta.className}`} role="status">
      {meta.label}
    </p>
  );
}
