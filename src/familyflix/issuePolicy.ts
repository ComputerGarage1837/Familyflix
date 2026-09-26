import { canonicalGuid } from './seriesPreferencePolicy';

export const ISSUE_LABELS = {
    noAudio: 'No audio', wrongEpisode: 'Wrong episode', brokenVideo: 'Broken video',
    subtitles: 'Subtitles', introTiming: 'Intro timing', other: 'Other problem'
} as const;
export type IssueCategory = keyof typeof ISSUE_LABELS;
export type IssueStatus = 'reported' | 'investigating' | 'resolved' | 'dismissed';
export type IssueSummary = {
    itemId: string; itemType: 'Movie' | 'Episode' | 'Series' | 'Season'; title: string;
    activeCount: number; affectedEpisodeCount: number; categories: IssueCategory[];
    status: 'clear' | 'reported' | 'investigating';
};
export type IssueReport = {
    reportId: string; userName: string; createdAtEpochMillis: number; note: string;
    positionTicks?: number; deviceName?: string; appVersion?: string;
};
export type IssueCase = {
    caseId: string; itemId: string; itemType: 'Movie' | 'Episode'; title: string; seriesName?: string;
    seasonNumber?: number; episodeNumber?: number; filePath?: string; mediaSourceId?: string;
    category: IssueCategory; status: IssueStatus; revision: number; createdAtEpochMillis: number;
    updatedAtEpochMillis: number; reportCount: number; reports: IssueReport[];
};

export function objectValue(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid server response');
    return value as Record<string, unknown>;
}

export function naturalNumber(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid server count');
    return Number(value);
}

function text(value: unknown, optional = false): string | undefined {
    if (optional && value == null) return undefined;
    if (typeof value !== 'string') throw new Error('Invalid server text');
    return value;
}

function guid(value: unknown): string {
    const result = typeof value === 'string' && canonicalGuid(value);
    if (!result) throw new Error('Invalid item identity');
    return result;
}

export function issueCategory(value: unknown): IssueCategory {
    if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(ISSUE_LABELS, value)) throw new Error('Unknown report category');
    return value as IssueCategory;
}

export function issueEnvelope(value: unknown) {
    const dto = objectValue(value);
    if (dto.schema !== 1) throw new Error('Unsupported reporting response');
    naturalNumber(dto.revision);
    return dto;
}

/** Explicit projection is the privacy boundary: no admin-only fields survive. */
export function parseIssueSummary(value: unknown): IssueSummary {
    const dto = objectValue(value);
    if (!['Movie', 'Episode', 'Series', 'Season'].includes(String(dto.itemType))
        || !['clear', 'reported', 'investigating'].includes(String(dto.status)) || !Array.isArray(dto.categories)) {
        throw new Error('Invalid public report summary');
    }
    const activeCount = naturalNumber(dto.activeCount);
    const categories = Array.from(new Set(dto.categories.map(issueCategory)));
    if ((activeCount === 0) !== (dto.status === 'clear') || (activeCount > 0 && categories.length === 0)) {
        throw new Error('Inconsistent public report summary');
    }
    return {
        itemId: guid(dto.itemId), itemType: dto.itemType as IssueSummary['itemType'], title: text(dto.title)!,
        activeCount, affectedEpisodeCount: naturalNumber(dto.affectedEpisodeCount), categories,
        status: dto.status as IssueSummary['status']
    };
}

export function publicIssueMessage(summary?: IssueSummary): string {
    if (!summary?.activeCount) return '';
    const categories = summary.categories.map(category => ISSUE_LABELS[category]).join(' · ');
    const aggregate = summary.itemType === 'Series' || summary.itemType === 'Season';
    const plural = summary.affectedEpisodeCount === 1 ? '' : 's';
    const label = aggregate ? `${summary.affectedEpisodeCount} episode${plural} reported` : 'Reported problem';
    return `${label}: ${categories}${summary.status === 'investigating' ? ' · Investigating' : ''}`;
}

export function parseIssueCase(value: unknown): IssueCase {
    const dto = objectValue(value);
    if (!['Movie', 'Episode'].includes(String(dto.itemType))
        || !['reported', 'investigating', 'resolved', 'dismissed'].includes(String(dto.status)) || !Array.isArray(dto.reports)) {
        throw new Error('Invalid admin report');
    }
    return {
        caseId: guid(dto.caseId), itemId: guid(dto.itemId), itemType: dto.itemType as IssueCase['itemType'], title: text(dto.title)!,
        seriesName: text(dto.seriesName, true), filePath: text(dto.filePath, true), mediaSourceId: text(dto.mediaSourceId, true),
        seasonNumber: dto.seasonNumber == null ? undefined : naturalNumber(dto.seasonNumber),
        episodeNumber: dto.episodeNumber == null ? undefined : naturalNumber(dto.episodeNumber),
        category: issueCategory(dto.category), status: dto.status as IssueStatus, revision: naturalNumber(dto.revision),
        createdAtEpochMillis: naturalNumber(dto.createdAtEpochMillis), updatedAtEpochMillis: naturalNumber(dto.updatedAtEpochMillis),
        reportCount: naturalNumber(dto.reportCount), reports: dto.reports.map(reportValue => {
            const report = objectValue(reportValue);
            return {
                reportId: guid(report.reportId), userName: text(report.userName)!, note: text(report.note)!,
                createdAtEpochMillis: naturalNumber(report.createdAtEpochMillis),
                positionTicks: report.positionTicks == null ? undefined : naturalNumber(report.positionTicks),
                deviceName: text(report.deviceName, true), appVersion: text(report.appVersion, true)
            };
        })
    };
}
