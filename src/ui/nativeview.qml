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
        for (const entry of familyApi.watchlistEntries) {
            if (entry.itemType === type) result.push(entry)
        }
        return result
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
        } else if (page === "season") {
            familyApi.openItem(selectedSeries.Id || "")
            page = "detail"
        } else if (page !== "home" && familyApi.signedIn) {
            page = "home"
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
        if (familyApi.signedIn) familyApi.refreshHome()
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
            if (window.page === "player")
                familyApi.reportPlaybackStart(familyApi.selectedItem, components.player.getPosition() * 1000)
        }
        function onPaused() {
            if (window.page === "player")
                familyApi.reportPlaybackProgress(components.player.getPosition() * 1000, true)
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
        visible: page === "login"
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
        }
    }

    Item {
        anchors.fill: parent
        visible: page === "home"
        Rectangle {
            id: sidebar
            width: 220
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            color: "#e50b1724"
            Column {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 8
                Text { text: "Family Flix"; color: "white"; font.pixelSize: 27; font.bold: true; height: 60 }
                NativeAction {
                    id: homeButton
                    width: parent.width
                    text: "Home"
                    selected: true
                    upAction: function() { profileButton.forceActiveFocus() }
                    rightAction: function() { window.focusCard(0, 0) }
                    onClicked: homeScroll.contentY = 0
                }
                Repeater {
                    model: familyApi.libraries
                    NativeAction {
                        width: 188
                        text: modelData.Name || "Library"
                        rightAction: function() { window.focusCard(0, 0) }
                        onClicked: window.scrollToSection(modelData.Name)
                    }
                }
                NativeAction { width: parent.width; text: "All Libraries"; onClicked: notice = "Library browser is being ported" }
                NativeAction { width: parent.width; text: "Watchlist"; onClicked: { familyApi.refreshWatchlist(); page = "watchlist" } }
                NativeAction { width: parent.width; text: "Playlists"; onClicked: notice = "Playlist screen is being ported" }
                NativeAction { width: parent.width; text: "Live TV"; onClicked: notice = "TV guide is being ported" }
                NativeAction { width: parent.width; text: "Settings"; onClicked: notice = "Settings screen is being ported" }
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
            onClicked: familyApi.signOut()
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
                            text: modelData.title || "Movie"
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
                            text: modelData.title || "Show"
                            onClicked: window.showItem({ Id: modelData.itemId, Name: modelData.title }, "watchlist")
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
        anchors.fill: parent
        visible: page === "player"
        focus: visible
        Keys.onEscapePressed: window.goBack()
        Keys.onBackPressed: window.goBack()
        NativeAction {
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.margins: 24
            text: "Back to details"
            onClicked: window.goBack()
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
