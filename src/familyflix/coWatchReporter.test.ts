import { describe, expect, it, vi } from 'vitest';
import { CoWatchReporter, type CoWatchParticipant } from './coWatchReporter';

const amanda: CoWatchParticipant = { serverId: 'server', userId: 'amanda', token: 'token-a', name: 'Amanda' };
const kristine: CoWatchParticipant = { serverId: 'server', userId: 'kristine', token: 'token-k', name: 'Kristine' };
const report = { ItemId: 'episode', PlaySessionId: 'playback', PositionTicks: 10 };

describe('Watching Together report boundary', () => {
    it('sends start, progress and stop in order without losing the stop', async () => {
        let release!: () => void;
        const startPending = new Promise<void>(done => {
            release = done;
        });
        const sent: string[] = [];
        const sender = vi.fn(async (_profile, kind) => {
            sent.push(kind);
            if (kind === 'start') await startPending;
        });
        const reporter = new CoWatchReporter(() => [amanda], sender);
        const start = reporter.start(report);
        const progress = reporter.progress({ ...report, PositionTicks: 20 });
        const stop = reporter.stop({ ...report, PositionTicks: 30 });
        await Promise.resolve();
        expect(sent).toEqual(['start']);
        release();
        await Promise.all([start, progress, stop]);
        expect(sent).toEqual(['start', 'progress', 'stop']);
    });

    it('isolates a failed participant and never reports for another play session', async () => {
        const sent: string[] = [];
        const reporter = new CoWatchReporter(() => [amanda, kristine], async (profile, kind) => {
            if (profile.userId === 'amanda') throw new Error('device unavailable');
            sent.push(profile.userId + ':' + kind);
        });
        await reporter.start(report);
        await reporter.progress({ ItemId: 'different', PlaySessionId: 'playback' });
        await reporter.stop({ ...report, PlaySessionId: 'other' });
        await reporter.stop(report);
        expect(sent).toEqual(['kristine:start', 'kristine:stop']);
    });

    it('cancels queued secondary reports when Watching Together is turned off', async () => {
        let release!: () => void;
        const startPending = new Promise<void>(done => {
            release = done;
        });
        const sent: string[] = [];
        const reporter = new CoWatchReporter(() => [amanda], async (_profile, kind) => {
            sent.push(kind);
            if (kind === 'start') await startPending;
        });
        const start = reporter.start(report);
        const progress = reporter.progress(report);
        await Promise.resolve();
        reporter.deactivate();
        release();
        await Promise.all([start, progress]);
        expect(sent).toEqual(['start']);
    });
});
