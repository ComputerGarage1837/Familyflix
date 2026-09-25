import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import React, { useCallback, useState } from 'react';

import UserAvatar from 'components/UserAvatar';
import { useApi } from 'hooks/useApi';
import globalize from 'lib/globalize';
import { openProfileChooser } from 'familyflix/profileChooser';
import { partyFor, savedProfile } from 'familyflix/profiles';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { readKidsSettings } from 'familyflix/kidsMode';

import AppUserMenu, { ID } from './AppUserMenu';

const UserMenuButton = () => {
    const { user } = useApi();
    const apiClient = ServerConnections.currentApiClient();
    const party = apiClient?.getCurrentUserId() && !readKidsSettings(apiClient).enabled ? partyFor(apiClient) : null;
    const partyNames = party?.participantUserIds?.map((id: string) => savedProfile(apiClient?.serverId(), id)?.name).filter(Boolean) || [];
    const label = partyNames.length ? `${user?.Name || 'Profile'} / ${partyNames.join(' / ')}` : null;

    const [ userMenuAnchorEl, setUserMenuAnchorEl ] = useState<null | HTMLElement>(null);
    const isUserMenuOpen = Boolean(userMenuAnchorEl);

    const onUserButtonClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
        event.preventDefault();
        void openProfileChooser();
    }, []);

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
                    sx={{ padding: 0 }}
                >
                    <UserAvatar user={user} />
                    {label && <span className='familyToolbarParty'><span>{label}</span><small>Watching Together</small></span>}
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
