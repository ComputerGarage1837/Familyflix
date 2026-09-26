import type { ApiClient } from 'jellyfin-apiclient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
const active = vi.hoisted(() => ({ value: true }));
vi.mock('./familySession', () => ({
    captureFamilySession: () => ({ key: 'server:user', current: () => active.value }),
    familyRequest: request
}));

import { cachedPreferenceSeriesId, resolvePreferenceSeriesId } from './seriesIdentity';

const client = {} as ApiClient;
const ids = {
    actual: '10000000-0000-4000-8000-000000000001', stable: '10000000-0000-4000-8000-000000000099',
    ambiguous: '10000000-0000-4000-8000-000000000002', wrong: '10000000-0000-4000-8000-000000000003'
};

describe('move-stable series preference identity', () => {
    beforeEach(() => {
        active.value = true;
        request.mockReset();
    });

    it('uses only a ready, verified provider match and caches it by actual series ID', async () => {
        request.mockResolvedValue({ schema: 1, seriesId: ids.actual, preferenceSeriesId: ids.stable,
            matchedBy: 'providerIds', ready: true });
        expect(await resolvePreferenceSeriesId(ids.actual, client, 350, true)).toBe(ids.stable);
        expect(cachedPreferenceSeriesId(ids.actual, client)).toBe(ids.stable);
        expect(request).toHaveBeenCalledOnce();
    });

    it.each([
        { matchedBy: 'ambiguous', ready: true },
        { matchedBy: 'providerIds', ready: false },
        { matchedBy: 'futureMode', ready: true },
        { matchedBy: 'providerIds', ready: true, schema: 2 }
    ])('keeps the current UUID for an unverified response %j', async patch => {
        request.mockResolvedValue({ schema: 1, seriesId: ids.ambiguous, preferenceSeriesId: ids.stable, ...patch });
        expect(await resolvePreferenceSeriesId(ids.ambiguous, client, 350, true)).toBe(ids.ambiguous);
    });

    it('keeps current UUID on timeout/failure, mismatched identity, or stale session', async () => {
        request.mockRejectedValueOnce(new TypeError('offline'));
        expect(await resolvePreferenceSeriesId(ids.wrong, client, 350, true)).toBe(ids.wrong);
        request.mockResolvedValueOnce({ schema: 1, seriesId: ids.actual, preferenceSeriesId: ids.stable,
            matchedBy: 'providerIds', ready: true });
        active.value = false;
        expect(await resolvePreferenceSeriesId(ids.wrong, client, 350, true)).toBe(ids.wrong);
    });
});
