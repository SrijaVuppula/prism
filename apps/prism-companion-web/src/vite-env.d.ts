/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the companion event WebSocket URL; defaults to same-origin /ws. */
  readonly VITE_WS_URL?: string;
  /** Overrides the base URL for backend REST calls (push subscribe, etc.); defaults to same-origin. */
  readonly VITE_API_BASE_URL?: string;
  /** "1" shows the note for a public demo deployment (components/DemoNote.tsx). */
  readonly VITE_DEMO_NOTE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
