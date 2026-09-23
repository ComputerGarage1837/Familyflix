import QtQuick

FocusScope {
    id: action
    property string text: ""
    property color accent: "#ffd36a"
    property bool selected: false
    signal clicked()
    width: 160
    height: 48
    activeFocusOnTab: true

    function moveAmongSiblings(direction) {
        if (!parent) return
        const actions = parent.children.filter(item => item && item.clicked !== undefined && item.visible)
        const index = actions.indexOf(action)
        const next = actions[index + direction]
        if (next) next.forceActiveFocus()
    }

    Keys.onReturnPressed: clicked()
    Keys.onEnterPressed: clicked()
    Keys.onSpacePressed: clicked()
    Keys.onUpPressed: moveAmongSiblings(-1)
    Keys.onDownPressed: moveAmongSiblings(1)
    Keys.onLeftPressed: moveAmongSiblings(-1)
    Keys.onRightPressed: moveAmongSiblings(1)

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
