import { isArrayEqual, isString, uuid } from '../util'
import annotationHelpers from './annotationHelpers'
import documentHelpers from './documentHelpers'
import { setCursor } from './selectionHelpers'
import paste from './paste'
import NodeEditing from './NodeEditing'
import TextNodeEditing from './TextNodeEditing'
import ContainerEditing from './ContainerEditing'

/**
  Core editing implementation, that controls meta behavior
  such as deleting a selection, merging nodes, etc.

  Some of the implementation are then delegated to specific editing behaviors,
  such as manipulating content of a text-property, merging or breaking text nodes

  Note: this is pretty much the same what we did with transforms before.
        We decided to move this here, to switch to a stateful editor implementation (aka turtle-graphics-style)
 */
export default class Editing {
  constructor(behaviours) {
    this.behaviours = {
      default: new NodeEditing(),
      text: new TextNodeEditing(),
      container: new ContainerEditing(),
    }

    Object.getOwnPropertyNames(behaviours).forEach(name => {
      this.behaviours[name] = new behaviours[name]()
    })
  }

  getEditing(type) {
    if (typeof type !== 'string') {
      type = type.getEditing()
    }
    return this.behaviours[type] || this.behaviours.default
  }

  // create an annotation for the current selection using the given data
  annotate(tx, annotation) {
    let sel = tx.selection
    let schema = tx.getSchema()
    let AnnotationClass = schema.getNodeClass(annotation.type)
    if (!AnnotationClass) throw new Error('Unknown annotation type', annotation)
    let start = sel.start
    let end = sel.end
    let containerId = sel.containerId
    let nodeData = { start, end, containerId }
    /* istanbul ignore else  */
    if (sel.isPropertySelection()) {
      if (!AnnotationClass.prototype._isAnnotation) {
        throw new Error('Annotation can not be created for a selection.')
      }
    } else if (sel.isContainerSelection()) {
      if (AnnotationClass.prototype._isPropertyAnnotation) {
        console.warn('NOT SUPPORTED YET: creating property annotations for a non collapsed container selection.')
      }
    }
    Object.assign(nodeData, annotation)
    return tx.create(nodeData)
  }

  break(tx, options) {
    let sel = tx.selection
    let container = tx.get(sel.containerId)
    let cntedit = this.getEditing(container)

    if (sel.isNodeSelection()) {
      let nodeId = sel.getNodeId()
      let nodePos = container.getPosition(nodeId, 'strict')
      let textNode = tx.createDefaultTextNode()
      if (sel.isBefore()) {
        cntedit.show(tx, container, textNode, nodePos)
        // Leave selection as is
      } else {
        cntedit.show(tx, container, textNode, nodePos + 1)
        setCursor(tx, textNode, container.id, 'before')
      }
    } else if (sel.isCustomSelection()) {
      throw new Error("not implemented")
    } else if (sel.isPropertySelection()) {
      if (!sel.isCollapsed()) {
        cntedit.deleteRange(tx, container, sel.start, sel.end, Object.assign({}, { noMerge: true }, options))
      }
      sel = cntedit.break(tx, container, sel.start, options)
      tx.setSelection(sel)
    } else if (sel.isContainerSelection()) {
      let nodePos = container.getPosition(sel.start.path[0], 'strict')
      this.getEditing(container).deleteRange(tx, container, sel.start, sel.end, { noMerge: true })
      setCursor(tx, container.getNodeAt(nodePos+1), sel.containerId, 'before')
    }
  }

