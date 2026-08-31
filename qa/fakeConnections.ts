const users = ['11111111-2222-4333-8444-555555555551', '11111111-2222-4333-8444-555555555552'];
let selected = 0;
let online = true;
let reads = 0;
let writes = 0;
const documents = new Map<string, unknown>();
export const client = {
    getCurrentUserId: () => users[selected],
    accessToken: () => `fixture-only-${selected}`,
    serverId: () => '55555555-aaaa-4bbb-8ccc-111111111111',
    serverAddress: () => window.location.origin,
    getUrl: (route: string, params: Record<string, string>) => `${window.location.origin}/qa-api/${route}?${new URLSearchParams(params)}`
};
export const ServerConnections = { currentApiClient: () => client };
export const isOnline = () => online;
function describe() {
    document.querySelector('#profile')!.textContent = `Profile: Test ${selected ? 'Blair' : 'Alex'}`;
    document.querySelector('#connection')!.textContent = `Connection: ${online ? 'Online' : 'Offline'}`;
    document.querySelector('#status')!.textContent = `Synthetic settings requests: ${reads} reads, ${writes} writes. No live server requests.`;
}
export function setupFixture() {
    document.querySelector('#profile')!.addEventListener('click', () => { selected = 1 - selected; describe(); });
    document.querySelector('#connection')!.addEventListener('click', () => { online = !online; describe(); });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = String(input);
        if (!url.includes('/qa-api/')) return originalFetch(input, init);
        if (!online) throw new TypeError('Synthetic offline connection');
        const parsed = new URL(url);
        const key = parsed.pathname + ':' + parsed.searchParams.get('userId');
        if (init?.method === 'POST') {
            writes++;
            documents.set(key, JSON.parse(String(init.body)));
            describe();
            return new Response(null, { status: 204 });
        }
        reads++;
        describe();
        return new Response(JSON.stringify(documents.get(key) || { Id: parsed.pathname.split('/').pop(), CustomPrefs: {} }),
            { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    describe();
}
