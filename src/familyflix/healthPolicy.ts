import { naturalNumber, objectValue } from './issuePolicy';

export type HealthOverallStatus = 'healthy' | 'attention' | 'unavailable';
export type HealthUpdateStatus = 'notReported' | 'notApplicable';

export type HealthSnapshot = {
    schema: 1;
    generatedAtUtc: string;
    overallStatus: HealthOverallStatus;
    server: {
        name: string; version: string; coreStartupComplete: boolean; pendingRestart: boolean;
        startedAtUtc: string; uptimeSeconds: number;
    };
    plugin: { name: string; version: string; enabled: boolean; startedAtUtc: string };
    issues: { available: boolean; revision: number; openCount: number; newCount: number };
    watchlists: {
        available: boolean; currentAdministratorPersonalRevision: number; currentAdministratorPersonalEntries: number;
        householdRevision: number; householdEntries: number;
    };
    devices: Array<{
        name: string; appName: string; appVersion: string; lastUserName?: string;
        lastSeenAtUtc?: string; isFamilyFlix: boolean; updateStatus: HealthUpdateStatus;
    }>;
    sessions: Array<{
        deviceName: string; userName: string; client: string; appVersion: string; lastActivityAtUtc: string;
        isActive: boolean; isPlaying: boolean; isPaused: boolean;
        playback?: {
            title: string; itemType: string; seriesName?: string; seasonNumber?: number; episodeNumber?: number;
            positionTicks?: number; runtimeTicks?: number; playMethod?: string;
        };
        transcode?: {
            container?: string; videoCodec?: string; audioCodec?: string; videoDirect: boolean; audioDirect: boolean;
            bitrate?: number; framerate?: number; width?: number; height?: number; audioChannels?: number;
            hardwareAcceleration?: string; reasons: string;
        };
    }>;
    tasks: Array<{
        name: string; key: string; state: string; progress?: number; lastStatus?: string; lastEndedAtUtc?: string;
    }>;
    crashes: {
        available: boolean; filesScanned: number; items: Array<{
            appName: string; appVersion: string; kind: 'temporaryOutage' | 'appCrash'; exceptionType: string;
            summary: string; fingerprint: string; occurrences: number; firstSeenAtUtc: string; lastSeenAtUtc: string;
        }>;
    };
};

function text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid health text');
    return value;
}

function optionalText(value: unknown): string | undefined {
    return value == null ? undefined : text(value);
}

function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new Error('Invalid health flag');
    return value;
}

function date(value: unknown): string {
    const raw = text(value);
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed)) throw new Error('Invalid health date');
    return new Date(parsed).toISOString();
}

function optionalDate(value: unknown): string | undefined {
    return value == null ? undefined : date(value);
}

function optionalNatural(value: unknown): number | undefined {
    return value == null ? undefined : naturalNumber(value);
}

function optionalFinite(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid health measurement');
    return value;
}

function values(value: unknown, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid health list');
    return value;
}