  delete(tx, direction) {
    let sel = tx.selection
    let container = tx.get(sel.containerId)

    if (sel.isNodeSelection()) {
      this._deleteNodeSelection(tx, container, sel, direction)
    } else if (sel.isCustomSelection()) {
      throw new Error("not implemented")
    } else if (sel.isPropertySelection() && sel.isCollapsed()) {
      if (container) {
        let cntedit = this.getEditing(container)
        sel = cntedit.deleteCharacter(tx, container, sel.start, direction, null, {
          node: container,
          editing: cntedit,
        }) || sel
      } else {
        let node = tx.get(sel.start.path[0])
        let editing = this.getEditing(node)
        sel = editing.deleteCharacter(tx, node, sel.start, direction, null, null) || sel
      }
      tx.setSelection(sel)
    } else if (sel.isPropertySelection()) {
      documentHelpers.deleteTextRange(tx, sel.start, sel.end)
      tx.setSelection(sel.collapse('left'))
    } else if (sel.isContainerSelection()) {
      let cntedit = this.getEditing(container)
      sel = cntedit.deleteRange(tx, container, sel.start, sel.end)
      tx.setSelection(sel)
    } else {
      console.warn('Unsupported case: tx.delete(%)', direction, sel)
      return sel
    }
  }

  _deleteNodeSelection(tx, container, sel, direction) {
    let cntedit = this.getEditing(container)
    let nodeId = sel.getNodeId()
    let nodePos = container.getPosition(nodeId, 'strict')
    if (sel.isFull() ||
        sel.isBefore() && direction === 'right' ||
        sel.isAfter() && direction === 'left' ) {
      // replace the node with default text node
      cntedit.hideAt(tx, container, nodePos)
      documentHelpers.deleteNode(tx, tx.get(nodeId))
      let newNode = tx.createDefaultTextNode()
      cntedit.show(tx, container, newNode, nodePos)
      tx.setSelection({
        type: 'property',
        path: newNode.getTextPath(),
        startOffset: 0,
        containerId: container.id,
      })
    } else {
      /* istanbul ignore else  */
      if (sel.isBefore() && direction === 'left') {
        if (nodePos > 0) {
          let previous = container.getNodeAt(nodePos-1)
          if (previous.isText()) {
            tx.setSelection({
              type: 'property',
              path: previous.getTextPath(),
              startOffset: previous.getLength()
            })
            this.delete(tx, direction)
          } else {
            tx.setSelection({
              type: 'node',
              nodeId: previous.id,
              containerId: container.id
            })
          }
        } else {
          // nothing to do
        }
      } else if (sel.isAfter() && direction === 'right') {
        if (nodePos < container.getLength()-1) {
          let next = container.getNodeAt(nodePos+1)
          if (next.isText()) {
            tx.setSelection({
              type: 'property',
              path: next.getTextPath(),
              startOffset: 0
            })
            this.delete(tx, direction)
          } else {
            tx.setSelection({
              type: 'node',
              nodeId: next.id,
              containerId: container.id
            })
          }
        } else {
          // nothing to do
        }
      } else {
        console.warn('Unsupported case: delete(%s)', direction, sel)
      }
    }
  }

  insertInlineNode(tx, nodeData) {
    let sel = tx.selection
    let text = "\uFEFF"
    this.insertText(tx, text)
    sel = tx.selection
    let endOffset = tx.selection.end.offset
    let startOffset = endOffset - text.length
    nodeData = Object.assign({}, nodeData, {
      start: {
        path: sel.path,
        offset: startOffset
      },
      end: {
        path: sel.path,
        offset: endOffset
      }
    })
    return tx.create(nodeData)
  }

