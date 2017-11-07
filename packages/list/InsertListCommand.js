import { Command } from '../../ui'

class InsertListCommand extends Command {
  getCommandState (params) {
    let sel = this._getSelection(params)
    let selectionState = params.editorSession.getSelectionState()
    let commandState = { disabled: false }
    let _disabledCollapsedCursor = this.config.disableCollapsedCursor && sel.isCollapsed()
    if (_disabledCollapsedCursor || !sel.isPropertySelection() || selectionState.isInlineNodeSelection()) {
      commandState.disabled = true
    }
    return commandState
  }
  execute (params) {
    let ordered = this.config.ordered
    let editorSession = params.editorSession
    editorSession.transaction((tx) => {
      tx.selection = tx.getEditing('list').toggle(tx, tx.selection, { ordered: ordered })
    })
  }
}

export default InsertListCommand
