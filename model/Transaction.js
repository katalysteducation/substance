import { isFunction } from '../util'
import DocumentChange from './DocumentChange'
import EditingInterface from './EditingInterface'

/*
  A transaction for editing a document in an EditorSession.

  Wherever you see `tx`, it is mostly an instance of this class.

  The transaction is used to manipulate the document in a 'turtle-graphics' style.
  For that it maintains an internal state consisting of an array of operations, a selection, and
  the current surface.

  Usually, at the beginning of a transaction, one Surface is focused. This is used to initialize
  the transaction state. Depending on the type of Surface or the type of the current selection,
  some manipulations are allowed or others are not: it is not possible to create a ContainerAnnotation without
  a ContainerSelection, or pasting a list of nodes into a TextPropertyEditor will strip the structure and just
  the text content.

*/
export default
class Transaction extends EditingInterface {

  /*
    @param {Document} doc
  */
  constructor(doc, editorSession) {
    super(doc.newInstance())

    // using a different name internally
    this.master = doc
    this.stage = this._document
    this._editorSession = editorSession

    // internal state
    this._isTransacting = false
    this._surface = null
  }

  dispose() {
    this.stage.dispose()
  }

  // internal API

  get ops() {
    return this.stage._ops
  }

  set ops(ops) {
    this.stage._ops = ops
  }

  _reset() {
    this._before = {}
    this._after = {}
    this.stage._ops.length = 0
    this._info = {}
    this.setSelection(null)
  }

  /**
    Start a transaction to manipulate the document

    @param {function} transformation a function(tx) that performs actions on the transaction document tx

    @example

    ```js
    doc.transaction(function(tx, args) {
      tx.update(...)
      ...
      return {
        selection: newSelection
      }
    })
    ```
  */
  _recordChange(transformation, selection) {
    if (this._isTransacting) throw new Error('Nested transactions are not supported.')
    if (!isFunction(transformation)) throw new Error('Document.transaction() requires a transformation function.')
    let hasFinished = false
    this._isTransacting = true
    this._reset()
    let change
    try {
      this.setSelection(selection)
      let selBefore = this.getSelection()
      transformation(this, {
        selection: selBefore
      })
      let ops = this.ops
      if (ops.length > 0) {
        change = new DocumentChange(ops, this._before, this._after)
        change.before = { selection: selBefore }
        change.after = { selection: this.getSelection() }
      }
      hasFinished = true
    } finally {
      if (!hasFinished) {
        this._rollback()
      }
      this._isTransacting = false
    }
    return change
  }

  _sync() {
    const master = this.master
    const stage = this.stage
    let ops = master._ops
    for (let i = 0; i < ops.length; i++) {
      stage._applyOp(ops[i])
    }
    ops.length = 0
  }

  _rollback() {
    const stage = this.stage
    let ops = this._stage._ops
    for (let i = ops.length - 1; i >= 0; i--) {
      stage._applyOp(ops[i].invert())
    }
    ops.length = 0
  }

}