  insertBlockNode(tx, nodeData) {
    let sel = tx.selection
    // don't create the node if it already exists
    let blockNode
    if (!nodeData._isNode || !tx.get(nodeData.id)) {
      blockNode = tx.create(nodeData)
    } else {
      blockNode = tx.get(nodeData.id)
    }
    /* istanbul ignore else  */
    if (sel.isNodeSelection()) {
      let containerId = sel.containerId
      let container = tx.get(containerId)
      let cntedit = this.getEditing(container)
      let nodeId = sel.getNodeId()
      let nodePos = container.getPosition(nodeId, 'strict')
      // insert before
      if (sel.isBefore()) {
        cntedit.show(tx, container, blockNode, nodePos)
      }
      // insert after
      else if (sel.isAfter()) {
        cntedit.show(tx, container, blockNode, nodePos + 1)
        tx.setSelection({
          type: 'node',
          containerId: containerId,
          nodeId: blockNode.id,
          mode: 'after'
        })
      } else {
        cntedit.hideAt(tx, container, nodePos)
        documentHelpers.deleteNode(tx, tx.get(nodeId))
        cntedit.show(tx, container, blockNode, nodePos)
        tx.setSelection({
          type: 'node',
          containerId: containerId,
          nodeId: blockNode.id,
          mode: 'after'
        })
      }
    } else if (sel.isPropertySelection()) {
      /* istanbul ignore next */
      if (!sel.containerId) throw new Error('insertBlockNode can only be used within a container.')
      let container = tx.get(sel.containerId)
      let cntedit = this.getEditing(container)
      if (!sel.isCollapsed()) {
        this.getEditing(container).deletePropertySelection(tx, container, sel)
        tx.setSelection(sel.collapse('left'))
      }
      let node = tx.get(sel.path[0])
      /* istanbul ignore next */
      if (!node) throw new Error('Invalid selection.')
      let nodePos = container.getPosition(node.id, 'strict')
      /* istanbul ignore else  */
      if (node.isText()) {
        let text = node.getText()
        // replace node
        if (text.length === 0) {
          cntedit.hideAt(tx, container, nodePos)
          documentHelpers.deleteNode(tx, node)
          cntedit.show(tx, container, blockNode, nodePos)
          setCursor(tx, blockNode, container.id, 'after')
        }
        // insert before
        else if (sel.start.offset === 0) {
          cntedit.show(tx, container, blockNode, nodePos)
        }
        // insert after
        else if (sel.start.offset === text.length) {
          cntedit.show(tx, container, blockNode, nodePos + 1)
          setCursor(tx, blockNode, container.id, 'before')
        }
        // break
        else {
          this.break(tx)
          cntedit.show(tx, container, blockNode, nodePos + 1)
          setCursor(tx, blockNode, container.id, 'after')
        }
      } else {
        console.error('Not supported: insertBlockNode() on a custom node')
      }
    } else if (sel.isContainerSelection()) {
      if (sel.isCollapsed()) {
        let start = sel.start
        /* istanbul ignore else  */
        if (start.isPropertyCoordinate()) {
          tx.setSelection({
            type: 'property',
            path: start.path,
            startOffset: start.offset,
            containerId: sel.containerId,
          })
        } else if (start.isNodeCoordinate()) {
          tx.setSelection({
            type: 'node',
            containerId: sel.containerId,
            nodeId: start.path[0],
            mode: start.offset === 0 ? 'before' : 'after',
          })
        } else {
          throw new Error('Unsupported selection for insertBlockNode')
        }
        return this.insertBlockNode(tx, blockNode)
      } else {
        this.break(tx)
        return this.insertBlockNode(tx, blockNode)
      }
    }
    return blockNode
  }

  insertText(tx, text) {
    let sel = tx.selection
    // type over a selected node or insert a paragraph before
    // or after
    /* istanbul ignore else  */
    if (sel.isNodeSelection()) {
      let containerId = sel.containerId
      let container = tx.get(containerId)
      let cntedit = this.getEditing(container)
      let nodeId = sel.getNodeId()
      let nodePos = container.getPosition(nodeId, 'strict')
      let textNode = tx.createDefaultTextNode(text)
      if (sel.isBefore()) {
        cntedit.show(tx, container, textNode, nodePos)
      } else if (sel.isAfter()) {
        cntedit.show(tx, container, textNode, nodePos + 1)
      } else {
        cntedit.hide(tx, container, nodeId)
        documentHelpers.deleteNode(tx, tx.get(nodeId))
        cntedit.show(tx, container, textNode, nodePos)
      }
      setCursor(tx, textNode, sel.containerId, 'after')
    } else if (sel.isCustomSelection()) {
      // TODO: what to do with custom selections?
    } else if (sel.isCollapsed() || sel.isPropertySelection()) {
      if (!isArrayEqual(sel.start.path, sel.end.path)) {
        throw new Error('Unsupported state: range should be on one property')
      }
      let node = tx.get(sel.start.path[0])
      let editing = this.getEditing(node)
      if (sel.isCollapsed()) {
        sel = editing.insertText(tx, node, sel.start, text)
      } else {
        sel = editing.replaceText(tx, node, sel.start, sel.end, text)
      }
      tx.setSelection(sel)
    } else if (sel.isContainerSelection()) {
      let container = tx.get(sel.containerId)
      sel = this.getEditing(container).deleteRange(tx, container, sel.start, sel.end)
      tx.setSelection(sel)
      this.insertText(tx, text)
    }
  }

