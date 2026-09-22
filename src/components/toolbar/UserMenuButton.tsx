import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import React, { useCallback, useEffect, useState } from 'react';

import UserAvatar from 'components/UserAvatar';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { captureFamilySession } from 'familyflix/familySession';
import { readCoWatchState } from 'familyflix/coWatchProfiles';

import AppUserMenu, { ID } from './AppUserMenu';

const UserMenuButton = () => {
    const { user } = useApi();

    const [ userMenuAnchorEl, setUserMenuAnchorEl ] = useState<null | HTMLElement>(null);
    const [ togetherNames, setTogetherNames ] = useState<string[]>([]);
    useEffect(() => {
        const update = () => {
            const session = captureFamilySession();
            if (!session || session.userId !== user?.Id?.toLowerCase().replace(/-/g, '')) {
                setTogetherNames([]);
                return;
            }
            const state = readCoWatchState(session);
            setTogetherNames(state.profiles.filter(profile => state.activeIds.some(value =>
                value.toLowerCase().replace(/-/g, '') === profile.userId.toLowerCase().replace(/-/g, '')))
                .map(profile => profile.name));
        };
        update();
        window.addEventListener('familyflix-cowatch-changed', update);
        return () => window.removeEventListener('familyflix-cowatch-changed', update);
    }, [user?.Id]);
    const isUserMenuOpen = Boolean(userMenuAnchorEl);

    const onUserButtonClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        setUserMenuAnchorEl(event.currentTarget);
    }, [ setUserMenuAnchorEl ]);

    const onUserMenuClose = useCallback(() => {
        setUserMenuAnchorEl(null);
    }, [ setUserMenuAnchorEl ]);

    return (
        <>
            <Tooltip title={globalize.translate('UserMenu')}>
                <IconButton
                    size='large'
                    aria-label={globalize.translate('UserMenu')}
                    aria-controls={ID}
                    aria-haspopup='true'
                    onClick={onUserButtonClick}
                    color='inherit'
                    sx={{ padding: 0, gap: 1, borderRadius: 1 }}
                >
                    <UserAvatar user={user} />
                    {togetherNames.length > 0 && <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'start', fontSize: '0.8rem', lineHeight: 1.15 }}>
                        <span>{[user?.Name || 'You', ...togetherNames].join(' / ')}</span>
                        <span>Watching Together</span>
                    </span>}
                </IconButton>
            </Tooltip>

            <AppUserMenu
                open={isUserMenuOpen}
                anchorEl={userMenuAnchorEl}
                onMenuClose={onUserMenuClose}
            />
        </>
    );
};

export default UserMenuButton;
