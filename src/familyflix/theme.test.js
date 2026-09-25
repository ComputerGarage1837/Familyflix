/* eslint-disable @typescript-eslint/naming-convention -- Assert Android's shared wire-format keys. */
import { describe, expect, it } from 'vitest';

import { saveFamilyProfileValues } from './theme';

describe('shared Family Flix settings', () => {
    it('updates Windows choices without dropping unrelated Android settings', async () => {
        const original = {
            version: 1,
            revision: 4,
            values: {
                app_theme: 'DARK',
                pref_clock_behavior: 'ALWAYS',
                pref_show_backdrop: 'true',
                next_up_behavior: 'EXTENDED',
                media_segment_actions: '{"INTRO":"ASK_TO_SKIP"}'
            }
        };
        let saved;
        const apiClient = {
            getDisplayPreferences: async () => ({ CustomPrefs: {
                familyFlixProfileSettingsV1: JSON.stringify(original),
                unrelatedPluginKey: 'keep this too'
            } }),
            updateDisplayPreferences: async (_id, preferences) => { saved = preferences; },
            deviceId: () => 'windows-test'
        };
        const values = await saveFamilyProfileValues(apiClient, 'user', {
            pref_clock_behavior: 'IN_MENUS', pref_show_backdrop: 'false'
        }, { pref_clock_behavior: 'ALWAYS', pref_show_backdrop: 'true' });
        const document = JSON.parse(saved.CustomPrefs.familyFlixProfileSettingsV1);

        expect(values.pref_clock_behavior).toBe('IN_MENUS');
        expect(document.revision).toBe(5);
        expect(document.values.next_up_behavior).toBe('EXTENDED');
        expect(document.values.media_segment_actions).toBe(original.values.media_segment_actions);
        expect(saved.CustomPrefs.unrelatedPluginKey).toBe('keep this too');
    });

    it('refuses to overwrite a conflicting Android change', async () => {
        const apiClient = { getDisplayPreferences: async () => ({ CustomPrefs: {
            familyFlixProfileSettingsV1: JSON.stringify({
                version: 1, revision: 6, values: { pref_clock_behavior: 'NEVER' }
            })
        } }) };
        await expect(saveFamilyProfileValues(apiClient, 'user', {
            pref_clock_behavior: 'IN_MENUS'
        }, { pref_clock_behavior: 'ALWAYS' })).rejects.toThrow('changed on another device');
    });
});
/* eslint-enable @typescript-eslint/naming-convention */
