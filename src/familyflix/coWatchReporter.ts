/** Per-playback reporting boundary for additional Watching Together profiles.
 * The primary user's normal Jellyfin report remains owned by playbackmanager.
 */
export type CoWatchParticipant = { serverId: string; userId: string; token: string; name: string };
export type CoWatchReport = { ItemId: string; PlaySessionId?: string; [key: string]: unknown };
export type CoWatchReportKind = 'start' | 'progress' | 'stop';

type Session = {
    itemId: string;
    playSessionId?: string;
    participants: CoWatchParticipant[];
    active: boolean;
    stopped: boolean;
    chain: Promise<void>;
};

export class CoWatchReporter {
    private current?: Session;

    constructor(
        private readonly party: () => CoWatchParticipant[],
        private readonly send: (profile: CoWatchParticipant, kind: CoWatchReportKind, report: CoWatchReport) => Promise<void>
    ) { }

    private enqueue(session: Session, kind: CoWatchReportKind, report: CoWatchReport) {
        const snapshot = { ...report };
        session.chain = session.chain.then(async () => {
            if (!session.active) return;
            await Promise.allSettled(session.participants.map(async profile => {
                // A failure on one user's device/token must not prevent other users' reports.
                await this.send(profile, kind, snapshot);
            }));
        }).catch(() => undefined);
        return session.chain;
    }

    start(report: CoWatchReport): Promise<void> {
        this.deactivate();
        if (!report.ItemId) return Promise.resolve();
        const participants = this.party().filter(profile => profile.serverId && profile.userId && profile.token);
        if (!participants.length) return Promise.resolve();
        const session: Session = {
            itemId: report.ItemId, playSessionId: report.PlaySessionId,
            participants: participants.map(profile => ({ ...profile })),
            active: true, stopped: false, chain: Promise.resolve()
        };
        this.current = session;
        return this.enqueue(session, 'start', report);
    }

    progress(report: CoWatchReport): Promise<void> {
        const session = this.current;
        if (!this.matches(session, report) || session.stopped) return Promise.resolve();
        return this.enqueue(session, 'progress', report);
    }

    stop(report: CoWatchReport): Promise<void> {
        const session = this.current;
        if (!this.matches(session, report) || session.stopped) return Promise.resolve();
        session.stopped = true;
        const completion = this.enqueue(session, 'stop', report);
        if (this.current === session) this.current = undefined;
        return completion;
    }

    /** Leaving Watching Together never changes the primary playback's reporting. */
    deactivate(): void {
        if (this.current) this.current.active = false;
        this.current = undefined;
    }

    private matches(session: Session | undefined, report: CoWatchReport): session is Session {
        return !!session && session.active && report.ItemId === session.itemId
            && (!session.playSessionId || !report.PlaySessionId || report.PlaySessionId === session.playSessionId);
    }
}
