// "My position" (R6.5): browser geolocation after the user grants permission.

/** Failure with `key` = i18n key for the user-visible message. */
export class LocateError extends Error {
  constructor(key, message) {
    super(message ?? key);
    this.name = 'LocateError';
    this.key = key;
  }
}

// Without a timeout some embedded browsers never call back at all.
const OPTIONS = { timeout: 10_000, maximumAge: 60_000 };
const PERMISSION_DENIED = 1;

/** Resolves [lat, lon] when the position is inside the covered area (`isInside([lat, lon])`), else rejects with a LocateError. */
export function locate(geolocation, isInside) {
  return new Promise((resolve, reject) => {
    if (!geolocation) {
      reject(new LocateError('errors.geolocationUnavailable', 'geolocation: not supported'));
      return;
    }
    geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = [coords.latitude, coords.longitude];
        if (isInside(point)) resolve(point);
        else reject(new LocateError('errors.outsideCity', 'geolocation: outside the covered area'));
      },
      (error) =>
        reject(
          new LocateError(
            error?.code === PERMISSION_DENIED ? 'errors.geolocationDenied' : 'errors.geolocationUnavailable',
            `geolocation: code ${error?.code}`,
          ),
        ),
      OPTIONS,
    );
  });
}
