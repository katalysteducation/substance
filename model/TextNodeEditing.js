import annotationHelpers from './annotationHelpers'
import documentHelpers from './documentHelpers'
import NodeEditing from './NodeEditing'
import { selectCursor } from './selectionHelpers'

export default class TextNodeEditing extends NodeEditing {
  splitNode(tx, node, coor) {
    if (coor.offset === 0) {
      return { before: tx.create({
        type: node.type,
        content: "",
      }) }
    }

    let text = tx.get(coor.path)
    let newNode = Object.assign(node.toJSON(), {
      id: undefined,
      content: text.substring(coor.offset),
    })

    if (coor.offset === text.length) {
      // If at the end insert a default text node
      newNode.type = tx.getSchema().getDefaultTextType()
    }
    newNode = tx.create(newNode)

    // Transfer annotations which are after |coor.offset| to the new node
    annotationHelpers.transferAnnotations(tx, coor.path, coor.offset, newNode.getPath(), 0)
    // Truncate the original property
    tx.update(coor.path, { type: 'delete', start: coor.offset, end: text.length })

    return { after: newNode }
  }

  deleteRange(tx, node, start, end) {
    if ((start || end).path[0] !== node.id) {
      console.error('TextNodeEditing#deleteRange: range to delete must be on node passed')
      return null
    }
    documentHelpers.deleteTextRange(tx, start, end)

    start = start || end
    return tx.createSelection({
      type: 'property',
      path: start.path || node.getPath(),
      startOffset: start.offset || 0,
    })
  }

  getMergeAsTypes(tx, node, coor) {
    if (coor.path[0] !== node.id) {
      return []
    }
    return node.isEmpty() ? ['text', 'remove'] : ['text']
  }

  selectMergeType(tx, node, types, coor) {
    if (coor.path[0] !== node.id) {
      return null
    }
    if (node.isEmpty()) {
      return types[0]
    }
    return types.find(type => type === 'text') || null
  }

  convertForMerge(tx, node, coor, type, container, containerEditing) {
    console.assert(node.id === coor.path[0] && type === 'text')
    containerEditing.hide(tx, container, node)
    return node
  }

  mergeNode(tx, node, type, source, coor, container, containerEditing) {
    if (coor.path[0] !== node.id) {
      return null
    }
    if (node.isEmpty()) {
      // If target is empty replace it with source
      let nodePos = container.getPosition(node)
      containerEditing.hide(tx, container, node)
      containerEditing.show(tx, container, source, nodePos)
      documentHelpers.deleteNode(tx, node)
      return selectCursor(tx, source, container.id, 'before')
    }
    if (type === 'text') {
      // Merge two text nodes
      let path = node.getPath()
      let startOffset = node.getLength()
      tx.update(path, { type: 'insert', start: startOffset, text: source.getText() })
      annotationHelpers.transferAnnotations(tx, source.getPath(), 0, path, startOffset)
      documentHelpers.deleteNode(tx, source)
      return tx.createSelection({
        type: 'property',
        path, startOffset,
        containerId: container.id,
      })
    }
    console.warn(`TextNodeEditing#mergeNode invoked with unsupported source type: ${type}`)
    return null
  }

  deleteCharacter(tx, node, coor, direction, container, root) {
    let text = node.content
    let offset = coor.offset
    let needsMerge = root && (
      (offset === 0 && direction === 'left') ||
      (offset === text.length && direction === 'right')
    )

    if (needsMerge) {
      return root.editing.merge(tx, root.node, coor, direction)
    }

    return super.deleteCharacter(tx, node, coor, direction, container, root)
  }
}
