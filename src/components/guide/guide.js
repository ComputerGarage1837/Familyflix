import escapeHtml from 'escape-html';
import inputManager from '../../scripts/inputManager';
import browser from '../../scripts/browser';
import globalize from '../../lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events.ts';
import scrollHelper from '../../scripts/scrollHelper';
import serverNotifications from '../../scripts/serverNotifications';
import loading from '../loading/loading';
import datetime from '../../scripts/datetime';
import focusManager from '../focusManager';
import { playbackManager } from '../playback/playbackmanager';
import * as userSettings from '../../scripts/settings/userSettings';
import appSettings from '../../scripts/settings/appSettings';
import imageLoader from '../images/imageLoader';
import layoutManager from '../layoutManager';
import itemShortcuts from '../shortcuts';
import dom from '../../utils/dom';
import './guide.scss';
import './programs.scss';
import 'material-design-icons-iconfont';
import '../../styles/scrollstyles.scss';
import '../../elements/emby-programcell/emby-programcell';
import '../../elements/emby-button/emby-button';
import '../../elements/emby-button/paper-icon-button-light';
import '../../elements/emby-tabs/emby-tabs';
import '../../elements/emby-scroller/emby-scroller';
import '../../styles/flexstyles.scss';
import 'webcomponents.js/webcomponents-lite';
import template from './tvguide.template.html';

function updateProgramCellOnScroll(cell, scrollPct) {
    let left = cell.posLeft;
    if (!left) {
        left = parseFloat(cell.style.left.replace('%', ''));
        cell.posLeft = left;
    }
    let width = cell.posWidth;
    if (!width) {
        width = parseFloat(cell.style.width.replace('%', ''));
        cell.posWidth = width;
    }

    const right = left + width;
    const newPct = Math.max(Math.min(scrollPct, right), left);

    const offset = newPct - left;
    const pctOfWidth = (offset / width) * 100;

    let guideProgramName = cell.guideProgramName;
    if (!guideProgramName) {
        guideProgramName = cell.querySelector('.guideProgramName');
        cell.guideProgramName = guideProgramName;
    }

    let caret = cell.caret;
    if (!caret) {
        caret = cell.querySelector('.guide-programNameCaret');
        cell.caret = caret;
    }

    if (guideProgramName) {
        if (pctOfWidth > 0 && pctOfWidth <= 100) {
            guideProgramName.style.transform = 'translateX(' + pctOfWidth + '%)';
            caret.classList.remove('hide');
        } else {
            guideProgramName.style.transform = 'none';
            caret.classList.add('hide');
        }
    }
}

let isUpdatingProgramCellScroll = false;
function updateProgramCellsOnScroll(programGrid, programCells) {
    if (isUpdatingProgramCellScroll) {
        return;
    }

    isUpdatingProgramCellScroll = true;

    requestAnimationFrame(function () {
        const scrollLeft = programGrid.scrollLeft;

        const scrollPct = scrollLeft ? (scrollLeft / programGrid.scrollWidth) * 100 : 0;

        for (const programCell of programCells) {
            updateProgramCellOnScroll(programCell, scrollPct);
        }

        isUpdatingProgramCellScroll = false;
    });
}

