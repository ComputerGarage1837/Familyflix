import { beforeEach, describe, expect, it, vi } from 'vitest';

let scopeKey = 'server:user:one';
let scopeCounter = 0;
const current = vi.fn(() => true);
vi.mock('./familySession', () => ({
    captureFamilySession: () => ({ key: scopeKey, current })
}));

import { appendSpeedSample, beginFamilySpeed, clearFamilySpeed, familySpeedSummary, summarizeSpeed } from './speedReport';

describe('local measured speed report', () => {
    beforeEach(() => {
        scopeKey = `server:user:${scopeCounter++}`;
        current.mockReturnValue(true);
        localStorage.clear();
    });

    it('uses a fake clock to record only the measured stage and rounds duration', () => {
        const readings = [100, 142.6];
        const finish = beginFamilySpeed('home-ready', undefined, () => readings.shift()!);
        finish();
        finish();
        expect(familySpeedSummary()[0]).toMatchObject({ stage: 'home-ready', count: 1, recentMs: 43, medianMs: 43 });
        const stored = localStorage.getItem('familyflix-speed-v1:' + scopeKey)!;
        expect(stored).not.toContain('title');
        expect(JSON.parse(stored)[0]).toMatchObject({ stage: 'home-ready', durationMs: 43 });
    });

    it('does not record stale-profile or hidden completions', () => {
        current.mockReturnValue(false);
        beginFamilySpeed('playback-start', undefined, () => 10)();
        expect(familySpeedSummary().find(row => row.stage === 'playback-start')?.count).toBe(0);
    });

    it('reports medians, rejects invented/invalid samples and bounds retention', () => {
        let samples = appendSpeedSample([], { stage: 'deck-ready', durationMs: 30, at: 1 });
        samples = appendSpeedSample(samples, { stage: 'deck-ready', durationMs: 10, at: 2 });
        samples = appendSpeedSample(samples, { stage: 'deck-ready', durationMs: 20, at: 3 });
        expect(summarizeSpeed(samples).find(row => row.stage === 'deck-ready')?.medianMs).toBe(20);
        expect(appendSpeedSample(samples, { stage: 'deck-ready', durationMs: -1, at: 4 })).toBe(samples);
        for (let index = 0; index < 130; index++) {
            samples = appendSpeedSample(samples, { stage: 'artwork-decode', durationMs: index, at: index });
        }
        expect(samples).toHaveLength(120);
    });

    it('clears only the current user/server diagnostics key', () => {
        localStorage.setItem('familyflix-speed-v1:other', '[1]');
        const finish = beginFamilySpeed('season-ready', undefined, () => 10);
        finish();
        expect(clearFamilySpeed()).toBe(true);
        expect(localStorage.getItem('familyflix-speed-v1:' + scopeKey)).toBeNull();
        expect(localStorage.getItem('familyflix-speed-v1:other')).toBe('[1]');
    });
});
