// Must be imported before 'cesium' so the library finds its workers and assets.
declare const CESIUM_BASE_URL: string;
(window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;
export {};
