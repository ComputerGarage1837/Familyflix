import type { BaseItemDto, MediaStream } from '@jellyfin/sdk/lib/generated-client';
import { seriesTrackChoices, type SeriesValues } from './seriesPreferencePolicy';

type TrackOptions = {
    audioStreamIndex?: number | string | null;
    subtitleStreamIndex?: number | string | null;
    familyExplicitAudio?: boolean;
    familyExplicitSubtitle?: boolean;
};

/** The reporting DTO allows nullable IDs and extra item types; retain episode identity. */
export function seriesPlaybackIdentity(item: { Id?: string | null; Type?: string; SeriesId?: string | null; ServerId?: string | null }): BaseItemDto {
    return {
        Id: item.Id || undefined,
        Type: item.Type === 'Episode' ? 'Episode' : undefined,
        SeriesId: item.SeriesId,
        ServerId: item.ServerId
    };
}

/** Explicit choices for this play take precedence; only portable language intent is reused. */
export function sharedSeriesTrackOptions(values: SeriesValues, streams: MediaStream[], options: TrackOptions) {
    const choices = seriesTrackChoices(values, streams);
    const explicitAudio = options.familyExplicitAudio ?? options.audioStreamIndex != null;
    const explicitSubtitle = options.familyExplicitSubtitle ?? options.subtitleStreamIndex != null;
    return {
        audioStreamIndex: explicitAudio ? undefined : choices.audio,
        subtitleStreamIndex: explicitSubtitle ? undefined : choices.subtitle,
        clearSecondarySubtitle: !explicitSubtitle && ['OFF', 'FORCED_ONLY'].includes(values.subtitleMode)
    };
}

export function sharedIntroAction(values: SeriesValues, segmentType: string, appAction: string): string {
    if (segmentType !== 'Intro' || values.introSkipMode === 'APP_DEFAULT') return appAction;
    if (values.introSkipMode === 'ASK') return 'AskToSkip';
    if (values.introSkipMode === 'AUTO_SKIP') return 'Skip';
    if (values.introSkipMode === 'DO_NOT_SKIP') return 'None';
    return appAction;
}
