import * as userSettings from 'scripts/settings/userSettings';

import { readFamilyProfileValues, saveFamilyProfileValues } from './theme';

const TYPES = ['Intro', 'Preview', 'Recap', 'Commercial', 'Outro'];
const TO_WEB = { ASK_TO_SKIP: 'AskToSkip', SKIP: 'Skip', NOTHING: 'None' };
const TO_ANDROID = { AskToSkip: 'ASK_TO_SKIP', Skip: 'SKIP', None: 'NOTHING' };

export function applyFamilySegmentActions(encoded) {
    if (!encoded) return;
    const actions = new Map(String(encoded).split(',').map(entry => entry.split('=')));
    for (const type of TYPES) {
        const action = TO_WEB[actions.get(type.toUpperCase())];
        if (action) userSettings.set(`segmentTypeAction__${type}`, action, false);
    }
}

export function familySegmentActionsFromForm(context) {
    return TYPES.map(type => {
        const value = context.querySelector(`#segmentTypeAction__${type}`)?.value || 'None';
        return `${type.toUpperCase()}=${TO_ANDROID[value] || 'NOTHING'}`;
    }).join(',');
}

export async function loadFamilySegmentActions(apiClient, userId) {
    const values = await readFamilyProfileValues(apiClient, userId);
    if (apiClient.getCurrentUserId() === userId) applyFamilySegmentActions(values.media_segment_actions);
    return values.media_segment_actions || '';
}

export async function saveFamilySegmentActions(apiClient, userId, encoded, expected) {
    await saveFamilyProfileValues(apiClient, userId,
        { media_segment_actions: encoded }, { media_segment_actions: expected });
    if (apiClient.getCurrentUserId() === userId) applyFamilySegmentActions(encoded);
    return encoded;
}
