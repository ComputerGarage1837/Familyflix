/* eslint-disable compat/compat, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @stylistic/max-statements-per-line -- Isolated QA router intentionally keeps all synthetic routes together. */
const USERS = {
    normal: '11111111-2222-4333-8444-555555555551',
    admin: '11111111-2222-4333-8444-555555555552'
} as const;
export const FIXTURE_IDS = {
    series: '10000000-0000-4000-8000-000000000001',
    preferenceSeries: '10000000-0000-4000-8000-000000000099',
    season: '20000000-0000-4000-8000-000000000001',
    movie: '30000000-0000-4000-8000-000000000001',
    episodeOne: '30000000-0000-4000-8000-000000000101',
    episodeThree: '30000000-0000-4000-8000-000000000103',
    case: '40000000-0000-4000-8000-000000000001',
    report: '50000000-0000-4000-8000-000000000001'
} as const;

type Profile = keyof typeof USERS;
const requestedProfile = new URLSearchParams(window.location.search).get('profile');
const profile: Profile = requestedProfile === 'admin' ? 'admin' : 'normal';
let online = true;
let reads = 0;
let writes = 0;
let revision = 7;
let acknowledgedRevision = 0;
let caseStatus: 'reported' | 'investigating' | 'resolved' | 'dismissed' = 'reported';
const documents = new Map<string, unknown>();

export const client = {
    getCurrentUserId: () => USERS[profile],
    accessToken: () => `fixture-only-${profile}`,
    serverId: () => '55555555-aaaa-4bbb-8ccc-111111111111',
    serverAddress: () => window.location.origin,
    getUrl: (endpoint: string, params: Record<string, string> = {}) =>
        `${window.location.origin}/qa-api/${endpoint}?${new URLSearchParams(params)}`
};
export const ServerConnections = { currentApiClient: () => client };
export const isOnline = () => online;

function json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function describe() {
    document.querySelector('#profile')!.textContent = `Fixture profile: ${profile === 'admin' ? 'Administrator Blair' : 'Viewer Alex'}`;
    document.querySelector('#connection')!.textContent = `Connection: ${online ? 'Online' : 'Offline'}`;
    document.querySelector('#status')!.textContent =
        `Synthetic Family Flix requests: ${reads} reads, ${writes} in-memory writes. No live server requests.`;
}

function categoryFor(id: string) {
    if (id === FIXTURE_IDS.movie) return 'brokenVideo';
    if (id === FIXTURE_IDS.episodeThree) return 'wrongEpisode';
    return 'noAudio';
}

function summaryFor(id: string) {
    const active = caseStatus === 'reported' || caseStatus === 'investigating';
    const itemType = id === FIXTURE_IDS.movie ? 'Movie' : id === FIXTURE_IDS.series ? 'Series' :
        id === FIXTURE_IDS.season ? 'Season' : 'Episode';
    const warned = active && [FIXTURE_IDS.movie, FIXTURE_IDS.episodeThree, FIXTURE_IDS.series, FIXTURE_IDS.season]
        .some(candidate => candidate === id);
    return {
        itemId: id, itemType, title: itemType === 'Movie' ? 'Fixture Movie' : itemType === 'Episode' ? 'Fixture Episode 3' : 'Fixture Show',
        activeCount: warned ? 1 : 0, affectedEpisodeCount: warned && itemType !== 'Movie' ? 1 : 0,
        categories: warned ? [categoryFor(id)] : [], status: warned ? caseStatus : 'clear'
    };
}

function issueCase() {
    return {
        caseId: FIXTURE_IDS.case, itemId: FIXTURE_IDS.episodeThree, itemType: 'Episode', title: 'Episode 3 — The Return',
        seriesName: 'Fixture Show', seasonNumber: 1, episodeNumber: 3,
        filePath: 'D:\\Fixture Media\\Fixture Show\\S01E03.mkv', mediaSourceId: 'fixture-source-03',
        category: 'wrongEpisode', status: caseStatus, revision, createdAtEpochMillis: 1_788_100_000_000,
        updatedAtEpochMillis: 1_788_100_060_000, reportCount: 1,
        reports: [{
            reportId: FIXTURE_IDS.report, userName: 'Viewer Alex', createdAtEpochMillis: 1_788_100_000_000,
            note: 'The file starts with episode 4.', positionTicks: 180_000_000,
            deviceName: 'QA browser fixture', appVersion: 'Family Flix .25 fixture'
        }]
    };
}

function adminSummary() {
    const open = caseStatus === 'reported' || caseStatus === 'investigating';
    return { schema: 1, revision, openCount: open ? 1 : 0, newCount: open && acknowledgedRevision < revision ? 1 : 0,
        ackRevision: acknowledgedRevision };
}

