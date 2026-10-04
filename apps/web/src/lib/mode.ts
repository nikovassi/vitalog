/**
 * LOCAL MODE (GitHub Pages build, VITE_LOCAL_MODE=true): no server. Uploads are processed in
 * the browser and all data is stored only on this device (IndexedDB).
 */
export const LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === 'true';
