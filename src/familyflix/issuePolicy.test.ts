import { describe, expect, it } from 'vitest';
import { parseIssueCase, parseIssueSummary, publicIssueMessage } from './issuePolicy';

const ITEM = '30000000-0000-4000-8000-000000000001';
const CASE = '40000000-0000-4000-8000-000000000001';
const REPORT = '50000000-0000-4000-8000-000000000001';

describe('problem reporting response policy', () => {
    it('projects public summaries without retaining private server fields', () => {
        const summary = parseIssueSummary({
            itemId: ITEM, itemType: 'Episode', title: 'Episode 3', activeCount: 2, affectedEpisodeCount: 1,
            categories: ['noAudio', 'subtitles', 'noAudio'], status: 'investigating',
            filePath: 'must-not-survive', userName: 'must-not-survive', deviceName: 'must-not-survive'
        });
        expect(summary.categories).toEqual(['noAudio', 'subtitles']);
        expect(summary).not.toHaveProperty('filePath');
        expect(summary).not.toHaveProperty('userName');
        expect(publicIssueMessage(summary)).toBe('Reported problem: No audio · Subtitles · Investigating');
    });

    it('labels aggregate series/season warnings as affected episodes', () => {
        const summary = parseIssueSummary({
            itemId: ITEM, itemType: 'Season', title: 'Season 1', activeCount: 3, affectedEpisodeCount: 2,
            categories: ['wrongEpisode'], status: 'reported'
        });
        expect(publicIssueMessage(summary)).toBe('2 episodes reported: Wrong episode');
    });

    it('fails closed on unknown schemas, enums, identities and inconsistent clear state', () => {
        const base = { itemId: ITEM, itemType: 'Movie', title: 'Movie', activeCount: 1, affectedEpisodeCount: 0,
            categories: ['other'], status: 'reported' };
        expect(() => parseIssueSummary({ ...base, categories: ['futureCategory'] })).toThrow();
        expect(() => parseIssueSummary({ ...base, status: 'clear' })).toThrow();
        expect(() => parseIssueSummary({ ...base, itemId: 'not-an-id' })).toThrow();
    });

    it('admits private context only through the explicit administrator parser', () => {
        const value = {
            caseId: CASE, itemId: ITEM, itemType: 'Episode', title: 'Episode 3', seriesName: 'Fixture Show',
            seasonNumber: 1, episodeNumber: 3, filePath: 'D:\\Media\\S01E03.mkv', mediaSourceId: 'source',
            category: 'wrongEpisode', status: 'reported', revision: 4,
            createdAtEpochMillis: 1000, updatedAtEpochMillis: 2000, reportCount: 1,
            reports: [{ reportId: REPORT, userName: 'Alex', createdAtEpochMillis: 1000, note: 'Wrong file',
                positionTicks: 10_000_000, deviceName: 'TV', appVersion: '.25' }]
        };
        const parsed = parseIssueCase(value);
        expect(parsed.filePath).toBe('D:\\Media\\S01E03.mkv');
        expect(parsed.reports[0]).toMatchObject({ userName: 'Alex', deviceName: 'TV', positionTicks: 10_000_000 });
        expect(() => parseIssueCase({ ...value, status: 'deleted' })).toThrow();
    });
});
