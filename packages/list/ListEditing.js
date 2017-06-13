import annotationHelpers from '../../model/annotationHelpers'
import documentHelpers from '../../model/documentHelpers'
import NodeEditing from '../../model/NodeEditing'
import { selectCursor } from '../../model/selectionHelpers'

export default class ListEditing extends NodeEditing {
  splitNode(tx, list, coor, options={}) {
    let item = tx.get(coor.path[0])
    let itemPos = list.getItemPosition(item.id)
    let text = item.getText()

    if (!text) {
      // When breaking an empty list item break the list instead
      let newNode = tx.createDefaultTextNode()
      if (list.length < 2) {
        // If |list| is empty replace it with a paragraph
        return { replace: newNode }
      }
      if (itemPos === 0) {
        // If breaking at the first item then remove it and insert a paragraph
        // before |list|
        list.remove(item.id)
        documentHelpers.deleteNode(tx, item)
        return { before: newNode, selection: selectCursor(tx, newNode) }
      }
      if (itemPos === list.length - 1) {
        // If breaking at the last item then remove it and insert a paragraph
        // after |list|
        list.remove(item.id)
        documentHelpers.deleteNode(tx, item)
        return { after: newNode }
      }
      // Otherwise split |list| into two
      let next = this._splitAtPos(tx, list, itemPos, true)
      return { after: [newNode, next] }
    } else {
      // Split a list item
      let editing = tx.getEditing(item)
      let split = editing.splitNode(tx, item, coor, options)
      let after

      if (split.before) {
        list.insertItemAt(itemPos++, split.before.id)
      }

      if (split.replace) {
        let item = list.getItemAt(itemPos)
        list.removeItemAt(itemPos)
        documentHelpers.deleteNode(tx, item)
        list.insertItemAt(itemPos, split.replace.id)
        after = split.replace
      }

      if (split.after) {
        list.insertItemAt(itemPos + 1, split.after.id)
        after = after || split.after
      }

      if (options.mustSplit) {
        let next = this._splitAtPos(tx, list, itemPos)
        return { after: next }
      }

      if (!after) {
        after = list.getItemAt(itemPos)
      }

      return { selection: selectCursor(tx, after) }
    }
  }

  /**
   * Split a list after the item at |itemPos|
   *
   * @param {EditingInterface}  tx
   * @param {ListNode}          list
   * @param {Number}            itemPos
   * @param {Boolean}           remove
   *
   * @return {ListNode}
   */
  _splitAtPos(tx, list, itemPos, remove=false) {
    let items = []
    for (let pos = list.length - 1 ; pos > itemPos ; --pos) {
      let item = list.items[pos]
      list.remove(item)
      items.push(item)
    }
    if (remove) {
      let item = list.getItemAt(itemPos)
      list.remove(item)
      documentHelpers.deleteNode(tx, item)
    }
    return tx.create(this.createFromNodes(tx, list.type, items.reverse(), {
      ordered: list.ordered,
    }))
  }

  break(tx, list, coor) {
    let item = tx.get(coor.path[0])
    let itemPos = list.getItemPosition(item.id)
    let editing = tx.getEditing(item)
    let split = editing.splitNode(tx, item, coor)
    let after

    if (split.before) {
      list.insertItemAt(itemPos++, split.before.id)
    }

    if (split.replace) {
      let item = list.getItemAt(itemPos)
      list.removeItemAt(itemPos)
      documentHelpers.deleteNode(tx, item)
      list.insertItemAt(itemPos, split.replace.id)
      after = split.replace
    }

    if (split.after) {
      list.insertItemAt(itemPos + 1, split.after.id)
      after = after || split.after
    }

    if (!after) {
      after = list.getItemAt(itemPos)
    }

    return { selection: selectCursor(tx, after) }
  }

  deleteRange(tx, list, start, end, options={}) {
    documentHelpers.deleteListRange(tx, list, start, end)
    return tx.createSelection({
      type: 'property',
      path: start.path,
      startOffset: start.offset,
    })
  }

  merge(tx, list, coor, direction) {
    let item = tx.get(coor.path[0])
    let itemPos = list.getItemPosition(item.id)

    let withinList = (
      (direction === 'left' && itemPos > 0) ||
      (direction === 'right' && itemPos < list.length - 1)
    )

    if (!withinList) {
      // Nothing to merge
      return null
    }

    if (direction === 'left') {
      itemPos -= 1
    }

    let target = list.getItemAt(itemPos)
    let targetLength = target.getLength()

    documentHelpers.mergeListItems(tx, list.id, itemPos)
    return tx.createSelection({
      type: 'property',
      path: target.getPath(),
      startOffset: targetLength,
    })
  }

  getMergeAsTypes(tx, list, coor) {
    return ['list', 'text']
  }

