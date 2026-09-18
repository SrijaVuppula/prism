// Shared same-origin API base resolution, used by the personalization hooks
// (usePreferences, useAlertFeedback). Mirrors the inline resolveApiBase()
// already duplicated in hooks/usePushSubscription.ts -- pulled out here
// rather than refactored there, so that already-shipped hook stays exactly
// as it was.

export function resolveApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "";
}
