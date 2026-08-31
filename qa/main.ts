/* eslint-disable compat/compat, @stylistic/max-statements-per-line, sonarjs/void-use -- QA runs only in the current local browser. */
import { bindFamilyItemTools } from '../src/familyflix/itemFamilyTools';
import { installFamilyIssueDecorations } from '../src/familyflix/issueDecorations';
import { openProblemsInbox } from '../src/familyflix/issueDialogs';
import { issueCapabilities } from '../src/familyflix/issues';
import { confirmFamilyPlayback } from '../src/familyflix/playbackWarnings';
import { openFamilySpeedReport } from '../src/familyflix/speedReportDialog';
import { beginFamilySpeed } from '../src/familyflix/speedReport';
import { captureFamilySession } from '../src/familyflix/familySession';
import { openSeriesPreferences } from '../src/familyflix/seriesPreferencesDialog';
import { runFamilyBrowse } from '../src/familyflix/browseRecovery';
import { client, FIXTURE_IDS, isOnline, setupFixture } from './fakeConnections';

setupFixture();
const show = { Id: FIXTURE_IDS.series, Type: 'Series', Name: 'Fixture Show' } as const;
const movie = { Id: FIXTURE_IDS.movie, Type: 'Movie', Name: 'Fixture Movie' } as const;
const season = { Id: FIXTURE_IDS.season, SeriesId: FIXTURE_IDS.series, Type: 'Season', Name: 'Season 1', IndexNumber: 1 } as const;
const episodeOne = { Id: FIXTURE_IDS.episodeOne, SeriesId: FIXTURE_IDS.series, SeasonId: FIXTURE_IDS.season,
    Type: 'Episode', Name: 'Episode 1', ParentIndexNumber: 1, IndexNumber: 1 } as const;
const episodeThree = { Id: FIXTURE_IDS.episodeThree, SeriesId: FIXTURE_IDS.series, SeasonId: FIXTURE_IDS.season,
    Type: 'Episode', Name: 'Episode 3', ParentIndexNumber: 1, IndexNumber: 3, IndexNumberEnd: 4 } as const;

document.querySelector<HTMLButtonElement>('#settings')!.addEventListener('click', function () {
    openSeriesPreferences(show, client as never, this);
});
document.querySelector<HTMLButtonElement>('#speed')!.addEventListener('click', function () {
    const finish = beginFamilySpeed('home-ready', client as never, () => performance.now());
    setTimeout(() => { finish(); openFamilySpeedReport(client as never, this); }, 40);
});
document.querySelector<HTMLButtonElement>('#preplay')!.addEventListener('click', () => {
    void confirmFamilyPlayback(episodeThree, client as never, episodeOne);
});
document.querySelector<HTMLButtonElement>('#offlinePreplay')!.addEventListener('click', async () => {
    if (!isOnline()) document.querySelector<HTMLButtonElement>('#connection')!.click();
    await confirmFamilyPlayback(episodeThree, client as never, episodeOne);
    document.querySelector<HTMLButtonElement>('#connection')!.click();
    await confirmFamilyPlayback(episodeThree, client as never, episodeOne);
});
const inbox = document.querySelector<HTMLButtonElement>('#inbox')!;
inbox.addEventListener('click', () => openProblemsInbox(client as never, inbox));
void issueCapabilities(captureFamilySession(client as never)!, true).then(capability => {
    inbox.hidden = !capability?.isAdmin;
    document.querySelector<HTMLElement>('#adminNote')!.hidden = !!capability?.isAdmin;
});

const cards = document.querySelector<HTMLElement>('#cards')!;
document.querySelector('#refresh')!.addEventListener('click', () => {
    void runFamilyBrowse(cards, async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (!isOnline()) throw new TypeError('Synthetic offline connection');
        return ['Fixture Movie', 'Fixture Show', 'Fixture Episode 3'];
    }, () => {
        document.querySelector('#status')!.textContent = 'Library refreshed; existing cards and warning badges retained.';
    });
});

bindFamilyItemTools(document.querySelector<HTMLElement>('#movieDetail')!, movie, client as never);
bindFamilyItemTools(document.querySelector<HTMLElement>('#seasonDetail')!, season, client as never);
installFamilyIssueDecorations();
/* eslint-enable compat/compat, @stylistic/max-statements-per-line, sonarjs/void-use */