function episodes() {
    return [
        { Id: FIXTURE_IDS.episodeOne, Type: 'Episode', SeriesId: FIXTURE_IDS.series, SeasonId: FIXTURE_IDS.season,
            ParentIndexNumber: 1, IndexNumber: 1, UserData: { Played: true } },
        { Id: FIXTURE_IDS.episodeThree, Type: 'Episode', SeriesId: FIXTURE_IDS.series, SeasonId: FIXTURE_IDS.season,
            ParentIndexNumber: 1, IndexNumber: 3, IndexNumberEnd: 4 },
        { Id: '30000000-0000-4000-8000-000000000105', Type: 'Episode', SeriesId: FIXTURE_IDS.series,
            SeasonId: FIXTURE_IDS.season, ParentIndexNumber: 1, IndexNumber: 5, PremiereDate: '2099-01-01T00:00:00Z' },
        { Id: '30000000-0000-4000-8000-000000000106', Type: 'Episode', SeriesId: FIXTURE_IDS.series,
            SeasonId: FIXTURE_IDS.season, ParentIndexNumber: 1, IndexNumber: 6, IsVirtualItem: true,
            PremiereDate: '2020-01-01T00:00:00Z' }
    ];
}

async function route(url: URL, init?: RequestInit): Promise<Response> {
    const routeName = url.pathname.slice('/qa-api/'.length);
    const method = init?.method || 'GET';
    if (routeName === 'FamilyFlix/Issues/Capabilities') {
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- Plugin version, not an IP address.
        return json({ schema: 1, version: '1.0.0.3', isAdmin: profile === 'admin', revision });
    }
    if (routeName === 'FamilyFlix/Issues/Summaries') {
        const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
        return json({ schema: 1, revision, items: ids.map(summaryFor) });
    }
    if (routeName === 'FamilyFlix/Issues/Reports' && method === 'POST') {
        const body = JSON.parse(String(init?.body));
        caseStatus = 'reported';
        revision++;
        return json({ schema: 1, revision, caseId: FIXTURE_IDS.case, summary: summaryFor(body.itemId) });
    }
    if (routeName === 'FamilyFlix/Issues/Admin/Summary') {
        return profile === 'admin' ? json(adminSummary()) : json({ code: 'forbidden', message: 'Administrator only' }, 403);
    }
    if (routeName === 'FamilyFlix/Issues/Admin/Cases') {
        if (profile !== 'admin') return json({ code: 'forbidden', message: 'Administrator only' }, 403);
        const active = caseStatus === 'reported' || caseStatus === 'investigating';
        const items = url.searchParams.get('state') === 'all' || active ? [issueCase()] : [];
        return json({ schema: 1, revision, total: items.length, items });
    }
    if (routeName === 'FamilyFlix/Issues/Admin/Acknowledge' && method === 'POST') {
        if (profile !== 'admin') return json({ code: 'forbidden', message: 'Administrator only' }, 403);
        acknowledgedRevision = Number(JSON.parse(String(init?.body)).revision);
        return json(adminSummary());
    }
    if (routeName === `FamilyFlix/Issues/Admin/Cases/${FIXTURE_IDS.case}/Status` && method === 'PUT') {
        if (profile !== 'admin') return json({ code: 'forbidden', message: 'Administrator only' }, 403);
        const body = JSON.parse(String(init?.body));
        if (body.expectedRevision !== revision) {
            return json({ code: 'revisionConflict', message: 'Fixture conflict', current: issueCase() }, 409);
        }
        caseStatus = body.status;
        revision++;
        return json({ schema: 1, revision, case: issueCase() });
    }
    if (routeName === `FamilyFlix/Playback/SeriesIdentity/${FIXTURE_IDS.series}`) {
        return json({ schema: 1, seriesId: FIXTURE_IDS.series, preferenceSeriesId: FIXTURE_IDS.preferenceSeries,
            matchedBy: 'providerIds', ready: true });
    }
    if (routeName === `Shows/${FIXTURE_IDS.series}/Episodes`) {
        const items = episodes();
        const start = Number(url.searchParams.get('StartIndex') || 0);
        return json({ Items: items.slice(start, start + 200), TotalRecordCount: items.length });
    }
    const key = url.pathname + ':' + url.searchParams.get('userId');
    if (routeName.startsWith('DisplayPreferences/')) {
        if (method === 'POST') {
            documents.set(key, JSON.parse(String(init?.body)));
            return new Response(null, { status: 204 });
        }
        return json(documents.get(key) || { Id: routeName.split('/').pop(), CustomPrefs: {} });
    }
    return json({ code: 'notFound', message: `Unknown fixture route: ${routeName}` }, 404);
}

export function setupFixture() {
    document.querySelector('#connection')!.addEventListener('click', () => { online = !online; describe(); });
    window.fetch = async (input, init) => {
        const url = new URL(String(input), window.location.origin);
        if (!url.pathname.startsWith('/qa-api/')) throw new Error('QA fixture blocked a non-fixture network request: ' + url.origin);
        if (!online) throw new TypeError('Synthetic offline connection');
        if ((init?.method || 'GET') === 'GET') reads++;
        else writes++;
        describe();
        return route(url, init);
    };
    describe();
}
/* eslint-enable compat/compat, sonarjs/cognitive-complexity, no-nested-ternary, sonarjs/no-nested-conditional, @stylistic/max-statements-per-line */
