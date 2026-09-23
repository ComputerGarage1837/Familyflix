import QtQuick

FocusScope {
    id: action
    property string text: ""
    property color accent: "#ffd36a"
    property bool selected: false
    property var upAction: null
    property var downAction: null
    property var leftAction: null
    property var rightAction: null
    property var focusScroll: null
    signal clicked()
    width: 160
    height: 48
    activeFocusOnTab: true

    onActiveFocusChanged: {
        if (!activeFocus || !focusScroll) return
        const top = action.mapToItem(focusScroll.contentItem, 0, 0).y
        if (top < focusScroll.contentY)
            focusScroll.contentY = Math.max(0, top - 8)
        else if (top + height > focusScroll.contentY + focusScroll.height)
            focusScroll.contentY = Math.min(focusScroll.contentHeight - focusScroll.height,
                                            top + height - focusScroll.height + 8)
    }

    function moveAmongSiblings(direction) {
        if (!parent) return
        const actions = []
        for (let item of parent.children) {
            if (item && item.clicked !== undefined && item.visible) actions.push(item)
        }
        const index = actions.indexOf(action)
        const next = actions[index + direction]
        if (next) next.forceActiveFocus()
    }

    Keys.onReturnPressed: clicked()
    Keys.onEnterPressed: clicked()
    Keys.onSpacePressed: clicked()
    Keys.onUpPressed: upAction ? upAction() : moveAmongSiblings(-1)
    Keys.onDownPressed: downAction ? downAction() : moveAmongSiblings(1)
    Keys.onLeftPressed: leftAction ? leftAction() : moveAmongSiblings(-1)
    Keys.onRightPressed: rightAction ? rightAction() : moveAmongSiblings(1)

    Rectangle {
        anchors.fill: parent
        radius: 9
        border.width: action.activeFocus ? 3 : 1
        border.color: action.activeFocus ? action.accent : "#607080"
        color: action.activeFocus ? action.accent : (action.selected ? "#34475a" : "#182736")
    }
    Text {
        anchors.fill: parent
        anchors.margins: 7
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        color: action.activeFocus ? "#111b25" : "#ffffff"
        font.pixelSize: 16
        font.bold: action.activeFocus
        elide: Text.ElideRight
        text: action.text
    }
    MouseArea {
        anchors.fill: parent
        onClicked: {
            action.forceActiveFocus()
            action.clicked()
        }
    }
}
