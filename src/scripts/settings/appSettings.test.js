// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import appSettings from './appSettings';

describe('Family Flix Live TV buffer setting', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to one hour so the guide can initialize', () => {
        expect(appSettings.liveBufferMinutes()).toBe(60);
    });

    it('persists a valid choice and ignores corrupt saved values', () => {
        expect(appSettings.liveBufferMinutes(10)).toBe(10);
        expect(appSettings.liveBufferMinutes()).toBe(10);
        localStorage.setItem('familyflix-live-buffer-minutes', 'not-a-number');
        expect(appSettings.liveBufferMinutes()).toBe(60);
    });

    it('rejects values outside the supported range', () => {
        expect(() => appSettings.liveBufferMinutes(61)).toThrow(RangeError);
    });
});
