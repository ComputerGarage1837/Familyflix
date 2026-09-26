(function() {
const releasesUrl = 'https://api.github.com/repos/ComputerGarage1837/Familyflix/releases?per_page=30';
const windowsTag = /^windows-v(\d+)\.(\d+)\.(\d+)-family\.(\d+)$/i;

function parts(version) {
    const match = /^v?(\d+)\.(\d+)\.(\d+)-family\.(\d+)$/i.exec(version);
    return match && match.slice(1).map(Number);
}

function newer(candidate, current) {
    for (let index = 0; index < candidate.length; index++) {
        if (candidate[index] !== current[index]) return candidate[index] > current[index];
    }
    return false;
}

class updatePlugin {
    constructor({ confirm }) {
        this.name = 'Family Flix Updates';
        this.type = 'input';
        this.id = 'updatePlugin';

        (async () => {
            if (!/Windows/i.test(navigator.userAgent)) return;
            const current = parts(jmpInfo.version);
            if (!current) return;
            const api = await window.apiPromise;
            const check = async () => {
                try {
                    const response = await fetch(releasesUrl, {
                        headers: { Accept: 'application/vnd.github+json' },
                        cache: 'no-store'
                    });
                    if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`);
                    const releases = await response.json();
                    const latest = releases.filter(release => !release.draft && !release.prerelease &&
                        windowsTag.test(release.tag_name || ''))
                        .sort((left, right) => {
                            const l = windowsTag.exec(left.tag_name).slice(1).map(Number);
                            const r = windowsTag.exec(right.tag_name).slice(1).map(Number);
                            for (let index = 0; index < l.length; index++) {
                                if (l[index] !== r[index]) return r[index] - l[index];
                            }
                            return 0;
                        })[0];
                    if (!latest) return;
                    const available = windowsTag.exec(latest.tag_name).slice(1).map(Number);
                    if (!newer(available, current)) return;
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    await confirm({
                        title: 'Family Flix update available',
                        text: `${latest.tag_name.replace('windows-v', '')} is available for Windows. Your settings and signed-in profiles will remain in place.`,
                        cancelText: 'Later',
                        confirmText: 'Open download'
                    });
                    api.system.openExternalUrl(latest.html_url);
                } catch (error) {
                    if (error instanceof Error) window.dispatchEvent(new CustomEvent('familyflix-diagnostic', { detail: error.message }));
                    // Network failure or Later: do not interrupt playback or sign-in.
                }
            };
            api.system.updateInfoEmitted.connect(check);
            api.system.checkForUpdates();
        })();
    }
}

window._updatePlugin = updatePlugin;
})();
