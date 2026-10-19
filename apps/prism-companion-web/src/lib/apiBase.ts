// Where the app sends its API calls: its own origin by default (the backend
// serves the app, and the dev server proxies to it), or VITE_API_BASE_URL
// when the app is hosted apart from the backend.

export function resolveApiBase(): string {
  return import.meta.env.VITE_API_BASE_URL ?? "";
}