function Guide(options) {
    const self = this;
    let items = {};

    self.options = options;
    self.categoryOptions = { categories: [] };

    // 30 mins
    const cellCurationMinutes = 30;
    const cellDurationMs = cellCurationMinutes * 60 * 1000;
    const guideDurationMs = 6 * 60 * 60 * 1000;

    let currentDate;
    let currentStartIndex = 0;
    let currentBand = 1;
    let destroyed = false;
    let autoRefreshInterval;
    let programCells;
    let lastFocusDirection;
    let channelCache;
    let channelCacheTime = 0;
    let loadRequestId = 0;
    let previewChannelId;
    let previewRequestId = 0;
    let previewHls;
    let previewSessionId;
    let previewLiveStreamId;
    let previewStarted = false;
    let previewBufferRegistered = false;
    let previewVideo = null;
    let previewContainer = null;
    let previewEmpty = null;
    let previewLabel = null;
    let previewBehindLive = null;
    let previewControls = null;
    let previewTimeline = null;
    const previewClock = setInterval(updatePreviewControls, 1000);
    let visibleChannelsById = new Map();

    const maxTimeshiftSeconds = appSettings.liveBufferMinutes() * 60;
    const liveThresholdSeconds = 15;

    function getPreviewWindow() {
        if (!previewVideo || !previewVideo.seekable.length) return null;
        const last = previewVideo.seekable.length - 1;
        const end = previewVideo.seekable.end(last);
        const start = Math.max(previewVideo.seekable.start(last), end - maxTimeshiftSeconds);
        return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
    }

    function updatePreviewControls() {
        if (!previewVideo || !previewControls) return;
        // A seek can temporarily drop readyState to HAVE_NOTHING. Keep recovery
        // controls enabled for a stream that has already started.
        const ready = Boolean(previewChannelId) && previewStarted;
        const window = getPreviewWindow();
        const behind = window ? Math.max(0, window.end - previewVideo.currentTime) : 0;
        const canSeek = ready && Boolean(window);
        const paused = ready && previewVideo.paused;
        const playing = ready && !paused;
        const playButton = previewControls.querySelector('.familyGuidePlayPause');
        const audioButton = previewControls.querySelector('.familyGuideAudio');
        playButton.disabled = !ready;
        playButton.textContent = playing ? 'Pause' : 'Play';
        playButton.setAttribute('aria-label', playing ? 'Pause live TV' : 'Resume live TV');
        previewControls.querySelector('.familyGuideRewind').disabled = !canSeek || previewVideo.currentTime <= window.start + 1;
        previewControls.querySelector('.familyGuideForward').disabled = !canSeek || behind <= liveThresholdSeconds;
        previewControls.querySelector('.familyGuideGoLive').disabled = !canSeek || behind <= liveThresholdSeconds;
        audioButton.disabled = !ready;
        audioButton.textContent = previewVideo.muted ? 'Sound on' : 'Mute';
        audioButton.setAttribute('aria-label', previewVideo.muted ? 'Turn preview sound on' : 'Mute preview sound');
        previewTimeline.disabled = !canSeek;
        previewTimeline.max = window ? String(Math.floor(window.end - window.start)) : '0';
        previewTimeline.value = window ? String(Math.max(0, Math.floor(previewVideo.currentTime - window.start))) : '0';
        if (paused || behind > liveThresholdSeconds) {
            const minutes = Math.floor(behind / 60);
            const seconds = Math.floor(behind % 60);
            previewBehindLive.textContent = `${paused ? 'PAUSED · ' : ''}${minutes}:${String(seconds).padStart(2, '0')} behind live`;
            previewBehindLive.classList.add('is-behind');
        } else {
            previewBehindLive.textContent = 'LIVE';
            previewBehindLive.classList.remove('is-behind');
        }
    }

    function seekPreview(seconds) {
        const window = getPreviewWindow();
        if (!window) return;
        const safeEnd = Math.max(window.start, window.end - 6);
        const safeStart = Math.min(safeEnd, window.start + 3);
        previewVideo.currentTime = Math.max(safeStart, Math.min(safeEnd, seconds));
        updatePreviewControls();
    }

    function stopPreviewStream(sessionId, liveStreamId) {
        const apiClient = ServerConnections.getApiClient(options.serverId);
        // A normal ajax request is cancelled when the browser tab closes. Keep
        // the close request alive across pagehide so abandoned previews do not
        // consume all of an IPTV provider's limited stream slots.
        if (liveStreamId) {
            fetch(apiClient.getUrl('LiveStreams/Close', { liveStreamId }), {
                method: 'POST',
                headers: { 'X-Emby-Token': apiClient.accessToken() },
                keepalive: true
            }).then(function (response) {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
            }).catch(function () {
                console.warn('Unable to close the previous live preview stream');
            });
        }
        if (sessionId) {
            apiClient.stopActiveEncodings(sessionId).catch(function () {
                console.warn('Unable to stop the previous live preview encoding');
            });
        }
    }

    function onPageHide() {
        releasePreview();
    }

    function onPreviewFullscreenChange() {
        if (!document.fullscreenElement && previewVideo) {
            previewVideo.controls = false;
            updatePreviewControls();
        }
    }

    function releasePreview() {
        previewRequestId++;
        previewChannelId = null;
        previewStarted = false;
        const closingSessionId = previewSessionId;
        if (previewBufferRegistered && closingSessionId) {
            const apiClient = ServerConnections.getApiClient(options.serverId);
            fetch(apiClient.getUrl('FamilyFlix/Buffer/Live/Unregister'), {
                method: 'POST',
                headers: { 'X-Emby-Token': apiClient.accessToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ playSessionId: closingSessionId, minutes: appSettings.liveBufferMinutes() }),
                keepalive: true
            }).catch(() => {
                console.warn('Unable to release Live TV buffer registration');
            });
        }
        previewBufferRegistered = false;
        const closingLiveStreamId = previewLiveStreamId;
        previewSessionId = null;
        previewLiveStreamId = null;
        previewHls?.destroy();
        previewHls = null;
        if (previewVideo) {
            previewVideo.pause();
            previewVideo.removeAttribute('src');
            previewVideo.load();
            previewVideo.classList.remove('is-playing');
            previewVideo.muted = true;
            previewVideo.controls = false;
        }
        stopPreviewStream(closingSessionId, closingLiveStreamId);
        updatePreviewControls();
    }

    function showPreviewMessage(message) {
        previewEmpty.textContent = message;
        previewEmpty.classList.remove('hide');
    }

    function startPreviewPlayback() {
        // The channel click usually permits sound. If the browser's autoplay
        // policy rejects that delayed request, keep video working and offer
        // the explicit Sound on button for the next user gesture.
        previewVideo.muted = false;
        return previewVideo.play().catch(function () {
            previewVideo.muted = true;
            return previewVideo.play();
        }).then(function () {
            previewStarted = true;
            previewVideo.classList.add('is-playing');
            previewEmpty.classList.add('hide');
            updatePreviewControls();
            if (previewSessionId && !previewBufferRegistered) {
                const apiClient = ServerConnections.getApiClient(options.serverId);
                const registeringSessionId = previewSessionId;
                fetch(apiClient.getUrl('FamilyFlix/Buffer/Live/Register'), {
                    method: 'POST',
                    headers: { 'X-Emby-Token': apiClient.accessToken(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playSessionId: registeringSessionId, minutes: appSettings.liveBufferMinutes() })
                }).then(response => {
                    if (previewSessionId === registeringSessionId) {
                        previewBufferRegistered = response.ok;
                    } else if (response.ok) {
                        fetch(apiClient.getUrl('FamilyFlix/Buffer/Live/Unregister'), {
                            method: 'POST',
                            headers: { 'X-Emby-Token': apiClient.accessToken(), 'Content-Type': 'application/json' },
                            body: JSON.stringify({ playSessionId: registeringSessionId, minutes: appSettings.liveBufferMinutes() }),
                            keepalive: true
                        }).catch(() => {
                            console.warn('Unable to release a previous Live TV buffer registration');
                        });
                    }
                }).catch(() => {
                    if (previewSessionId === registeringSessionId) {
                        previewBufferRegistered = false;
                    }
                });
            }
        });
    }

    function openFullscreen(channelId) {
        const playInMainPlayer = function () {
            const channel = visibleChannelsById.get(channelId);
            releasePreview();
            playbackManager.play(channel ? { items: [channel] } : { ids: [channelId], serverId: options.serverId });
        };
        if (previewVideo.readyState >= 2 && previewContainer.requestFullscreen) {
            previewVideo.muted = false;
            updatePreviewControls();
            previewContainer.requestFullscreen().catch(function () {
                playInMainPlayer();
            });
        } else {
            playInMainPlayer();
        }
    }

    function previewSelection(channelId) {
        if (!channelId) return;
        if (previewChannelId === channelId) {
            openFullscreen(channelId);
            return;
        }
        releasePreview();
        previewChannelId = channelId;
        const channel = visibleChannelsById.get(channelId);
        previewLabel.textContent = channel?.Name || 'Selected channel';
        showPreviewMessage('Loading preview…');
        const requestId = previewRequestId;
        const apiClient = ServerConnections.getApiClient(options.serverId);
        apiClient.getLiveTvChannel(channelId, apiClient.getCurrentUserId())
            .then(function (item) { return playbackManager.getPlaybackInfo(item, { forceHls: true }); })
            .then(function (stream) {
                if (requestId !== previewRequestId) {
                    stopPreviewStream(stream?.playSessionId, stream?.liveStreamId);
                    return;
                }
                if (!stream?.url) throw new Error('No live preview stream URL');
                previewSessionId = stream.playSessionId;
                previewLiveStreamId = stream.liveStreamId;
                if (stream.mimeType === 'application/x-mpegURL' || /\.m3u8(?:\?|$)/i.test(stream.url)) {
                    return import('hls.js').then(function ({ default: Hls }) {
                        if (requestId !== previewRequestId) return;
                        if (Hls.isSupported()) {
                            previewHls = new Hls({
                                enableWorker: true,
                                lowLatencyMode: false,
                                maxBufferLength: 30,
                                backBufferLength: 300,
                                liveBackBufferLength: 300
                            });
                            previewHls.on(Hls.Events.ERROR, function (_event, error) {
                                if (!error.fatal) return;
                                if (error.type === Hls.ErrorTypes.NETWORK_ERROR) {
                                    previewHls.startLoad();
                                } else if (error.type === Hls.ErrorTypes.MEDIA_ERROR) {
                                    previewHls.recoverMediaError();
                                } else {
                                    showPreviewMessage('Preview unavailable. Select again for full screen.');
                                }
                            });
                            previewHls.on(Hls.Events.MANIFEST_PARSED, function () {
                                if (requestId !== previewRequestId) return;
                                startPreviewPlayback().catch(function () {
                                    showPreviewMessage('Preview unavailable. Select again for full screen.');
                                });
                            });
                            previewHls.loadSource(stream.url);
                            previewHls.attachMedia(previewVideo);
                            return true;
                        } else {
                            previewVideo.src = stream.url;
                        }
                    });
                }
                previewVideo.src = stream.url;
            })
            .then(function (waitForHls) {
                if (waitForHls) return;
                if (requestId !== previewRequestId) return;
                return startPreviewPlayback();
            })
            .catch(function () {
                if (requestId === previewRequestId) {
                    showPreviewMessage('Preview unavailable. Select again for full screen.');
                }
            });
    }

    function onGuideCellClick(event) {
        const cell = dom.parentWithClass(event.target, 'programCell')
            || dom.parentWithClass(event.target, 'guide-channelHeaderCell');
        if (!cell) return;
        event.preventDefault();
        event.stopPropagation();
        previewSelection(cell.getAttribute('data-channelid') || cell.getAttribute('data-id'));
    }

    self.refresh = function () {
        reloadPage(options.element);
        restartAutoRefresh();
    };

    self.pause = function () {
        stopAutoRefresh();
        releasePreview();
    };

    self.resume = function (refreshData) {
        if (refreshData) {
            self.refresh();
        } else {
            restartAutoRefresh();
        }
    };

    self.destroy = function () {
        destroyed = true;
        stopAutoRefresh();
        releasePreview();
        clearInterval(previewClock);
        window.removeEventListener('pagehide', onPageHide);
        document.removeEventListener('fullscreenchange', onPreviewFullscreenChange);

        Events.off(serverNotifications, 'TimerCreated', onTimerCreated);
        Events.off(serverNotifications, 'TimerCancelled', onTimerCancelled);
        Events.off(serverNotifications, 'SeriesTimerCancelled', onSeriesTimerCancelled);

        setScrollEvents(options.element, false);
        itemShortcuts.off(options.element);
        items = {};
    };

    function restartAutoRefresh() {
        stopAutoRefresh();

        const intervalMs = 60000 * 15; // (minutes)

        autoRefreshInterval = setInterval(function () {
            self.refresh();
        }, intervalMs);
    }

    function stopAutoRefresh() {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }

    function normalizeDateToTimeslot(date) {
        const minutesOffset = date.getMinutes() - cellCurationMinutes;

        if (minutesOffset >= 0) {
            date.setHours(date.getHours(), cellCurationMinutes, 0, 0);
        } else {
            date.setHours(date.getHours(), 0, 0, 0);
        }

        return date;
    }

    function showLoading() {
        loading.show();
    }

    function hideLoading() {
        loading.hide();
    }

    function showGuideError(context, message, error) {
        console.warn(message, error);
        context.querySelector('.channelList').textContent = message;
        context.querySelector('.programGrid').replaceChildren();
    }

    function reloadGuide(context, newStartDate, scrollToTimeMs, focusToTimeMs, startTimeOfDayMs, focusProgramOnRender) {
        const requestId = ++loadRequestId;
        const apiClient = ServerConnections.getApiClient(options.serverId);

        const channelQuery = {

            StartIndex: 0,
            EnableFavoriteSorting: userSettings.get('livetv-favoritechannelsattop') !== 'false'
        };

        channelQuery.UserId = apiClient.getCurrentUserId();

        // Family Flix's five IPTV groups total fewer than 1,000 channels.
        // Fetch once, then ask for programme data only for the selected group.
        const channelLimit = 1000;

        showLoading();

        channelQuery.StartIndex = currentStartIndex;
        channelQuery.Limit = channelLimit;
        channelQuery.AddCurrentProgram = false;
        channelQuery.EnableUserData = false;
        channelQuery.EnableImageTypes = 'Primary';

        const categories = self.categoryOptions.categories || [];
        const displayMovieContent = !categories.length || categories.indexOf('movies') !== -1;
        const displaySportsContent = !categories.length || categories.indexOf('sports') !== -1;
        const displayNewsContent = !categories.length || categories.indexOf('news') !== -1;
        const displayKidsContent = !categories.length || categories.indexOf('kids') !== -1;
        const displaySeriesContent = !categories.length || categories.indexOf('series') !== -1;

        if (displayMovieContent && displaySportsContent && displayNewsContent && displayKidsContent) {
            channelQuery.IsMovie = null;
            channelQuery.IsSports = null;
            channelQuery.IsKids = null;
            channelQuery.IsNews = null;
            channelQuery.IsSeries = null;
        } else {
            if (displayNewsContent) {
                channelQuery.IsNews = true;
            }
            if (displaySportsContent) {
                channelQuery.IsSports = true;
            }
            if (displayKidsContent) {
                channelQuery.IsKids = true;
            }
            if (displayMovieContent) {
                channelQuery.IsMovie = true;
            }
            if (displaySeriesContent) {
                channelQuery.IsSeries = true;
            }
        }

        if (userSettings.get('livetv-channelorder') === 'DatePlayed') {
            channelQuery.SortBy = 'DatePlayed';
            channelQuery.SortOrder = 'Descending';
        } else {
            channelQuery.SortBy = null;
            channelQuery.SortOrder = null;
        }

        let date = newStartDate;
        // Add one second to avoid getting programs that are just ending
        date = new Date(date.getTime() + 1000);

        // Subtract to avoid getting programs that are starting when the grid ends
        const nextDay = new Date(date.getTime() + guideDurationMs - 2000);

        // Normally we'd want to just let responsive css handle this,
        // but since mobile browsers are often underpowered,
        // it can help performance to get them out of the markup
        const allowIndicators = dom.getWindowSize().innerWidth >= 600;

        const renderOptions = {
            showHdIcon: allowIndicators && userSettings.get('guide-indicator-hd') === 'true',
            showLiveIndicator: allowIndicators && userSettings.get('guide-indicator-live') !== 'false',
            showPremiereIndicator: allowIndicators && userSettings.get('guide-indicator-premiere') !== 'false',
            showNewIndicator: allowIndicators && userSettings.get('guide-indicator-new') !== 'false',
            showRepeatIndicator: allowIndicators && userSettings.get('guide-indicator-repeat') === 'true',
            showEpisodeTitle: !layoutManager.tv
        };

        const channelsPromise = channelCache && Date.now() - channelCacheTime < 300000 ?
            Promise.resolve(channelCache) :
            apiClient.getLiveTvChannels(channelQuery).then(function (result) {
                channelCache = result;
                channelCacheTime = Date.now();
                return result;
            });

        channelsPromise.then(function (channelsResult) {
            if (requestId !== loadRequestId) return;
            const visibleChannels = (channelsResult.Items || []).filter(function (channel) {
                if (!currentBand) return true;
                const number = Number(channel.Number || channel.ChannelNumber);
                return Number.isFinite(number) && Math.floor(number / 1000) === currentBand;
            });
            visibleChannelsById = new Map(visibleChannels.map(channel => [channel.Id, channel]));

            const programFields = [];

            const programQuery = {
                UserId: apiClient.getCurrentUserId(),
                MaxStartDate: nextDay.toISOString(),
                MinEndDate: date.toISOString(),
                channelIds: visibleChannels.map(function (c) {
                    return c.Id;
                }).join(','),
                ImageTypeLimit: 1,
                EnableImages: false,
                //EnableImageTypes: layoutManager.tv ? "Primary,Backdrop" : "Primary",
                SortBy: 'StartDate',
                EnableTotalRecordCount: false,
                EnableUserData: false
            };

            if (renderOptions.showHdIcon) {
                programFields.push('IsHD');
            }

            if (programFields.length) {
                programQuery.Fields = programFields.join('');
            }

            if (!visibleChannels.length) {
                renderGuide(context, date, [], [], renderOptions, { focusProgramOnRender, scrollToTimeMs, focusToTimeMs, startTimeOfDayMs }, apiClient);
                hideLoading();
                return;
            }

            apiClient.getLiveTvPrograms(programQuery).then(function (programsResult) {
                if (requestId !== loadRequestId) return;
                const guideOptions = { focusProgramOnRender, scrollToTimeMs, focusToTimeMs, startTimeOfDayMs };

                renderGuide(context, date, visibleChannels, programsResult.Items, renderOptions, guideOptions, apiClient);

                hideLoading();
            }).catch(function (error) {
                if (requestId === loadRequestId) {
                    showGuideError(context, 'TV listings could not load. Try again in a moment.', error);
                    hideLoading();
                }
            });
        }).catch(function (error) {
            if (requestId === loadRequestId) {
                showGuideError(context, 'Live TV channels could not load. Try again in a moment.', error);
                hideLoading();
            }
        });
    }

    function getDisplayTime(date) {
        if ((typeof date).toString().toLowerCase() === 'string') {
            try {
                date = datetime.parseISO8601Date(date, { toLocal: true });
            } catch {
                return date;
            }
        }

        return datetime.getDisplayTime(date).toLowerCase();
    }

    function getTimeslotHeadersHtml(startDate, endDateTime) {
        let html = '';

        // clone
        startDate = new Date(startDate.getTime());

        html += '<div class="timeslotHeadersInner">';

        while (startDate.getTime() < endDateTime) {
            html += '<div class="timeslotHeader">';

            html += getDisplayTime(startDate);
            html += '</div>';

            // Add 30 mins
            startDate.setTime(startDate.getTime() + cellDurationMs);
        }

        return html;
    }

    function parseDates(program) {
        if (!program.StartDateLocal) {
            try {
                program.StartDateLocal = datetime.parseISO8601Date(program.StartDate, { toLocal: true });
            } catch (err) {
                console.error('error parsing timestamp for start date', err);
            }
        }

        if (!program.EndDateLocal) {
            try {
                program.EndDateLocal = datetime.parseISO8601Date(program.EndDate, { toLocal: true });
            } catch (err) {
                console.error('error parsing timestamp for end date', err);
            }
        }

        return null;
    }

    function getTimerIndicator(item) {
        let status;

        if (item.Type === 'SeriesTimer') {
            return '<span class="material-icons programIcon seriesTimerIcon fiber_smart_record" aria-hidden="true"></span>';
        } else if (item.TimerId || item.SeriesTimerId) {
            status = item.Status || 'Cancelled';
        } else if (item.Type === 'Timer') {
            status = item.Status;
        } else {
            return '';
        }

        if (item.SeriesTimerId) {
            if (status !== 'Cancelled') {
                return '<span class="material-icons programIcon seriesTimerIcon fiber_smart_record" aria-hidden="true"></span>';
            }

            return '<span class="material-icons programIcon seriesTimerIcon seriesTimerIcon-inactive fiber_smart_record" aria-hidden="true"></span>';
        }

        return '<span class="material-icons programIcon timerIcon fiber_manual_record" aria-hidden="true"></span>';
    }

    function getChannelProgramsHtml(context, date, channel, programs, programOptions) {
        let html = '';

        const startMs = date.getTime();
        const endMs = startMs + guideDurationMs - 1;

        const outerCssClass = layoutManager.tv ? 'channelPrograms channelPrograms-tv' : 'channelPrograms';

        html += '<div class="' + outerCssClass + '" data-channelid="' + channel.Id + '">';

        const clickAction = layoutManager.tv ? 'link' : 'programdialog';

        const categories = self.categoryOptions.categories || [];
        const displayMovieContent = !categories.length || categories.indexOf('movies') !== -1;
        const displaySportsContent = !categories.length || categories.indexOf('sports') !== -1;
        const displayNewsContent = !categories.length || categories.indexOf('news') !== -1;
        const displayKidsContent = !categories.length || categories.indexOf('kids') !== -1;
        const displaySeriesContent = !categories.length || categories.indexOf('series') !== -1;
        const enableColorCodedBackgrounds = userSettings.get('guide-colorcodedbackgrounds') === 'true';

        const now = new Date().getTime();

        for (const program of programs) {
            parseDates(program);

            const startDateLocalMs = program.StartDateLocal.getTime();
            const endDateLocalMs = program.EndDateLocal.getTime();

            if (endDateLocalMs < startMs) {
                continue;
            }

            if (startDateLocalMs > endMs) {
                break;
            }

            items[program.Id] = program;

            const renderStartMs = Math.max(startDateLocalMs, startMs);
            let startPercent = (startDateLocalMs - startMs) / guideDurationMs;
            startPercent *= 100;
            startPercent = Math.max(startPercent, 0);

            const renderEndMs = Math.min(endDateLocalMs, endMs);
            let endPercent = (renderEndMs - renderStartMs) / guideDurationMs;
            endPercent *= 100;

            let cssClass = 'programCell itemAction';
            let accentCssClass = null;
            let displayInnerContent = true;

            if (program.IsKids) {
                displayInnerContent = displayKidsContent;
                accentCssClass = 'kids';
            } else if (program.IsSports) {
                displayInnerContent = displaySportsContent;
                accentCssClass = 'sports';
            } else if (program.IsNews) {
                displayInnerContent = displayNewsContent;
                accentCssClass = 'news';
            } else if (program.IsMovie) {
                displayInnerContent = displayMovieContent;
                accentCssClass = 'movie';
            } else if (program.IsSeries) {
                displayInnerContent = displaySeriesContent;
            } else {
                displayInnerContent = displayMovieContent && displayNewsContent && displaySportsContent && displayKidsContent && displaySeriesContent;
            }

            if (displayInnerContent && enableColorCodedBackgrounds && accentCssClass) {
                cssClass += ' programCell-' + accentCssClass;
            }

            if (now >= startDateLocalMs && now < endDateLocalMs) {
                cssClass += ' programCell-active';
            }

            let timerAttributes = '';
            if (program.TimerId) {
                timerAttributes += ' data-timerid="' + program.TimerId + '"';
            }
            if (program.SeriesTimerId) {
                timerAttributes += ' data-seriestimerid="' + program.SeriesTimerId + '"';
            }

            const isAttribute = endPercent >= 2 ? ' is="emby-programcell"' : '';

            html += '<button' + isAttribute + ' data-action="' + clickAction + '"' + timerAttributes + ' data-channelid="' + program.ChannelId + '" data-id="' + program.Id + '" data-serverid="' + program.ServerId + '" data-startdate="' + program.StartDate + '" data-enddate="' + program.EndDate + '" data-type="' + program.Type + '" class="' + cssClass + '" style="left:' + startPercent + '%;width:' + endPercent + '%;">';

            if (displayInnerContent) {
                const guideProgramNameClass = 'guideProgramName';

                html += '<div class="' + guideProgramNameClass + '">';

                html += '<div class="guide-programNameCaret hide"><span class="guideProgramNameCaretIcon material-icons keyboard_arrow_left" aria-hidden="true"></span></div>';

                html += '<div class="guideProgramNameText">' + escapeHtml(program.Name);

                let indicatorHtml = null;
                if (program.IsLive && programOptions.showLiveIndicator) {
                    indicatorHtml = '<span class="liveTvProgram guideProgramIndicator">' + globalize.translate('Live') + '</span>';
                } else if (program.IsPremiere && programOptions.showPremiereIndicator) {
                    indicatorHtml = '<span class="premiereTvProgram guideProgramIndicator">' + globalize.translate('Premiere') + '</span>';
                } else if (program.IsSeries && !program.IsRepeat && programOptions.showNewIndicator) {
                    indicatorHtml = '<span class="newTvProgram guideProgramIndicator">' + globalize.translate('New') + '</span>';
                } else if (program.IsSeries && program.IsRepeat && programOptions.showRepeatIndicator) {
                    indicatorHtml = '<span class="repeatTvProgram guideProgramIndicator">' + globalize.translate('Repeat') + '</span>';
                }
                html += indicatorHtml || '';

                if ((program.EpisodeTitle && programOptions.showEpisodeTitle)) {
                    html += '<div class="guideProgramSecondaryInfo">';

                    if (program.EpisodeTitle && programOptions.showEpisodeTitle) {
                        html += '<span class="programSecondaryTitle">' + escapeHtml(program.EpisodeTitle) + '</span>';
                    }
                    html += '</div>';
                }

                html += '</div>';

                if (program.IsHD && programOptions.showHdIcon) {
                    if (layoutManager.tv) {
                        html += '<div class="programIcon guide-programTextIcon guide-programTextIcon-tv">HD</div>';
                    } else {
                        html += '<div class="programIcon guide-programTextIcon">HD</div>';
                    }
                }

                html += getTimerIndicator(program);

                html += '</div>';
            }

            html += '</button>';
        }

        html += '</div>';

        return html;
    }

    function renderChannelHeaders(context, channels, apiClient) {
        let html = '';

        for (const channel of channels) {
            const hasChannelImage = channel.ImageTags.Primary;

            let cssClass = 'guide-channelHeaderCell itemAction';

            if (layoutManager.tv) {
                cssClass += ' guide-channelHeaderCell-tv';
            }

            const title = [];
            if (channel.ChannelNumber) {
                title.push(channel.ChannelNumber);
            }
            if (channel.Name) {
                title.push(channel.Name);
            }

            html += '<button title="' + escapeHtml(title.join(' ')) + '" type="button" class="' + cssClass + '"' + ' data-action="link" data-isfolder="' + channel.IsFolder + '" data-id="' + channel.Id + '" data-serverid="' + channel.ServerId + '" data-type="' + channel.Type + '">';

            if (hasChannelImage) {
                const url = apiClient.getScaledImageUrl(channel.Id, {
                    maxHeight: 220,
                    tag: channel.ImageTags.Primary,
                    type: 'Primary'
                });

                html += '<div class="guideChannelImage lazy" data-src="' + url + '"></div>';
            }

            if (channel.ChannelNumber) {
                html += '<h3 class="guideChannelNumber">' + channel.ChannelNumber + '</h3>';
            }

            if (!hasChannelImage && channel.Name) {
                html += '<div class="guideChannelName">' + escapeHtml(channel.Name) + '</div>';
            }

            html += '</button>';
        }

        const channelList = context.querySelector('.channelsContainer');
        channelList.innerHTML = html;
        imageLoader.lazyChildren(channelList);
    }

    function renderPrograms(context, date, channels, programs, programOptions) {
        const programsByChannel = new Map();
        for (const program of programs) {
            if (!programsByChannel.has(program.ChannelId)) programsByChannel.set(program.ChannelId, []);
            programsByChannel.get(program.ChannelId).push(program);
        }
        const html = [];

        for (const channel of channels) {
            html.push(getChannelProgramsHtml(context, date, channel, programsByChannel.get(channel.Id) || [], programOptions));
        }

        programGrid.innerHTML = html.join('');

        programCells = programGrid.querySelectorAll('[is=emby-programcell]');

        updateProgramCellsOnScroll(programGrid, programCells);
    }

    function renderGuide(context, date, channels, programs, renderOptions, guideOptions, apiClient) {
        const activeElement = document.activeElement;
        const itemId = activeElement?.getAttribute ? activeElement.getAttribute('data-id') : null;
        let channelRowId = null;

        if (activeElement) {
            channelRowId = dom.parentWithClass(activeElement, 'channelPrograms');
            channelRowId = channelRowId?.getAttribute ? channelRowId.getAttribute('data-channelid') : null;
        }

        renderChannelHeaders(context, channels, apiClient);

        const startDate = date;
        const endDate = new Date(startDate.getTime() + guideDurationMs);
        context.querySelector('.timeslotHeaders').innerHTML = getTimeslotHeadersHtml(startDate, endDate);
        items = {};
        renderPrograms(context, date, channels, programs, renderOptions);

        if (guideOptions.focusProgramOnRender) {
            focusProgram(context, itemId, channelRowId, guideOptions.focusToTimeMs, guideOptions.startTimeOfDayMs);
        }

        scrollProgramGridToTimeMs(context, guideOptions.scrollToTimeMs, guideOptions.startTimeOfDayMs);
    }

    function scrollProgramGridToTimeMs(context, scrollToTimeMs, startTimeOfDayMs) {
        scrollToTimeMs -= startTimeOfDayMs;

        const pct = scrollToTimeMs / guideDurationMs;

        programGrid.scrollTop = 0;

        const scrollPos = pct * programGrid.scrollWidth;

        nativeScrollTo(programGrid, scrollPos, true);
    }

    function focusProgram(context, itemId, channelRowId, focusToTimeMs, startTimeOfDayMs) {
        let focusElem;
        if (itemId) {
            focusElem = context.querySelector('[data-id="' + itemId + '"]');
        }

        if (focusElem) {
            focusManager.focus(focusElem);
        } else {
            let autoFocusParent;

            if (channelRowId) {
                autoFocusParent = context.querySelector('[data-channelid="' + channelRowId + '"]');
            }

            if (!autoFocusParent) {
                autoFocusParent = programGrid;
            }

            focusToTimeMs -= startTimeOfDayMs;

            const pct = (focusToTimeMs / guideDurationMs) * 100;

            let programCell = autoFocusParent.querySelector('.programCell');

            while (programCell) {
                let left = (programCell.style.left || '').replace('%', '');
                left = left ? parseFloat(left) : 0;
                let width = (programCell.style.width || '').replace('%', '');
                width = width ? parseFloat(width) : 0;

                if (left >= pct || (left + width) >= pct) {
                    break;
                }
                programCell = programCell.nextSibling;
            }

            if (programCell) {
                focusManager.focus(programCell);
            } else {
                focusManager.autoFocus(autoFocusParent, true);
            }
        }
    }

    function nativeScrollTo(container, pos, horizontal) {
        if (container.scrollTo) {
            if (horizontal) {
                container.scrollTo(pos, 0);
            } else {
                container.scrollTo(0, pos);
            }
        } else if (horizontal) {
            container.scrollLeft = Math.round(pos);
        } else {
            container.scrollTop = Math.round(pos);
        }
    }

    let lastGridScroll = 0;
    let lastHeaderScroll = 0;
    let scrollXPct = 0;
    function onProgramGridScroll(context, elem, headers) {
        if ((new Date().getTime() - lastHeaderScroll) >= 1000) {
            lastGridScroll = new Date().getTime();

            const scrollLeft = elem.scrollLeft;
            scrollXPct = (scrollLeft * 100) / elem.scrollWidth;
            nativeScrollTo(headers, scrollLeft, true);
        }

        updateProgramCellsOnScroll(elem, programCells);
    }

    function onTimeslotHeadersScroll(context, elem) {
        if ((new Date().getTime() - lastGridScroll) >= 1000) {
            lastHeaderScroll = new Date().getTime();
            nativeScrollTo(programGrid, elem.scrollLeft, true);
        }
    }

    function reloadPage(page) {
        if (!currentDate) currentDate = normalizeDateToTimeslot(new Date());
        const end = new Date(currentDate.getTime() + guideDurationMs);
        page.querySelector('.familyGuideWindowLabel').textContent =
            getDisplayTime(currentDate) + ' – ' + getDisplayTime(end);
        reloadGuide(page, currentDate, 0, 0, 0, false);
    }

    function getChannelProgramsFocusableElements(container) {
        const elements = container.querySelectorAll('.programCell');

        const list = [];
        // add 1 to avoid programs that are out of view to the left
        const currentScrollXPct = scrollXPct + 1;

        for (const elem of elements) {
            let left = (elem.style.left || '').replace('%', '');
            left = left ? parseFloat(left) : 0;

            let width = (elem.style.width || '').replace('%', '');
            width = width ? parseFloat(width) : 0;

            if ((left + width) >= currentScrollXPct) {
                list.push(elem);
            }
        }

        return list;
    }

    function onInputCommand(e) {
        const target = e.target;
        const programCell = dom.parentWithClass(target, 'programCell');
        let container;
        let channelPrograms;
        let focusableElements;
        let newRow;

        switch (e.detail.command) {
            case 'up':
                if (programCell) {
                    container = programGrid;
                    channelPrograms = dom.parentWithClass(programCell, 'channelPrograms');

                    newRow = channelPrograms.previousSibling;
                    if (newRow) {
                        focusableElements = getChannelProgramsFocusableElements(newRow);
                        if (focusableElements.length) {
                            container = newRow;
                        } else {
                            focusableElements = null;
                        }
                    } else {
                        container = null;
                    }
                } else {
                    container = null;
                }
                lastFocusDirection = e.detail.command;

                focusManager.moveUp(target, {
                    container: container,
                    focusableElements: focusableElements
                });
                break;
            case 'down':
                if (programCell) {
                    container = programGrid;
                    channelPrograms = dom.parentWithClass(programCell, 'channelPrograms');

                    newRow = channelPrograms.nextSibling;
                    if (newRow) {
                        focusableElements = getChannelProgramsFocusableElements(newRow);
                        if (focusableElements.length) {
                            container = newRow;
                        } else {
                            focusableElements = null;
                        }
                    } else {
                        container = null;
                    }
                } else {
                    container = null;
                }
                lastFocusDirection = e.detail.command;

                focusManager.moveDown(target, {
                    container: container,
                    focusableElements: focusableElements
                });
                break;
            case 'left':
                container = programCell ? dom.parentWithClass(programCell, 'channelPrograms') : null;
                // allow left outside the channelProgramsContainer when the first child is currently focused
                if (container && !programCell.previousSibling) {
                    container = null;
                }
                lastFocusDirection = e.detail.command;

                focusManager.moveLeft(target, {
                    container: container
                });
                break;
            case 'right':
                container = programCell ? dom.parentWithClass(programCell, 'channelPrograms') : null;
                lastFocusDirection = e.detail.command;

                focusManager.moveRight(target, {
                    container: container
                });
                break;
            default:
                return;
        }

        e.preventDefault();
        e.stopPropagation();
    }

    function onScrollerFocus(e) {
        const target = e.target;
        const programCell = dom.parentWithClass(target, 'programCell');

        if (programCell) {
            const focused = target;

            const id = focused.getAttribute('data-id');
            const item = items[id];

            if (item) {
                Events.trigger(self, 'focus', [
                    {
                        item: item
                    }]);
            }
        }

        if (lastFocusDirection === 'left') {
            if (programCell) {
                scrollHelper.toStart(programGrid, programCell, true, true);
            }
        } else if (lastFocusDirection === 'right') {
            if (programCell) {
                scrollHelper.toCenter(programGrid, programCell, true, true);
            }
        } else if (lastFocusDirection === 'up' || lastFocusDirection === 'down') {
            const verticalScroller = dom.parentWithClass(target, 'guideVerticalScroller');
            if (verticalScroller) {
                const focusedElement = programCell || dom.parentWithTag(target, 'BUTTON');
                verticalScroller.toCenter(focusedElement, true);
            }
        }
    }

    function setScrollEvents(view, enabled) {
        if (layoutManager.tv) {
            const guideVerticalScroller = view.querySelector('.guideVerticalScroller');

            if (enabled) {
                inputManager.on(guideVerticalScroller, onInputCommand);
            } else {
                inputManager.off(guideVerticalScroller, onInputCommand);
            }
        }
    }

    function onTimerCreated(e, apiClient, data) {
        const programId = data.ProgramId;
        // This could be null, not supported by all tv providers
        const newTimerId = data.Id;

        // find guide cells by program id, ensure timer icon
        const cells = options.element.querySelectorAll('.programCell[data-id="' + programId + '"]');
        for (const cell of cells) {
            const icon = cell.querySelector('.timerIcon');
            if (!icon) {
                cell.querySelector('.guideProgramName').insertAdjacentHTML('beforeend', '<span class="timerIcon material-icons programIcon fiber_manual_record"></span>');
            }

            if (newTimerId) {
                cell.setAttribute('data-timerid', newTimerId);
            }
        }
    }

    function onTimerCancelled(e, apiClient, data) {
        const id = data.Id;
        // find guide cells by timer id, remove timer icon
        const cells = options.element.querySelectorAll('.programCell[data-timerid="' + id + '"]');

        for (const cell of cells) {
            const icon = cell.querySelector('.timerIcon');

            if (icon) {
                icon.parentNode.removeChild(icon);
            }

            cell.removeAttribute('data-timerid');
        }
    }

    function onSeriesTimerCancelled(e, apiClient, data) {
        const id = data.Id;
        // find guide cells by timer id, remove timer icon
        const cells = options.element.querySelectorAll('.programCell[data-seriestimerid="' + id + '"]');

        for (const cell of cells) {
            const icon = cell.querySelector('.seriesTimerIcon');

            if (icon) {
                icon.parentNode.removeChild(icon);
            }

            cell.removeAttribute('data-seriestimerid');
        }
    }

    const guideContext = options.element;

    guideContext.classList.add('tvguide');

    guideContext.innerHTML = globalize.translateHtml(template, 'core');
    previewVideo = guideContext.querySelector('.familyGuideVideo');
    previewContainer = guideContext.querySelector('.familyGuideSidebar');
    previewEmpty = guideContext.querySelector('.familyGuidePreviewEmpty');
    previewLabel = guideContext.querySelector('.familyGuidePreviewLabel');
    previewBehindLive = guideContext.querySelector('.familyGuideBehindLive');
    previewControls = guideContext.querySelector('.familyGuidePlaybackControls');
    previewTimeline = guideContext.querySelector('.familyGuideTimeline');
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('fullscreenchange', onPreviewFullscreenChange);
    for (const eventName of ['loadedmetadata', 'loadeddata', 'timeupdate', 'progress', 'durationchange', 'seeked', 'play', 'pause', 'waiting', 'volumechange']) {
        previewVideo.addEventListener(eventName, updatePreviewControls);
    }
    previewVideo.addEventListener('error', function () {
        if (previewChannelId) showPreviewMessage('Preview unavailable. Select again for full screen.');
    });
    previewControls.querySelector('.familyGuidePlayPause').addEventListener('click', function () {
        if (previewVideo.paused) {
            previewVideo.play().catch(function () {
                showPreviewMessage('Unable to resume this channel.');
            });
        } else {
            previewVideo.pause();
        }
    });
    previewControls.querySelector('.familyGuideRewind').addEventListener('click', function () {
        seekPreview(previewVideo.currentTime - 30);
    });
    previewControls.querySelector('.familyGuideForward').addEventListener('click', function () {
        seekPreview(previewVideo.currentTime + 30);
    });
    previewControls.querySelector('.familyGuideGoLive').addEventListener('click', function () {
        const window = getPreviewWindow();
        if (window) seekPreview(window.end);
        previewVideo.play().catch(function () {
            showPreviewMessage('Unable to resume this channel.');
        });
    });
    previewControls.querySelector('.familyGuideAudio').addEventListener('click', function () {
        previewVideo.muted = !previewVideo.muted;
        updatePreviewControls();
    });
    previewTimeline.addEventListener('input', function () {
        const window = getPreviewWindow();
        if (window) seekPreview(window.start + Number(previewTimeline.value));
    });

    function wireCategoryButton(button) {
        button.addEventListener('click', function () {
            const band = Number(button.getAttribute('data-band'));
            if (band === currentBand) return;
            currentBand = band;
            currentStartIndex = 0;
            for (const category of guideContext.querySelectorAll('.familyGuideCategory')) {
                category.classList.toggle('is-selected', category === button);
            }
            self.refresh();
            button.focus();
        });
    }
    for (const button of guideContext.querySelectorAll('.familyGuideCategory')) {
        wireCategoryButton(button);
    }

    const apiClientForCategories = ServerConnections.getApiClient(options.serverId);
    fetch(apiClientForCategories.getUrl('FamilyFlix/Iptv/Categories'), {
        headers: { 'X-Emby-Token': apiClientForCategories.accessToken() }
    }).then(function (response) {
        if (!response.ok) throw new Error('Categories unavailable');
        return response.json();
    }).then(function (result) {
        if (destroyed || !Array.isArray(result.categories) || !result.categories.length) return;
        const categories = result.categories.filter(category => category.enabled && Number.isInteger(category.band)
            && category.band > 0 && typeof category.name === 'string');
        if (!categories.length) return;
        const allButton = guideContext.querySelector('.familyGuideCategory[data-band="0"]');
        for (const button of guideContext.querySelectorAll('.familyGuideCategory:not([data-band="0"])')) button.remove();
        for (const category of categories) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'familyGuideCategory';
            button.dataset.band = String(category.band);
            button.textContent = category.name;
            allButton.before(button);
            wireCategoryButton(button);
        }
        if (!categories.some(category => category.band === currentBand) && currentBand !== 0) {
            currentBand = categories[0].band;
            currentStartIndex = 0;
            self.refresh();
        }
        for (const button of guideContext.querySelectorAll('.familyGuideCategory')) {
            button.classList.toggle('is-selected', Number(button.dataset.band) === currentBand);
        }
    }).catch(function () {
        // The five-category guide remains usable before the server component is activated.
    });

    const programGrid = guideContext.querySelector('.programGrid');
    const timeslotHeaders = guideContext.querySelector('.timeslotHeaders');

    if (layoutManager.tv) {
        dom.addEventListener(guideContext.querySelector('.guideVerticalScroller'), 'focus', onScrollerFocus, {
            capture: true,
            passive: true
        });
    } else if (layoutManager.desktop) {
        timeslotHeaders.classList.add('timeslotHeaders-desktop');
    }

    if (browser.iOS || browser.osx) {
        guideContext.querySelector('.channelsContainer').classList.add('noRubberBanding');

        programGrid.classList.add('noRubberBanding');
    }

    dom.addEventListener(programGrid, 'scroll', function () {
        onProgramGridScroll(guideContext, this, timeslotHeaders);
    }, {
        passive: true
    });

    dom.addEventListener(timeslotHeaders, 'scroll', function () {
        onTimeslotHeadersScroll(guideContext, this);
    }, {
        passive: true
    });

    programGrid.addEventListener('click', onGuideCellClick);
    guideContext.querySelector('.channelsContainer').addEventListener('click', onGuideCellClick);

    guideContext.querySelector('.familyGuideLater').addEventListener('click', function () {
        currentDate = new Date(currentDate.getTime() + guideDurationMs);
        reloadPage(guideContext);
    });
    guideContext.querySelector('.familyGuideEarlier').addEventListener('click', function () {
        const earliest = normalizeDateToTimeslot(new Date());
        currentDate = new Date(Math.max(earliest.getTime(), currentDate.getTime() - guideDurationMs));
        reloadPage(guideContext);
    });

    setScrollEvents(guideContext, true);
    itemShortcuts.on(guideContext);

    Events.trigger(self, 'load');

    Events.on(serverNotifications, 'TimerCreated', onTimerCreated);
    Events.on(serverNotifications, 'TimerCancelled', onTimerCancelled);
    Events.on(serverNotifications, 'SeriesTimerCancelled', onSeriesTimerCancelled);

    self.refresh();
}

export default Guide;
