/* eslint-disable @stylistic/max-statements-per-line, array-callback-return -- Cache notification callbacks intentionally return no semantic value. */
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client';
import { canonicalGuid } from './seriesPreferencePolicy';
import { familyOperationId, familyRequest, FamilyRequestError, type FamilySession } from './familySession';
import {
    issueCategory, issueEnvelope, naturalNumber, objectValue, parseIssueCase, parseIssueSummary,
    type IssueCase, type IssueCategory, type IssueStatus, type IssueSummary
} from './issuePolicy';

const PREFIX = 'FamilyFlix/Issues/';
const FRESH_MS = 30_000;
type CachedSummary = { value: IssueSummary; revision: number; readAt: number };
type Capabilities = { isAdmin: boolean; version: string; revision: number };
export type SummaryResult = { available: boolean; items: Record<string, IssueSummary> };
export type AdminSummary = { revision: number; openCount: number; newCount: number; ackRevision: number };
const summaries = new Map<string, Map<string, CachedSummary>>();
const capabilities = new Map<string, { value?: Capabilities; readAt: number; session: FamilySession }>();
const capabilityFlights = new Map<string, { session: FamilySession; promise: Promise<Capabilities | undefined> }>();
const listeners = new Set<() => void>();
type SummaryWaiter = (available: boolean) => void;
type Batch = { session: FamilySession; items: Map<string, SummaryWaiter[]>; timer: ReturnType<typeof setTimeout> };
const batches = new Map<string, Batch>();

function scope(session: FamilySession) {
    let result = summaries.get(session.key);
    if (!result) {
        result = new Map();
        summaries.set(session.key, result);
    }
    return result;
}

function putSummary(session: FamilySession, summary: IssueSummary, revision: number) {
    if (!session.current()) return;
    const cache = scope(session);
    if ((cache.get(summary.itemId)?.revision ?? -1) <= revision) {
        cache.set(summary.itemId, { value: summary, revision, readAt: Date.now() });
    }
    // Public in-memory cache only. Bound long-running browser tabs.
    while (cache.size > 2000) cache.delete(cache.keys().next().value!);
}

export function cachedIssueSummary(itemId: string, session: FamilySession): IssueSummary | undefined {
    if (!session.current()) return undefined;
    return scope(session).get(canonicalGuid(itemId) || '')?.value;
}

export function onIssueSummariesChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function expireIssueSummaries(session: FamilySession) {
    scope(session).forEach(entry => { entry.readAt = 0; });
    listeners.forEach(listener => listener());
}

export async function issueCapabilities(session: FamilySession, force = false): Promise<Capabilities | undefined> {
    if (!session.current()) return undefined;
    const cached = capabilities.get(session.key);
    if (!force && cached?.session.current() && Date.now() - cached.readAt < (cached.value ? FRESH_MS : 2000)) return cached.value;
    const previous = capabilityFlights.get(session.key);
    if (previous?.session.current()) return previous.promise;
    const promise = (async () => {
        let value: Capabilities | undefined;
        try {
            const dto = issueEnvelope(await familyRequest(session, PREFIX + 'Capabilities'));
            if (typeof dto.isAdmin !== 'boolean' || typeof dto.version !== 'string') throw new Error('Invalid reporting capabilities');
            value = { isAdmin: dto.isAdmin, version: dto.version, revision: naturalNumber(dto.revision) };
        } catch { /* Missing/old plugin and failed authorization are unavailable, never admin. */ }
        if (!session.current()) return undefined;
        capabilities.set(session.key, { value, readAt: Date.now(), session });
        return value;
    })();
    const flight = { session, promise };
    capabilityFlights.set(session.key, flight);
    try { return await promise; } finally { if (capabilityFlights.get(session.key) === flight) capabilityFlights.delete(session.key); }
}

async function flushBatch(batch: Batch) {
    if (batches.get(batch.session.key) === batch) batches.delete(batch.session.key);
    const entries = Array.from(batch.items);
    for (let start = 0; start < entries.length; start += 200) {
        const group = entries.slice(start, start + 200);
        let available = false;
        try {
            if (!batch.session.current()) throw new Error('Profile changed');
            const ids = group.map(([id]) => id);
            const dto = issueEnvelope(await familyRequest(batch.session, PREFIX + 'Summaries', { query: { ids: ids.join(',') } }));
            if (!Array.isArray(dto.items)) throw new Error('Missing summaries');
            const received = dto.items.map(parseIssueSummary);
            const receivedIds = new Set(received.map(item => item.itemId));
            if (received.length !== ids.length || receivedIds.size !== ids.length || ids.some(id => !receivedIds.has(id))) {
                throw new Error('An unchecked item is not an issue-free item');
            }
            if (!batch.session.current()) throw new Error('Profile changed');
            received.forEach(item => putSummary(batch.session, item, naturalNumber(dto.revision)));
            available = true;
        } catch { /* Keep cached active warnings, but report that refresh was unavailable. */ }
        group.forEach(([, callbacks]) => callbacks.forEach(callback => callback(available)));
    }
}

function queueSummary(id: string, session: FamilySession): Promise<boolean> {
    let batch = batches.get(session.key);
    if (!batch?.session.current()) {
        if (batch) {
            clearTimeout(batch.timer);
            batch.items.forEach(callbacks => callbacks.forEach(callback => callback(false)));
        }
        batch = { session, items: new Map(), timer: undefined as unknown as ReturnType<typeof setTimeout> };
        const created = batch;
        batch.timer = setTimeout(() => { void flushBatch(created); }, 35);
        batches.set(session.key, batch);
    }
    return new Promise(resolve => {
        const callbacks = batch!.items.get(id) || [];
        callbacks.push(resolve);
        batch!.items.set(id, callbacks);
    });
}

