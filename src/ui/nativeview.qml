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
    color: "#08121d"

    property string page: familyApi.signedIn ? "home" : "login"
    property string chosenUser: ""
    property var focusedItem: ({})
    property var selectedSeries: ({})
    property string detailReturnPage: "home"
    property string notice: ""
    property bool playerControlsVisible: false
    property bool playerPaused: false
    property bool sidebarExpanded: true
    property int lastHomeRow: 0
    property int lastHomeCard: 0
    property string watchlistMode: "personal"
    property var playlistTarget: ({})
    property var homeRows: {
        let rows = []
        if (familyApi.continueItems.length) rows.push({ title: "Continue Watching", items: familyApi.continueItems })
        if (familyApi.deckItems.length) rows.push({ title: "The Deck", items: familyApi.deckItems })
        for (let row of familyApi.libraryRows) {
            if (row.Items && row.Items.length) rows.push({ title: row.Name, items: row.Items })
        }
        return rows
    }

    function showItem(item, returnPage) {
        focusedItem = item
        detailReturnPage = returnPage || "home"
        familyApi.openItem(item.Id || "")
        page = "detail"
    }

    function showSeason(season) {
        if (familyApi.selectedItem.Type !== "Series") return
        selectedSeries = familyApi.selectedItem
        familyApi.openSeason(season.Id || "")
        page = "season"
    }

    function watchlistOfType(type) {
        const result = []
        const entries = watchlistMode === "household" ? familyApi.householdWatchlistEntries : familyApi.watchlistEntries
        for (const entry of entries) {
            if (entry.itemType === type) result.push(entry)
        }
        return result
    }

    function householdEntry(itemId) {
        for (const entry of familyApi.householdWatchlistEntries) {
            if (entry.itemId === itemId) return entry
        }
        return null
    }

    function playSelected() {
        const item = familyApi.selectedItem
        if (!item.Id || item.Type === "Series" || item.Type === "Season") return
        const stream = familyApi.streamUrl(item.Id)
        if (!stream) return
        const resume = Number(item.UserData && item.UserData.PlaybackPositionTicks || 0) / 10000
        const metadata = { type: "video", metadata: item,
            headers: { "User-Agent": "FamilyFlixWindows" }, media: {} }
        if (components.player.load(stream, { autoplay: true, startMilliseconds: resume }, metadata, 1, -1)) {
            page = "player"
        }
    }

    function goBack() {
        if (page === "player") {
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            components.player.stop()
            page = "detail"
        } else if (page === "detail") {
            page = detailReturnPage
            if (page === "home") Qt.callLater(function() { window.focusCard(lastHomeRow, lastHomeCard) })
        } else if (page === "season") {
            familyApi.openItem(selectedSeries.Id || "")
            page = "detail"
        } else if (page === "playlistPicker") {
            page = "detail"
        } else if (page === "playlist") {
            page = "playlists"
        } else if (page !== "home" && familyApi.signedIn) {
            page = "home"
        }
    }

    onPageChanged: {
        if (page === "player") {
            playerControlsVisible = false
            playerPaused = false
            playerPanel.forceActiveFocus()
        }
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

    Component.onCompleted: {
        if (familyApi.signedIn) {
            familyApi.refreshHome()
            familyApi.refreshWatchlist()
            familyApi.refreshHouseholdWatchlist()
        }
        else familyApi.refreshPublicUsers()
    }
    Shortcut { sequence: "Esc"; onActivated: window.goBack() }
    Shortcut { sequence: "Backspace"; onActivated: window.goBack() }
    Shortcut { sequence: "F11"; onActivated: window.visibility = window.visibility === Window.FullScreen ? Window.Windowed : Window.FullScreen }

    Connections {
        target: familyApi
        function onSessionChanged() {
            window.page = familyApi.signedIn ? "home" : "login"
            if (!familyApi.signedIn) {
                window.chosenUser = ""
                password.clear()
            }
        }
        function onErrorOccurred(message) {
            window.notice = message
            noticeTimer.restart()
        }
    }
    Connections {
        target: components.player
        function onPlaying() {
            if (window.page === "player") {
                window.playerPaused = false
                familyApi.reportPlaybackStart(familyApi.selectedItem, components.player.getPosition() * 1000)
            }
        }
        function onPaused() {
            if (window.page === "player") {
                window.playerPaused = true
                familyApi.reportPlaybackProgress(components.player.getPosition() * 1000, true)
            }
        }
        function onFinished() {
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            window.page = "detail"
        }
        function onCanceled() {
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            window.page = "detail"
        }
        function onError(message) {
            if (window.page !== "player") return
            familyApi.reportPlaybackStopped(components.player.getPosition() * 1000)
            window.notice = message
            window.page = "detail"
        }
    }
    Timer {
        interval: 10000
        repeat: true
        running: window.page === "player"
        onTriggered: familyApi.reportPlaybackProgress(components.player.getPosition() * 1000, false)
    }
    Timer { id: noticeTimer; interval: 6000; onTriggered: window.notice = "" }
    Timer { id: controlsTimer; interval: 6000; onTriggered: window.playerControlsVisible = false }

    // The desktop shell and cards are Qt Quick controls, not the Jellyfin web client.
    Image {
        anchors.fill: parent
        source: page === "player" ? "" : familyApi.imageUrl(focusedItem.Id || "", "Backdrop")
        fillMode: Image.PreserveAspectCrop
        opacity: page === "home" || page === "detail" ? 0.32 : 0
    }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0; color: "#bf07121e" }
            GradientStop { position: 1; color: "#f008111b" }
        }
        visible: page !== "player"
    }

    MpvVideoItem {
        id: video
        objectName: "video"
        anchors.fill: parent
        visible: page === "player"
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
                            password.forceActiveFocus()
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
                NativeAction { text: "Back to Home"; onClicked: page = "home" }
                NativeAction { text: "Sign out"; onClicked: familyApi.signOut() }
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
            color: "#e50b1724"
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
                    width: parent.width
                    text: window.sidebarExpanded ? "Home" : "☰"
                    selected: true
                    focusScroll: sidebarScroll
                    onActiveFocusChanged: if (activeFocus) window.sidebarExpanded = true
                    upAction: function() { profileButton.forceActiveFocus() }
                    rightAction: function() { window.focusCard(0, 0) }
                    onClicked: homeScroll.contentY = 0
                }
                Repeater {
                    model: familyApi.railLibraries
                    NativeAction {
                        width: parent.width
                        visible: window.sidebarExpanded
                        text: modelData.Name || "Library"
                        focusScroll: sidebarScroll
                        rightAction: function() { window.focusCard(0, 0) }
                        onClicked: window.scrollToSection(modelData.Name)
                    }
                }
                NativeAction { width: parent.width; visible: window.sidebarExpanded; text: "All Libraries"; focusScroll: sidebarScroll; onClicked: notice = "Library browser is being ported" }
                NativeAction { width: parent.width; visible: window.sidebarExpanded; text: "Watchlist"; focusScroll: sidebarScroll; onClicked: { familyApi.refreshWatchlist(); familyApi.refreshHouseholdWatchlist(); page = "watchlist" } }
                NativeAction { width: parent.width; visible: window.sidebarExpanded; text: "Playlists"; focusScroll: sidebarScroll; onClicked: { familyApi.refreshPlaylists(); page = "playlists" } }
                NativeAction { width: parent.width; visible: window.sidebarExpanded; text: "Live TV"; focusScroll: sidebarScroll; onClicked: notice = "TV guide is being ported" }
                NativeAction { width: parent.width; visible: window.sidebarExpanded; text: "Settings"; focusScroll: sidebarScroll; onClicked: page = "settings" }
              }
            }
        }
        Text {
            text: Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP")
            anchors.top: parent.top
            anchors.topMargin: 22
            anchors.horizontalCenter: parent.horizontalCenter
            color: "white"
            font.pixelSize: 18
            Timer { interval: 30000; running: true; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "ddd MMM d  •  h:mm AP") }
        }
        NativeAction {
            id: profileButton
            width: 170
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.margins: 16
            text: familyApi.userName
            downAction: function() { homeButton.forceActiveFocus() }
            onClicked: {
                chosenUser = ""
                password.clear()
                familyApi.refreshPublicUsers()
                page = "profile"
            }
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
                                        width: 226
                                        height: 170
                                        radius: 9
                                        color: "#25374a"
                                        border.width: card.activeFocus ? 3 : 0
                                        border.color: "#ffd36a"
                                        focus: false
                                        activeFocusOnTab: true
                                        onActiveFocusChanged: if (activeFocus) {
                                            window.lastHomeRow = section.index
                                            window.lastHomeCard = card.index
                                            window.sidebarExpanded = false
                                        }
                                        Image {
                                            anchors.fill: parent
                                            anchors.margins: 3
                                            source: familyApi.imageUrl(card.modelData.Id || "", "Backdrop")
                                            fillMode: Image.PreserveAspectCrop
                                        }
                                        Rectangle { anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom; height: 54; color: "#d908111b" }
                                        Text {
                                            anchors.left: parent.left; anchors.right: parent.right; anchors.bottom: parent.bottom
                                            anchors.margins: 8
                                            text: card.modelData.SeriesName || card.modelData.Name || ""
                                            color: "white"; font.pixelSize: 15; elide: Text.ElideRight
                                        }
                                        MouseArea { anchors.fill: parent; onClicked: { card.forceActiveFocus(); window.showItem(card.modelData) } }
                                        Keys.onReturnPressed: window.showItem(modelData)
                                        Keys.onEnterPressed: window.showItem(modelData)
                                        Keys.onLeftPressed: {
                                            if (card.index > 0) window.focusCard(section.index, card.index - 1)
                                            else homeButton.forceActiveFocus()
                                        }
                                        Keys.onRightPressed: window.focusCard(section.index, card.index + 1)
                                        Keys.onUpPressed: window.focusCard(section.index - 1, 0)
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
        visible: page === "watchlist"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 24
            Row {
                spacing: 20
                NativeAction { text: "← Home"; onClicked: page = "home" }
                Text { text: "Watchlist"; color: "white"; font.pixelSize: 33; font.bold: true }
                NativeAction { text: "My List"; selected: watchlistMode === "personal"; onClicked: watchlistMode = "personal" }
                NativeAction { text: "Family List"; selected: watchlistMode === "household"; onClicked: watchlistMode = "household" }
            }
            Text { text: "Movies"; color: "white"; font.pixelSize: 24; font.bold: true }
            Flickable {
                width: parent.width
                height: 190
                contentWidth: movieRow.width
                clip: true
                Row {
                    id: movieRow
                    spacing: 12
                    Repeater {
                        model: window.watchlistOfType("movie")
                        NativeAction {
                            width: 225
                            height: 160
                            text: (modelData.title || "Movie") + (watchlistMode === "household" ? "  ·  " + (modelData.voteCount || 0) + " votes" : "")
                            onClicked: window.showItem({ Id: modelData.itemId, Name: modelData.title }, "watchlist")
                        }
                    }
                }
            }
            Text { text: "Shows"; color: "white"; font.pixelSize: 24; font.bold: true }
            Flickable {
                width: parent.width
                height: 190
                contentWidth: showRow.width
                clip: true
                Row {
                    id: showRow
                    spacing: 12
                    Repeater {
                        model: window.watchlistOfType("series")
                        NativeAction {
                            width: 225
                            height: 160
                            text: (modelData.title || "Show") + (watchlistMode === "household" ? "  ·  " + (modelData.voteCount || 0) + " votes" : "")
                            onClicked: window.showItem({ Id: modelData.itemId, Name: modelData.title }, "watchlist")
                        }
                    }
                }
            }
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "settings"
        Column {
            anchors.fill: parent
            anchors.margins: 40
            spacing: 16
            Row {
                spacing: 18
                NativeAction { text: "← Home"; onClicked: page = "home" }
                Text { text: "Family Flix Settings"; color: "white"; font.pixelSize: 32; font.bold: true }
            }
            Text { text: "Libraries on the left menu"; color: "white"; font.pixelSize: 23; font.bold: true }
            Text {
                text: "Hidden libraries stay on Home. Move changes both menu and Home order."
                color: "#c8d5e3"; font.pixelSize: 16
            }
            ScrollView {
                width: parent.width
                height: parent.height - 155
                Column {
                    width: Math.max(800, window.width - 90)
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
                NativeAction { text: "← Back"; onClicked: window.goBack() }
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
                    onAccepted: {
                        familyApi.createPlaylist(text)
                        text = ""
                    }
                }
                NativeAction {
                    text: "Create Playlist"
                    onClicked: {
                        familyApi.createPlaylist(newPlaylistName.text)
                        newPlaylistName.clear()
                    }
                }
            }
            ScrollView {
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
                NativeAction { text: "← Playlists"; onClicked: page = "playlists" }
                Text { text: "Playlist"; color: "white"; font.pixelSize: 32; font.bold: true }
            }
            ScrollView {
                width: parent.width
                height: parent.height - 75
                Column {
                    width: Math.max(700, window.width - 90)
                    spacing: 8
                    Repeater {
                        model: familyApi.playlistItems
                        Row {
                            required property var modelData
                            required property int index
                            spacing: 8
                            NativeAction {
                                width: Math.max(450, window.width - 510)
                                height: 62
                                text: (modelData.SeriesName ? modelData.SeriesName + " — " : "") + (modelData.Name || "Video")
                                onClicked: window.showItem(modelData, "playlist")
                            }
                            NativeAction {
                                width: 65
                                height: 62
                                text: "↑"
                                visible: index > 0
                                onClicked: familyApi.movePlaylistEntry(familyApi.selectedPlaylistId, modelData.PlaylistItemId, index - 1)
                            }
                            NativeAction {
                                width: 65
                                height: 62
                                text: "↓"
                                visible: index < familyApi.playlistItems.length - 1
                                onClicked: familyApi.movePlaylistEntry(familyApi.selectedPlaylistId, modelData.PlaylistItemId, index + 1)
                            }
                            NativeAction {
                                width: 210
                                height: 62
                                text: "Remove from Playlist"
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
                text: familyApi.selectedItem.Name || focusedItem.Name || ""
                color: "white"
                font.pixelSize: 42
                font.bold: true
            }
            Text {
                width: Math.min(parent.width, 950)
                text: familyApi.selectedItem.Overview || ""
                color: "#e4edf6"
                font.pixelSize: 18
                wrapMode: Text.WordWrap
                maximumLineCount: 5
                elide: Text.ElideRight
            }
            Row {
                spacing: 8
                NativeAction { text: "Back"; onClicked: window.goBack() }
                NativeAction {
                    text: "Play"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Episode"
                    onClicked: window.playSelected()
                }
                NativeAction {
                    text: familyApi.isWatchlisted(familyApi.selectedItem.Id || "")
                        ? "Remove from Watchlist" : "Add to Watchlist"
                    width: 215
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                    onClicked: familyApi.toggleWatchlist(familyApi.selectedItem)
                }
                NativeAction {
                    text: familyApi.isHouseholdWatchlisted(familyApi.selectedItem.Id || "")
                        ? "Remove from Family List" : "Add to Family List"
                    width: 210
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                    onClicked: familyApi.toggleHouseholdWatchlist(familyApi.selectedItem)
                }
                NativeAction {
                    width: 110
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
                    width: 180
                    text: "Add to Playlist"
                    visible: familyApi.selectedItem.Type === "Movie" || familyApi.selectedItem.Type === "Series"
                          || familyApi.selectedItem.Type === "Episode"
                    onClicked: {
                        window.playlistTarget = familyApi.selectedItem
                        familyApi.refreshPlaylists()
                        page = "playlistPicker"
                    }
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
        visible: page === "season"
        Column {
            anchors.fill: parent
            anchors.margins: 35
            spacing: 18
            Row {
                spacing: 15
                NativeAction { text: "← Show"; onClicked: window.goBack() }
                Text { text: selectedSeries.Name || "Episodes"; color: "white"; font.pixelSize: 30; font.bold: true }
            }
            ScrollView {
                width: parent.width
                height: parent.height - 100
                Column {
                    width: Math.max(800, window.width - 90)
                    spacing: 8
                    Repeater {
                        model: familyApi.episodes
                        NativeAction {
                            width: parent.width
                            height: 65
                            text: "Episode " + (modelData.IndexNumber || "") + "  ·  " + (modelData.Name || "")
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
            window.playerControlsVisible = true
            controlsTimer.restart()
            if (event.key === Qt.Key_Space || event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                if (window.playerPaused) components.player.play()
                else components.player.pause()
                window.playerPaused = !window.playerPaused
                event.accepted = true
            } else if (event.key === Qt.Key_Left || event.key === Qt.Key_Right) {
                const delta = event.key === Qt.Key_Left ? -10000 : 10000
                components.player.seekTo(Math.max(0, components.player.getPosition() * 1000 + delta))
                event.accepted = true
            }
        }
        MouseArea {
            anchors.fill: parent
            onClicked: { window.playerControlsVisible = true; controlsTimer.restart(); playerPanel.forceActiveFocus() }
        }
        Rectangle {
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: 106
            color: "#df08121d"
            visible: window.playerControlsVisible
            Row {
                anchors.centerIn: parent
                spacing: 14
                NativeAction { text: "Back"; onClicked: window.goBack() }
                NativeAction {
                    text: window.playerPaused ? "Play" : "Pause"
                    onClicked: {
                        if (window.playerPaused) components.player.play()
                        else components.player.pause()
                        window.playerPaused = !window.playerPaused
                        controlsTimer.restart()
                    }
                }
                NativeAction { text: "−10 sec"; onClicked: { components.player.seekTo(Math.max(0, components.player.getPosition() * 1000 - 10000)); controlsTimer.restart() } }
                NativeAction { text: "+10 sec"; onClicked: { components.player.seekTo(components.player.getPosition() * 1000 + 10000); controlsTimer.restart() } }
                Text {
                    text: Qt.formatDateTime(new Date(), "h:mm AP")
                    color: "white"
                    font.pixelSize: 18
                    anchors.verticalCenter: parent.verticalCenter
                    Timer { interval: 30000; running: window.page === "player"; repeat: true; onTriggered: parent.text = Qt.formatDateTime(new Date(), "h:mm AP") }
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
