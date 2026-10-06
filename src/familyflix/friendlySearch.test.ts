import { describe, expect, it } from 'vitest';
import { compactTitle, titleMatchScore } from './friendlySearch';
describe('friendly title matching', () => {
    it('ignores punctuation, spaces, case and accents', () => {
        for (const query of ['Spiderman', 'Spider-Man', 'Spider Man']) expect(titleMatchScore('Spider-Man', query)).toBeLessThan(2);
        expect(compactTitle('Amélie')).toBe('amelie');
    });
    it('matches subtitles and small misspellings including transpositions', () => {
        expect(titleMatchScore('Spider-Man: Homecoming', 'spidermna')).toBeLessThan(Infinity);
        expect(titleMatchScore('Spider-Man', 'spderman')).toBeLessThan(Infinity);
        expect(titleMatchScore('Spider-Man', 'batman')).toBe(Infinity);
        expect(titleMatchScore('Dune', 'x')).toBe(Infinity);
    });
    it('ranks exact titles ahead of equivalents and spelling suggestions', () => {
        expect(titleMatchScore('Spider Man', 'Spider Man')).toBeLessThan(titleMatchScore('Spider-Man', 'Spider Man'));
        expect(titleMatchScore('Spider-Man', 'Spiderman')).toBeLessThan(titleMatchScore('Spider-Man', 'Spidermna'));
    });
});
