import ArrowBack from '@mui/icons-material/ArrowBack';
import MenuIcon from '@mui/icons-material/Menu';
import SettingsIcon from '@mui/icons-material/Settings';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import React, { type FC, type PropsWithChildren, ReactNode, useEffect, useState } from 'react';

import { appRouter } from 'components/router/appRouter';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { readKidsSettings } from 'familyflix/kidsMode';

import UserMenuButton from './UserMenuButton';

interface AppToolbarProps {
    buttons?: ReactNode
    isDrawerAvailable: boolean
    isDrawerOpen: boolean
    onDrawerButtonClick?: (event: React.MouseEvent<HTMLElement>) => void
    isBackButtonAvailable?: boolean
    isUserMenuAvailable?: boolean
}

const onBackButtonClick = () => {
    appRouter.back()
        .catch(err => {
            console.error('[AppToolbar] error calling appRouter.back', err);
        });
};

const onSettingsButtonClick = () => {
    window.location.hash = '#/mypreferencesmenu';
};

const FamilyClock: FC = () => {
    const [ stamp, setStamp ] = useState(() => new Date());
    const [ location, setLocation ] = useState(() => window.location.hash);
    const [ behavior, setBehavior ] = useState(() => document.documentElement.dataset.familyClock || 'ALWAYS');
    useEffect(() => {
        const timer = window.setInterval(() => setStamp(new Date()), 30_000);
        const onLocation = () => setLocation(window.location.hash);
        const onSettings = () => setBehavior(document.documentElement.dataset.familyClock || 'ALWAYS');
        window.addEventListener('hashchange', onLocation);
        document.addEventListener('familyflix-settings-updated', onSettings);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('hashchange', onLocation);
            document.removeEventListener('familyflix-settings-updated', onSettings);
        };
    }, []);
    const playing = /#\/video(?:\?|$)/.test(location);
    if (behavior === 'NEVER' || (behavior === 'IN_VIDEO' && !playing)
        || (behavior === 'IN_MENUS' && playing)) return null;
    const inGuide = /#\/livetv(?:\?|$)/.test(location) && /[?&]tab=1(?:&|$)/.test(location);
    const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(stamp);
    const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(stamp);
    return <Box sx={{ position: 'absolute', left: inGuide ? 'auto' : '50%', right: inGuide ? 94 : 'auto',
        transform: inGuide ? 'none' : 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap',
        fontWeight: 600, fontSize: 14, opacity: 0.9 }} aria-label={`${date} ${time}`}>
        {date} · {time}
    </Box>;
};

const AppToolbar: FC<PropsWithChildren<AppToolbarProps>> = ({
    buttons,
    children,
    isDrawerAvailable,
    isDrawerOpen,
    onDrawerButtonClick = () => { /* no-op */ },
    isBackButtonAvailable = false,
    isUserMenuAvailable = true
}) => {
    const { user } = useApi();
    const isUserLoggedIn = Boolean(user);
    const apiClient = ServerConnections.currentApiClient();
    const [ kidsActive, setKidsActive ] = useState(() => readKidsSettings(apiClient).enabled);
    useEffect(() => {
        const refresh = () => setKidsActive(readKidsSettings(ServerConnections.currentApiClient()).enabled);
        document.addEventListener('familyflix-kids-updated', refresh);
        return () => document.removeEventListener('familyflix-kids-updated', refresh);
    }, []);
    const showSettings = isUserLoggedIn && !kidsActive;

    return (
        <Toolbar
            variant='dense'
            sx={{
                position: 'relative',
                flexWrap: {
                    xs: 'wrap',
                    lg: 'nowrap'
                },
                pl: {
                    xs: 'max(16px, env(safe-area-inset-left))',
                    sm: 'max(24px, env(safe-area-inset-left))'
                },
                pr: {
                    xs: 'max(16px, env(safe-area-inset-left))',
                    sm: 'max(24px, env(safe-area-inset-left))'
                }
            }}
        >
            {isUserLoggedIn && isDrawerAvailable && (
                <Tooltip title={globalize.translate(isDrawerOpen ? 'MenuClose' : 'MenuOpen')}>
                    <IconButton
                        size='large'
                        edge='start'
                        color='inherit'
                        aria-label={globalize.translate(isDrawerOpen ? 'MenuClose' : 'MenuOpen')}
                        onClick={onDrawerButtonClick}
                    >
                        <MenuIcon />
                    </IconButton>
                </Tooltip>
            )}

            {isBackButtonAvailable && (
                <Tooltip title={globalize.translate('ButtonBack')}>
                    <IconButton
                        size='large'
                        // Set the edge if the drawer button is not shown
                        edge={!(isUserLoggedIn && isDrawerAvailable) ? 'start' : undefined}
                        color='inherit'
                        aria-label={globalize.translate('ButtonBack')}
                        onClick={onBackButtonClick}
                    >
                        <ArrowBack />
                    </IconButton>
                </Tooltip>
            )}

            {children}

            {isUserLoggedIn && <FamilyClock />}

            <Box sx={{ display: 'flex', flexGrow: 1, justifyContent: 'flex-end' }}>
                {buttons}
            </Box>

            {showSettings && (
                <Tooltip title={globalize.translate('Settings')}>
                    <IconButton color='inherit' aria-label={globalize.translate('Settings')}
                        onClick={onSettingsButtonClick}>
                        <SettingsIcon />
                    </IconButton>
                </Tooltip>
            )}

            {isUserLoggedIn && isUserMenuAvailable && (
                <Box sx={{ flexGrow: 0 }}>
                    <UserMenuButton />
                </Box>
            )}
        </Toolbar>
    );
};

export default AppToolbar;