/** Multiple visible cards/views coalesce into <=200-item requests, never one request per card. */
export async function loadIssueSummaries(itemIds: string[], session: FamilySession, force = false): Promise<SummaryResult> {
    const ids = Array.from(new Set(itemIds.map(canonicalGuid).filter((id): id is string => !!id))).slice(0, 1000);
    if (!session.current()) return { available: false, items: {} };
    const results = await Promise.all(ids.map(id => {
        const cached = scope(session).get(id);
        return !force && cached && Date.now() - cached.readAt >= 0 && Date.now() - cached.readAt < FRESH_MS ?
            Promise.resolve(true) : queueSummary(id, session);
    }));
    if (!session.current()) return { available: false, items: {} };
    const items: Record<string, IssueSummary> = {};
    ids.forEach(id => {
        const value = cachedIssueSummary(id, session);
        if (value) items[id] = value;
    });
    return { available: results.every(Boolean), items };
}

export type ReportDraft = {
    operationId: string; itemId: string; category: IssueCategory; note?: string; positionTicks?: number;
    mediaSourceId?: string; deviceName?: string; appVersion?: string;
};
export function createIssueReport(item: BaseItemDto, category: IssueCategory, note: string, context: Partial<ReportDraft> = {}): ReportDraft {
    const itemId = canonicalGuid(item.Id);
    if (!itemId || !['Movie', 'Episode'].includes(item.Type || '')) throw new Error('Choose an actual movie or episode');
    return {
        operationId: familyOperationId(), itemId, category: issueCategory(category), note: note.trim().slice(0, 1000),
        ...(Number.isSafeInteger(context.positionTicks) && Number(context.positionTicks) >= 0 ? { positionTicks: context.positionTicks } : {}),
        ...(context.mediaSourceId ? { mediaSourceId: context.mediaSourceId.slice(0, 128) } : {}),
        ...(context.deviceName ? { deviceName: context.deviceName.slice(0, 128) } : {}),
        ...(context.appVersion ? { appVersion: context.appVersion.slice(0, 128) } : {})
    };
}

export async function sendIssueReport(draft: ReportDraft, session: FamilySession): Promise<{
    status: 'sent'; caseId: string; summary: IssueSummary;
} | { status: 'unsent'; retryable: boolean }> {
    try {
        if (!session.current()) throw new FamilyRequestError('Profile changed', 401);
        const dto = issueEnvelope(await familyRequest(session, PREFIX + 'Reports', { method: 'POST', body: draft, timeout: 2500 }));
        const caseId = typeof dto.caseId === 'string' && canonicalGuid(dto.caseId);
        const summary = parseIssueSummary(dto.summary);
        if (!caseId || summary.itemId !== draft.itemId || !session.current()) throw new Error('Invalid report acknowledgement');
        putSummary(session, summary, naturalNumber(dto.revision));
        listeners.forEach(listener => listener());
        return { status: 'sent', caseId, summary };
    } catch (error) {
        const denied = error instanceof FamilyRequestError && [401, 403].includes(error.status);
        return { status: 'unsent', retryable: session.current() && !denied };
    }
}

async function requireAdmin(session: FamilySession) {
    if (!(await issueCapabilities(session))?.isAdmin || !session.current()) throw new FamilyRequestError('Administrator access is unavailable', 403);
}

function parseAdminSummary(value: unknown): AdminSummary {
    const dto = issueEnvelope(value);
    return { revision: naturalNumber(dto.revision), openCount: naturalNumber(dto.openCount),
        newCount: naturalNumber(dto.newCount), ackRevision: naturalNumber(dto.ackRevision) };
}

export async function loadAdminIssueSummary(session: FamilySession): Promise<AdminSummary> {
    await requireAdmin(session);
    return parseAdminSummary(await familyRequest(session, PREFIX + 'Admin/Summary'));
}

export async function loadAdminIssueCases(session: FamilySession, state: 'active' | 'all' = 'active', offset = 0) {
    await requireAdmin(session);
    const dto = issueEnvelope(await familyRequest(session, PREFIX + 'Admin/Cases', { query: { state, offset: String(offset), limit: '100' } }));
    if (!Array.isArray(dto.items)) throw new Error('Invalid problem inbox');
    return { revision: naturalNumber(dto.revision), total: naturalNumber(dto.total), items: dto.items.map(parseIssueCase) };
}

export async function acknowledgeIssueInbox(session: FamilySession, revision: number) {
    await requireAdmin(session);
    return parseAdminSummary(await familyRequest(session, PREFIX + 'Admin/Acknowledge', { method: 'POST', body: { revision: naturalNumber(revision) } }));
}

export type StatusOperation = { operationId: string; expectedRevision: number; status: IssueStatus };
export async function updateIssueStatus(session: FamilySession, caseId: string, operation: StatusOperation): Promise<{
    status: 'updated' | 'conflict'; item: IssueCase;
}> {
    await requireAdmin(session);
    const id = canonicalGuid(caseId);
    if (!id) throw new Error('Invalid case identity');
    try {
        const dto = issueEnvelope(await familyRequest(session, PREFIX + 'Admin/Cases/' + id + '/Status', { method: 'PUT', body: operation, timeout: 2500 }));
        const item = parseIssueCase(dto.case);
        if (item.caseId !== id) throw new Error('Unexpected case acknowledgement');
        expireIssueSummaries(session);
        return { status: 'updated', item };
    } catch (error) {
        if (error instanceof FamilyRequestError && error.status === 409) {
            const dto = objectValue(error.payload);
            const item = parseIssueCase(dto.current);
            if (dto.code === 'revisionConflict' && item.caseId === id) return { status: 'conflict', item };
        }
        throw error;
    }
}
/* eslint-enable @stylistic/max-statements-per-line, array-callback-return */