  selectMergeType(tx, list, types, coor) {
    return types.find(type => type === 'list' || type === 'text')
  }

  convertForMerge(tx, list, coor, type, container, containerEditing) {
    if (type === 'list') {
      containerEditing.hide(tx, container, list)
      return list
    }
    if (type === 'text') {
      let item = list.getFirstItem()
      if (item) {
        list.remove(item)
      } else {
        item = tx.createDefaultTextNode()
      }

      if (list.isEmpty()) {
        containerEditing.hide(tx, container, list)
      }

      return item
    }
    throw new Error(`Unsupported merge type: ${type}`)
  }

  mergeNode(tx, list, type, source, coor, container, containerEditing) {
    if (type === 'list') {
      let item = list.getLastItem()
      let items = []
      for (let pos = source.length - 1 ; pos >= 0 ; --pos) {
        let item = source.getItemAt(pos)
        source.remove(item)
        items.push(item.id)
      }
      while (items.length > 0) {
        list.appendItem(items.pop())
      }
      documentHelpers.deleteNode(tx, source)
      return tx.createSelection({
        type: 'property',
        path: item.getPath(),
        startOffset: item.getLength(),
        containerId: container.id,
      })
    }
    if (type === 'text') {
      let target = list.getLastItem()
      let targetPath = target.getPath()
      let targetLength = target.getLength()
      tx.update(targetPath, { type: 'insert', start: targetLength, text: source.getText() })
      annotationHelpers.transferAnnotations(tx, source.getPath(), 0, targetPath, targetLength)
      documentHelpers.deleteNode(tx, source)
      return tx.createSelection({
        type: 'property',
        path: targetPath,
        startOffset: targetLength,
        containerId: container.id,
      })
    }
    throw new Error(`Unsupported merge type: ${type}`)
  }

  createFromNodes(tx, type, items, options) {
    return {
      type, items,
      ordered: options.ordered || false,
    }
  }

  deleteCharacter(tx, list, coor, direction, container, root) {
    let toggleList = coor.offset === 0 && direction === 'left'
    let itemPos = list.getItemPosition(coor.path[0])
    let item = list.getItemAt(itemPos)

    if (!toggleList) {
      let editing = tx.getEditing(item)
      return editing.deleteCharacter(tx, item, coor, direction, null, root)
    }

    return this._toggleItem(tx, list, item, itemPos, container)
  }

  toggle(tx, sel, params) {
    if (!sel.isPropertySelection()) {
      console.error('TODO: support toggleList with ContainerSelection')
      return
    }

    let container = tx.get(sel.containerId)
    let editing = tx.getEditing(container)
    if (!container) {
      throw new Error("Selection must be within a container.")
    }

    let nodeId = sel.start.path[0]
    // ATTENTION: we need the root node here e.g. the list, not the list-item
    let node = tx.get(nodeId).getRoot()
    let nodePos = container.getPosition(node.id, 'strict')

    if (node.isText()) {
      editing.hideAt(tx, container, nodePos)
      let newItem = tx.create({
        type: 'list-item',
        content: node.getText(),
      })
      annotationHelpers.transferAnnotations(tx, node.getTextPath(), 0, newItem.getTextPath(), 0)
      let newList = tx.create(Object.assign({
        type: 'list',
        items: [newItem.id]
      }, params))
      documentHelpers.deleteNode(tx, node)
      tx.update([container.id, 'nodes'], { type: 'insert', pos: nodePos, value: newList.id })
      return tx.createSelection({
        type: 'property',
        path: newItem.getTextPath(),
        startOffset: sel.start.offset,
        containerId: sel.containerId
      })
    } else if (node.isList()) {
      let item = tx.get(nodeId)
      let itemPos = node.getItemPosition(item)
      return this._toggleItem(tx, node, item, itemPos, {
        node: container, editing,
      })
    }
  }

  _toggleItem(tx, list, item, itemPos, container) {
    let newNode = tx.createDefaultTextNode(item.getText())
    annotationHelpers.transferAnnotations(tx, item.getPath(), 0, newNode.getPath(), 0)
    list.removeItemAt(itemPos)

    let nodePos = container.node.getPosition(list)
    if (list.isEmpty()) {
      container.editing.hide(tx, container.node, list)
      documentHelpers.deleteNode(tx, list)
    } else if (itemPos !== 0) {
      nodePos += 1
    }

    container.editing.show(tx, container.node, newNode, nodePos)

    if (itemPos !== 0 && itemPos < list.getLength()) {
      let after = this._splitAtPos(tx, list, itemPos - 1)
      container.editing.show(tx, container.node, after, nodePos + 1)
    }

    return tx.createSelection({
      type: 'property',
      path: newNode.getPath(),
      startOffset: 0,
    })
  }
}
