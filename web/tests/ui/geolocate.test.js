// R6.5: "my position" uses browser geolocation; denial, failure or an outside position leave the departure unchanged.
import { describe, expect, it, vi } from 'vitest';
import { LocateError, locate } from '../../src/ui/geolocate.js';

const inside = () => true;
const fake = (outcome) => ({
  getCurrentPosition: vi.fn((ok, fail) => (outcome.coords ? ok(outcome) : fail(outcome))),
});

describe('locate', () => {
  it('resolves [lat, lon] for a position inside the covered area', async () => {
    const geolocation = fake({ coords: { latitude: 41.65, longitude: -4.72 } });
    expect(await locate(geolocation, inside)).toEqual([41.65, -4.72]);
  });

  it('asks with a finite timeout so embedded browsers always call back', async () => {
    const geolocation = fake({ coords: { latitude: 1, longitude: 2 } });
    await locate(geolocation, inside);
    expect(geolocation.getCurrentPosition.mock.calls[0][2].timeout).toBeGreaterThan(0);
  });

  it('maps permission denied to its own message key', async () => {
    const error = await locate(fake({ code: 1 }), inside).catch((e) => e);
    expect(error).toBeInstanceOf(LocateError);
    expect(error.key).toBe('errors.geolocationDenied');
  });

  it('maps unavailable and timeout to the generic message key', async () => {
    for (const code of [2, 3]) {
      const error = await locate(fake({ code }), inside).catch((e) => e);
      expect(error.key).toBe('errors.geolocationUnavailable');
    }
  });

  it('is unavailable when the browser has no geolocation', async () => {
    const error = await locate(undefined, inside).catch((e) => e);
    expect(error.key).toBe('errors.geolocationUnavailable');
  });

  it('rejects positions outside the covered area', async () => {
    const geolocation = fake({ coords: { latitude: 10, longitude: 10 } });
    const error = await locate(geolocation, () => false).catch((e) => e);
    expect(error.key).toBe('errors.outsideCity');
  });

  it('rejects instead of hanging when the success callback itself fails', async () => {
    const geolocation = fake({ coords: { latitude: 41.65, longitude: -4.72 } });
    const error = await locate(geolocation, () => { throw new Error('boom'); }).catch((e) => e);
    expect(error).toBeInstanceOf(LocateError);
    expect(error.key).toBe('errors.geolocationUnavailable');
  });

  it('treats a position without coordinates as unavailable', async () => {
    const geolocation = { getCurrentPosition: vi.fn((ok) => ok({})) };
    const error = await locate(geolocation, inside).catch((e) => e);
    expect(error.key).toBe('errors.geolocationUnavailable');
  });
});
