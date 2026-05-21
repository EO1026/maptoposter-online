/**
 * Browser Geolocation Service
 * Uses the W3C Geolocation API (navigator.geolocation.getCurrentPosition)
 */

export interface BrowserCoordinates {
  lat: number;
  lng: number;
}

export type GeolocationErrorCode = "denied" | "unavailable" | "timeout" | "unsupported";

export interface GeolocationResult {
  coordinates: BrowserCoordinates | null;
  error: GeolocationErrorCode | null;
}

/**
 * Get the user's current location using the browser's Geolocation API.
 * Returns coordinates on success, or a structured error on failure.
 */
export function getBrowserLocation(): Promise<GeolocationResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ coordinates: null, error: "unsupported" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          coordinates: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          error: null,
        });
      },
      (error) => {
        let code: GeolocationErrorCode;
        switch (error.code) {
          case error.PERMISSION_DENIED:
            code = "denied";
            break;
          case error.POSITION_UNAVAILABLE:
            code = "unavailable";
            break;
          case error.TIMEOUT:
            code = "timeout";
            break;
          default:
            code = "unavailable";
        }
        resolve({ coordinates: null, error: code });
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000, // 5 min cache
      }
    );
  });
}
