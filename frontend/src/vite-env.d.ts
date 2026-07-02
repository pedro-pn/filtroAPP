/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ASSETS_BASE_URL?: string;
  readonly VITE_MAINTENANCE_MODE?: string;
  readonly VITE_ERROR_TRACKING_ENABLED?: string;
  readonly VITE_ERROR_TRACKING_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
