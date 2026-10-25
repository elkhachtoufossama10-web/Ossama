/**
 * Where the two CORS-less sources come from:
 * - server mode (npm run dev / npm start): this app's relay at /api/*
 * - static mode (GitHub Pages build): a snapshot refreshed every ~20 min by a GitHub Actions workflow,
 *   published on the repository's `data` branch (see scripts/data_snapshot.py, .github/workflows/earth-data.yml)
 */
export const SNAPSHOT_URL = ((import.meta.env.VITE_DATA_SNAPSHOT_URL as string | undefined) || '').replace(/\/$/, '');
export const STATIC_MODE = SNAPSHOT_URL !== '';
