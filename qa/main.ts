import { openSeriesPreferences } from '../src/familyflix/seriesPreferencesDialog';
import { runFamilyBrowse } from '../src/familyflix/browseRecovery';
import { client, isOnline, setupFixture } from './fakeConnections';
setupFixture();
const show = { Id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', Type: 'Series', Name: 'Example Show One' } as const;
document.querySelector<HTMLButtonElement>('#settings')!.addEventListener('click', function () {
    openSeriesPreferences(show, client as never, this);
});
const cards = document.querySelector<HTMLElement>('#cards')!;
document.querySelector('#refresh')!.addEventListener('click', () => {
    void runFamilyBrowse(cards, async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!isOnline()) throw new TypeError('Synthetic offline connection');
        return ['Example Show One', 'Example Show Two', 'Example Show Three'];
    }, () => {
        // Unchanged real cards remain mounted, just like an unchanged browse response.
        document.querySelector('#status')!.textContent = 'Library refreshed; existing cards retained.';
    });
});
