export {}

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_ORIGIN?: string
  }

  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}
