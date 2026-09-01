import { describe, expect, it, vi } from 'vitest';

vi.mock('components/dialogHelper/dialogHelper', () => ({ default: {} }));
vi.mock('elements/emby-select/emby-select', () => ({}));
vi.mock('./familySession', () => ({ onFamilySessionChange: () => () => undefined }));

import { familyButton, familySelect, familyTextarea, setFamilyButtonDisabled } from './familyDialogs';

describe('Family dialog controls', () => {
    it('uses Jellyfin raised-button theming instead of an obsolete class', () => {
        const click = vi.fn();
        const button = familyButton('Refresh inbox', click);

        expect(button.classList.contains('emby-button')).toBe(true);
        expect(button.classList.contains('raised')).toBe(true);
        expect(button.classList.contains('show-focus')).toBe(true);
        expect(button.classList.contains('button-raised')).toBe(false);
        button.click();
        expect(click).toHaveBeenCalledOnce();

        setFamilyButtonDisabled(button, true);
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        button.click();
        expect(click).toHaveBeenCalledOnce();
    });

    it('uses Jellyfin color-aware form controls', () => {
        const control = familySelect('Cases to show');
        const textarea = familyTextarea();

        expect(control.container.classList.contains('selectContainer')).toBe(true);
        expect(control.select.getAttribute('is')).toBe('emby-select');
        expect(control.select.getAttribute('label')).toBe('Cases to show');
        expect(textarea.classList.contains('emby-textarea')).toBe(true);
    });
});
