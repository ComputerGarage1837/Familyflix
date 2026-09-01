/* eslint-disable @typescript-eslint/no-deprecated -- This dashboard follows Jellyfin's existing MUI Grid API. */
import BugReport from '@mui/icons-material/BugReport';
import CheckCircle from '@mui/icons-material/CheckCircle';
import Devices from '@mui/icons-material/Devices';
import PlayCircle from '@mui/icons-material/PlayCircle';
import Refresh from '@mui/icons-material/Refresh';
import Storage from '@mui/icons-material/Storage';
import WarningAmber from '@mui/icons-material/WarningAmber';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Page from 'components/Page';
import { captureFamilySession } from 'familyflix/familySession';
import { loadHealthSnapshot } from 'familyflix/health';
import type { HealthSnapshot } from 'familyflix/healthPolicy';
import { openProblemsInbox } from 'familyflix/issueDialogs';
import { useApi } from 'hooks/useApi';

const POLL_INTERVAL_MS = 30_000;
type HealthState = {
    snapshot?: HealthSnapshot;
    loading: boolean;
    stale: boolean;
    error?: string;
    receivedAt?: Date;
};

function dateTime(value?: string | Date) {
    if (!value) return 'Never';
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.valueOf()) ? 'Unknown' : date.toLocaleString();
}

