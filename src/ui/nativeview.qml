import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Konvergo 1.0

Window {
    id: window
    objectName: "mainWindow"
    title: "Family Flix"
    width: 1280
    height: 720
    minimumWidth: 960
    minimumHeight: 540
    visible: true
    color: familyApi.themeScreen

    property string page: familyApi.signedIn ? "home" : "login"
    property string chosenUser: ""
    property var chosenCoWatchUser: ({})
    property string familyNightMedia: "All"
    property int familyNightRuntime: 0
    property int familyNightAge: -1
    property int vodBufferMinutes: Number(components.settings.value("video", "familyVodBufferMinutes")) || 60
    property int liveBufferMinutes: Number(components.settings.value("video", "familyLiveBufferMinutes")) || 60
    property string familyNightGenre: "Any"
    property var familyNightPick: ({})
    property string pendingFamilyNightId: ""
    property string pendingSeriesPlayId: ""
    onFamilyNightMatchesChanged: if (page === "familyNight") Qt.callLater(pickFamilyNight)
    property var familyNightGenres: {
        const genres = ["Any"]
        for (const item of familyApi.familyNightCandidates) {
            for (const genre of (item.Genres || [])) {
                if (!genres.includes(genre)) genres.push(genre)
            }
        }
        return genres
    }
    property var familyNightMatches: {
        const matches = []
        for (const item of familyApi.familyNightCandidates) {
            if (familyNightMedia === "Movies" && item.Type !== "Movie") continue
            if (familyNightMedia === "Shows" && item.Type !== "Series") continue
            const minutes = Math.ceil(Number(item.RunTimeTicks || 0) / 600000000)
            if (familyNightRuntime > 0 && (minutes === 0 || minutes > familyNightRuntime)) continue
            if (familyNightGenre !== "Any" && !(item.Genres || []).some(function(genre) {
                return String(genre).toLowerCase() === familyNightGenre.toLowerCase()
            })) continue
            const requiredAge = familyApi.familyNightRequiredAge(item.OfficialRating || "")
            if (familyNightAge >= 0 && (requiredAge < 0 || requiredAge > familyNightAge)) continue
            matches.push(item)
        }
        return matches
    }
    property var focusedItem: ({})
    property string backgroundRandomId: ""
    property var backgroundRandomItem: ({})
    property var playingItem: ({})
    property var nextEpisode: ({})
    property bool autoNextPending: false
    property bool nextUpAutoBlocked: false
    property bool stillWatchingPrompt: false
    property int uninterruptedEpisodes: 0
    property real uninterruptedMinutes: 0
    property double nextUpDeadlineMs: 0
    property int nextUpSecondsRemaining: 0
    property var playbackQueue: []
    property int playbackQueueIndex: -1
    property int kidsQueuedEpisodes: 0
    property double sleepDeadlineMs: 0
    property int sleepMinutesRemaining: sleepDeadlineMs > 0 ? Math.max(0, Math.ceil((sleepDeadlineMs - Date.now()) / 60000)) : 0
    property string playbackReturnPage: "detail"
    property var selectedSeries: ({})
    property var selectedSeason: ({})
    property string detailReturnPage: "home"
    property string notice: ""
    property bool playerControlsVisible: false
    onPlayerControlsVisibleChanged: if (playerControlsVisible && page === "player" && !playerIsLive) {
        uninterruptedEpisodes = 0
        uninterruptedMinutes = 0
    }
    property bool playerPaused: false
    property real playbackSpeed: 1.0
    property real playerPositionSeconds: 0
    property real playerDurationSeconds: 0
    property bool trackMenuVisible: false
    property var availableTracks: []
    property bool seriesTracksApplied: false
    property int seriesTrackAttempts: 0
    property bool explicitAudioSelection: false
    property bool explicitSubtitleSelection: false
    property bool sidebarExpanded: true
    property int lastHomeRow: 0
    property int lastHomeCard: 0
    property string lastHomeItemId: ""
    property bool homeCardFocused: false
    property string lastSidebarKey: "Home"
    property bool contextOpen: false
    property var contextItem: ({})
    property bool searchKeyboardOpen: false
    property bool searchSymbols: false
    property string watchlistMode: "personal"
    property string lastWatchlistItemId: ""
    property var playlistTarget: ({})
    property string selectedPlaylistName: ""
    property int tvCategoryBand: 1
    property double tvStartMs: 0
    property string tvRequestedKey: ""
    property var livePreviewChannel: ({})
    property bool livePreviewActive: false
    property bool playerIsLive: false
    property string issueCategory: "noAudio"
    property bool issueReportPending: false
    property var activeSkipSegment: ({})
    property string lastSkipSegmentKey: ""
    property var homeRows: {
        const buckets = {}
        if (familyApi.continueItems.length)
            buckets.continue = [{ title: "Continue Watching", items: familyApi.continueItems }]
        const deck = []
        if (familyApi.groupDeckItems.length)
            deck.push({ title: "The Deck · Watching Together", items: familyApi.groupDeckItems })
        if (familyApi.deckItems.length) deck.push({ title: "The Deck", items: familyApi.deckItems })
        if (deck.length) buckets.deck = deck
        if (familyApi.watchlistItems.length)
            buckets.watchlist = [{ title: "Watchlist", items: familyApi.watchlistItems }]
        const defaults = ["continue", "deck", "watchlist"]
        for (let row of familyApi.libraryRows) {
            const key = familyApi.homeRowIdForLibrary(row.Id)
            if (!key) continue
            defaults.push(key)
            if (row.Items && row.Items.length) buckets[key] = [{ title: row.Name, items: row.Items }]
        }
        const rows = []
        const seen = []
        for (const key of familyApi.homeRowOrder.concat(defaults)) {
            if (seen.includes(key)) continue
            seen.push(key)
            if (familyApi.hiddenHomeRows.includes(key)) continue
            for (const row of (buckets[key] || [])) rows.push(row)
        }
        return rows
    }

    function cycleBackground() {
        const choices = []
        for (const row of familyApi.libraryRows) {
            for (const item of (row.Items || [])) if (item.Id) choices.push(item)
        }
        for (const item of familyApi.continueItems) if (item.Id) choices.push(item)
        for (const item of familyApi.deckItems) if (item.Id) choices.push(item)
        for (const item of familyApi.watchlistItems) if (item.Id) choices.push(item)
        const valid = choices.filter(function(item) { return artworkChoices(item, "backdrop").length > 0 })
        if (!valid.length) return
        const alternatives = valid.filter(function(item) {
            return artworkChoices(item, "backdrop")[0].id !== backgroundRandomId
        })
        const pool = alternatives.length ? alternatives : valid
        backgroundRandomItem = pool[Math.floor(Math.random() * pool.length)]
        backgroundRandomId = artworkChoices(backgroundRandomItem, "backdrop")[0].id
    }

    function safeTitle(item) {
        if (familyApi.kidsSpoilerHidden(item))
            return item.IndexNumber ? "Episode " + item.IndexNumber : "Episode"
        return item.Name || ""
    }

    function episodeNumber(item) {
        if (!item || item.Type !== "Episode") return ""
        const season = Number(item.ParentIndexNumber)
        const episode = Number(item.IndexNumber)
        const hasSeason = item.ParentIndexNumber !== undefined && item.ParentIndexNumber !== null
            && !isNaN(season)
        const hasEpisode = item.IndexNumber !== undefined && item.IndexNumber !== null
            && !isNaN(episode)
        if (hasSeason && hasEpisode)
            return "S" + String(season).padStart(2, "0") + ":E" + String(episode).padStart(2, "0")
        if (hasEpisode) return "Episode " + episode
        return ""
    }

    function homeCardSubtitle(item) {
        if (!item || item.Type !== "Episode") return ""
        const number = episodeNumber(item)
        if (familyApi.kidsSpoilerHidden(item)) return number
        const title = item.Name || ""
        return number && title ? number + " · " + title : number || title
    }

    function detailTitle(item) {
        if (!item) return ""
        if (item.Type !== "Episode") return safeTitle(item)
        return [item.SeriesName || "Show", episodeNumber(item), safeTitle(item)].filter(function(value) {
            return !!value
        }).join(" · ")
    }

    function browseCardTitle(item) {
        if (!item) return ""
        if (item.Type !== "Episode") return item.Name || item.SeriesName || "Video"
        return [item.SeriesName || "Show", episodeNumber(item), safeTitle(item)].filter(function(value) {
            return !!value
        }).join(" · ")
    }

    function episodeListTitle(item) {
        if (!item) return ""
        const parts = [episodeNumber(item), safeTitle(item)]
        const minutes = Math.round(Number(item.RunTimeTicks || 0) / 600000000)
        if (minutes > 0) parts.push(minutes + " min")
        if (item.UserData && item.UserData.Played) parts.push("✓ Watched")
        else if (resumeFraction(item) > 0) parts.push("In progress")
        return parts.filter(function(value) { return !!value }).join("  ·  ")
    }

    function detailMetadata(item) {
        if (!item) return ""
        const parts = []
        const year = Number(item.ProductionYear || 0)
        if (year > 1800) parts.push(String(year))
        const minutes = Math.round(Number(item.RunTimeTicks || 0) / 600000000)
        if (minutes > 0) parts.push(minutes >= 60
            ? Math.floor(minutes / 60) + "h " + String(minutes % 60).padStart(2, "0") + "m"
            : minutes + "m")
        if (item.OfficialRating) parts.push(item.OfficialRating)
        const rating = Number(item.CommunityRating || 0)
        if (rating > 0) parts.push("★ " + rating.toFixed(1))
        if (item.Genres && item.Genres.length) parts.push(item.Genres.slice(0, 3).join(" / "))
        return parts.join("  ·  ")
    }

    function resumeFraction(item) {
        const runtime = Number(item && item.RunTimeTicks || 0)
        const position = Number(item && item.UserData && item.UserData.PlaybackPositionTicks || 0)
        return runtime > 0 && position > 0 ? Math.min(1, Math.max(0, position / runtime)) : 0
    }

    function bedtimeTime(minutes) {
        const hour = Math.floor(minutes / 60)
        const displayHour = hour % 12 || 12
        return displayHour + ":" + String(minutes % 60).padStart(2, "0") + (hour < 12 ? " AM" : " PM")
    }

    function artworkChoices(item, purpose) {
        if (!item || !item.Id) return []
        const choices = []
        function add(id, kind) {
            if (id && !choices.some(function(value) { return value.id === id && value.kind === kind }))
                choices.push({ id: id, kind: kind })
        }
        const tags = item.ImageTags || {}
        const own = item.Id
        const parentBackdrop = item.ParentBackdropItemId || ""
        if (familyApi.kidsSpoilerHidden(item)) {
            if (item.ParentBackdropImageTags && item.ParentBackdropImageTags.length)
                add(parentBackdrop, "Backdrop")
            if (item.SeriesThumbImageTag) add(item.SeriesId, "Thumb")
            if (item.SeriesPrimaryImageTag) add(item.SeriesId, "Primary")
            return choices
        }
        if (purpose === "portrait") {
            // Jellyfin includes cast members without portrait artwork. Do not
            // request images that the server has not advertised.
            if (tags.Primary || item.PrimaryImageTag) add(own, "Primary")
            return choices
        }
        if (purpose === "backdrop") {
            // Match Android's BackgroundService.homeBackgroundArtwork order.
            if (item.BackdropImageTags && item.BackdropImageTags.length) add(own, "Backdrop")
            if (item.ParentBackdropImageTags && item.ParentBackdropImageTags.length)
                add(parentBackdrop, "Backdrop")
            if (tags.Thumb) add(own, "Thumb")
            if (item.SeriesThumbImageTag) add(item.SeriesId, "Thumb")
            if (item.ParentThumbImageTag) add(item.ParentThumbItemId, "Thumb")
            if (tags.Primary && Number(item.PrimaryImageAspectRatio || 0) >= 1.3)
                add(own, "Primary")
        } else {
            // Match the Android wide-card preference: episode still first,
            // followed by the title or parent wide image when available.
            if (item.Type === "Series" && !familyApi.seriesThumbnailsEnabled && tags.Primary)
                add(own, "Primary")
            if (item.Type === "Episode" && tags.Primary) add(own, "Primary")
            if (item.ParentThumbImageTag) add(item.ParentThumbItemId, "Thumb")
            if (item.SeriesThumbImageTag) add(item.SeriesId, "Thumb")
            if (tags.Thumb) add(own, "Thumb")
            if (item.BackdropImageTags && item.BackdropImageTags.length) add(own, "Backdrop")
            if (item.ParentBackdropImageTags && item.ParentBackdropImageTags.length)
                add(parentBackdrop, "Backdrop")
            if (tags.Primary) add(own, "Primary")
        }
        return choices
    }

    component Artwork: Image {
        property var item: ({})
        property string purpose: "card"
        property var candidates: window.artworkChoices(item, purpose)
        property int candidateIndex: 0
        onCandidatesChanged: candidateIndex = 0
        source: candidateIndex < candidates.length
            ? familyApi.imageUrl(candidates[candidateIndex].id, candidates[candidateIndex].kind,
                                 purpose === "backdrop" ? Math.max(1280, window.width) : 640) : ""
        onStatusChanged: if (status === Image.Error && candidateIndex + 1 < candidates.length)
            candidateIndex++
        asynchronous: true
        fillMode: Image.PreserveAspectCrop
        property string watchedBadge: {
            if (purpose !== "card" || !item || !item.Id) return ""
            const mode = familyApi.watchedIndicatorBehavior
            if (mode === "NEVER") return ""
            const usage = item.UserData || {}
            if (usage.Played && (mode !== "EPISODES_ONLY" || item.Type === "Episode")) return "✓"
            const count = Number(usage.UnplayedItemCount || 0)
            if (mode === "ALWAYS" && count > 0 && (item.Type === "Series" || item.Type === "Season"))
                return count > 99 ? "99+" : String(count)
            return ""
        }
        Rectangle {
            visible: parent.watchedBadge.length > 0
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 7
            width: Math.max(27, badgeText.implicitWidth + 14)
            height: 27
            radius: 14
            color: familyApi.themeAccent
            Text {
                id: badgeText
                anchors.centerIn: parent
                text: parent.parent.watchedBadge
                color: familyApi.themeOnAccent
                font.pixelSize: 14
                font.bold: true
            }
        }
    }

    function showItem(item, returnPage) {
        focusedItem = item
        detailReturnPage = returnPage || "home"
        familyApi.refreshSeriesPlaybackPreferences(item.Type === "Series" ? (item.Id || "")
            : item.Type === "Episode" ? (item.SeriesId || "") : "")
        familyApi.openItem(item.Id || "")
        page = "detail"
    }

    function openContext(item) {
        if (!item || !item.Id) return
        contextItem = item
        focusedItem = item
        contextOpen = true
        Qt.callLater(function() { contextDetails.forceActiveFocus() })
    }

    function closeContext() {
        contextOpen = false
        if (page === "home") Qt.callLater(window.focusHomeItem)
    }

    function typeSearchKey(key) {
        if (key === "123" || key === "ABC") {
            searchSymbols = key === "123"
            Qt.callLater(function() { searchKeyRepeater.itemAt(0).forceActiveFocus() })
        } else if (key === "Done") {
            searchKeyboardOpen = false
            searchDelay.stop()
            familyApi.search(searchInput.text)
            Qt.callLater(function() {
                if (familyApi.searchResults.length) searchGrid.forceActiveFocus()
                else searchInput.forceActiveFocus()
            })
        } else if (key === "Back") searchInput.text = searchInput.text.slice(0, -1)
        else searchInput.text += key === "Space" ? " " : key
    }

    function playbackTime(seconds) {
        const safe = Math.max(0, Math.floor(Number(seconds) || 0))
        const hours = Math.floor(safe / 3600)
        const minutes = Math.floor((safe % 3600) / 60)
        const remainder = safe % 60
        return hours > 0
            ? hours + ":" + String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0")
            : minutes + ":" + String(remainder).padStart(2, "0")
    }

    function focusPlayerSeek() {
        if (playbackSeek.visible && playbackSeek.enabled) playbackSeek.forceActiveFocus()
        else playerPanel.forceActiveFocus()
    }

    function playerControlsHaveFocus() {
        if (playbackSeek.activeFocus) return true
        for (const item of playerControlsRow.children) if (item.activeFocus) return true
        return false
    }

    function showSeason(season) {
        if (familyApi.selectedItem.Type !== "Series") return
        selectedSeries = familyApi.selectedItem
        selectedSeason = season
        familyApi.openSeason(season.Id || "")
        page = "season"
    }

    function watchlistOfType(type) {
        const entries = watchlistMode === "household" ? familyApi.householdWatchlistEntries : familyApi.watchlistEntries
        const resolved = watchlistMode === "household" ? familyApi.householdWatchlistItems : familyApi.watchlistItems
        const result = []
        for (const entry of entries) {
            if (entry.itemType !== type) continue
            const item = resolved.find(function(candidate) {
                return String(candidate.Id || "").replace(/-/g, "").toLowerCase()
                    === String(entry.itemId || "").replace(/-/g, "").toLowerCase()
            })
            result.push(item || { Id: entry.itemId, Name: entry.title,
                Type: type === "series" ? "Series" : "Movie" })
        }
        return result
    }

    function focusWatchlistChoice() {
        if (page !== "watchlist" || watchlistBackButton.activeFocus
            || watchlistPersonalButton.activeFocus || watchlistHouseholdButton.activeFocus) return
        let first = null
        for (const repeater of [movieWatchlistRepeater, showWatchlistRepeater]) {
            for (let index = 0; index < repeater.count; ++index) {
                const card = repeater.itemAt(index)
                if (!card) continue
                if (card.activeFocus) return
                if (!first) first = card
                if (String(card.modelData.Id || "").replace(/-/g, "").toLowerCase()
                    === lastWatchlistItemId.replace(/-/g, "").toLowerCase()) first = card
            }
        }
        if (first) first.forceActiveFocus()
        else watchlistBackButton.forceActiveFocus()
    }

    function householdEntry(itemId) {
        for (const entry of familyApi.householdWatchlistEntries) {
            if (String(entry.itemId || "").replace(/-/g, "").toLowerCase()
                === String(itemId || "").replace(/-/g, "").toLowerCase()) return entry
        }
        return null
    }

    function pickFamilyNight() {
        let pool = familyNightMatches.filter(function(item) { return item.Id !== familyNightPick.Id })
        if (!pool.length) pool = familyNightMatches
        familyNightPick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : ({})
    }

    function playSelected(startOver) {
        playbackQueue = []
        playbackQueueIndex = -1
        if (familyApi.selectedItem.Type === "Series") {
            pendingSeriesPlayId = familyApi.selectedItem.Id || ""
            familyApi.resolveFirstUnwatchedEpisode(pendingSeriesPlayId)
            return
        }
        playItem(familyApi.selectedItem, "detail", false, !!startOver)
    }

    function setSleepTimer(minutes) {
        sleepDeadlineMs = minutes > 0 ? Date.now() + minutes * 60000 : 0
        notice = minutes > 0 ? "Sleep timer set for " + minutes + " minutes" : "Sleep timer turned off"
        noticeTimer.restart()
    }

    function expireSleepTimer() {
        sleepDeadlineMs = 0
        if (page === "player" && !playerIsLive)
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
        const wasPlaying = page === "player" || livePreviewActive
        if (wasPlaying) {
            playerPositionSeconds = Number(components.player.getPosition()) / 1000
            playbackQueue = []
            playbackQueueIndex = -1
            livePreviewActive = false
            page = playerIsLive ? "liveTv" : playbackReturnPage
            playerIsLive = false
            components.player.stop()
        }
        notice = "Sleep timer ended playback"
        noticeTimer.restart()
    }

    function playPlaylistFrom(startIndex) {
        const playable = familyApi.playlistItems.filter(function(item) {
            return item.Type === "Movie" || item.Type === "Episode" || item.Type === "Video"
        })
        if (!playable.length) { notice = "This playlist has no playable videos"; noticeTimer.restart(); return }
        playbackQueue = playable
        playbackQueueIndex = Math.max(0, Math.min(startIndex, playable.length - 1))
        kidsQueuedEpisodes = 0
        const item = playbackQueue[playbackQueueIndex]
        familyApi.openItem(item.Id)
        playItem(item, "playlist")
    }

    function renameSelectedPlaylist() {
        const name = playlistNameInput.text.trim()
        if (!name) { notice = "Enter a playlist name"; noticeTimer.restart(); return }
        selectedPlaylistName = name
        familyApi.renamePlaylist(familyApi.selectedPlaylistId, name)
    }

    function createNamedPlaylist() {
        const name = newPlaylistName.text.trim()
        if (!name) { notice = "Enter a playlist name"; noticeTimer.restart(); return }
        if (page === "playlistPicker") {
            familyApi.createPlaylistAndAdd(name, playlistTarget)
            page = "detail"
        } else familyApi.createPlaylist(name)
        newPlaylistName.clear()
    }

    function playItem(item, returnPage, automatic, startOver) {
        if (!item.Id || item.Type === "Series" || item.Type === "Season") return
        if (!automatic) {
            uninterruptedEpisodes = 0
            uninterruptedMinutes = 0
        }
        if (!familyApi.kidsPlaybackAllowed()) {
            notice = "Playback is paused for bedtime until " + bedtimeTime(familyApi.kidsBedtimeEnd) + "."
            noticeTimer.restart()
            return
        }
        const stream = familyApi.streamUrl(item.Id)
        if (!stream) return
        const savedPosition = Number(item.UserData && item.UserData.PlaybackPositionTicks || 0) / 10000
        const resume = startOver ? 0 : Math.max(0, savedPosition - familyApi.resumePrerollSeconds * 1000)
        const metadata = { type: "video", metadata: item,
            headers: { "User-Agent": "FamilyFlixWindows" }, media: {} }
        components.player.setPlaybackRate(Math.round(playbackSpeed * 1000))
        if (components.player.load(stream, { autoplay: true, startMilliseconds: resume }, metadata, 1, -1)) {
            if (!automatic && playbackQueueIndex < 0) kidsQueuedEpisodes = 0
            if (item.Type === "Episode") kidsQueuedEpisodes++
            playingItem = item
            playerDurationSeconds = 0
            playbackReturnPage = returnPage || "detail"
            playerIsLive = false
            activeSkipSegment = ({})
            lastSkipSegmentKey = ""
            seriesTracksApplied = false
            seriesTrackAttempts = 0
            explicitAudioSelection = false
            explicitSubtitleSelection = false
            familyApi.refreshSeriesPlaybackPreferences(item.Type === "Episode" ? (item.SeriesId || "") : "")
            familyApi.refreshMediaSegments(item.Id)
            page = "player"
        }
    }

    function openLiveTv() {
        tvStartMs = Math.floor(Date.now() / 1800000) * 1800000
        tvRequestedKey = ""
        tvCategoryBand = 1
        familyApi.refreshLiveTv()
        page = "liveTv"
    }

    function requestTvGuide() {
        if (familyApi.tvChannels.length === 0) return
        const key = tvCategoryBand + ":" + tvStartMs
        if (tvRequestedKey === key) return
        tvRequestedKey = key
        familyApi.refreshTvGuide(tvCategoryBand, new Date(tvStartMs))
    }

    function selectLiveChannel(channel) {
        if (!channel.Id) return
        if (!familyApi.kidsPlaybackAllowed()) {
            notice = "Playback is paused for bedtime until 7:00 AM."
            noticeTimer.restart()
            return
        }
        if (livePreviewActive && livePreviewChannel.Id === channel.Id) {
            page = "player"
            return
        }
        const stream = familyApi.streamUrl(channel.Id)
        if (!stream) return
        const metadata = { type: "video", metadata: channel,
            headers: { "User-Agent": "FamilyFlixWindows" }, media: {} }
        components.player.setPlaybackRate(1000)
        if (components.player.load(stream, { autoplay: true }, metadata, 1, -1)) {
            playerIsLive = true
            livePreviewChannel = channel
            livePreviewActive = true
        }
    }

    function goBack() {
        if (contextOpen) { closeContext(); return }
        if (page === "player") {
            if (playerIsLive) {
                page = "liveTv"
                return
            }
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            components.player.stop()
            playbackQueue = []
            playbackQueueIndex = -1
            page = playbackReturnPage
        } else if (page === "detail") {
            page = detailReturnPage
            if (page === "home") Qt.callLater(window.focusHomeItem)
        } else if (page === "season") {
            familyApi.openItem(selectedSeries.Id || "")
            page = "detail"
        } else if (page === "nextEpisode") {
            autoNextPending = false
            page = playbackReturnPage
        } else if (page === "playlistPicker") {
            page = "detail"
        } else if (page === "playlist") {
            page = "playlists"
        } else if (page === "liveTv") {
            if (livePreviewActive) components.player.stop()
            livePreviewActive = false
            playerIsLive = false
            page = "home"
        } else if (page === "skipSettings") {
            page = "settings"
        } else if (page === "seriesOptions") {
            page = "detail"
        } else if (page === "bufferSettings") {
            page = "settings"
        } else if (page === "issueReport") {
            page = "detail"
        } else if (page === "watchTogether") {
            page = "profile"
        } else if (page === "coWatchPresets") {
            page = "profile"
        } else if (page === "kidsSettings") {
            page = "profile"
        } else if (page === "parentPin") {
            page = "home"
        } else if (page !== "home" && familyApi.signedIn) {
            page = "home"
        }
    }

    function checkSkipSegment() {
        if (page !== "player" || playerIsLive || playerPaused) return
        const position = components.player.getPosition() * 1000
        if (activeSkipSegment.Key
            && (position < activeSkipSegment.Start || position >= activeSkipSegment.End)) {
            activeSkipSegment = ({})
            lastSkipSegmentKey = ""
        }
        for (const segment of familyApi.mediaSegments) {
            const start = Number(segment.StartTicks || 0) / 10000
            const end = Number(segment.EndTicks || 0) / 10000
            if (position < start || position >= end) continue
            const type = String(segment.Type || "")
            const action = familyApi.mediaSegmentAction(type)
            const minimum = action === "Ask" ? 3000 : 1000
            if (action === "Off" || end - start < minimum) continue
            const key = type + ":" + start + ":" + end
            if (lastSkipSegmentKey === key) return
            lastSkipSegmentKey = key
            if (action === "Auto") {
                components.player.seekTo(end)
                return
            }
            activeSkipSegment = { Type: type, Start: start, End: end, Key: key }
            return
        }
    }

    function applySeriesTracks() {
        if (page !== "player" || playingItem.Type !== "Episode"
            || !familyApi.activeSeriesPreferencesReady || seriesTracksApplied) return
        const tracks = components.player.getPlaybackTracks()
        if (!tracks.length) {
            seriesTrackAttempts++
            return
        }
        const prefs = familyApi.activeSeriesPlaybackValues
        if (!explicitAudioSelection && prefs.audioMode !== "SERVER_DEFAULT"
            && prefs.preferredAudioLanguage) {
            const audio = tracks.find(function(track) {
                return track.type === "audio"
                    && String(track.lang || "").toLowerCase() === String(prefs.preferredAudioLanguage).toLowerCase()
            })
            if (audio) components.player.setAudioStream(Number(audio.id))
        }
        if (!explicitSubtitleSelection && prefs.subtitleMode !== "SERVER_DEFAULT") {
            const language = String(prefs.preferredSubtitleLanguage || "").toLowerCase()
            const matches = tracks.filter(function(track) {
                return track.type === "sub" && (!language || String(track.lang || "").toLowerCase() === language)
            })
            if (prefs.subtitleMode === "OFF") components.player.setSubtitleStream(-1)
            else if (prefs.subtitleMode === "FORCED_ONLY") {
                const forced = matches.find(function(track) { return track.forced === true })
                components.player.setSubtitleStream(forced ? Number(forced.id) : -1)
            } else if (prefs.subtitleMode === "FULL") {
                const full = matches.find(function(track) { return track.forced !== true }) || matches[0]
                components.player.setSubtitleStream(full ? Number(full.id) : -1)
            }
        }
        seriesTracksApplied = true
    }

    onPageChanged: {
        contextOpen = false
        if (page !== "home" && page !== "detail" && page !== "season"
            && page !== "nextEpisode" && page !== "player") focusedItem = ({})
        if (page === "player") {
            playerControlsVisible = false
            playerPaused = false
            trackMenuVisible = false
            availableTracks = []
            playerPanel.forceActiveFocus()
        } else if (page === "home") {
            Qt.callLater(function() {
                if (window.homeCardFocused && window.lastHomeItemId) window.focusHomeItem()
                else window.focusSidebarChoice()
            })
        } else if (page === "login" || page === "profile") {
            Qt.callLater(window.focusLoginChoice)
        } else if (page === "allLibraries") {
            Qt.callLater(function() { librariesGrid.forceActiveFocus() })
        } else if (page === "libraryBrowse") {
            Qt.callLater(function() { libraryItemsGrid.forceActiveFocus() })
        } else if (page === "seriesOptions") {
            Qt.callLater(function() { seriesOptionsBack.forceActiveFocus() })
        } else if (page === "watchlist") {
            Qt.callLater(window.focusWatchlistChoice)
        } else if (page === "search") {
            if (!searchInput.text && !familyApi.searchResults.length) {
                searchKeyboardOpen = true
                searchSymbols = false
            }
            Qt.callLater(function() {
                if (familyApi.searchResults.length) searchGrid.forceActiveFocus()
                else searchInput.forceActiveFocus()
            })
        } else {
            Qt.callLater(window.focusPageStart)
        }
    }

    function focusPageStart() {
        const first = {
            coWatchPresets: presetsBackButton,
            parentPin: parentPinInput,
            kidsSettings: kidsModeButton,
            watchTogether: watchTogetherBackButton,
            watchlist: watchlistBackButton,
            familyNight: familyNightBackButton,
            settings: settingsBackButton,
            bufferSettings: bufferBackButton,
            skipSettings: skipBackButton,
            liveTv: liveBackButton,
            playlists: playlistsBackButton,
            playlistPicker: playlistsBackButton,
            playlist: playlistBackButton,
            detail: detailBackButton,
            issueReport: issueCancelButton,
            nextEpisode: nextEpisodeDoneButton,
            season: seasonBackButton
        }[page]
        if (first && first.visible && first.enabled) first.forceActiveFocus()
    }

    function scrollToSection(name) {
        for (let section of rowColumn.children) {
            if (section.sectionTitle === name) {
                homeScroll.contentY = Math.max(0, section.y)
                return
            }
        }
    }

    function focusCard(rowIndex, cardIndex) {
        const row = rowRepeater.itemAt(rowIndex)
        if (!row) return
        const card = row.cardAt(cardIndex)
        if (!card) return
        homeScroll.contentY = Math.max(0, row.y - 12)
        card.forceActiveFocus()
    }

    function focusHomeItem() {
        for (let rowIndex = 0; rowIndex < homeRows.length; ++rowIndex) {
            const list = homeRows[rowIndex].items || []
            for (let cardIndex = 0; cardIndex < list.length; ++cardIndex) {
                if (list[cardIndex].Id === lastHomeItemId) {
                    focusCard(rowIndex, cardIndex)
                    return
                }
            }
        }
        focusCard(lastHomeRow, lastHomeCard)
    }

    function focusSidebarChoice() {
        for (const item of sidebarColumn.children) {
            if (item && item.sidebarKey === lastSidebarKey && item.visible) {
                item.forceActiveFocus()
                return
            }
        }
        homeButton.forceActiveFocus()
    }

    function focusLoginChoice() {
        if (page !== "login" && page !== "profile") return
        if (chosenUser) { password.forceActiveFocus(); return }
        const first = userRepeater.itemAt(0)
        if (first) first.forceActiveFocus()
        else if (page === "profile") profileBackButton.forceActiveFocus()
    }

    Component.onCompleted: {
        applyPlayerZoom()
        if (page === "home") Qt.callLater(window.focusSidebarChoice)
        else if (page === "login") Qt.callLater(window.focusLoginChoice)
        if (familyApi.signedIn) {
            familyApi.refreshHome()
            familyApi.refreshWatchlist()
            familyApi.refreshHouseholdWatchlist()
        }
        else familyApi.refreshPublicUsers()
    }
    function applyPlayerZoom() {
        const aspect = familyApi.playerZoomMode === "AUTO_CROP" ? "zoom"
            : familyApi.playerZoomMode === "STRETCH" ? "stretch" : "fit"
        components.settings.setValue("video", "aspect", aspect)
    }
    function shouldAskStillWatching() {
        const mode = familyApi.stillWatchingBehavior
        if (mode === "DISABLED") return false
        const episodeLimits = { SHORT: 2, DEFAULT: 3, LONG: 5, VERY_LONG: 8 }
        const minuteLimits = { SHORT: 60, DEFAULT: 90, LONG: 150, VERY_LONG: 240 }
        return uninterruptedEpisodes >= episodeLimits[mode]
            || uninterruptedMinutes >= minuteLimits[mode]
    }
    Shortcut { sequence: "Esc"; onActivated: window.goBack() }
    Shortcut { sequence: "Backspace"; onActivated: window.goBack() }
    Shortcut { sequence: "F11"; onActivated: window.visibility = window.visibility === Window.FullScreen ? Window.Windowed : Window.FullScreen }

    Connections {
        target: familyApi
        function onSessionChanged() {
            window.uninterruptedEpisodes = 0
            window.uninterruptedMinutes = 0
            window.issueReportPending = false
            window.pendingSeriesPlayId = ""
            searchInput.clear()
            window.searchKeyboardOpen = false
            window.searchSymbols = false
            window.autoNextPending = false
            window.stillWatchingPrompt = false
            window.playbackQueue = []
            window.playbackQueueIndex = -1
            window.playbackSpeed = 1.0
            window.sleepDeadlineMs = 0
            window.chosenUser = ""
            password.clear()
            window.page = familyApi.signedIn ? "home" : "login"
        }
        function onPlayerZoomModeChanged() { window.applyPlayerZoom() }
        function onPublicUsersChanged() { Qt.callLater(window.focusLoginChoice) }
        function onErrorOccurred(message) {
            window.notice = message
            noticeTimer.restart()
        }
        function onSeriesPlaybackPreferencesChanged() {
            if (window.page === "player" && window.playingItem.Type === "Episode") {
                window.seriesTracksApplied = false
                window.seriesTrackAttempts = 0
                Qt.callLater(window.applySeriesTracks)
            }
        }
        function onIssueReportFinished(success, message) {
            window.issueReportPending = false
            window.notice = message
            noticeTimer.restart()
            if (success) {
                issueNote.clear()
                window.page = "detail"
            }
        }
        function onCoWatchChanged() {
            if (window.chosenCoWatchUser.Id && familyApi.hasSavedProfile(window.chosenCoWatchUser.Id)) {
                window.chosenCoWatchUser = ({})
                coWatchPassword.clear()
            }
        }
        function onFirstUnwatchedEpisodeReady(seriesId, episode) {
            if (window.page === "familyNight" && window.familyNightPick.Id === seriesId)
                window.playItem(episode, "familyNight")
            else if (window.page === "detail" && window.pendingSeriesPlayId === seriesId
                     && familyApi.selectedItem.Id === seriesId) {
                window.pendingSeriesPlayId = ""
                familyApi.openItem(episode.Id)
                window.playItem(episode, "detail")
            }
        }
        function onPlayableItemReady(itemId, item) {
            if (window.page !== "familyNight" || window.pendingFamilyNightId !== itemId
                || window.familyNightPick.Id !== itemId) return
            window.pendingFamilyNightId = ""
            window.playItem(item, "familyNight")
        }
        function onNextEpisodeReady(episode) {
            if (window.page !== "nextEpisode") return
            if (!episode.Id) {
                window.autoNextPending = false
                window.nextUpDeadlineMs = 0
                window.page = window.playbackReturnPage
                return
            }
            window.nextEpisode = episode
            if (window.autoNextPending) {
                window.autoNextPending = false
                familyApi.openItem(episode.Id)
                window.playItem(episode, "detail", true)
            } else if (!window.stillWatchingPrompt && !window.nextUpAutoBlocked
                       && familyApi.nextUpTimeoutMs > 0 && familyApi.nextUpMode !== "Off"
                       && familyApi.mediaQueuingEnabled) {
                window.nextUpDeadlineMs = Date.now() + familyApi.nextUpTimeoutMs
                window.nextUpSecondsRemaining = Math.ceil(familyApi.nextUpTimeoutMs / 1000)
            }
        }
        function onLiveTvChanged() {
            if (window.page !== "liveTv") return
            if (familyApi.tvCategories.length) {
                let bandAvailable = false
                for (const category of familyApi.tvCategories) {
                    if (Number(category.band) === window.tvCategoryBand) bandAvailable = true
                }
                if (!bandAvailable) window.tvCategoryBand = Number(familyApi.tvCategories[0].band)
            }
            window.requestTvGuide()
        }
        function onHomeChanged() {
            if (!window.backgroundRandomId) Qt.callLater(window.cycleBackground)
            if (window.page === "home" && window.homeCardFocused)
                Qt.callLater(window.focusHomeItem)
        }
        function onWatchlistChanged() {
            if (!window.backgroundRandomId) Qt.callLater(window.cycleBackground)
            if (window.page === "home" && window.homeCardFocused)
                Qt.callLater(window.focusHomeItem)
            if (window.page === "watchlist") Qt.callLater(window.focusWatchlistChoice)
        }
    }
    Connections {
        target: components.player
        function onPlaying() {
            if (window.page === "player" && !window.playerIsLive) {
                window.playerPaused = false
                familyApi.reportPlaybackStart(window.playingItem, components.player.getPosition() * 1000)
                Qt.callLater(window.applySeriesTracks)
            }
        }
        function onPositionChanged(positionMs) {
            if (window.page === "player") window.playerPositionSeconds = Number(positionMs) / 1000
        }
        function onUpdateDuration(milliseconds) {
            if (window.page === "player") window.playerDurationSeconds = Number(milliseconds) / 1000
        }
        function onPaused() {
            if (window.page === "player" && !window.playerIsLive) {
                window.playerPaused = true
                familyApi.reportPlaybackProgress(components.player.getPosition() * 1000, true)
            }
        }
        function onFinished() {
            if (window.playerIsLive) {
                window.livePreviewActive = false
                if (window.page === "player") window.page = "liveTv"
                return
            }
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            if (window.playingItem.Type === "Episode") {
                window.uninterruptedEpisodes++
                window.uninterruptedMinutes += window.playerDurationSeconds / 60
            }
            if (window.playbackQueueIndex >= 0) {
                const nextIndex = window.playbackQueueIndex + 1
                const nextItem = window.playbackQueue[nextIndex]
                const limitReached = familyApi.kidsModeEnabled && familyApi.kidsEpisodeLimit > 0
                    && window.kidsQueuedEpisodes >= familyApi.kidsEpisodeLimit
                    && nextItem && nextItem.Type === "Episode"
                if (nextItem && !limitReached) {
                    window.playbackQueueIndex = nextIndex
                    familyApi.openItem(nextItem.Id)
                    window.playItem(nextItem, "playlist", true)
                    return
                }
                window.playbackQueue = []
                window.playbackQueueIndex = -1
                if (limitReached) { window.notice = "Kids Mode episode limit reached"; noticeTimer.restart() }
                familyApi.openPlaylist(familyApi.selectedPlaylistId)
                window.page = "playlist"
            } else if (window.playingItem.Type === "Episode" && familyApi.mediaQueuingEnabled
                       && familyApi.activeSeriesAutoplayMode !== "STOP_AFTER_EPISODE"
                       && (familyApi.activeSeriesAutoplayMode === "PLAY_NEXT" || familyApi.nextUpMode !== "Off")) {
                const limitReached = familyApi.kidsModeEnabled && familyApi.kidsEpisodeLimit > 0
                    && window.kidsQueuedEpisodes >= familyApi.kidsEpisodeLimit
                window.nextEpisode = ({})
                window.nextUpDeadlineMs = 0
                window.nextUpAutoBlocked = limitReached
                window.stillWatchingPrompt = !limitReached && window.shouldAskStillWatching()
                window.autoNextPending = familyApi.activeSeriesAutoplayMode === "PLAY_NEXT"
                    && !limitReached && !window.stillWatchingPrompt
                if (limitReached) { window.notice = "Kids Mode automatic-next limit reached"; noticeTimer.restart() }
                window.page = "nextEpisode"
                familyApi.resolveNextEpisode(window.playingItem)
            } else window.page = window.playbackReturnPage
        }
        function onCanceled() {
            if (window.playerIsLive) { window.livePreviewActive = false; return }
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            window.autoNextPending = false
            window.playbackQueue = []
            window.playbackQueueIndex = -1
            window.page = window.playbackReturnPage
        }
        function onError(message) {
            if (window.playerIsLive) {
                window.livePreviewActive = false
                window.notice = message
                if (window.page === "player") window.page = "liveTv"
                return
            }
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            window.autoNextPending = false
            window.playbackQueue = []
            window.playbackQueueIndex = -1
            window.notice = message
            window.page = window.playbackReturnPage
        }
    }
    Timer {
        interval: 10000
        repeat: true
        running: window.page === "player"
        onTriggered: if (!window.playerIsLive) familyApi.reportPlaybackProgress(components.player.getPosition() * 1000, false)
    }
    Timer { id: noticeTimer; interval: 6000; onTriggered: window.notice = "" }
    Timer {
        interval: 250; repeat: true
        running: window.page === "nextEpisode" && window.nextUpDeadlineMs > 0
        onTriggered: {
            window.nextUpSecondsRemaining = Math.max(0, Math.ceil((window.nextUpDeadlineMs - Date.now()) / 1000))
            if (Date.now() < window.nextUpDeadlineMs || !window.nextEpisode.Id) return
            window.nextUpDeadlineMs = 0
            familyApi.openItem(window.nextEpisode.Id)
            window.playItem(window.nextEpisode, "detail", true)
        }
    }
    Timer {
        id: controlsTimer
        interval: 6000
        onTriggered: {
            if (window.playerControlsHaveFocus()) restart()
            else window.playerControlsVisible = false
        }
    }
    Timer { interval: 500; repeat: true; running: window.page === "player" && !window.playerIsLive; onTriggered: window.checkSkipSegment() }
    Timer {
        interval: 500; repeat: true
        running: window.page === "player" && window.playingItem.Type === "Episode"
            && !window.seriesTracksApplied && window.seriesTrackAttempts < 10
        onTriggered: window.applySeriesTracks()
    }
    Timer {
        interval: 1000; repeat: true; running: window.sleepDeadlineMs > 0
        onTriggered: {
            window.sleepMinutesRemaining = Math.max(0, Math.ceil((window.sleepDeadlineMs - Date.now()) / 60000))
            if (Date.now() >= window.sleepDeadlineMs) window.expireSleepTimer()
        }
    }
    Timer { interval: 20000; running: true; repeat: false; onTriggered: familyApi.checkWindowsUpdate(false) }
    Timer {
        interval: 60000; repeat: true
        running: window.page === "player" && familyApi.kidsModeEnabled
        onTriggered: if (!familyApi.kidsPlaybackAllowed()) {
            if (!window.playerIsLive) familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            components.player.stop()
            window.page = window.playerIsLive ? "liveTv" : window.playbackReturnPage
            window.notice = "Bedtime reached. Playback stopped until " + window.bedtimeTime(familyApi.kidsBedtimeEnd) + "."
            noticeTimer.restart()
        }
    }
    Timer { interval: 60000; repeat: true; running: window.page !== "player"; onTriggered: window.cycleBackground() }

    // The desktop shell and cards are Qt Quick controls, not the Jellyfin web client.
    Artwork {
        id: pageBackdrop
        anchors.fill: parent
        purpose: "backdrop"
        item: page === "detail"
            ? (familyApi.selectedItem.Id === focusedItem.Id ? familyApi.selectedItem : focusedItem)
            : (page === "season" && selectedSeries.Id ? selectedSeries
            : (page === "nextEpisode" && nextEpisode.Id ? nextEpisode
            : (focusedItem.Id ? focusedItem : backgroundRandomItem)))
        opacity: page === "player" || !familyApi.backdropEnabled ? 0 : 0.65
    }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: familyApi.themeAccentSecondary }
            GradientStop { position: 1; color: familyApi.themeScreen }
        }
        opacity: 0.50
        visible: page !== "player"
    }
    Text {
        z: 50
        anchors.top: parent.top
        anchors.topMargin: 22
        anchors.horizontalCenter: parent.horizontalCenter
        visible: page !== "home" && page !== "liveTv" && page !== "player" && page !== "login"
            && (familyApi.clockBehavior === "ALWAYS" || familyApi.clockBehavior === "IN_MENUS")
        text: Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP")
        color: familyApi.themeText
        font.pixelSize: 18
        Timer { interval: 30000; running: parent.visible; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP") }
    }

    MpvVideoItem {
        id: video
        objectName: "video"
        x: page === "liveTv" ? 220 : 0
        y: page === "liveTv" ? 84 : 0
        width: page === "liveTv" ? 270 : window.width
        height: page === "liveTv" ? 150 : window.height
        visible: page === "player" || (page === "liveTv" && livePreviewActive)
    }

    Item {
        anchors.fill: parent
        visible: page === "login" || page === "profile"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 120, 800)
            spacing: 28
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "Family Flix"
                color: "white"
                font.pixelSize: 46
                font.bold: true
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: chosenUser ? "Welcome, " + chosenUser : "Who's watching?"
                color: "#e2e8ef"
                font.pixelSize: 25
            }
            Flow {
                width: parent.width
                spacing: 12
                visible: !chosenUser
                Repeater {
                    id: userRepeater
                    model: familyApi.publicUsers
                    NativeAction {
                        width: 175
                        height: 90
                        text: modelData.Name || "User"
                        onClicked: {
                            chosenUser = modelData.Name || ""
                            if (familyApi.hasSavedProfile(modelData.Id || ""))
                                familyApi.useSavedProfile(modelData.Id)
                            else password.forceActiveFocus()
                        }
                    }
                }
            }
            TextField {
                id: password
                width: parent.width
                height: 54
                visible: !!chosenUser
                echoMode: TextInput.Password
                placeholderText: "Password (leave blank if none)"
                font.pixelSize: 20
                onAccepted: familyApi.signIn(chosenUser, text)
            }
            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12
                visible: !!chosenUser
                NativeAction { text: "Back"; onClicked: { chosenUser = ""; password.clear() } }
                NativeAction { text: "Sign in"; onClicked: familyApi.signIn(chosenUser, password.text) }
            }
            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12
                visible: page === "profile" && !chosenUser
                NativeAction { id: profileBackButton; text: "Back to Home"; onClicked: page = "home" }
                NativeAction { text: "Sign out"; onClicked: familyApi.signOut() }
                NativeAction { text: "Kids Mode"; onClicked: page = "kidsSettings" }
            }
            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12
                visible: page === "profile" && !chosenUser
                NativeAction {
                    width: 205
                    text: familyApi.watchingTogether ? "Manage Watching Together" : "Watch Together"
                    onClicked: { window.chosenCoWatchUser = ({}); page = "watchTogether" }
                }
                NativeAction {
                    width: 220
                    visible: familyApi.watchingTogether
                    text: "Stop Watching Together"
                    onClicked: { familyApi.stopWatchingTogether(); page = "home" }
                }
                NativeAction {
                    width: 170
                    text: "Party presets"
                    onClicked: { familyApi.refreshCoWatchPresets(); page = "coWatchPresets" }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "coWatchPresets"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 800)
            spacing: 17
            Row {
                spacing: 12
                NativeAction { id: presetsBackButton; width: 120; text: "← Profiles"; onClicked: window.goBack() }
                Text { text: "Watching Together presets"; color: familyApi.themeText; font.pixelSize: 29; font.bold: true; height: 48; verticalAlignment: Text.AlignVCenter }
            }
            Text { text: "Presets are saved to your Jellyfin profile and shared with the Android app."; color: familyApi.themeText; font.pixelSize: 17; wrapMode: Text.WordWrap; width: parent.width }
            Row {
                spacing: 12
                TextField { id: coWatchPresetName; width: 400; height: 48; placeholderText: "Name this party"; font.pixelSize: 18 }
                NativeAction {
                    width: 175
                    text: "Save current party"
                    visible: familyApi.watchingTogether
                    onClicked: familyApi.saveCoWatchPreset(coWatchPresetName.text)
                }
            }
            Text { text: familyApi.coWatchPresets.length ? "Choose a preset to start watching together:" : "No presets saved yet."; color: familyApi.themeText; font.pixelSize: 19 }
            ScrollView {
                width: parent.width
                height: Math.min(470, window.height - 300)
                Column {
                    width: Math.min(window.width - 100, 800)
                    spacing: 9
                    Repeater {
                        model: familyApi.coWatchPresets
                        Row {
                            required property var modelData
                            spacing: 12
                            NativeAction {
                                width: 560
                                height: 57
                                text: modelData.name || "Party"
                                onClicked: if (familyApi.activateCoWatchPreset(modelData.id)) page = "home"
                            }
                            NativeAction {
                                width: 100
                                height: 57
                                text: "Delete"
                                onClicked: familyApi.deleteCoWatchPreset(modelData.id)
                            }
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "parentPin"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 560)
            spacing: 16
            Text { text: "Parent PIN"; color: familyApi.themeText; font.pixelSize: 32; font.bold: true }
            Text { text: "Enter the PIN to change profiles or Kids Mode settings."; color: familyApi.themeText; font.pixelSize: 17 }
            TextField {
                id: parentPinInput
                width: parent.width; height: 54
                echoMode: TextInput.Password
                inputMethodHints: Qt.ImhDigitsOnly
                placeholderText: "4–8 digit PIN"
                onAccepted: {
                    if (familyApi.verifyKidsPin(text)) {
                        clear()
                        familyApi.refreshPublicUsers()
                        page = "profile"
                    } else { window.notice = "Incorrect parent PIN"; noticeTimer.restart(); clear() }
                }
            }
            Row {
                spacing: 12
                NativeAction { text: "Cancel"; onClicked: window.goBack() }
                NativeAction {
                    text: "Continue"
                    onClicked: {
                        if (familyApi.verifyKidsPin(parentPinInput.text)) {
                            parentPinInput.clear()
                            familyApi.refreshPublicUsers()
                            page = "profile"
                        } else { window.notice = "Incorrect parent PIN"; noticeTimer.restart(); parentPinInput.clear() }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "kidsSettings"
        ScrollView {
            anchors.fill: parent
            anchors.margins: 40
            Column {
            width: Math.min(window.width - 100, 700)
            spacing: 12
            Text { text: "Kids Mode · " + familyApi.userName; color: familyApi.themeText; font.pixelSize: 31; font.bold: true }
            Text { text: "These settings stay with this Windows profile between updates."; color: familyApi.themeText; font.pixelSize: 17 }
            NativeAction { id: kidsModeButton; width: parent.width; text: "Kids Mode: " + (familyApi.kidsModeEnabled ? "On" : "Off"); onClicked: familyApi.setKidsModeEnabled(!familyApi.kidsModeEnabled) }
            NativeAction { width: parent.width; text: "Hide unwatched episode spoilers: " + (familyApi.kidsHideSpoilers ? "On" : "Off"); onClicked: familyApi.setKidsHideSpoilers(!familyApi.kidsHideSpoilers) }
            NativeAction { width: parent.width; text: "Episodes before automatic next stops: " + (familyApi.kidsEpisodeLimit || "Unlimited"); onClicked: familyApi.cycleKidsEpisodeLimit() }
            Text {
                text: "Sleep timer: " + (window.sleepDeadlineMs > 0 ? window.sleepMinutesRemaining + " minutes remaining" : "Off")
                color: familyApi.themeText; font.pixelSize: 19
            }
            Flow {
                width: parent.width; spacing: 8
                Repeater {
                    model: [0, 30, 60, 90, 120]
                    NativeAction {
                        required property int modelData
                        width: 125; height: 46
                        text: modelData === 0 ? "Off" : modelData + " min"
                        selected: modelData === 0 ? window.sleepDeadlineMs === 0 : false
                        onClicked: window.setSleepTimer(modelData)
                    }
                }
            }
            NativeAction {
                width: parent.width
                text: "Bedtime start: " + (familyApi.kidsBedtimeStart < 0 ? "Off" : window.bedtimeTime(familyApi.kidsBedtimeStart))
                onClicked: familyApi.cycleKidsBedtime()
            }
            NativeAction {
                width: parent.width
                text: "Bedtime end: " + window.bedtimeTime(familyApi.kidsBedtimeEnd)
                enabled: familyApi.kidsBedtimeStart >= 0
                onClicked: familyApi.cycleKidsBedtimeEnd()
            }
            TextField {
                id: newKidsPin
                width: parent.width; height: 52
                echoMode: TextInput.Password
                inputMethodHints: Qt.ImhDigitsOnly
                placeholderText: familyApi.kidsHasPin ? "New 4–8 digit PIN" : "Set a 4–8 digit parent PIN"
            }
            Row {
                spacing: 12
                NativeAction {
                    text: "Save PIN"
                    onClicked: {
                        if (familyApi.setKidsPin(newKidsPin.text)) { newKidsPin.clear(); window.notice = "Parent PIN saved" }
                        else window.notice = "PIN must be 4–8 digits"
                        noticeTimer.restart()
                    }
                }
                NativeAction { text: "Clear PIN"; visible: familyApi.kidsHasPin; onClicked: { familyApi.setKidsPin(""); newKidsPin.clear() } }
                NativeAction { text: "Back"; onClicked: window.goBack() }
            }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "watchTogether"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 820)
            spacing: 15
            Row {
                spacing: 15
                NativeAction { id: watchTogetherBackButton; width: 120; text: "← Profiles"; onClicked: window.goBack() }
                Text { text: "Watching Together"; color: familyApi.themeText; font.pixelSize: 29; font.bold: true; height: 48; verticalAlignment: Text.AlignVCenter }
            }
            Text { text: "Choose the family members watching on this device."; color: familyApi.themeText; font.pixelSize: 18 }
            Repeater {
                model: familyApi.publicUsers.filter(function(user) {
                    return familyApi.coWatchProfiles.length === 0 || user.Id !== familyApi.coWatchProfiles[0].Id
                })
                NativeAction {
                    width: parent.width
                    height: 53
                    selected: familyApi.coWatchProfiles.some(function(profile) { return profile.Id === modelData.Id })
                    text: (selected ? "✓  " : "") + (modelData.Name || "User")
                        + (familyApi.hasSavedProfile(modelData.Id) ? "" : "  ·  Sign in first")
                    onClicked: {
                        if (familyApi.hasSavedProfile(modelData.Id))
                            familyApi.setCoWatchProfile(modelData.Id, !selected)
                        else {
                            window.chosenCoWatchUser = modelData
                            coWatchPassword.forceActiveFocus()
                        }
                    }
                }
            }
            Text { text: "Sign in " + (window.chosenCoWatchUser.Name || ""); visible: !!window.chosenCoWatchUser.Id; color: familyApi.themeText; font.pixelSize: 18 }
            Row {
                spacing: 12
                visible: !!window.chosenCoWatchUser.Id
                TextField {
                    id: coWatchPassword
                    width: 390; height: 48
                    echoMode: TextInput.Password
                    placeholderText: "Password (leave blank if none)"
                    onAccepted: familyApi.authenticateParticipant(window.chosenCoWatchUser.Id, text)
                }
                NativeAction {
                    width: 150
                    text: "Add profile"
                    onClicked: familyApi.authenticateParticipant(window.chosenCoWatchUser.Id, coWatchPassword.text)
                }
            }
            Text { text: "Use this person's Continue Watching and Deck on Home:"; visible: familyApi.watchingTogether; color: familyApi.themeText; font.pixelSize: 18 }
            Flow {
                width: parent.width
                spacing: 10
                visible: familyApi.watchingTogether
                Repeater {
                    model: familyApi.coWatchProfiles
                    NativeAction {
                        width: 170
                        text: modelData.Name || "User"
                        selected: familyApi.homeFeedOwnerId === modelData.Id
                        onClicked: familyApi.setHomeFeedOwner(modelData.Id)
                    }
                }
            }
            NativeAction {
                width: 300
                visible: familyApi.watchingTogether
                text: "Combined Deck: " + (familyApi.combinedGroupDeckEnabled ? "On" : "Off")
                onClicked: familyApi.setCombinedGroupDeckEnabled(!familyApi.combinedGroupDeckEnabled)
            }
            NativeAction {
                width: 220
                visible: familyApi.watchingTogether
                text: "Stop Watching Together"
                onClicked: { familyApi.stopWatchingTogether(); page = "profile" }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "home"
        Rectangle {
            id: sidebar
            width: window.sidebarExpanded ? 220 : 64
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            color: familyApi.themeSurface
            opacity: 0.94
            Flickable {
                id: sidebarScroll
                anchors.fill: parent
                anchors.margins: 12
                contentWidth: width
                contentHeight: sidebarColumn.height + 12
                clip: true
              Column {
                id: sidebarColumn
                width: sidebarScroll.width
                spacing: 6
                Text { text: "Family Flix"; visible: window.sidebarExpanded; color: "white"; font.pixelSize: 27; font.bold: true; height: visible ? 56 : 0 }
                NativeAction {
                    id: homeButton
                    sidebarKey: "Home"
                    width: parent.width
                    text: window.sidebarExpanded ? "Home" : "☰"
                    selected: true
                    focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.sidebarExpanded = true; window.focusedItem = ({}); window.homeCardFocused = false }
                    upAction: function() { profileButton.forceActiveFocus() }
                    rightAction: function() { window.focusCard(0, 0) }
                    onClicked: homeScroll.contentY = 0
                }
                Repeater {
                    model: familyApi.railLibraries
                    NativeAction {
                        sidebarKey: modelData.Id || ""
                        width: parent.width
                        visible: window.sidebarExpanded
                        text: modelData.Name || "Library"
                        focusScroll: sidebarScroll
                        onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                        rightAction: function() { window.focusCard(0, 0) }
                        onClicked: window.scrollToSection(modelData.Name)
                    }
                }
                NativeAction {
                    sidebarKey: "All Libraries"
                    width: parent.width; visible: window.sidebarExpanded; text: "All Libraries"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: page = "allLibraries"
                }
                NativeAction {
                    sidebarKey: "Watchlist"
                    width: parent.width; visible: window.sidebarExpanded; text: "Watchlist"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: { familyApi.refreshWatchlist(); familyApi.refreshHouseholdWatchlist(); page = "watchlist" }
                }
                NativeAction {
                    sidebarKey: "Search"
                    width: parent.width; visible: window.sidebarExpanded; text: "Search"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: page = "search"
                }
                NativeAction {
                    sidebarKey: "Family Night"
                    width: parent.width; visible: window.sidebarExpanded; text: "Family Night"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: { window.familyNightPick = ({}); familyApi.refreshFamilyNightCandidates(); page = "familyNight" }
                }
                NativeAction {
                    sidebarKey: "Playlists"
                    width: parent.width; visible: window.sidebarExpanded; text: "Playlists"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: { familyApi.refreshPlaylists(); page = "playlists" }
                }
                NativeAction {
                    sidebarKey: "Live TV"
                    width: parent.width; visible: window.sidebarExpanded; text: "Live TV"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: window.openLiveTv()
                }
                NativeAction {
                    sidebarKey: "Settings"
                    width: parent.width; visible: window.sidebarExpanded; text: "Settings"; focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) { window.lastSidebarKey = sidebarKey; window.focusedItem = ({}); window.homeCardFocused = false }
                    onClicked: page = "settings"
                }
              }
            }
        }
        Text {
            text: Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP")
            visible: familyApi.clockBehavior === "ALWAYS" || familyApi.clockBehavior === "IN_MENUS"
            anchors.top: parent.top
            anchors.topMargin: 22
            anchors.horizontalCenter: parent.horizontalCenter
            color: "white"
            font.pixelSize: 18
            Timer { interval: 30000; running: true; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP") }
        }
        NativeAction {
            id: profileButton
            width: familyApi.watchingTogether ? 260 : 170
            height: familyApi.watchingTogether ? 60 : 48
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 16
            text: familyApi.watchingTogether ? familyApi.coWatchLabel : familyApi.userName
            onActiveFocusChanged: if (activeFocus) { window.focusedItem = ({}); window.homeCardFocused = false }
            downAction: function() { homeButton.forceActiveFocus() }
            leftAction: function() { settingsTopButton.forceActiveFocus() }
            onClicked: {
                chosenUser = ""
                password.clear()
                if (familyApi.kidsModeEnabled && familyApi.kidsHasPin) {
                    parentPinInput.clear()
                    page = "parentPin"
                    parentPinInput.forceActiveFocus()
                } else {
                    familyApi.refreshPublicUsers()
                    page = "profile"
                }
            }
        }
        NativeAction {
            id: settingsTopButton
            width: 52
            height: 48
            anchors.top: profileButton.top
            anchors.right: profileButton.left
            anchors.rightMargin: 8
            text: "⚙"
            onActiveFocusChanged: if (activeFocus) { window.focusedItem = ({}); window.homeCardFocused = false }
            downAction: function() { homeButton.forceActiveFocus() }
            rightAction: function() { profileButton.forceActiveFocus() }
            onClicked: page = "settings"
        }
        Text {
            visible: familyApi.watchingTogether
            anchors.horizontalCenter: profileButton.horizontalCenter
            anchors.top: profileButton.top
            anchors.topMargin: 37
            text: "Watching Together"
            color: familyApi.themeOnAccent
            font.pixelSize: 12
            font.bold: true
        }
        Flickable {
            id: homeScroll
            anchors.left: sidebar.right
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.topMargin: 85
            contentWidth: width
            contentHeight: rowColumn.height + 36
            clip: true
            Column {
                id: rowColumn
                width: homeScroll.width
                spacing: 30
                Repeater {
                    id: rowRepeater
                    model: homeRows
                    Column {
                        id: section
                        required property var modelData
                        required property int index
                        property string sectionTitle: modelData.title
                        function cardAt(cardIndex) { return cardRepeater.itemAt(cardIndex) }
                        width: rowColumn.width
                        spacing: 10
                        Text { text: modelData.title; color: "white"; font.pixelSize: 22; font.bold: true; leftPadding: 28 }
                        Flickable {
                            width: parent.width
                            height: 184
                            contentWidth: cardRow.width + 40
                            contentHeight: height
                            clip: true
                            Row {
                                id: cardRow
                                x: 28
                                spacing: 13
                                Repeater {
                                    id: cardRepeater
                                    model: modelData.items
                                    Rectangle {
                                        id: card
                                        required property var modelData
                                        required property int index
                                        property bool longSelectOpened: false
                                        width: 226
                                        height: 170
                                        radius: 9
                                        color: familyApi.themeSurface
                                        border.width: card.activeFocus ? 3 : 0
                                        border.color: familyApi.themeAccent
                                        focus: false
                                        activeFocusOnTab: true
                                        onActiveFocusChanged: if (activeFocus) {
                                            window.lastHomeRow = section.index
                                            window.lastHomeCard = card.index
                                            window.lastHomeItemId = card.modelData.Id || ""
                                            window.homeCardFocused = true
                                            window.sidebarExpanded = false
                                            window.focusedItem = card.modelData
                                        }
                                        Artwork {
                                            anchors.fill: parent
                                            anchors.margins: 3
                                            item: card.modelData
                                        }
                                        Rectangle {
                                            anchors.top: parent.top; anchors.right: parent.right
                                            anchors.margins: 8
                                            radius: 4
                                            width: statusLabel.implicitWidth + 12; height: 23
                                            color: "#df08111b"
                                            visible: statusLabel.text.length > 0
                                            Text {
                                                id: statusLabel
                                                anchors.centerIn: parent
                                                text: card.modelData.UserData && card.modelData.UserData.Played ? "✓ Watched"
                                                    : window.resumeFraction(card.modelData) > 0 ? "In progress" : ""
                                                color: "white"; font.pixelSize: 12; font.bold: true
                                            }
                                        }
                                        Rectangle {
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                                            height: card.modelData.Type === "Episode" ? 62 : 54
                                            color: "#d908111b"
                                        }
                                        Column {
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                                            anchors.margins: 8
                                            spacing: 2
                                            Text {
                                                width: parent.width
                                                text: card.modelData.SeriesName || card.modelData.Name || ""
                                                color: "white"; font.pixelSize: 15; font.bold: true; elide: Text.ElideRight
                                            }
                                            Text {
                                                width: parent.width
                                                visible: card.modelData.Type === "Episode"
                                                text: window.homeCardSubtitle(card.modelData)
                                                color: "#dce5f1"; font.pixelSize: 13; elide: Text.ElideRight
                                            }
                                        }
                                        Rectangle {
                                            anchors.left: parent.left; anchors.bottom: parent.bottom
                                            height: 3
                                            width: parent.width * window.resumeFraction(card.modelData)
                                            color: familyApi.themeAccent
                                            visible: window.resumeFraction(card.modelData) > 0
                                        }
                                        Timer {
                                            id: longSelectTimer
                                            interval: 600
                                            onTriggered: { card.longSelectOpened = true; window.openContext(card.modelData) }
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            acceptedButtons: Qt.LeftButton | Qt.RightButton
                                            pressAndHoldInterval: 600
                                            onPressAndHold: { card.longSelectOpened = true; card.forceActiveFocus(); window.openContext(card.modelData) }
                                            onClicked: function(mouse) {
                                                if (card.longSelectOpened) { card.longSelectOpened = false; return }
                                                card.forceActiveFocus()
                                                if (mouse.button === Qt.RightButton) window.openContext(card.modelData)
                                                else window.showItem(card.modelData)
                                            }
                                        }
                                        Keys.onPressed: function(event) {
                                            if (event.key === Qt.Key_Menu) {
                                                window.openContext(card.modelData)
                                                event.accepted = true
                                            } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                                if (!event.isAutoRepeat && !longSelectTimer.running) {
                                                    card.longSelectOpened = false
                                                    longSelectTimer.start()
                                                }
                                                event.accepted = true
                                            }
                                        }
                                        Keys.onReleased: function(event) {
                                            if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                                                if (!event.isAutoRepeat) {
                                                    longSelectTimer.stop()
                                                    if (!card.longSelectOpened) window.showItem(card.modelData)
                                                    card.longSelectOpened = false
                                                }
                                                event.accepted = true
                                            }
                                        }
                                        Keys.onLeftPressed: {
                                            if (card.index > 0) window.focusCard(section.index, card.index - 1)
                                            else homeButton.forceActiveFocus()
                                        }
                                        Keys.onRightPressed: window.focusCard(section.index, card.index + 1)
                                        Keys.onUpPressed: {
                                            if (section.index > 0) window.focusCard(section.index - 1, 0)
                                            else profileButton.forceActiveFocus()
                                        }
                                        Keys.onDownPressed: window.focusCard(section.index + 1, 0)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "search"
        NativeAction { x: 28; y: 22; text: "← Home"; onClicked: page = "home" }
        Text { x: 220; y: 25; text: "Search"; color: familyApi.themeText; font.pixelSize: 31; font.bold: true }
        TextField {
            id: searchInput
            x: 28; y: 90
            width: Math.min(680, parent.width - 56)
            height: 58
            font.pixelSize: 22
            placeholderText: "Title, episode, cast…"
            activeFocusOnTab: true
            onTextChanged: searchDelay.restart()
            onAccepted: {
                searchDelay.stop()
                familyApi.search(text)
                if (familyApi.searchResults.length) searchGrid.forceActiveFocus()
            }
            Keys.onDownPressed: function(event) {
                if (window.searchKeyboardOpen) searchKeyRepeater.itemAt(0).forceActiveFocus()
                else if (familyApi.searchResults.length) searchGrid.forceActiveFocus()
                event.accepted = true
            }
            Keys.onRightPressed: function(event) {
                if (cursorPosition === text.length) {
                    searchKeyboardButton.forceActiveFocus()
                    event.accepted = true
                }
            }
        }
        NativeAction {
            id: searchKeyboardButton
            x: 720; y: 95
            width: 210; height: 48
            text: window.searchKeyboardOpen ? "Hide keyboard" : "Show keyboard"
            downAction: function() {
                if (window.searchKeyboardOpen) searchKeyRepeater.itemAt(0).forceActiveFocus()
                else if (familyApi.searchResults.length) searchGrid.forceActiveFocus()
            }
            onClicked: {
                window.searchKeyboardOpen = !window.searchKeyboardOpen
                if (window.searchKeyboardOpen) Qt.callLater(function() { searchKeyRepeater.itemAt(0).forceActiveFocus() })
                else searchInput.forceActiveFocus()
            }
        }
        Timer {
            id: searchDelay
            interval: 300
            repeat: false
            onTriggered: if (window.page === "search") familyApi.search(searchInput.text)
        }
        GridLayout {
            x: 28; y: 160
            visible: window.searchKeyboardOpen
            columns: 7
            property int actionColumns: 7
            columnSpacing: 6; rowSpacing: 6
            Repeater {
                id: searchKeyRepeater
                model: window.searchSymbols
                    ? ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "-", ".", "Space", "Back", "ABC", "Done"]
                    : ["A", "B", "C", "D", "E", "F", "G",
                        "H", "I", "J", "K", "L", "M", "N",
                        "O", "P", "Q", "R", "S", "T", "U",
                        "V", "W", "X", "Y", "Z", "Space", "Back", "123", "Done"]
                NativeAction {
                    required property var modelData
                    required property int index
                    Layout.preferredWidth: 70
                    Layout.preferredHeight: 38
                    fontSize: 14
                    text: modelData
                    upAction: index < 7 ? function() { searchInput.forceActiveFocus() } : null
                    onClicked: window.typeSearchKey(modelData)
                }
            }
        }
        Text {
            x: 28; y: window.searchKeyboardOpen ? 384 : 158
            text: familyApi.searchLoading ? "Searching…" : (searchInput.text.trim() && !familyApi.searchResults.length ? "No matching videos" : "")
            color: familyApi.themeText; font.pixelSize: 17
        }
        GridView {
            id: searchGrid
            x: 28; y: window.searchKeyboardOpen ? 420 : 195
            width: parent.width - 56
            height: parent.height - y - 20
            cellWidth: 245; cellHeight: 180
            model: familyApi.searchResults
            clip: true
            keyNavigationEnabled: true
            onCurrentIndexChanged: {
                if (currentIndex >= count - 12) familyApi.loadMoreSearch()
                if (currentIndex >= 0 && currentIndex < familyApi.searchResults.length)
                    window.focusedItem = familyApi.searchResults[currentIndex]
            }
            onActiveFocusChanged: if (activeFocus && currentIndex >= 0 && currentIndex < familyApi.searchResults.length)
                window.focusedItem = familyApi.searchResults[currentIndex]
            onCountChanged: if (activeFocus && currentIndex >= 0 && currentIndex < familyApi.searchResults.length)
                window.focusedItem = familyApi.searchResults[currentIndex]
            Keys.onReturnPressed: if (currentIndex >= 0) window.showItem(familyApi.searchResults[currentIndex], "search")
            Keys.onEnterPressed: if (currentIndex >= 0) window.showItem(familyApi.searchResults[currentIndex], "search")
            Keys.onUpPressed: function(event) {
                if (searchGrid.currentIndex < Math.max(1, Math.floor(searchGrid.width / searchGrid.cellWidth))) {
                    if (window.searchKeyboardOpen) searchKeyRepeater.itemAt(searchKeyRepeater.count - 1).forceActiveFocus()
                    else searchInput.forceActiveFocus()
                    event.accepted = true
                }
            }
            delegate: Rectangle {
                required property var modelData
                required property int index
                width: 228; height: 165; radius: 9
                color: familyApi.themeSurface
                border.width: searchGrid.activeFocus && GridView.isCurrentItem ? 3 : 1
                border.color: searchGrid.activeFocus && GridView.isCurrentItem ? familyApi.themeAccent : familyApi.themeAccentSecondary
                Artwork { anchors.fill: parent; anchors.margins: 3; item: modelData }
                Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 52; color: "#d908111b" }
                Text { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 8; text: window.browseCardTitle(modelData); color: "white"; font.pixelSize: 16; font.bold: true; elide: Text.ElideRight }
                MouseArea { anchors.fill: parent; onClicked: { searchGrid.currentIndex = index; window.showItem(modelData, "search") } }
            }
            footer: NativeAction {
                visible: familyApi.searchHasMore && !familyApi.searchLoading
                text: "Load more"
                onClicked: familyApi.loadMoreSearch()
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "allLibraries"
        NativeAction {
            x: 28; y: 22
            text: "← Home"
            onClicked: page = "home"
        }
        Text {
            x: 220; y: 25
            text: "All Libraries"
            color: familyApi.themeText
            font.pixelSize: 31; font.bold: true
        }
        GridView {
            id: librariesGrid
            x: 25; y: 100
            width: parent.width - 50
            height: parent.height - 120
            cellWidth: 265; cellHeight: 190
            model: familyApi.libraries
            focus: visible
            clip: true
            keyNavigationEnabled: true
            Keys.onReturnPressed: if (currentItem) {
                familyApi.openLibrary(familyApi.libraries[currentIndex])
                page = "libraryBrowse"
            }
            Keys.onEnterPressed: if (currentItem) {
                familyApi.openLibrary(familyApi.libraries[currentIndex])
                page = "libraryBrowse"
            }
            Keys.onEscapePressed: page = "home"
            delegate: Rectangle {
                required property var modelData
                required property int index
                width: 245; height: 168; radius: 9
                color: familyApi.themeSurface
                border.width: GridView.isCurrentItem ? 3 : 1
                border.color: GridView.isCurrentItem ? familyApi.themeAccent : familyApi.themeAccentSecondary
                Artwork { anchors.fill: parent; anchors.margins: 3; item: modelData }
                Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 55; color: "#d908111b" }
                Text { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 12; text: modelData.Name || "Library"; color: "white"; font.pixelSize: 20; font.bold: true; elide: Text.ElideRight }
                MouseArea { anchors.fill: parent; onClicked: { librariesGrid.currentIndex = index; familyApi.openLibrary(modelData); page = "libraryBrowse" } }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "libraryBrowse"
        NativeAction { x: 28; y: 22; text: "← Libraries"; onClicked: page = "allLibraries" }
        Text { x: 220; y: 25; text: familyApi.selectedLibrary.Name || "Library"; color: familyApi.themeText; font.pixelSize: 31; font.bold: true }
        Text {
            anchors.right: parent.right; anchors.rightMargin: 30; y: 36
            text: familyApi.libraryLoading ? "Loading…" : (familyApi.libraryItems.length + " items")
            color: familyApi.themeText; font.pixelSize: 17
        }
        Row {
            x: 28; y: 88
            spacing: 12
            NativeAction {
                id: librarySortButton
                width: 255
                text: "Sort: " + familyApi.librarySortLabel
                enabled: familyApi.libraryPreferencesReady
                downAction: function() { libraryItemsGrid.forceActiveFocus() }
                onClicked: familyApi.cycleLibrarySort()
            }
            NativeAction {
                width: 180
                text: "Unwatched: " + (familyApi.libraryUnwatchedOnly ? "On" : "Off")
                enabled: familyApi.libraryPreferencesReady
                downAction: function() { libraryItemsGrid.forceActiveFocus() }
                onClicked: familyApi.toggleLibraryUnwatchedOnly()
            }
            NativeAction {
                width: 175
                text: "Favourites: " + (familyApi.libraryFavoritesOnly ? "On" : "Off")
                enabled: familyApi.libraryPreferencesReady
                downAction: function() { libraryItemsGrid.forceActiveFocus() }
                onClicked: familyApi.toggleLibraryFavoritesOnly()
            }
        }
        GridView {
            id: libraryItemsGrid
            x: 25; y: 160
            width: parent.width - 50
            height: parent.height - 180
            cellWidth: 245; cellHeight: 180
            model: familyApi.libraryItems
            focus: visible
            clip: true
            keyNavigationEnabled: true
            onCurrentIndexChanged: {
                if (currentIndex >= count - 12) familyApi.loadMoreLibrary()
                if (currentIndex >= 0 && currentIndex < familyApi.libraryItems.length)
                    window.focusedItem = familyApi.libraryItems[currentIndex]
            }
            onActiveFocusChanged: if (activeFocus && currentIndex >= 0 && currentIndex < familyApi.libraryItems.length)
                window.focusedItem = familyApi.libraryItems[currentIndex]
            onCountChanged: if (activeFocus && currentIndex >= 0 && currentIndex < familyApi.libraryItems.length)
                window.focusedItem = familyApi.libraryItems[currentIndex]
            Keys.onReturnPressed: if (currentIndex >= 0) window.showItem(familyApi.libraryItems[currentIndex], "libraryBrowse")
            Keys.onEnterPressed: if (currentIndex >= 0) window.showItem(familyApi.libraryItems[currentIndex], "libraryBrowse")
            Keys.onUpPressed: function(event) {
                if (libraryItemsGrid.currentIndex < Math.max(1, Math.floor(libraryItemsGrid.width / libraryItemsGrid.cellWidth))) {
                    librarySortButton.forceActiveFocus()
                    event.accepted = true
                }
            }
            Keys.onEscapePressed: page = "allLibraries"
            delegate: Rectangle {
                required property var modelData
                required property int index
                width: 225; height: 162; radius: 9
                color: familyApi.themeSurface
                border.width: GridView.isCurrentItem ? 3 : 1
                border.color: GridView.isCurrentItem ? familyApi.themeAccent : familyApi.themeAccentSecondary
                Artwork { anchors.fill: parent; anchors.margins: 3; item: modelData }
                Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 54; color: "#d908111b" }
                Text { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; anchors.margins: 8; text: window.browseCardTitle(modelData); color: "white"; font.pixelSize: 16; elide: Text.ElideRight }
                MouseArea { anchors.fill: parent; onClicked: { libraryItemsGrid.currentIndex = index; window.showItem(modelData, "libraryBrowse") } }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "watchlist"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            anchors.topMargin: 72
            spacing: 24
            Row {
                spacing: 20
                NativeAction { id: watchlistBackButton; text: "← Home"; onClicked: page = "home" }
                Text { text: "Watchlist"; color: "white"; font.pixelSize: 33; font.bold: true }
                NativeAction { id: watchlistPersonalButton; text: "My List"; selected: watchlistMode === "personal"; onClicked: watchlistMode = "personal" }
                NativeAction { id: watchlistHouseholdButton; text: "Family List"; selected: watchlistMode === "household"; onClicked: watchlistMode = "household" }
            }
            Text { text: "Movies"; color: "white"; font.pixelSize: 24; font.bold: true }
            Flickable {
                id: movieWatchlistScroll
                width: parent.width
                height: 190
                contentWidth: movieRow.width
                clip: true
                Row {
                    id: movieRow
                    spacing: 12
                    Repeater {
                        id: movieWatchlistRepeater
                        model: window.watchlistOfType("movie")
                        Rectangle {
                            id: movieWatchlistCard
                            required property var modelData
                            required property int index
                            width: 225
                            height: 160
                            radius: 8
                            color: familyApi.themeSurface
                            border.width: activeFocus ? 3 : 1
                            border.color: activeFocus ? familyApi.themeAccent : familyApi.themeAccentSecondary
                            activeFocusOnTab: true
                            onActiveFocusChanged: if (activeFocus) {
                                window.focusedItem = modelData
                                window.lastWatchlistItemId = modelData.Id || ""
                                if (x < movieWatchlistScroll.contentX)
                                    movieWatchlistScroll.contentX = Math.max(0, x - 8)
                                else if (x + width > movieWatchlistScroll.contentX + movieWatchlistScroll.width)
                                    movieWatchlistScroll.contentX = x + width - movieWatchlistScroll.width + 8
                            }
                            Artwork { anchors.fill: parent; anchors.margins: 3; item: modelData }
                            Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 54; color: "#d908111b" }
                            Text {
                                anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                                anchors.margins: 8
                                text: (modelData.Name || "Movie") + (watchlistMode === "household"
                                    ? " · " + Number((window.householdEntry(modelData.Id) || {}).voteCount || 0) + " votes" : "")
                                color: "white"; font.pixelSize: 16; font.bold: true; elide: Text.ElideRight
                            }
                            Keys.onReturnPressed: window.showItem(modelData, "watchlist")
                            Keys.onEnterPressed: window.showItem(modelData, "watchlist")
                            Keys.onLeftPressed: {
                                const other = movieWatchlistRepeater.itemAt(index - 1)
                                if (other) other.forceActiveFocus()
                            }
                            Keys.onRightPressed: {
                                const other = movieWatchlistRepeater.itemAt(index + 1)
                                if (other) other.forceActiveFocus()
                            }
                            Keys.onDownPressed: {
                                const other = showWatchlistRepeater.itemAt(Math.min(index, showWatchlistRepeater.count - 1))
                                if (other) other.forceActiveFocus()
                            }
                            Keys.onUpPressed: watchlistBackButton.forceActiveFocus()
                            MouseArea { anchors.fill: parent; onClicked: { movieWatchlistCard.forceActiveFocus(); window.showItem(modelData, "watchlist") } }
                        }
                    }
                }
            }
            Text { text: "Shows"; color: "white"; font.pixelSize: 24; font.bold: true }
            Flickable {
                id: showWatchlistScroll
                width: parent.width
                height: 190
                contentWidth: showRow.width
                clip: true
                Row {
                    id: showRow
                    spacing: 12
                    Repeater {
                        id: showWatchlistRepeater
                        model: window.watchlistOfType("series")
                        Rectangle {
                            id: showWatchlistCard
                            required property var modelData
                            required property int index
                            width: 225
                            height: 160
                            radius: 8
                            color: familyApi.themeSurface
                            border.width: activeFocus ? 3 : 1
                            border.color: activeFocus ? familyApi.themeAccent : familyApi.themeAccentSecondary
                            activeFocusOnTab: true
                            onActiveFocusChanged: if (activeFocus) {
                                window.focusedItem = modelData
                                window.lastWatchlistItemId = modelData.Id || ""
                                if (x < showWatchlistScroll.contentX)
                                    showWatchlistScroll.contentX = Math.max(0, x - 8)
                                else if (x + width > showWatchlistScroll.contentX + showWatchlistScroll.width)
                                    showWatchlistScroll.contentX = x + width - showWatchlistScroll.width + 8
                            }
                            Artwork { anchors.fill: parent; anchors.margins: 3; item: modelData }
                            Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 54; color: "#d908111b" }
                            Text {
                                anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                                anchors.margins: 8
                                text: (modelData.Name || "Show") + (watchlistMode === "household"
                                    ? " · " + Number((window.householdEntry(modelData.Id) || {}).voteCount || 0) + " votes" : "")
                                color: "white"; font.pixelSize: 16; font.bold: true; elide: Text.ElideRight
                            }
                            Keys.onReturnPressed: window.showItem(modelData, "watchlist")
                            Keys.onEnterPressed: window.showItem(modelData, "watchlist")
                            Keys.onLeftPressed: {
                                const other = showWatchlistRepeater.itemAt(index - 1)
                                if (other) other.forceActiveFocus()
                            }
                            Keys.onRightPressed: {
                                const other = showWatchlistRepeater.itemAt(index + 1)
                                if (other) other.forceActiveFocus()
                            }
                            Keys.onUpPressed: {
                                const other = movieWatchlistRepeater.itemAt(Math.min(index, movieWatchlistRepeater.count - 1))
                                if (other) other.forceActiveFocus()
                                else watchlistBackButton.forceActiveFocus()
                            }
                            MouseArea { anchors.fill: parent; onClicked: { showWatchlistCard.forceActiveFocus(); window.showItem(modelData, "watchlist") } }
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "familyNight"
        Column {
            anchors.fill: parent
            anchors.margins: 30
            spacing: 14
            Row {
                spacing: 18
                NativeAction { id: familyNightBackButton; text: "← Home"; onClicked: page = "home" }
                Text { text: "Family Night"; color: familyApi.themeText; font.pixelSize: 32; font.bold: true; height: 48; verticalAlignment: Text.AlignVCenter }
                NativeAction { text: "Refresh lists"; onClicked: familyApi.refreshFamilyNightCandidates() }
            }
            Text { text: "Pick from your Watchlist" + (familyApi.watchingTogether ? " and everyone watching together" : "") + "."; color: familyApi.themeText; font.pixelSize: 18 }
            Flow {
                width: parent.width
                spacing: 10
                NativeAction {
                    width: 145
                    text: "Type: " + window.familyNightMedia
                    onClicked: {
                        const values = ["All", "Movies", "Shows"]
                        window.familyNightMedia = values[(values.indexOf(window.familyNightMedia) + 1) % values.length]
                    }
                }
                NativeAction {
                    width: 165
                    text: "Length: " + (window.familyNightRuntime || "Any")
                    onClicked: {
                        const values = [0, 90, 120, 150, 180]
                        window.familyNightRuntime = values[(values.indexOf(window.familyNightRuntime) + 1) % values.length]
                    }
                }
                NativeAction {
                    width: 185
                    text: "Max age: " + (window.familyNightAge < 0 ? "Any" : window.familyNightAge)
                    onClicked: {
                        const values = [-1, 7, 10, 13, 17, 18]
                        window.familyNightAge = values[(values.indexOf(window.familyNightAge) + 1) % values.length]
                    }
                }
                NativeAction {
                    width: 210
                    text: "Genre: " + window.familyNightGenre
                    onClicked: {
                        const values = window.familyNightGenres
                        window.familyNightGenre = values[(values.indexOf(window.familyNightGenre) + 1) % values.length]
                    }
                }
            }
            Text {
                text: familyApi.familyNightLoading ? "Loading family watchlists…" : window.familyNightMatches.length + " choices match your filters"
                color: familyApi.themeText; font.pixelSize: 18
            }
            Rectangle {
                width: Math.min(parent.width, 800)
                height: Math.min(300, window.height - 350)
                color: familyApi.themeSurface
                radius: 9
                Artwork { anchors.fill: parent; item: window.familyNightPick; purpose: "backdrop" }
                Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 82; color: "#df08121d" }
                Text {
                    anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                    anchors.margins: 12
                    text: window.familyNightPick.Name
                        ? window.familyNightPick.Name + "  ·  " + (window.familyNightPick.SourceProfiles || []).join(", ")
                        : "Use Surprise Me to pick a movie or show"
                    color: "white"; font.pixelSize: 21; font.bold: true; wrapMode: Text.WordWrap
                }
            }
            Row {
                spacing: 12
                NativeAction { width: 180; text: window.familyNightPick.Id ? "Reroll" : "Surprise Me"; onClicked: window.pickFamilyNight() }
                NativeAction {
                    width: 180
                    text: "Play"
                    visible: !!window.familyNightPick.Id
                    onClicked: {
                        if (window.familyNightPick.Type === "Series")
                            familyApi.resolveFirstUnwatchedEpisode(window.familyNightPick.Id)
                        else {
                            window.pendingFamilyNightId = window.familyNightPick.Id
                            familyApi.resolvePlayableItem(window.pendingFamilyNightId)
                        }
                    }
                }
                NativeAction { width: 180; text: "See details"; visible: !!window.familyNightPick.Id; onClicked: window.showItem(window.familyNightPick, "familyNight") }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "settings"
        ScrollView {
            id: settingsView
            anchors.fill: parent
            anchors.margins: 40
            clip: true
            Column {
              width: settingsView.availableWidth
              spacing: 16
            Row {
                spacing: 18
                NativeAction { id: settingsBackButton; text: "← Home"; onClicked: page = "home" }
                Text { text: "Family Flix Settings"; color: "white"; font.pixelSize: 32; font.bold: true }
            }
            Text { text: "Colour theme"; color: familyApi.themeText; font.pixelSize: 23; font.bold: true }
            NativeAction { text: "Intro, recap and outro skipping"; width: 325; onClicked: page = "skipSettings" }
            NativeAction { text: "Playback buffers"; width: 325; onClicked: page = "bufferSettings" }
            NativeAction { text: "Next episode screen: " + familyApi.nextUpMode; width: 325; onClicked: familyApi.cycleNextUpMode() }
            NativeAction {
                text: "Queue next episode: " + (familyApi.mediaQueuingEnabled ? "On" : "Off")
                width: 325
                onClicked: familyApi.toggleMediaQueuing()
            }
            NativeAction {
                text: "Still watching prompt: " + familyApi.stillWatchingBehavior.replace(/_/g, " ")
                width: 325
                onClicked: familyApi.cycleStillWatchingBehavior()
            }
            NativeAction {
                text: "Picture fit: " + familyApi.playerZoomMode.replace(/_/g, " ")
                width: 325
                onClicked: familyApi.cyclePlayerZoomMode()
            }
            NativeAction {
                text: "Next episode countdown: " + (familyApi.nextUpTimeoutMs === 0
                    ? "Off" : familyApi.nextUpTimeoutMs / 1000 + " sec")
                width: 325
                onClicked: familyApi.cycleNextUpTimeout()
            }
            NativeAction {
                text: "Resume rewind: " + (familyApi.resumePrerollSeconds === 0
                    ? "Off" : familyApi.resumePrerollSeconds + " sec")
                width: 325
                onClicked: familyApi.cycleResumePreroll()
            }
            NativeAction { text: "Skip forward: " + (familyApi.skipForwardMs / 1000) + " sec"; width: 325; onClicked: familyApi.cycleSkipForwardMs() }
            NativeAction { text: "Background images: " + (familyApi.backdropEnabled ? "On" : "Off"); width: 325; onClicked: familyApi.toggleBackdropEnabled() }
            NativeAction { text: "Clock: " + familyApi.clockBehavior.replace(/_/g, " "); width: 325; onClicked: familyApi.cycleClockBehavior() }
            NativeAction {
                text: "Watched badges: " + familyApi.watchedIndicatorBehavior.replace(/_/g, " ")
                width: 325
                onClicked: familyApi.cycleWatchedIndicatorBehavior()
            }
            NativeAction {
                text: "Series thumbnails: " + (familyApi.seriesThumbnailsEnabled ? "On" : "Off")
                width: 325
                onClicked: familyApi.toggleSeriesThumbnails()
            }
            NativeAction { text: "Check Windows updates"; width: 325; onClicked: familyApi.checkWindowsUpdate(true) }
            Flickable {
                width: parent.width
                height: 80
                contentWidth: themeRow.width
                contentHeight: height
                clip: true
                Row {
                    id: themeRow
                    spacing: 9
                    Repeater {
                        model: familyApi.themeOptions
                        NativeAction {
                            width: 145
                            height: 62
                            text: modelData.name
                            accent: modelData.accent
                            selected: familyApi.themeName === modelData.name
                            onClicked: familyApi.setTheme(modelData.name)
                        }
                    }
                }
            }
            Text { text: "Libraries on the left menu"; color: "white"; font.pixelSize: 23; font.bold: true }
            Text {
                text: "Hidden libraries stay on Home. Move changes both menu and Home order."
                color: "#c8d5e3"; font.pixelSize: 16
            }
            Column {
                width: parent.width
                spacing: 8
                Repeater {
                        model: familyApi.libraries
                        Row {
                            required property var modelData
                            spacing: 12
                            Text {
                                width: Math.max(250, window.width - 500)
                                height: 55
                                verticalAlignment: Text.AlignVCenter
                                text: modelData.Name || "Library"
                                color: "white"; font.pixelSize: 19
                            }
                            NativeAction {
                                width: 110
                                text: familyApi.libraryVisibleInRail(modelData.Id) ? "Hide" : "Show"
                                onClicked: familyApi.setLibraryVisibleInRail(modelData.Id, !familyApi.libraryVisibleInRail(modelData.Id))
                            }
                            NativeAction { width: 70; text: "↑"; onClicked: familyApi.moveLibrary(modelData.Id, -1) }
                            NativeAction { width: 70; text: "↓"; onClicked: familyApi.moveLibrary(modelData.Id, 1) }
                        }
                }
            }
            Text { text: "Home rows"; color: familyApi.themeText; font.pixelSize: 23; font.bold: true }
            Text {
                text: "These choices are shared with your Android app."
                color: familyApi.themeText; font.pixelSize: 16
            }
            Column {
                width: parent.width
                spacing: 8
                Repeater {
                    model: familyApi.homeLayoutRows
                    Row {
                        required property var modelData
                        spacing: 12
                        Text {
                            width: Math.max(250, window.width - 500)
                            height: 55
                            verticalAlignment: Text.AlignVCenter
                            text: modelData.label
                            color: familyApi.themeText; font.pixelSize: 19
                        }
                        NativeAction {
                            width: 110
                            text: modelData.visible ? "Hide" : "Show"
                            onClicked: familyApi.setHomeRowVisible(modelData.id, !modelData.visible)
                        }
                        NativeAction { width: 70; text: "↑"; onClicked: familyApi.moveHomeRow(modelData.id, -1) }
                        NativeAction { width: 70; text: "↓"; onClicked: familyApi.moveHomeRow(modelData.id, 1) }
                    }
                }
            }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "bufferSettings"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 18
            NativeAction { id: bufferBackButton; text: "← Settings"; onClicked: window.goBack() }
            Text { text: "Playback buffers"; color: familyApi.themeText; font.pixelSize: 30; font.bold: true }
            Text {
                width: parent.width
                text: "Choose how far ahead movies and shows can load, and how much live TV can be retained. Actual duration depends on bitrate and stream seekability."
                color: familyApi.themeText; font.pixelSize: 17; wrapMode: Text.WordWrap
            }
            Text { text: "Temporary storage free: " + familyApi.temporaryStorageGiB(); color: familyApi.themeText; font.pixelSize: 18 }
            Text { text: "Movies and shows · ahead of playback"; color: familyApi.themeText; font.pixelSize: 22; font.bold: true }
            Flow {
                width: parent.width; spacing: 10
                Repeater {
                    model: [5, 10, 20, 30, 60]
                    NativeAction {
                        required property int modelData
                        width: 145
                        text: modelData === 60 ? "1 hour" : modelData + " minutes"
                        selected: window.vodBufferMinutes === modelData
                        onClicked: {
                            components.settings.setValue("video", "familyVodBufferMinutes", modelData)
                            window.vodBufferMinutes = modelData
                        }
                    }
                }
            }
            Text { text: "Live TV · pause and rewind"; color: familyApi.themeText; font.pixelSize: 22; font.bold: true }
            Flow {
                width: parent.width; spacing: 10
                Repeater {
                    model: [5, 10, 20, 30, 60]
                    NativeAction {
                        required property int modelData
                        width: 145
                        text: modelData === 60 ? "1 hour" : modelData + " minutes"
                        selected: window.liveBufferMinutes === modelData
                        onClicked: {
                            components.settings.setValue("video", "familyLiveBufferMinutes", modelData)
                            window.liveBufferMinutes = modelData
                        }
                    }
                }
            }
            Text {
                width: parent.width
                text: "Family Flix uses memory first, then temporary storage when available. It reserves free space and removes the temporary buffer when playback ends."
                color: familyApi.themeText; font.pixelSize: 16; wrapMode: Text.WordWrap
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "skipSettings"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 18
            NativeAction { id: skipBackButton; text: "← Settings"; onClicked: window.goBack() }
            Text { text: "Skip prompts"; color: familyApi.themeText; font.pixelSize: 30; font.bold: true }
            Text { text: "Ask shows a button during a detected segment. Auto skips it; Off leaves it alone."; color: familyApi.themeText; font.pixelSize: 17 }
            Repeater {
                model: ["Intro", "Outro", "Preview", "Recap", "Commercial"]
                Row {
                    id: segmentRow
                    required property string modelData
                    spacing: 16
                    Text { width: 160; height: 54; verticalAlignment: Text.AlignVCenter; text: modelData; color: familyApi.themeText; font.pixelSize: 21 }
                    Repeater {
                        model: ["Ask", "Auto", "Off"]
                        NativeAction {
                            required property string modelData
                            width: 105
                            text: modelData
                            selected: familyApi.mediaSegmentAction(segmentRow.modelData) === modelData
                            onClicked: familyApi.setMediaSegmentAction(segmentRow.modelData, modelData)
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "liveTv"
        property real programWidth: Math.max(500, width - 445)
        NativeAction {
            id: liveBackButton
            x: 20; y: 18; width: 180
            text: "← Return Home"
            onClicked: window.goBack()
        }
        Text {
            x: 225; y: 19
            text: "TV Guide"
            color: "white"; font.pixelSize: 31; font.bold: true
        }
        Text {
            anchors.right: parent.right
            anchors.rightMargin: 24
            y: 25
            visible: familyApi.clockBehavior === "ALWAYS" || familyApi.clockBehavior === "IN_MENUS"
            color: "white"; font.pixelSize: 18
            text: Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP")
            Timer { interval: 30000; running: window.page === "liveTv"; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP") }
        }
        Rectangle {
            x: 214; y: 78; width: 282; height: 162
            radius: 8; color: window.livePreviewActive ? "transparent" : "#172635"; border.color: "#69849c"
            Text {
                anchors.centerIn: parent
                visible: !window.livePreviewActive
                text: "Select a channel to preview"
                color: "#cad7e3"; font.pixelSize: 15
            }
        }
        Text {
            x: 515; y: 98; width: Math.max(280, parent.width - 545)
            text: livePreviewChannel.Name || "Choose a channel below"
            color: "white"; font.pixelSize: 26; font.bold: true
            elide: Text.ElideRight
        }
        Text {
            x: 515; y: 140; width: Math.max(280, parent.width - 545)
            text: livePreviewActive ? "Select this channel again for fullscreen" : "One selection previews; a second opens fullscreen"
            color: "#c5d5e6"; font.pixelSize: 16; wrapMode: Text.WordWrap
        }
        Row {
            x: 22; y: 258; spacing: 8
            NativeAction {
                width: 88; height: 38; text: "← 2h"
                onClicked: {
                    window.tvStartMs -= 7200000
                    window.requestTvGuide()
                }
            }
            NativeAction {
                width: 88; height: 38; text: "Now"
                onClicked: {
                    window.tvStartMs = Math.floor(Date.now() / 1800000) * 1800000
                    window.requestTvGuide()
                }
            }
        }
        Text { x: 213; y: 264; text: "Channel"; color: "#c4d4e2"; font.pixelSize: 18; font.bold: true }
        Flickable {
            id: timelineScroll
            x: 395; y: 252
            width: parent.programWidth
            height: 48
            contentWidth: width * 3
            contentHeight: height
            clip: true
            Row {
                Repeater {
                    model: 12
                    Rectangle {
                        width: timelineScroll.width / 4
                        height: 45
                        color: index % 2 ? "#1b2e40" : "#24394d"
                        border.color: "#526f89"
                        Text {
                            anchors.centerIn: parent
                            text: Qt.formatTime(new Date(window.tvStartMs + index * 1800000), "h:mm AP")
                            color: "white"; font.pixelSize: 16
                        }
                    }
                }
            }
        }
        Flickable {
            x: 18; y: 310; width: 184; height: Math.max(180, parent.height - 330)
            contentWidth: width; contentHeight: categoryColumn.height
            clip: true
            Column {
                id: categoryColumn
                width: 184
                spacing: 7
                Repeater {
                    model: familyApi.tvCategories
                    NativeAction {
                        width: categoryColumn.width
                        height: 50
                        text: modelData.name || "Category"
                        selected: Number(modelData.band) === window.tvCategoryBand
                        onClicked: {
                            window.tvCategoryBand = Number(modelData.band)
                            window.requestTvGuide()
                        }
                    }
                }
            }
        }
        ListView {
            id: guideChannels
            x: 213; y: 310
            width: Math.max(650, parent.width - 235)
            height: Math.max(180, parent.height - 330)
            clip: true
            spacing: 4
            model: familyApi.tvChannelsForBand(window.tvCategoryBand)
            delegate: Row {
                id: channelRow
                required property var modelData
                spacing: 7
                height: 60
                NativeAction {
                    width: 175; height: 58
                    text: (modelData.Number ? modelData.Number + "  " : "") + (modelData.Name || "Channel")
                    onClicked: window.selectLiveChannel(modelData)
                }
                Item {
                    width: guideChannels.width - 185
                    height: 58
                    clip: true
                    Repeater {
                        model: familyApi.tvProgramsForChannel(modelData.Id)
                        NativeAction {
                            property double startMs: new Date(modelData.StartDate).getTime()
                            property double endMs: new Date(modelData.EndDate).getTime()
                            x: (Math.max(startMs, window.tvStartMs) - window.tvStartMs) / 7200000 * timelineScroll.width - timelineScroll.contentX
                            width: Math.max(80, (Math.min(endMs, window.tvStartMs + 21600000)
                                - Math.max(startMs, window.tvStartMs)) / 7200000 * timelineScroll.width - 3)
                            height: 58
                            visible: endMs > window.tvStartMs && startMs < window.tvStartMs + 21600000
                                     && x + width > 0 && x < guideChannels.width - 185
                            text: modelData.Name || "No program information"
                            onClicked: window.selectLiveChannel(channelRow.modelData)
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "playlists" || page === "playlistPicker"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 16
            Row {
                spacing: 18
                NativeAction { id: playlistsBackButton; text: "← Back"; onClicked: window.goBack() }
                Text {
                    text: page === "playlistPicker" ? "Add to Playlist" : "Playlists"
                    color: "white"; font.pixelSize: 32; font.bold: true
                }
            }
            Row {
                spacing: 10
                TextField {
                    id: newPlaylistName
                    width: 380
                    height: 48
                    placeholderText: "New playlist name"
                    font.pixelSize: 18
                    onAccepted: window.createNamedPlaylist()
                }
                NativeAction {
                    text: page === "playlistPicker" ? "Create & Add" : "Create Playlist"
                    onClicked: window.createNamedPlaylist()
                }
            }
            Text {
                visible: familyApi.playlists.length === 0
                text: page === "playlistPicker"
                    ? "No playlists yet. Name one above to create it and add this video."
                    : "No playlists yet. Name one above to start a movie-and-show playlist."
                color: familyApi.themeText
                font.pixelSize: 19
                wrapMode: Text.WordWrap
                width: Math.min(parent.width, 760)
            }
            ScrollView {
                visible: familyApi.playlists.length > 0
                width: parent.width
                height: parent.height - 135
                Column {
                    width: Math.max(700, window.width - 90)
                    spacing: 8
                    Repeater {
                        model: familyApi.playlists
                        NativeAction {
                            width: parent.width
                            height: 62
                            text: modelData.Name || "Playlist"
                            onClicked: {
                                if (page === "playlistPicker") {
                                    familyApi.addToPlaylist(modelData.Id, window.playlistTarget)
                                    page = "detail"
                                } else {
                                    window.selectedPlaylistName = modelData.Name || "Playlist"
                                    familyApi.openPlaylist(modelData.Id)
                                    page = "playlist"
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "playlist"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 16
            Row {
                spacing: 18
                NativeAction { id: playlistBackButton; text: "← Playlists"; onClicked: page = "playlists" }
                Text { text: "Playlist"; color: "white"; font.pixelSize: 32; font.bold: true }
                NativeAction {
                    text: familyApi.playlistLoading ? "Loading…" : "▶ Play all"
                    enabled: !familyApi.playlistLoading && familyApi.playlistItems.length > 0
                    onClicked: window.playPlaylistFrom(0)
                }
            }
            Row {
                spacing: 10
                TextField {
                    id: playlistNameInput
                    width: Math.min(380, window.width - 290)
                    height: 48
                    text: window.selectedPlaylistName
                    placeholderText: "Playlist name"
                    onAccepted: window.renameSelectedPlaylist()
                }
                NativeAction {
                    text: "Rename Playlist"
                    onClicked: window.renameSelectedPlaylist()
                }
            }
            Text {
                visible: familyApi.playlistLoading
                height: visible ? 22 : 0
                text: "Loading " + familyApi.playlistItems.length + " playlist items…"
                color: familyApi.themeText; font.pixelSize: 15
            }
            ScrollView {
                id: playlistScroll
                width: parent.width
                height: parent.height - (familyApi.playlistLoading ? 160 : 135)
                Column {
                    width: Math.max(700, window.width - 90)
                    spacing: 8
                    Repeater {
                        id: playlistRows
                        model: familyApi.playlistItems
                        Row {
                            id: playlistRow
                            required property var modelData
                            required property int index
                            spacing: 8
                            function focusNeighbor(delta, column) {
                                const row = playlistRows.itemAt(index + delta)
                                if (!row) return
                                const preferred = row.children[column]
                                if (preferred && preferred.visible && preferred.enabled) {
                                    preferred.forceActiveFocus()
                                    return
                                }
                                for (const action of row.children) {
                                    if (action && action.clicked !== undefined && action.visible && action.enabled) {
                                        action.forceActiveFocus()
                                        return
                                    }
                                }
                            }
                            NativeAction {
                                width: Math.max(300, window.width - 720)
                                height: 62
                                text: window.browseCardTitle(modelData)
                                focusScroll: playlistScroll
                                upAction: function() { playlistRow.focusNeighbor(-1, 0) }
                                downAction: function() { playlistRow.focusNeighbor(1, 0) }
                                onClicked: window.showItem(modelData, "playlist")
                            }
                            NativeAction {
                                width: 170
                                height: 62
                                text: "▶ Play from here"
                                enabled: !familyApi.playlistLoading && (modelData.Type === "Movie" || modelData.Type === "Episode" || modelData.Type === "Video")
                                focusScroll: playlistScroll
                                upAction: function() { playlistRow.focusNeighbor(-1, 1) }
                                downAction: function() { playlistRow.focusNeighbor(1, 1) }
                                onClicked: {
                                    const playableIndex = familyApi.playlistItems.slice(0, index).filter(function(item) {
                                        return item.Type === "Movie" || item.Type === "Episode" || item.Type === "Video"
                                    }).length
                                    window.playPlaylistFrom(playableIndex)
                                }
                            }
                            NativeAction {
                                width: 65
                                height: 62
                                text: "↑"
                                visible: index > 0
                                focusScroll: playlistScroll
                                upAction: function() { playlistRow.focusNeighbor(-1, 2) }
                                downAction: function() { playlistRow.focusNeighbor(1, 2) }
                                onClicked: familyApi.movePlaylistEntry(familyApi.selectedPlaylistId, modelData.PlaylistItemId, index - 1)
                            }
                            NativeAction {
                                width: 65
                                height: 62
                                text: "↓"
                                visible: index < familyApi.playlistItems.length - 1
                                focusScroll: playlistScroll
                                upAction: function() { playlistRow.focusNeighbor(-1, 3) }
                                downAction: function() { playlistRow.focusNeighbor(1, 3) }
                                onClicked: familyApi.movePlaylistEntry(familyApi.selectedPlaylistId, modelData.PlaylistItemId, index + 1)
                            }
                            NativeAction {
                                width: 210
                                height: 62
                                text: "Remove from Playlist"
                                focusScroll: playlistScroll
                                upAction: function() { playlistRow.focusNeighbor(-1, 4) }
                                downAction: function() { playlistRow.focusNeighbor(1, 4) }
                                onClicked: familyApi.removePlaylistEntry(familyApi.selectedPlaylistId, modelData.PlaylistItemId)
                            }
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "detail"
        Column {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            anchors.margins: 44
            spacing: 14
            Text {
                text: window.detailTitle(familyApi.selectedItem.Id ? familyApi.selectedItem : focusedItem)
                color: "white"
                font.pixelSize: 42
                font.bold: true
                width: parent.width
                elide: Text.ElideRight
            }
            Text {
                width: parent.width
                text: window.detailMetadata(familyApi.selectedItem.Id ? familyApi.selectedItem : focusedItem)
                visible: text.length > 0
                color: "#e4edf6"
                font.pixelSize: 18
                elide: Text.ElideRight
            }
            Rectangle {
                width: Math.min(parent.width, 950)
                height: visible ? 64 : 0
                radius: 7
                color: "#593813"
                border.color: "#efb85c"
                visible: Number(familyApi.selectedIssueSummary.activeCount || 0) > 0
                    && ["reported", "investigating"].includes(String(familyApi.selectedIssueSummary.status || "").toLowerCase())
                Text {
                    anchors.fill: parent
                    anchors.margins: 10
                    verticalAlignment: Text.AlignVCenter
                    color: "#fff3d6"
                    font.pixelSize: 17
                    wrapMode: Text.WordWrap
                    text: "Reported playback problem: " + (familyApi.selectedIssueSummary.categories || []).join(", ")
                        + (familyApi.selectedIssueSummary.affectedEpisodeCount ? " · " + familyApi.selectedIssueSummary.affectedEpisodeCount + " affected episodes" : "")
                }
            }
            Text {
                width: Math.min(parent.width, 950)
                text: familyApi.kidsSpoilerHidden(familyApi.selectedItem) ? "" : (familyApi.selectedItem.Overview || "")
                color: "#e4edf6"
                font.pixelSize: 18
                wrapMode: Text.WordWrap
                maximumLineCount: 3
                elide: Text.ElideRight
            }
            Column {
                width: parent.width
                spacing: 6
                visible: familyApi.selectedCast.length > 0
                Text {
                    text: familyApi.selectedItem.Type === "Episode"
                        && (familyApi.selectedItem.People || []).some(function(person) { return person.Type === "GuestStar" })
                        ? "Guest stars" : "Cast"
                    color: familyApi.themeText; font.pixelSize: 20; font.bold: true
                }
                Flickable {
                    width: parent.width
                    height: 94
                    contentWidth: castRow.width
                    contentHeight: height
                    clip: true
                    Row {
                        id: castRow
                        spacing: 12
                        Repeater {
                            model: familyApi.selectedCast
                            Column {
                                width: 112
                                spacing: 3
                                Rectangle {
                                    width: 44; height: 44
                                    anchors.horizontalCenter: parent.horizontalCenter
                                    radius: 22
                                    clip: true
                                    color: familyApi.themeSurface
                                    border.color: familyApi.themeAccentSecondary
                                    Text {
                                        anchors.centerIn: parent
                                        text: (modelData.Name || "?").charAt(0).toUpperCase()
                                        color: familyApi.themeText
                                        font.pixelSize: 20
                                        font.bold: true
                                    }
                                    Artwork {
                                        anchors.fill: parent
                                        item: modelData
                                        purpose: "portrait"
                                        visible: status === Image.Ready
                                    }
                                }
                                Text {
                                    width: parent.width
                                    text: modelData.Name || ""
                                    color: familyApi.themeText; font.pixelSize: 14
                                    horizontalAlignment: Text.AlignHCenter
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: modelData.Role || ""
                                    color: "#cad7e3"; font.pixelSize: 12
                                    horizontalAlignment: Text.AlignHCenter
                                    elide: Text.ElideRight
                                }
                            }
                        }
                    }
                }
            }
            Row {
                id: detailActionRow
                spacing: 8
                transformOrigin: Item.TopLeft
                scale: Math.min(1, (window.width - 88) / Math.max(1, implicitWidth))
                NativeAction { id: detailBackButton; width: 55; text: "Back"; onClicked: window.goBack() }
                NativeAction {
                    width: 105
                    text: familyApi.selectedItem.Type === "Series" ? "Play next"
                        : Number(familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.PlaybackPositionTicks || 0) > 0
                            ? "Resume" : "Play"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Episode"
                        || familyApi.selectedItem.Type === "Series"
                    onClicked: window.playSelected(false)
                }
                NativeAction {
                    width: 105
                    text: "Start over"
                    visible: (familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Episode")
                        && Number(familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.PlaybackPositionTicks || 0) > 0
                    onClicked: window.playSelected(true)
                }
                NativeAction {
                    text: familyApi.isWatchlisted(familyApi.selectedItem.Id || "")
                        ? "− Watchlist" : "+ Watchlist"
                    width: 105
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                    onClicked: familyApi.toggleWatchlist(familyApi.selectedItem)
                }
                NativeAction {
                    text: familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.IsFavorite
                        ? "♥ Favourite" : "♡ Favourite"
                    width: 105
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                          || familyApi.selectedItem.Type === "Episode" || familyApi.selectedItem.Type === "Season"
                    onClicked: familyApi.setFavorite(familyApi.selectedItem,
                        !(familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.IsFavorite))
                }
                NativeAction {
                    text: familyApi.isHouseholdWatchlisted(familyApi.selectedItem.Id || "")
                        ? "− Family List" : "+ Family List"
                    width: 110
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                    onClicked: familyApi.toggleHouseholdWatchlist(familyApi.selectedItem)
                }
                NativeAction {
                    width: 64
                    text: {
                        const entry = window.householdEntry(familyApi.selectedItem.Id || "")
                        return entry && entry.currentUserVoted ? "Unvote" : "Vote"
                    }
                    visible: familyApi.isHouseholdWatchlisted(familyApi.selectedItem.Id || "")
                    onClicked: {
                        const entry = window.householdEntry(familyApi.selectedItem.Id || "")
                        if (entry) familyApi.voteHouseholdWatchlistItem(entry.itemId, !entry.currentUserVoted)
                    }
                }
                NativeAction {
                    width: 105
                    text: "+ Playlist"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                          || familyApi.selectedItem.Type === "Episode"
                    onClicked: {
                        window.playlistTarget = familyApi.selectedItem
                        familyApi.refreshPlaylists()
                        page = "playlistPicker"
                    }
                }
                NativeAction {
                    width: 115
                    fontSize: 14
                    text: "Series options"
                    visible: familyApi.selectedItem.Type === "Series" || familyApi.selectedItem.Type === "Episode"
                    onClicked: {
                        familyApi.refreshSeriesPlaybackPreferences(
                            familyApi.selectedItem.Type === "Series" ? familyApi.selectedItem.Id : familyApi.selectedItem.SeriesId)
                        page = "seriesOptions"
                    }
                }
                NativeAction {
                    width: 72
                    text: "Report"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Episode"
                    onClicked: { window.issueCategory = "noAudio"; window.issueReportPending = false; page = "issueReport" }
                }
                NativeAction {
                    width: 112
                    fontSize: 14
                    text: familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.Played
                        ? "Mark unwatched" : "Mark watched"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                          || familyApi.selectedItem.Type === "Episode" || familyApi.selectedItem.Type === "Season"
                    onClicked: familyApi.setPlayed(familyApi.selectedItem,
                        !(familyApi.selectedItem.UserData && familyApi.selectedItem.UserData.Played))
                }
            }
            Flickable {
                width: parent.width
                height: familyApi.selectedItem.Type === "Series" ? 90 : 0
                visible: height > 0
                contentWidth: seasonRow.width
                clip: true
                Row {
                    id: seasonRow
                    spacing: 9
                    Repeater {
                        model: familyApi.seasons
                        NativeAction {
                            width: 175
                            text: modelData.Name || "Season"
                            onClicked: window.showSeason(modelData)
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "seriesOptions"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 760)
            spacing: 18
            NativeAction { id: seriesOptionsBack; text: "← Show"; onClicked: page = "detail" }
            Text { text: "Series playback options"; color: familyApi.themeText; font.pixelSize: 30; font.bold: true }
            Text {
                width: parent.width
                text: "Shared with Family Flix on Android and the web for this profile and show."
                color: familyApi.themeText; font.pixelSize: 17; wrapMode: Text.WordWrap
            }
            Text {
                text: familyApi.activeSeriesPreferencesBusy ? "Saving…"
                    : familyApi.activeSeriesPreferencesReady ? "" : "Loading this show's choices…"
                color: familyApi.themeText; font.pixelSize: 17
            }
            NativeAction {
                width: 450
                enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                text: "Intro: " + ({ APP_DEFAULT: "App default", ASK: "Ask to skip",
                    AUTO_SKIP: "Auto skip", DO_NOT_SKIP: "Do not skip" })[familyApi.activeSeriesIntroSkipMode]
                onClicked: {
                    const modes = ["APP_DEFAULT", "ASK", "AUTO_SKIP", "DO_NOT_SKIP"]
                    const current = modes.indexOf(familyApi.activeSeriesIntroSkipMode)
                    familyApi.setActiveSeriesPlaybackPreference("introSkipMode", modes[(current + 1) % modes.length])
                }
            }
            NativeAction {
                width: 450
                enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                text: "After episode: " + ({ APP_DEFAULT: "App default", PLAY_NEXT: "Play next",
                    STOP_AFTER_EPISODE: "Stop" })[familyApi.activeSeriesAutoplayMode]
                onClicked: {
                    const modes = ["APP_DEFAULT", "PLAY_NEXT", "STOP_AFTER_EPISODE"]
                    const current = modes.indexOf(familyApi.activeSeriesAutoplayMode)
                    familyApi.setActiveSeriesPlaybackPreference("autoplayMode", modes[(current + 1) % modes.length])
                }
            }
            NativeAction {
                width: 450
                enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                text: "Audio: " + ({ SERVER_DEFAULT: "Server default", PREFER_LANGUAGE: "Preferred language",
                    REMEMBER_LAST_SELECTION: "Remember last choice" })[familyApi.activeSeriesPlaybackValues.audioMode]
                onClicked: {
                    const modes = ["SERVER_DEFAULT", "PREFER_LANGUAGE", "REMEMBER_LAST_SELECTION"]
                    const current = modes.indexOf(familyApi.activeSeriesPlaybackValues.audioMode)
                    familyApi.setActiveSeriesPlaybackPreference("audioMode", modes[(current + 1) % modes.length])
                }
            }
            Text {
                color: familyApi.themeText; font.pixelSize: 16
                text: "Preferred audio language: " + (familyApi.activeSeriesPlaybackValues.preferredAudioLanguage || "not set")
            }
            NativeAction {
                width: 450
                enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                text: "Subtitles: " + ({ SERVER_DEFAULT: "Server default", OFF: "Off",
                    FORCED_ONLY: "Forced only", FULL: "Full" })[familyApi.activeSeriesPlaybackValues.subtitleMode]
                onClicked: {
                    const modes = ["SERVER_DEFAULT", "OFF", "FORCED_ONLY", "FULL"]
                    const current = modes.indexOf(familyApi.activeSeriesPlaybackValues.subtitleMode)
                    familyApi.setActiveSeriesPlaybackPreference("subtitleMode", modes[(current + 1) % modes.length])
                }
            }
            Text {
                color: familyApi.themeText; font.pixelSize: 16
                text: "Preferred subtitle language: " + (familyApi.activeSeriesPlaybackValues.preferredSubtitleLanguage || "any")
            }
            Text {
                width: parent.width; color: familyApi.themeText; font.pixelSize: 15; wrapMode: Text.WordWrap
                text: "To set a language, choose an audio or subtitle track during playback, then use its series-language button."
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "issueReport"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 760)
            spacing: 14
            Text { text: "Report a problem · " + (familyApi.selectedItem.Name || "Video"); color: familyApi.themeText; font.pixelSize: 27; font.bold: true }
            Repeater {
                model: [
                    { value: "noAudio", label: "No audio" },
                    { value: "wrongEpisode", label: "Wrong episode" },
                    { value: "brokenVideo", label: "Broken video" },
                    { value: "subtitles", label: "Subtitles" },
                    { value: "introTiming", label: "Skip timing" },
                    { value: "other", label: "Other" }
                ]
                NativeAction {
                    width: parent.width
                    height: 48
                    text: modelData.label
                    selected: window.issueCategory === modelData.value
                    onClicked: window.issueCategory = modelData.value
                }
            }
            TextArea {
                id: issueNote
                width: parent.width
                height: 90
                placeholderText: "Optional details (up to 1,000 characters)"
                wrapMode: TextEdit.Wrap
                background: Rectangle { color: familyApi.themeSurface; border.color: familyApi.themeAccent; radius: 6 }
                color: familyApi.themeText
                font.pixelSize: 17
                onTextChanged: if (text.length > 1000) text = text.slice(0, 1000)
            }
            Row {
                spacing: 12
                NativeAction { id: issueCancelButton; text: "Cancel"; onClicked: window.goBack() }
                NativeAction {
                    text: window.issueReportPending ? "Sending…" : "Send report"
                    width: 165
                    onClicked: {
                        if (window.issueReportPending) return
                        window.issueReportPending = true
                        familyApi.reportIssue(familyApi.selectedItem.Id, window.issueCategory, issueNote.text)
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "nextEpisode"
        Column {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 800)
            spacing: 16
            Text { text: window.stillWatchingPrompt ? "Still watching?" : "Up next"; color: familyApi.themeText; font.pixelSize: 32; font.bold: true }
            Text {
                width: parent.width
                text: nextEpisode.Id
                    ? window.browseCardTitle(nextEpisode)
                    : "Finding the next unwatched episode…"
                color: familyApi.themeText; font.pixelSize: 23; wrapMode: Text.WordWrap
            }
            Text {
                visible: window.nextUpDeadlineMs > 0
                text: "Playing in " + window.nextUpSecondsRemaining + " seconds"
                color: familyApi.themeText; font.pixelSize: 18
            }
            Artwork {
                width: Math.min(parent.width, 600)
                height: familyApi.nextUpMode === "Minimal" ? 0 : 270
                visible: height > 0
                item: nextEpisode
                purpose: "backdrop"
            }
            Row {
                spacing: 14
                NativeAction {
                    width: 205
                    text: "Play next episode"
                    visible: !!nextEpisode.Id
                    onClicked: {
                        window.nextUpDeadlineMs = 0
                        familyApi.openItem(nextEpisode.Id)
                        window.playItem(nextEpisode, "detail")
                    }
                }
                NativeAction { id: nextEpisodeDoneButton; width: 150; text: "Done"; onClicked: { window.nextUpDeadlineMs = 0; window.goBack() } }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "season"
        Column {
            anchors.fill: parent
            anchors.margins: 35
            spacing: 18
            Row {
                spacing: 15
                NativeAction { id: seasonBackButton; text: "← Show"; onClicked: window.goBack() }
                Text { text: (selectedSeries.Name || "Show") + " · " + (selectedSeason.Name || "Episodes"); color: "white"; font.pixelSize: 30; font.bold: true }
            }
            Text { text: "Season cast"; visible: familyApi.seasonCast.length > 0; color: familyApi.themeText; font.pixelSize: 20; font.bold: true }
            Row {
                spacing: 12
                visible: familyApi.seasonCast.length > 0
                Repeater {
                    model: familyApi.seasonCast
                    Column {
                        width: 112; spacing: 3
                        Artwork {
                            width: 44; height: 44
                            anchors.horizontalCenter: parent.horizontalCenter
                            item: modelData
                            purpose: "portrait"
                        }
                        Text { width: parent.width; text: modelData.Name || ""; color: familyApi.themeText; font.pixelSize: 14; horizontalAlignment: Text.AlignHCenter; elide: Text.ElideRight }
                    }
                }
            }
            ScrollView {
                width: parent.width
                height: Math.max(140, parent.height - (familyApi.seasonCast.length ? 220 : 100))
                Column {
                    width: Math.max(800, window.width - 90)
                    spacing: 8
                    Repeater {
                        model: familyApi.episodes
                        NativeAction {
                            width: parent.width
                            height: 65
                            text: window.episodeListTitle(modelData)
                            onClicked: window.showItem(modelData, "season")
                        }
                    }
                }
            }
        }
    }

    Item {
        id: playerPanel
        anchors.fill: parent
        visible: page === "player"
        focus: visible
        Keys.onEscapePressed: window.goBack()
        Keys.onBackPressed: window.goBack()
        Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Escape || event.key === Qt.Key_Back) return
            if (window.trackMenuVisible) return
            window.playerControlsVisible = true
            controlsTimer.restart()
            if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                if (window.playerPaused) components.player.play()
                else components.player.pause()
                window.playerPaused = !window.playerPaused
                event.accepted = true
            } else if (event.key === Qt.Key_Left || event.key === Qt.Key_Right) {
                const delta = event.key === Qt.Key_Left ? -familyApi.skipBackMs : familyApi.skipForwardMs
                components.player.seekTo(Math.max(0, components.player.getPosition() * 1000 + delta))
                event.accepted = true
            } else if (event.key === Qt.Key_Down) {
                playerPauseButton.forceActiveFocus()
                event.accepted = true
            } else if (event.key === Qt.Key_Up) {
                if (skipPromptButton.visible) skipPromptButton.forceActiveFocus()
                else window.focusPlayerSeek()
                event.accepted = true
            }
        }
        MouseArea {
            anchors.fill: parent
            onClicked: { window.playerControlsVisible = true; controlsTimer.restart(); playerPanel.forceActiveFocus() }
        }
        NativeAction {
            id: skipPromptButton
            anchors.right: parent.right
            anchors.rightMargin: 28
            anchors.bottom: parent.bottom
            anchors.bottomMargin: window.playerControlsVisible ? 165 : 32
            width: 190
            height: 54
            visible: !!window.activeSkipSegment.Key
            text: "Skip " + (window.activeSkipSegment.Type || "segment")
            downAction: function() { playerPauseButton.forceActiveFocus() }
            onClicked: {
                components.player.seekTo(window.activeSkipSegment.End)
                window.activeSkipSegment = ({})
                window.lastSkipSegmentKey = ""
            }
        }
        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 150
            color: "#df08121d"
            visible: window.playerControlsVisible
            Column {
                anchors.fill: parent
                anchors.margins: 10
                spacing: 10
                Row {
                    width: parent.width
                    height: 42
                    spacing: 10
                    Text {
                        width: 80; height: parent.height
                        verticalAlignment: Text.AlignVCenter
                        horizontalAlignment: Text.AlignRight
                        text: window.playerIsLive ? "LIVE" : window.playbackTime(window.playerPositionSeconds)
                        color: "white"; font.pixelSize: 17
                    }
                    Slider {
                        id: playbackSeek
                        width: parent.width - 180
                        height: parent.height
                        visible: !window.playerIsLive
                        enabled: window.playerDurationSeconds > 0
                        activeFocusOnTab: true
                        from: 0
                        to: Math.max(1, window.playerDurationSeconds)
                        value: window.playerPositionSeconds
                        stepSize: 10
                        onMoved: {
                            window.playerPositionSeconds = value
                            components.player.seekTo(Math.round(value * 1000))
                            controlsTimer.restart()
                        }
                        Keys.onDownPressed: playerPauseButton.forceActiveFocus()
                        background: Rectangle {
                            x: playbackSeek.leftPadding
                            y: playbackSeek.topPadding + playbackSeek.availableHeight / 2 - height / 2
                            width: playbackSeek.availableWidth; height: 7; radius: 4
                            color: familyApi.themeAccentSecondary
                            Rectangle {
                                width: parent.width * playbackSeek.visualPosition
                                height: parent.height; radius: parent.radius
                                color: familyApi.themeAccent
                            }
                        }
                        handle: Rectangle {
                            x: playbackSeek.leftPadding + playbackSeek.visualPosition * (playbackSeek.availableWidth - width)
                            y: playbackSeek.topPadding + playbackSeek.availableHeight / 2 - height / 2
                            width: 20; height: 20; radius: 10
                            color: playbackSeek.activeFocus ? familyApi.themeOnAccent : familyApi.themeAccent
                            border.color: familyApi.themeAccentSecondary
                        }
                    }
                    Text {
                        width: 80; height: parent.height
                        verticalAlignment: Text.AlignVCenter
                        text: window.playerIsLive ? "" : window.playbackTime(window.playerDurationSeconds)
                        color: "white"; font.pixelSize: 17
                    }
                }
                Row {
                id: playerControlsRow
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 10
                NativeAction { width: 120; text: "Back"; upAction: function() { window.focusPlayerSeek() }; onClicked: window.goBack() }
                NativeAction {
                    id: playerPauseButton
                    width: 120
                    text: window.playerPaused ? "Play" : "Pause"
                    upAction: function() { window.focusPlayerSeek() }
                    onClicked: {
                        if (window.playerPaused) components.player.play()
                        else components.player.pause()
                        window.playerPaused = !window.playerPaused
                        controlsTimer.restart()
                    }
                }
                NativeAction { width: 120; text: "−" + (familyApi.skipBackMs / 1000) + " sec"; upAction: function() { window.focusPlayerSeek() }; onClicked: { components.player.seekTo(Math.max(0, components.player.getPosition() * 1000 - familyApi.skipBackMs)); controlsTimer.restart() } }
                NativeAction { width: 120; text: "+" + (familyApi.skipForwardMs / 1000) + " sec"; upAction: function() { window.focusPlayerSeek() }; onClicked: { components.player.seekTo(components.player.getPosition() * 1000 + familyApi.skipForwardMs); controlsTimer.restart() } }
                NativeAction {
                    width: 125
                    visible: !window.playerIsLive
                    text: "Speed " + window.playbackSpeed + "×"
                    upAction: function() { window.focusPlayerSeek() }
                    onClicked: {
                        const speeds = [0.75, 1.0, 1.25, 1.5, 2.0]
                        const current = speeds.indexOf(window.playbackSpeed)
                        window.playbackSpeed = speeds[(current + 1) % speeds.length]
                        components.player.setPlaybackRate(Math.round(window.playbackSpeed * 1000))
                        controlsTimer.restart()
                    }
                }
                NativeAction {
                    text: "Audio / Subs"
                    width: 145
                    upAction: function() { window.focusPlayerSeek() }
                    onClicked: {
                        window.availableTracks = components.player.getPlaybackTracks()
                        window.trackMenuVisible = true
                        window.playerControlsVisible = true
                        controlsTimer.stop()
                        tracksCloseButton.forceActiveFocus()
                    }
                }
                Text {
                    text: Qt.formatDateTime(new Date(), "h:mm AP")
                    visible: familyApi.clockBehavior === "ALWAYS" || familyApi.clockBehavior === "IN_VIDEO"
                    color: "white"
                    font.pixelSize: 18
                    anchors.verticalCenter: parent.verticalCenter
                    Timer { interval: 30000; running: window.page === "player"; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "h:mm AP") }
                }
                }
            }
        }
        Rectangle {
            id: tracksPanel
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 620)
            height: Math.min(parent.height - 100, 560)
            color: familyApi.themeScreen
            border.color: familyApi.themeAccent
            border.width: 2
            radius: 12
            visible: window.trackMenuVisible
            focus: visible
            Keys.onEscapePressed: { window.trackMenuVisible = false; playerPanel.forceActiveFocus(); controlsTimer.restart() }
            Keys.onBackPressed: { window.trackMenuVisible = false; playerPanel.forceActiveFocus(); controlsTimer.restart() }
            Column {
                anchors.fill: parent
                anchors.margins: 20
                spacing: 10
                Row {
                    spacing: 12
                    NativeAction {
                        id: tracksCloseButton
                        width: 105; text: "← Close"
                        onClicked: { window.trackMenuVisible = false; playerPanel.forceActiveFocus(); controlsTimer.restart() }
                    }
                    Text { text: "Audio and subtitles"; color: familyApi.themeText; font.pixelSize: 26; font.bold: true; height: 48; verticalAlignment: Text.AlignVCenter }
                }
                ScrollView {
                    width: parent.width
                    height: parent.height - 75
                    Column {
                        width: tracksPanel.width - 45
                        spacing: 7
                        Text { text: "Audio"; color: familyApi.themeText; font.pixelSize: 20; font.bold: true }
                        Repeater {
                            model: window.availableTracks.filter(function(track) { return track.type === "audio" })
                            NativeAction {
                                width: parent.width
                                height: 45
                                text: (modelData.selected ? "✓  " : "") + (modelData.title || modelData.lang || "Audio track") + " · " + modelData.id
                                onClicked: {
                                    window.explicitAudioSelection = true
                                    components.player.setAudioStream(Number(modelData.id))
                                    window.availableTracks = components.player.getPlaybackTracks()
                                    if (window.playingItem.Type === "Episode" && modelData.lang
                                        && familyApi.activeSeriesPlaybackValues.audioMode === "REMEMBER_LAST_SELECTION")
                                        familyApi.setActiveSeriesPlaybackPreference(
                                            "preferredAudioLanguage", String(modelData.lang).toLowerCase())
                                }
                            }
                        }
                        NativeAction {
                            width: parent.width; height: 45
                            visible: window.playingItem.Type === "Episode"
                            enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                            text: "Use selected audio language for this show"
                            onClicked: {
                                const selected = window.availableTracks.find(function(track) {
                                    return track.type === "audio" && track.selected && track.lang
                                })
                                if (selected) familyApi.setActiveSeriesPlaybackPreference(
                                    "preferredAudioLanguage", String(selected.lang).toLowerCase())
                            }
                        }
                        Text { text: "Subtitles"; color: familyApi.themeText; font.pixelSize: 20; font.bold: true }
                        NativeAction { width: parent.width; height: 45; text: "Off"; onClicked: { window.explicitSubtitleSelection = true; components.player.setSubtitleStream(-1); window.availableTracks = components.player.getPlaybackTracks() } }
                        Repeater {
                            model: window.availableTracks.filter(function(track) { return track.type === "sub" })
                            NativeAction {
                                width: parent.width
                                height: 45
                                text: (modelData.selected ? "✓  " : "") + (modelData.title || modelData.lang || "Subtitle track") + " · " + modelData.id
                                onClicked: {
                                    window.explicitSubtitleSelection = true
                                    components.player.setSubtitleStream(Number(modelData.id))
                                    window.availableTracks = components.player.getPlaybackTracks()
                                }
                            }
                        }
                        NativeAction {
                            width: parent.width; height: 45
                            visible: window.playingItem.Type === "Episode"
                            enabled: familyApi.activeSeriesPreferencesReady && !familyApi.activeSeriesPreferencesBusy
                            text: "Use selected subtitle language for this show"
                            onClicked: {
                                const selected = window.availableTracks.find(function(track) {
                                    return track.type === "sub" && track.selected && track.lang
                                })
                                if (selected) familyApi.setActiveSeriesPlaybackPreference(
                                    "preferredSubtitleLanguage", String(selected.lang).toLowerCase())
                            }
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        id: contextOverlay
        anchors.fill: parent
        z: 45
        visible: window.contextOpen && page === "home"
        color: "#dd020810"
        MouseArea { anchors.fill: parent; onClicked: window.closeContext() }
        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width - 80, 590)
            height: Math.min(parent.height - 60, 440)
            radius: 14
            color: familyApi.themeSurface
            border.width: 2
            border.color: familyApi.themeAccent
            Column {
                anchors.fill: parent
                anchors.margins: 22
                spacing: 16
                Text {
                    width: parent.width
                    text: window.contextItem.Name || window.contextItem.SeriesName || "Video"
                    color: familyApi.themeText; font.pixelSize: 25; font.bold: true; elide: Text.ElideRight
                }
                Text { text: "Choose an action"; color: familyApi.themeText; font.pixelSize: 17 }
                GridLayout {
                    columns: 2
                    property int actionColumns: 2
                    columnSpacing: 12
                    rowSpacing: 12
                    NativeAction {
                        id: contextDetails
                        Layout.preferredWidth: 255
                        text: "Details"
                        onClicked: { window.closeContext(); window.showItem(window.contextItem, "home") }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: "Play"
                        visible: window.contextItem.Type === "Movie" || window.contextItem.Type === "Episode"
                        onClicked: { window.closeContext(); window.playItem(window.contextItem, "home") }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: familyApi.isWatchlisted(window.contextItem.Id || "") ? "Remove from Watchlist" : "Add to Watchlist"
                        visible: window.contextItem.Type === "Movie" || window.contextItem.Type === "Series"
                        onClicked: { window.closeContext(); familyApi.toggleWatchlist(window.contextItem) }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: familyApi.isHouseholdWatchlisted(window.contextItem.Id || "") ? "Remove from Family List" : "Add to Family List"
                        visible: window.contextItem.Type === "Movie" || window.contextItem.Type === "Series"
                        onClicked: { window.closeContext(); familyApi.toggleHouseholdWatchlist(window.contextItem) }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: window.contextItem.UserData && window.contextItem.UserData.IsFavorite ? "Remove Favourite" : "Add Favourite"
                        onClicked: {
                            window.closeContext()
                            familyApi.setFavorite(window.contextItem,
                                !(window.contextItem.UserData && window.contextItem.UserData.IsFavorite))
                        }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: "Add to Playlist"
                        onClicked: {
                            window.closeContext()
                            window.playlistTarget = window.contextItem
                            window.detailReturnPage = "home"
                            familyApi.openItem(window.contextItem.Id)
                            familyApi.refreshPlaylists()
                            window.page = "playlistPicker"
                        }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: window.contextItem.UserData && window.contextItem.UserData.Played ? "Mark unwatched" : "Mark watched"
                        onClicked: {
                            window.closeContext()
                            familyApi.setPlayed(window.contextItem,
                                !(window.contextItem.UserData && window.contextItem.UserData.Played))
                        }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: "Report playback problem"
                        visible: window.contextItem.Type === "Movie" || window.contextItem.Type === "Episode"
                        onClicked: {
                            window.closeContext()
                            window.detailReturnPage = "home"
                            window.issueCategory = "noAudio"
                            familyApi.openItem(window.contextItem.Id)
                            window.page = "issueReport"
                        }
                    }
                    NativeAction {
                        Layout.preferredWidth: 255
                        text: "Close"
                        onClicked: window.closeContext()
                    }
                }
            }
        }
    }

    Rectangle {
        id: updatePrompt
        anchors.fill: parent
        z: 50
        visible: !!familyApi.windowsUpdate.downloadUrl && page !== "player"
        color: "#dd020810"
        onVisibleChanged: if (visible) updateDownloadButton.forceActiveFocus()
        MouseArea { anchors.fill: parent }
        Rectangle {
            anchors.centerIn: parent
            width: Math.min(parent.width - 100, 650)
            height: 245
            radius: 12
            color: familyApi.themeSurface
            border.color: familyApi.themeAccent
            Column {
                anchors.fill: parent
                anchors.margins: 22
                spacing: 16
                Text { text: "Family Flix Windows update"; color: familyApi.themeText; font.pixelSize: 28; font.bold: true }
                Text {
                    width: parent.width
                    text: "A newer Windows version is available: " + (familyApi.windowsUpdate.tag || "")
                    color: familyApi.themeText; font.pixelSize: 19; wrapMode: Text.WordWrap
                }
                Text {
                    width: parent.width
                    text: "The installer opens in your browser. Run it after downloading; your Family Flix settings remain in your Windows profile."
                    color: familyApi.themeText; font.pixelSize: 16; wrapMode: Text.WordWrap
                }
                Row {
                    spacing: 12
                    NativeAction {
                        id: updateDownloadButton
                        width: 245
                        text: "Open installer download"
                        onClicked: {
                            Qt.openUrlExternally(familyApi.windowsUpdate.downloadUrl)
                            familyApi.dismissWindowsUpdate()
                        }
                    }
                    NativeAction { width: 150; text: "Not now"; onClicked: familyApi.dismissWindowsUpdate() }
                }
            }
        }
    }

    Rectangle {
        visible: !!notice
        width: Math.min(parent.width - 80, 700)
        height: 56
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 22
        radius: 8
        color: "#293d50"
        Text { anchors.centerIn: parent; text: notice; color: "white"; font.pixelSize: 16 }
    }
}