/** Explicitly projects the read-only contract so unknown or sensitive server fields are discarded. */
export function parseHealthSnapshot(value: unknown): HealthSnapshot {
    const dto = objectValue(value);
    if (dto.schema !== 1 || !['healthy', 'attention', 'unavailable'].includes(String(dto.overallStatus))) {
        throw new Error('Unsupported Health Centre response');
    }
    const server = objectValue(dto.server);
    const plugin = objectValue(dto.plugin);
    const issues = objectValue(dto.issues);
    const watchlists = objectValue(dto.watchlists);
    const crashes = objectValue(dto.crashes);

    return {
        schema: 1,
        generatedAtUtc: date(dto.generatedAtUtc),
        overallStatus: dto.overallStatus as HealthOverallStatus,
        server: {
            name: text(server.name), version: text(server.version),
            coreStartupComplete: boolean(server.coreStartupComplete), pendingRestart: boolean(server.pendingRestart),
            startedAtUtc: date(server.startedAtUtc), uptimeSeconds: naturalNumber(server.uptimeSeconds)
        },
        plugin: {
            name: text(plugin.name), version: text(plugin.version), enabled: boolean(plugin.enabled),
            startedAtUtc: date(plugin.startedAtUtc)
        },
        issues: {
            available: boolean(issues.available), revision: naturalNumber(issues.revision),
            openCount: naturalNumber(issues.openCount), newCount: naturalNumber(issues.newCount)
        },
        watchlists: {
            available: boolean(watchlists.available),
            currentAdministratorPersonalRevision: naturalNumber(watchlists.currentAdministratorPersonalRevision),
            currentAdministratorPersonalEntries: naturalNumber(watchlists.currentAdministratorPersonalEntries),
            householdRevision: naturalNumber(watchlists.householdRevision),
            householdEntries: naturalNumber(watchlists.householdEntries)
        },
        devices: values(dto.devices, 100).map(entry => {
            const device = objectValue(entry);
            if (!['notReported', 'notApplicable'].includes(String(device.updateStatus))) throw new Error('Invalid update status');
            return {
                name: text(device.name), appName: text(device.appName), appVersion: text(device.appVersion),
                lastUserName: optionalText(device.lastUserName), lastSeenAtUtc: optionalDate(device.lastSeenAtUtc),
                isFamilyFlix: boolean(device.isFamilyFlix), updateStatus: device.updateStatus as HealthUpdateStatus
            };
        }),
        sessions: values(dto.sessions, 50).map(entry => {
            const session = objectValue(entry);
            const playback = session.playback == null ? undefined : objectValue(session.playback);
            const transcode = session.transcode == null ? undefined : objectValue(session.transcode);
            return {
                deviceName: text(session.deviceName), userName: text(session.userName), client: text(session.client),
                appVersion: text(session.appVersion), lastActivityAtUtc: date(session.lastActivityAtUtc),
                isActive: boolean(session.isActive), isPlaying: boolean(session.isPlaying), isPaused: boolean(session.isPaused),
                playback: playback && {
                    title: text(playback.title), itemType: text(playback.itemType), seriesName: optionalText(playback.seriesName),
                    seasonNumber: optionalNatural(playback.seasonNumber), episodeNumber: optionalNatural(playback.episodeNumber),
                    positionTicks: optionalNatural(playback.positionTicks), runtimeTicks: optionalNatural(playback.runtimeTicks),
                    playMethod: optionalText(playback.playMethod)
                },
                transcode: transcode && {
                    container: optionalText(transcode.container), videoCodec: optionalText(transcode.videoCodec),
                    audioCodec: optionalText(transcode.audioCodec), videoDirect: boolean(transcode.videoDirect),
                    audioDirect: boolean(transcode.audioDirect), bitrate: optionalNatural(transcode.bitrate),
                    framerate: optionalFinite(transcode.framerate), width: optionalNatural(transcode.width),
                    height: optionalNatural(transcode.height), audioChannels: optionalNatural(transcode.audioChannels),
                    hardwareAcceleration: optionalText(transcode.hardwareAcceleration), reasons: text(transcode.reasons)
                }
            };
        }),
        tasks: values(dto.tasks, 100).map(entry => {
            const task = objectValue(entry);
            return {
                name: text(task.name), key: text(task.key), state: text(task.state),
                progress: optionalFinite(task.progress), lastStatus: optionalText(task.lastStatus),
                lastEndedAtUtc: optionalDate(task.lastEndedAtUtc)
            };
        }),
        crashes: {
            available: boolean(crashes.available), filesScanned: naturalNumber(crashes.filesScanned),
            items: values(crashes.items, 25).map(entry => {
                const crash = objectValue(entry);
                if (!['temporaryOutage', 'appCrash'].includes(String(crash.kind))
                    || typeof crash.fingerprint !== 'string' || !/^[a-f0-9]{12}$/.test(crash.fingerprint)) {
                    throw new Error('Invalid crash summary');
                }
                return {
                    appName: text(crash.appName), appVersion: text(crash.appVersion),
                    kind: crash.kind as 'temporaryOutage' | 'appCrash', exceptionType: text(crash.exceptionType),
                    summary: text(crash.summary), fingerprint: crash.fingerprint,
                    occurrences: naturalNumber(crash.occurrences), firstSeenAtUtc: date(crash.firstSeenAtUtc),
                    lastSeenAtUtc: date(crash.lastSeenAtUtc)
                };
            })
        }
    };
}
