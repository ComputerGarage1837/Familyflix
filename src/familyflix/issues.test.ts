import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FamilySession } from './familySession';

const request = vi.hoisted(() => vi.fn());
const operationId = vi.hoisted(() => vi.fn(() => '60000000-0000-4000-8000-000000000001'));
vi.mock('./familySession', () => {
    class FamilyRequestError extends Error {
        constructor(message: string, readonly status = 0, readonly payload?: unknown) {
            super(message);
        }
    }
    return { FamilyRequestError, familyRequest: request, familyOperationId: operationId };
});

import {
    createIssueReport, issueCapabilities, loadAdminIssueCases, loadIssueSummaries, sendIssueReport
} from './issues';

const ONE = '30000000-0000-4000-8000-000000000001';
const TWO = '30000000-0000-4000-8000-000000000002';
const CASE = '40000000-0000-4000-8000-000000000001';
let current = true;
let key = '';
let keyCounter = 0;
let session: FamilySession;

function summary(itemId: string, active = itemId === ONE) {
    return {
        itemId, itemType: 'Movie', title: itemId === ONE ? 'One' : 'Two', activeCount: active ? 1 : 0,
        affectedEpisodeCount: 0, categories: active ? ['noAudio'] : [], status: active ? 'reported' : 'clear'
    };
}

describe('problem reporting runtime', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        current = true;
        key = `server:user:${keyCounter++}`;
        session = { key, current: () => current } as FamilySession;
        request.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('coalesces visible items into one bounded summary request and requires an exact response set', async () => {
        request.mockImplementation(async (_session, path, options) => {
            expect(path).toBe('FamilyFlix/Issues/Summaries');
            expect(options.query.ids.split(',')).toEqual([ONE, TWO]);
            return { schema: 1, revision: 3, items: [summary(ONE), summary(TWO)] };
        });
        const first = loadIssueSummaries([ONE], session, true);
        const second = loadIssueSummaries([TWO], session, true);
        await vi.advanceTimersByTimeAsync(40);
        expect(await first).toMatchObject({ available: true, items: { [ONE]: summary(ONE) } });
        expect(await second).toMatchObject({ available: true, items: { [TWO]: summary(TWO) } });
        expect(request).toHaveBeenCalledOnce();
    });

    it('keeps a cached active warning visible when a foreground refresh is unavailable', async () => {
        request.mockResolvedValueOnce({ schema: 1, revision: 3, items: [summary(ONE)] });
        const initial = loadIssueSummaries([ONE], session, true);
        await vi.advanceTimersByTimeAsync(40);
        expect((await initial).available).toBe(true);
        request.mockRejectedValueOnce(new TypeError('offline'));
        const refresh = loadIssueSummaries([ONE], session, true);
        await vi.advanceTimersByTimeAsync(40);
        expect(await refresh).toEqual({ available: false, items: { [ONE]: summary(ONE) } });
    });

    it('retains an immutable idempotency key for an uncertain report retry', async () => {
        const item = { Id: ONE, Type: 'Movie' } as BaseItemDto;
        const draft = createIssueReport(item, 'other', '  note  ', { deviceName: 'x'.repeat(200) });
        expect(draft).toMatchObject({ operationId: operationId(), itemId: ONE, note: 'note' });
        expect(draft.deviceName).toHaveLength(128);
        request.mockRejectedValue(new TypeError('offline'));
        expect(await sendIssueReport(draft, session)).toEqual({ status: 'unsent', retryable: true });
        expect(await sendIssueReport(draft, session)).toEqual({ status: 'unsent', retryable: true });
        expect(request.mock.calls.map(call => call[2].body.operationId)).toEqual([draft.operationId, draft.operationId]);
    });

    it('exposes administrator APIs only after the actual capability response', async () => {
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- Plugin version, not an IP address.
        request.mockResolvedValueOnce({ schema: 1, version: '1.0.0.3', isAdmin: false, revision: 1 });
        expect(await issueCapabilities(session, true)).toMatchObject({ isAdmin: false });
        await expect(loadAdminIssueCases(session)).rejects.toThrow('Administrator access is unavailable');
        expect(request).toHaveBeenCalledTimes(1);

        key += ':admin';
        session = { key, current: () => current } as FamilySession;
        request
            // eslint-disable-next-line sonarjs/no-hardcoded-ip -- Plugin version, not an IP address.
            .mockResolvedValueOnce({ schema: 1, version: '1.0.0.3', isAdmin: true, revision: 2 })
            .mockResolvedValueOnce({ schema: 1, revision: 2, total: 0, items: [] });
        expect(await issueCapabilities(session, true)).toMatchObject({ isAdmin: true });
        expect(await loadAdminIssueCases(session)).toEqual({ revision: 2, total: 0, items: [] });
    });

    it('rejects old-profile results before publishing them', async () => {
        request.mockImplementation(async () => {
            current = false;
            return { schema: 1, revision: 3, items: [summary(ONE)] };
        });
        const loading = loadIssueSummaries([ONE], session, true);
        await vi.advanceTimersByTimeAsync(40);
        expect(await loading).toEqual({ available: false, items: {} });
    });

    it('accepts a server acknowledgement only when case and item identities match', async () => {
        const draft = createIssueReport({ Id: ONE, Type: 'Movie' }, 'noAudio', '');
        request.mockResolvedValue({ schema: 1, revision: 4, caseId: CASE, summary: summary(ONE) });
        expect(await sendIssueReport(draft, session)).toMatchObject({ status: 'sent', caseId: CASE });
        request.mockResolvedValue({ schema: 1, revision: 5, caseId: CASE, summary: summary(TWO) });
        expect(await sendIssueReport(draft, session)).toEqual({ status: 'unsent', retryable: true });
    });
});