function duration(seconds: number) {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

function playbackPosition(position?: number, runtime?: number) {
    if (position == null) return '';
    const minutes = Math.floor(position / 600_000_000);
    const runtimeMinutes = runtime == null ? undefined : Math.floor(runtime / 600_000_000);
    return runtimeMinutes == null ? `${minutes} min` : `${minutes} / ${runtimeMinutes} min`;
}

function overallChip(status: HealthSnapshot['overallStatus']) {
    if (status === 'healthy') return <Chip color='success' icon={<CheckCircle />} label='Healthy' />;
    if (status === 'attention') return <Chip color='warning' icon={<WarningAmber />} label='Needs attention' />;
    return <Chip color='error' icon={<WarningAmber />} label='Unavailable' />;
}

function taskDescription(task: HealthSnapshot['tasks'][number]) {
    return task.lastStatus ? `${task.state} · last: ${task.lastStatus}` : task.state;
}

function crashTitle(crash: HealthSnapshot['crashes']['items'][number]) {
    return crash.occurrences > 1 ? `${crash.summary} · ${crash.occurrences} times` : crash.summary;
}

function CrashSummaries({ crashes }: Readonly<{ crashes: HealthSnapshot['crashes'] }>) {
    if (!crashes.available) return <Alert severity='warning'>Crash summaries could not be read.</Alert>;
    if (crashes.items.length === 0) return <Typography color='text.secondary'>No recent Android TV crash uploads.</Typography>;
    return (
        <List disablePadding>
            {crashes.items.map(crash => (
                <ListItem key={`${crash.appVersion}:${crash.fingerprint}`} disableGutters>
                    <ListItemIcon sx={{ minWidth: 40 }}>
                        {crash.kind === 'temporaryOutage' ? <WarningAmber color='warning' /> : <BugReport color='error' />}
                    </ListItemIcon>
                    <ListItemText
                        primary={crashTitle(crash)}
                        secondary={`${crash.appName} ${crash.appVersion} · last seen ${dateTime(crash.lastSeenAtUtc)} · ${crash.fingerprint}`}
                    />
                </ListItem>
            ))}
        </List>
    );
}

export const Component = () => {
    const { __legacyApiClient__: legacyClient } = useApi();
    const [ state, setState ] = useState<HealthState>({ loading: true, stale: false });
    const generation = useRef(0);
    const closeProblems = useRef<(() => void) | undefined>();

    const refresh = useCallback(async (silent = false, forceCapabilities = false) => {
        const requestGeneration = ++generation.current;
        const session = legacyClient && captureFamilySession(legacyClient);
        if (!session) {
            setState(previous => ({ ...previous, loading: false, stale: Boolean(previous.snapshot), error: 'Sign in again to view Health Centre.' }));
            return;
        }
        if (!silent) setState(previous => ({ ...previous, loading: !previous.snapshot, error: undefined }));
        try {
            const snapshot = await loadHealthSnapshot(session, forceCapabilities);
            if (generation.current !== requestGeneration || !session.current()) return;
            setState({ snapshot, loading: false, stale: false, receivedAt: new Date() });
        } catch {
            if (generation.current !== requestGeneration || !session.current()) return;
            setState(previous => ({
                ...previous,
                loading: false,
                stale: Boolean(previous.snapshot),
                error: previous.snapshot ?
                    'The latest check failed. Showing the last successful snapshot.' :
                    'Health Centre is unavailable. Administrator access or the server connection could not be confirmed.'
            }));
        }
    }, [ legacyClient ]);

    useEffect(() => {
        void refresh(false);
        const interval = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh(true);
        }, POLL_INTERVAL_MS);
        const onVisibility = () => {
            if (document.visibilityState === 'visible') void refresh(true);
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => {
            // eslint-disable-next-line react-hooks/exhaustive-deps -- Request generation counter, not a rendered node ref.
            generation.current++;
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
            closeProblems.current?.();
        };
    }, [ refresh ]);

    const showProblems = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!legacyClient) return;
        closeProblems.current?.();
        closeProblems.current = openProblemsInbox(legacyClient, event.currentTarget);
    }, [ legacyClient ]);
    const manualRefresh = useCallback(() => refresh(false, true), [ refresh ]);

    const snapshot = state.snapshot;
    const playback = useMemo(() => snapshot?.sessions.filter(session => session.isPlaying) || [], [ snapshot ]);
    const noteworthyTasks = useMemo(() => snapshot?.tasks.filter(task => task.state !== 'Idle' || task.lastStatus === 'Failed').slice(0, 12) || [], [ snapshot ]);

    return (
        <Page id='familyHealthCentrePage' title='Health Centre' className='mainAnimatedPage type-interior'>
            <Box className='content-primary' sx={{ py: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' alignItems={{ xs: 'stretch', sm: 'center' }} spacing={2} mb={3}>
                    <Box>
                        <Typography variant='h4' component='h1'>Health Centre</Typography>
                        <Typography color='text.secondary'>Read-only Family Flix and Jellyfin status for administrators.</Typography>
                    </Box>
                    <Button
                        variant='contained'
                        startIcon={state.loading ? <CircularProgress color='inherit' size={18} /> : <Refresh />}
                        disabled={state.loading}
                        onClick={manualRefresh}
                    >Refresh</Button>
                </Stack>

                {state.error && <Alert severity={state.stale ? 'warning' : 'error'} sx={{ mb: 3 }}>{state.error}</Alert>}
                {!snapshot && state.loading && <LinearProgress aria-label='Loading Health Centre' />}

                {snapshot && (
                    <Grid container spacing={3}>
                        <Grid item xs={12} lg={7}>
                            <Card variant='outlined'>
                                <CardContent>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' spacing={2}>
                                        <Box>
                                            <Typography variant='h5'>{snapshot.server.name}</Typography>
                                            <Typography color='text.secondary'>Jellyfin {snapshot.server.version} · running {duration(snapshot.server.uptimeSeconds)}</Typography>
                                            <Typography color='text.secondary'>{snapshot.plugin.name} {snapshot.plugin.version}</Typography>
                                        </Box>
                                        <Box>{overallChip(snapshot.overallStatus)}</Box>
                                    </Stack>
                                    <Typography variant='body2' color='text.secondary' mt={2}>
                                        Snapshot {dateTime(snapshot.generatedAtUtc)} · received {dateTime(state.receivedAt)}
                                        {state.stale ? ' · stale' : ''}
                                    </Typography>
                                    {snapshot.server.pendingRestart && <Alert severity='warning' sx={{ mt: 2 }}>Jellyfin reports that a restart is pending.</Alert>}
                                    {!snapshot.server.coreStartupComplete && <Alert severity='error' sx={{ mt: 2 }}>Jellyfin startup has not completed.</Alert>}
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} lg={5}>
                            <Card variant='outlined'>
                                <CardContent>
                                    <Typography variant='h6' gutterBottom>Shared Family Flix data</Typography>
                                    <Stack spacing={1}>
                                        <Typography>Problems: {snapshot.issues.available ? `${snapshot.issues.openCount} open · ${snapshot.issues.newCount} new` : 'Unavailable'}</Typography>
                                        <Typography>
                                            Watchlists: {snapshot.watchlists.available ?
                                                `${snapshot.watchlists.currentAdministratorPersonalEntries} in your personal list · ${snapshot.watchlists.householdEntries} household` :
                                                'Unavailable'}
                                        </Typography>
                                    </Stack>
                                    {snapshot.issues.available && (
                                        <Button sx={{ mt: 2 }} variant='outlined' onClick={showProblems}>
                                            Open Problems inbox
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12}>
                            <Card variant='outlined'>
                                <CardContent>
                                    <Stack direction='row' spacing={1} alignItems='center' mb={1}>
                                        <PlayCircle color='primary' />
                                        <Typography variant='h6'>Active playback</Typography>
                                    </Stack>
                                    {playback.length === 0 ? <Typography color='text.secondary'>Nothing is playing right now.</Typography> : (
                                        <List disablePadding>
                                            {playback.map((session, index) => (
                                                <ListItem key={`${session.deviceName}:${session.userName}:${session.lastActivityAtUtc}`} divider={index < playback.length - 1} disableGutters>
                                                    <ListItemText
                                                        primary={`${session.playback?.title || 'Unknown title'} · ${session.userName}`}
                                                        secondary={[
                                                            session.deviceName,
                                                            session.isPaused ? 'Paused' : 'Playing',
                                                            session.playback?.playMethod,
                                                            playbackPosition(session.playback?.positionTicks, session.playback?.runtimeTicks),
                                                            session.transcode ? `Transcode: ${session.transcode.reasons}` : 'Direct play/stream'
                                                        ].filter(Boolean).join(' · ')}
                                                    />
                                                </ListItem>
                                            ))}
                                        </List>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12}>
                            <Card variant='outlined'>
                                <CardContent>
                                    <Stack direction='row' spacing={1} alignItems='center' mb={1}>
                                        <Devices color='primary' />
                                        <Typography variant='h6'>Devices and app versions</Typography>
                                    </Stack>
                                    <Typography variant='body2' color='text.secondary' mb={2}>
                                        Installed version is the last version each device reported to Jellyfin. Update-check and installation state are not reported by current clients.
                                    </Typography>
                                    <TableContainer>
                                        <Table size='small'>
                                            <TableHead><TableRow>
                                                <TableCell>Device</TableCell><TableCell>Client</TableCell><TableCell>Version</TableCell>
                                                <TableCell>Last user</TableCell><TableCell>Last seen</TableCell><TableCell>Update</TableCell>
                                            </TableRow></TableHead>
                                            <TableBody>
                                                {snapshot.devices.map(device => (
                                                    <TableRow key={`${device.name}:${device.appName}:${device.appVersion}:${device.lastSeenAtUtc || 'never'}`}>
                                                        <TableCell>{device.name}</TableCell><TableCell>{device.appName}</TableCell>
                                                        <TableCell>{device.appVersion}</TableCell><TableCell>{device.lastUserName || '—'}</TableCell>
                                                        <TableCell>{dateTime(device.lastSeenAtUtc)}</TableCell>
                                                        <TableCell>{device.updateStatus === 'notReported' ? 'Not reported' : 'Not applicable'}</TableCell>
                                                    </TableRow>
                                                ))}
                                                {snapshot.devices.length === 0 && <TableRow><TableCell colSpan={6}>No devices were returned.</TableCell></TableRow>}
                                            </TableBody>
                                        </Table>
                                    </TableContainer>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <Card variant='outlined' sx={{ height: '100%' }}>
                                <CardContent>
                                    <Stack direction='row' spacing={1} alignItems='center' mb={1}>
                                        <Storage color='primary' />
                                        <Typography variant='h6'>Scheduled tasks</Typography>
                                    </Stack>
                                    {noteworthyTasks.length === 0 ? <Typography color='text.secondary'>No tasks are running or currently marked failed.</Typography> : (
                                        <List disablePadding>
                                            {noteworthyTasks.map(task => (
                                                <ListItem key={task.key} disableGutters>
                                                    <ListItemText
                                                        primary={task.name}
                                                        secondary={taskDescription(task)}
                                                    />
                                                    {task.progress != null && <Chip size='small' label={`${Math.round(task.progress)}%`} />}
                                                </ListItem>
                                            ))}
                                        </List>
                                    )}
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <Card variant='outlined' sx={{ height: '100%' }}>
                                <CardContent>
                                    <Stack direction='row' spacing={1} alignItems='center' mb={1}>
                                        <BugReport color='primary' />
                                        <Typography variant='h6'>Android TV crash uploads</Typography>
                                    </Stack>
                                    <CrashSummaries crashes={snapshot.crashes} />
                                    <Typography variant='caption' color='text.secondary'>Summaries omit full stack traces, logcat, tokens, and media paths.</Typography>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                )}
            </Box>
        </Page>
    );
};

Component.displayName = 'FamilyHealthCentrePage';
/* eslint-enable @typescript-eslint/no-deprecated */