  paste(tx, content) {
    if (!content) return
    /* istanbul ignore else  */
    if (isString(content)) {
      paste(tx, {text: content})
    } else if (content._isDocument) {
      paste(tx, {doc: content})
    } else {
      throw new Error('Illegal content for paste.')
    }
  }

  /**
    Switch text type for a given node. E.g. from `paragraph` to `heading`.

    @param {Object} args object with `selection`, `containerId` and `data` with new node data
    @return {Object} object with updated `selection`

    @example

    ```js
    switchTextType(tx, {
      selection: bodyEditor.getSelection(),
      containerId: bodyEditor.getContainerId(),
      data: {
        type: 'heading',
        level: 2
      }
    })
    ```
  */
  switchTextType(tx, data) {
    let sel = tx.selection
    /* istanbul ignore next */
    if (!sel.isPropertySelection()) {
      throw new Error("Selection must be a PropertySelection.")
    }
    let containerId = sel.containerId
    /* istanbul ignore next */
    if (!containerId) {
      throw new Error("Selection must be within a container.")
    }
    let path = sel.path
    let nodeId = path[0]
    let node = tx.get(nodeId)
    /* istanbul ignore next */
    if (!(node.isInstanceOf('text'))) {
      throw new Error('Trying to use switchTextType on a non text node.')
    }
    // create a new node and transfer annotations
    let newNode = Object.assign({
      id: uuid(data.type),
      type: data.type,
      content: node.content,
      direction: node.direction
    }, data)
    let newPath = [newNode.id, 'content']
    newNode = tx.create(newNode)
    annotationHelpers.transferAnnotations(tx, path, 0, newPath, 0)

    // hide and delete the old one, show the new node
    let container = tx.get(sel.containerId)
    let cntedit = this.getEditing(container)
    let pos = container.getPosition(nodeId, 'strict')
    cntedit.hide(tx, container, nodeId)
    documentHelpers.deleteNode(tx, node)
    cntedit.show(tx, container, newNode, pos)

    tx.setSelection({
      type: 'property',
      path: newPath,
      startOffset: sel.start.offset,
      endOffset: sel.end.offset,
      containerId: containerId
    })

    return newNode
  }

  indent(tx) {
    let sel = tx.selection
    if (sel.isPropertySelection()) {
      let nodeId = sel.start.getNodeId()
      // ATTENTION: we need the root node here, e.g. the list, not the list items
      let node = tx.get(nodeId).getRoot()
      if (node.isList()) {
        let itemId = sel.start.path[0]
        let item = tx.get(itemId)
        // Note: allowing only 3 levels
        if (item && item.level<3) {
          tx.set([itemId, 'level'], item.level+1)
        }
      }
    } else if (sel.isContainerSelection()) {
      console.error('TODO: support toggleList with ContainerSelection')
    }
  }

  dedent(tx) {
    let sel = tx.selection
    if (sel.isPropertySelection()) {
      let nodeId = sel.start.getNodeId()
      // ATTENTION: we need the root node here, e.g. the list, not the list items
      let node = tx.get(nodeId).getRoot()
      if (node.isList()) {
        let itemId = sel.start.path[0]
        let item = tx.get(itemId)
        if (item && item.level>1) {
          tx.set([itemId, 'level'], item.level-1)
        }
      }
    } else if (sel.isContainerSelection()) {
      console.error('TODO: support toggleList with ContainerSelection')
    }
  }
}
