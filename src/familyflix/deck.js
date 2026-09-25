// Keep this selection in step with FamilyDeck.kt in the Android TV client.
const MAX_ACTIVE_SERIES = 12;

function identity(item) {
    if (item.SeriesId) return `series:${item.SeriesId}`;
    if (item.SeriesName) return `series-name:${item.SeriesName.trim().toLowerCase()}`;
    return `item:${item.Id}`;
}

const isEligible = item => !item.UserData?.Played && Number(item.UserData?.PlaybackPositionTicks || 0) <= 0;
const isResume = item => !item.UserData?.Played && item.UserData?.PlaybackPositionTicks > 0;
const episodeNumber = item => item.IndexNumberEnd || item.IndexNumber;

function latestActivity(items) {
    const latest = new Map();
    for (const item of items) {
        if (item.Type !== 'Episode' || Number(item.ParentIndexNumber || 0) <= 0
            || item.IndexNumber == null || !item.UserData?.LastPlayedDate) continue;
        const key = identity(item);
        const previous = latest.get(key);
        if (!previous || item.UserData.LastPlayedDate > previous.UserData.LastPlayedDate) latest.set(key, item);
    }
    return latest;
}

function isObviousSuccessor(candidate, anchor) {
    if (!isEligible(candidate) || isResume(anchor) || identity(candidate) !== identity(anchor)) return false;
    if (Number(candidate.ParentIndexNumber || 0) <= 0 || candidate.ParentIndexNumber !== anchor.ParentIndexNumber) return false;
    const anchorNumber = episodeNumber(anchor);
    return anchorNumber > 0 && candidate.IndexNumber === (anchor.UserData.Played ? anchorNumber + 1 : anchorNumber);
}

function nextInSeason(episodes, anchor) {
    const threshold = episodeNumber(anchor) + (anchor.UserData?.Played ? 1 : 0);
    if (threshold <= 0) return null;
    return episodes.filter(item => item.Type === 'Episode'
        && item.ParentIndexNumber === anchor.ParentIndexNumber
        && item.IndexNumber >= threshold && isEligible(item))
        .sort((left, right) => left.IndexNumber - right.IndexNumber || String(left.Id).localeCompare(String(right.Id)))[0] || null;
}

export async function getFamilyDeck(apiClient, options, displayLimit) {
    const userId = apiClient.getCurrentUserId();
    const [serverResult, activityResult] = await Promise.all([
        apiClient.getNextUpEpisodes({ ...options, Limit: displayLimit * 2, EnableRewatching: true,
            EnableResumable: false, EnableUserData: true, EnableTotalRecordCount: false }),
        apiClient.getItems(userId, { Recursive: true, IncludeItemTypes: 'Episode',
            SortBy: 'DatePlayed', SortOrder: 'Descending', Limit: 200,
            EnableUserData: true, EnableImages: false, EnableTotalRecordCount: false })
            .catch(() => ({ Items: [] }))
    ]);
    const candidates = serverResult.Items || [];
    const bySeries = new Map();
    for (const item of candidates) {
        const key = identity(item);
        if (!bySeries.has(key)) bySeries.set(key, []);
        bySeries.get(key).push(item);
    }
    const anchors = latestActivity(activityResult.Items || []);
    const activeSeries = new Set([...anchors].filter(([key]) => bySeries.has(key))
        .sort((left, right) => right[1].UserData.LastPlayedDate.localeCompare(left[1].UserData.LastPlayedDate))
        .slice(0, MAX_ACTIVE_SERIES).map(([key]) => key));
    const resolved = await Promise.all([...bySeries].map(async ([key, seriesCandidates]) => {
        const safeFallback = seriesCandidates.find(isEligible) || null;
        const anchor = activeSeries.has(key) ? anchors.get(key) : null;
        if (!anchor) return safeFallback;
        if (isResume(anchor)) return null;
        const obvious = seriesCandidates.find(item => isObviousSuccessor(item, anchor));
        if (obvious) return obvious;
        if (!anchor.SeasonId) return safeFallback;
        try {
            const season = await apiClient.getItems(userId, { ParentId: anchor.SeasonId,
                Recursive: true, IncludeItemTypes: 'Episode', IsMissing: false, IsPlayed: false,
                SortBy: 'IndexNumber', SortOrder: 'Ascending', EnableUserData: true,
                EnableTotalRecordCount: false,
                Fields: 'PrimaryImageAspectRatio,DateCreated,Path,MediaSourceCount',
                ImageTypeLimit: 1, EnableImageTypes: 'Primary,Backdrop,Banner,Thumb' });
            return nextInSeason(season.Items || [], anchor) || safeFallback;
        } catch {
            return safeFallback;
        }
    }));
    return { ...serverResult, Items: resolved.filter(Boolean).slice(0, displayLimit) };
}
