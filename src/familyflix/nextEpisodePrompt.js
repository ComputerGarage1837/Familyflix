import './nextEpisodePrompt.scss';
import * as inputManager from '../scripts/inputManager';

/** Post-episode Android-style countdown. Zero means wait for an explicit choice. */
export function nextEpisodePrompt(api, item, preferences, stillWatching, isCurrent) {
    if (!stillWatching && preferences.nextUp === 'DISABLED') return Promise.resolve(true);
    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const root = document.createElement('div');
        root.className = 'familyNextOverlay';
        root.innerHTML = '<section class="familyNextPanel" role="dialog" aria-modal="true" aria-labelledby="familyNextTitle"><h2 id="familyNextTitle"></h2><img class="familyNextImage" alt=""><h3></h3><p aria-live="polite"></p><div><button type="button" class="familyNextPlay">Play next episode</button><button type="button" class="familyNextStop">Stop watching</button></div></section>';
        root.querySelector('h2').textContent = stillWatching ? 'Are you still watching?' : 'Up next';
        root.querySelector('h3').textContent = [item.SeriesName, item.ParentIndexNumber != null && item.IndexNumber != null ? `S${item.ParentIndexNumber} E${item.IndexNumber}` : '', item.Name].filter(Boolean).join(' · ');
        const image = root.querySelector('img');
        if (preferences.nextUp === 'EXTENDED' && item.ImageTags?.Primary) {
            image.src = api.getImageUrl(item.Id, { type: 'Primary', tag: item.ImageTags.Primary, maxWidth: 640 });
            image.onerror = () => {
                image.hidden = true;
            };
        } else {
            image.hidden = true;
        }
        document.body.appendChild(root);
        const play = root.querySelector('.familyNextPlay');
        const stop = root.querySelector('.familyNextStop');
        const deadline = !stillWatching && preferences.nextUpSeconds > 0 ? Date.now() + preferences.nextUpSeconds * 1000 : null;
        let settled = false;
        const finish = choice => {
            if (settled) return;
            settled = true;
            clearInterval(timer);
            inputManager.off(root, onCommand);
            root.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
            resolve(choice && isCurrent());
        };
        play.addEventListener('click', () => finish(true));
        stop.addEventListener('click', () => finish(false));
        const onCommand = event => {
            const command = event.detail?.command;
            if (['back', 'stop', 'home', 'settings', 'guide', 'livetv'].includes(command)) {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            } else if (['up', 'down', 'left', 'right'].includes(command)) {
                event.preventDefault();
                event.stopPropagation();
                (document.activeElement === play ? stop : play).focus();
            } else if (['select', 'play', 'playpause'].includes(command)) {
                event.preventDefault();
                event.stopPropagation();
                finish(document.activeElement !== stop);
            }
        };
        inputManager.on(root, onCommand);
        root.addEventListener('keydown', event => {
            if (['Escape', 'BrowserBack', 'Backspace'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            }
            if (['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                (document.activeElement === play ? stop : play).focus();
            }
        });
        const tick = () => {
            if (!isCurrent()) {
                finish(false);
                return;
            }
            const seconds = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
            root.querySelector('p').textContent = seconds === null ? 'Choose Play next episode to continue.' : `Playing in ${seconds} seconds`;
            if (seconds === 0) finish(true);
        };
        const timer = setInterval(tick, 250);
        tick();
        play.focus();
    });
}
