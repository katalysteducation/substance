import documentHelpers from './documentHelpers'
import NodeEditing from './NodeEditing'
import { isEntirelySelected, selectCursor, createNodeSelection } from './selectionHelpers'

export default class ContainerEditing extends NodeEditing {
  /**
   * Show a |node| in this |container|.
   *
   * @param {EditingInterface}  tx
   * @param {Container}         container   this container
   * @param {Node|NodeID}       node        node to show
   * @param {Number?}           pos         position at which to show |node|
   */
  show(tx, container, node, pos) {
    if (typeof pos !== 'number') {
      pos = container.getLength()
    }
    if (node instanceof Array) {
      node.forEach(n => this.show(tx, container, n, pos++))
      return
    } else if (typeof node !== 'string' && node._isNode) {
      node = node.id
    }
    tx.update(container.getContentPath(), { type: 'insert', pos, value: node })
  }

  /**
   * Hide a |node| from this |container|.
   *
   * @param {EditingInterface}  tx
   * @param {Container}         container   this container
   * @param {Node|NodeID}       node        node to hide
   */
  hide(tx, container, node) {
    let pos = container.getPosition(node)
    this.hideAt(tx, container, pos)
  }

  /**
   * Hide a node from a specified position from this |container|.
   *
   * @param {EditingInterface}  tx
   * @param {Container}         container   this container
   * @param {Number}            pos         position of the node to hide
   */
  hideAt(tx, container, pos) {
    tx.update(container.getContentPath(), { type: 'delete', pos })
  }

  /**
   * Create a new container from a list of nodes.
   *
   * This function should only create node data, but not a node in |tx|, so that
   * editing behaviours for subclasses can derive their data
   * from |super.createFromNodes|.
   *
   * @param {EditingInterface}  tx
   * @param {String}            type    type of the container to be created
   * @param {[Node]}            nodes   list of nodes which which are to be the
   *                                    newly created container's children
   * @param {Object}            options additional options
   *
   * @return {Object}
   */
  createFromNodes(tx, type, nodes, options={}) {
    nodes = nodes.map(node => node._isNode ? node.id : node)
    return { type, nodes }
  }

  /**
   * Merge nodes.
   *
   *
   *
   * @param {EditingInterface} tx
   * @param {Container} container
   * @param {Coordinate} coor
   * @param {String} direction
   *
   * @return {Selection}
   */
  merge(tx, container, coor, direction) {
    let nodePos = container.getPosition(coor.path[0])
    let node = container.getChildAt(nodePos)
    let source, sourceCoor, target, targetCoor

    if (node.id !== coor.path[0]) {
      // |coor| is not a direct child of |container|; first try delegating merge
      // to |node|
      let nodeEditing = tx.getEditing(node)
      if (nodeEditing.merge) {
        // First try delegating merge to |node|
        let sel = nodeEditing.merge(tx, node, coor, direction)
        if (sel) {
          return sel
        }
      }
    }

    if (direction === 'left' && nodePos > 0) {
      source = node
      sourceCoor = coor
      target = container.getChildAt(nodePos - 1)
      targetCoor = { path: [target.id] }
    } else if (direction === 'right' && nodePos < container.getLength() - 1) {
      source = container.getChildAt(nodePos + 1)
      sourceCoor = { path: [source.id] }
      target = node
      targetCoor = coor
    } else {
      // Nothing to merge
      return null
    }

    return this.mergeNodes(tx, container, source, sourceCoor, target, targetCoor, direction)
  }


  mergeNodes(tx, container, source, sourceCoor, target, targetCoor, direction) {
    let sourceEditing = tx.getEditing(source)
    let targetEditing = tx.getEditing(target)

    let sourceTypes = sourceEditing.getMergeAsTypes(tx, source, sourceCoor)
    let type = targetEditing.selectMergeType(tx, target, sourceTypes, targetCoor)

    if (type === null) {
      // No merge is possible
      let nodeId = direction === 'left' ? target.id : source.id
      if (sourceTypes.some(type => type === 'remove')) {
        // Remove source
        this.hide(tx, container, source)
        documentHelpers.deleteNode(tx, source)
        nodeId = target.id
      }
      return createNodeSelection({ doc: tx, nodeId, containerId: container.id })
    }

    let sourceNode = sourceEditing.convertForMerge(tx, source, sourceCoor, type, container, this)
    return targetEditing.mergeNode(tx, target, type, sourceNode, targetCoor, container, this)
  }

  splitNodeInContainer(tx, container, node, coor, options) {
    return tx.getEditing(node).splitNode(tx, node, coor, options)
  }

  deleteRange(tx, container, start, end, options={}) {
    let startPos = container.getPosition(start.getNodeId(), 'strict')
    let endPos = container.getPosition(end.getNodeId(), 'strict')

    if (startPos === endPos) {
      // Selection within a single node
      let child = container.getChildAt(startPos)
      return tx.getEditing(child).deleteRange(tx, child, start, end, options)
    }

    let firstNode = tx.get(start.getNodeId())
    let lastNode = tx.get(end.getNodeId())
    let firstEntirelySelected = isEntirelySelected(tx, firstNode, start, null)
    let lastEntirelySelected = isEntirelySelected(tx, lastNode, null, end)

    if (lastEntirelySelected) {
      this.hide(tx, container, lastNode)
      documentHelpers.deleteNode(tx, lastNode)
    } else {
      tx.getEditing(lastNode).deleteRange(tx, lastNode, null, end, options)
    }

    // Delete inner nodes
    for (let i=endPos-1 ; i>startPos ; --i) {
      let nodeId = container.nodes[i]
      this.hide(tx, container, nodeId)
      documentHelpers.deleteNode(tx, tx.get(nodeId))
    }

    if (firstEntirelySelected) {
      this.hide(tx, container, firstNode)
      documentHelpers.deleteNode(tx, firstNode)
    } else {
      tx.getEditing(firstNode).deleteRange(tx, firstNode, start, null, options)
    }

    if (firstEntirelySelected && lastEntirelySelected) {
      let node = tx.createDefaultTextNode()
      this.show(tx, container, node, startPos)
      return tx.createSelection({
        type: 'property',
        path: node.getTextPath(),
        startOffset: 0,
        containerId: container.id,
      })
    } else if (!firstEntirelySelected && !lastEntirelySelected) {
      if (!options.noMerge) {
        return this.merge(tx, container, start, 'right')
      }
      return tx.createSelection({
        type: 'property',
        path: start.path,
        startOffset: start.offset,
        containerId: container.id,
      })
    } else if (firstEntirelySelected) {
      return selectCursor(tx, lastNode, container.id, 'before')
    } else {
      return selectCursor(tx, firstNode, container.id, 'after')
    }
  }

  splitNode(tx, container, coor, options={}) {
    if (coor.path[0] === container.id) {
      // Split |container| if |coor| points to it

      let nodesAfter = []
      for (let pos=container.nodes.length-1 ; pos >= coor.offset ; --pos) {
        let nodeID = container.nodes[pos]
        this.hideAt(tx, container, pos)
        nodesAfter.push(nodeID)
      }

      let after
      if (options.atCoordinate) {
        let node = tx.get(nodesAfter.pop())
        let cnt = tx.create(this.createFromNodes(tx, container.type, nodesAfter.reverse()))
        after = [node, cnt]
      } else {
        after = tx.create(this.createFromNodes(tx, container.type, nodesAfter.reverse()))
      }

      return { after }
    }
    // otherwise also split a node within

    let nodePos = container.getPosition(coor.path[0])
    let node = container.getNodeAt(nodePos)

    let split = this.splitNodeInContainer(tx, container, node, coor, options)

    if (options.mustSplit) {
      // Only split container if must do so
      let nodesAfter = []
      for (let pos=container.nodes.length-1 ; pos > nodePos ; --pos) {
        let nodeID = container.nodes[pos]
        this.hideAt(tx, container, pos)
        nodesAfter.push(nodeID)
      }

      if (split.before) {
        this.show(tx, container, split.before)
      }

      if (split.after) {
        nodesAfter.splice(0, 0, split.after)
      }

      let newNode = tx.create(this.createFromNodes(tx, container.type, nodesAfter.reverse()))
      return { after: newNode }
    }
    // otherwise just split a node within it

    let selection = split.selection

    if (split.replace) {
      this.hideAt(tx, container, nodePos)
      this.show(tx, container, split.replace, nodePos)
      documentHelpers.deleteNode(tx, node)
      selection = selection || selectCursor(tx, split.replace)
    }
    if (split.before) {
      this.show(tx, container, split.before, nodePos)
      nodePos += split.before instanceof Array ? split.before.length : 1
    }
    if (split.after) {
      this.show(tx, container, split.after, nodePos + 1)
      selection = selection || selectCursor(tx, split.after)
    }

    selection = selection || selectCursor(tx, node)
    return { selection }
  }

  break(tx, container, coor, options={}) {
    let nodePos = container.getPosition(coor.path[0])
    let node = container.getNodeAt(nodePos)

    let split = this.splitNodeInContainer(tx, container, node, coor, options)
    let result = split.replace

    if (split.before) {
      this.show(tx, container, split.before, nodePos++)
    }

    if (split.replace) {
      this.hide(tx, container, node)
      documentHelpers.deleteNode(tx, node)
      this.show(tx, container, split.replace, nodePos)
    }

    if (split.after) {
      this.show(tx, container, split.after, nodePos + 1)

      if (!result) {
        result = split.after instanceof Array ? split.after[0] : split.after
      }
    }

    if (!result) {
      result = container.getNodeAt(nodePos)
    }

    if (split.selection) {
      return split.selection
    }
    return selectCursor(tx, result, container.id)
  }

  getMergeAsTypes(tx, container, coor) {
    if (coor.path[0] === container.id[0]) {
      return ['container']
    }

    let nodePos = container.getPosition(coor.path[0], 'strict')
    let child = container.getNodeAt(nodePos)
    let editing = tx.getEditing(child)
    return Array.of(...editing.getMergeAsTypes(tx, child, coor), 'container')
  }

  selectMergeType(tx, container, types, coor) {
    if (coor.path[0] === container.id) {
      return types[0]
    }

    let nodePos = container.getPosition(coor.path[0], 'strict')
    let child = container.getNodeAt(nodePos)
    let editing = tx.getEditing(child)
    let type = editing.selectMergeType(tx, child, types, coor)
    return type || types.find(type => type === 'container') || null
  }

  convertForMerge(tx, node, coor, type, container, containerEditing) {
    if (coor.path[0] === node.id) {
      console.assert(type === 'container')
      containerEditing.hide(tx, container, node)
      return node
    }

    let nodePos = node.getPosition(coor.path[0], 'strict')
    let child = node.getNodeAt(nodePos)
    let editing = tx.getEditing(child)
    return editing.convertForMerge(tx, child, coor, type, node, this)
  }

  mergeNode(tx, container, type, source, coor) {
    if (coor.path[0] === container.id) {
      if (type !== 'container') {
        this.show(tx, container, source)
        return createNodeSelection({ doc: tx, nodeId: source.id, containerId: container.id })
      }

      let nodePos = container.getLength()

      let srcEditing = tx.getEditing(source)
      let nodes = []
      while (source.nodes.length > 0) {
        let node = source.nodes[source.nodes.length - 1]
        srcEditing.hide(tx, source, node)
        nodes.push(node)
      }
      while (nodes.length > 0) {
        this.show(tx, container, nodes.pop())
      }
      documentHelpers.deleteNode(tx, source)

      if (nodePos === container.getLength()) {
        // There were no nodes in |source|
        nodePos -= 1
      }

      return createNodeSelection({ doc: tx, nodeId: container.nodes[nodePos], containerId: container.id })
    }

    let nodePos = container.getPosition(coor.path[0], 'strict')
    let child = container.getNodeAt(nodePos)
    let editing = tx.getEditing(child)
    return editing.mergeNode(tx, child, type, source, coor, container, this)
  }

  deleteCharacter(tx, container, coor, direction, parent, root) {
    let nodePos = container.getPosition(coor.path[0])
    let node = container.getNodeAt(nodePos)
    let editing = tx.getEditing(node)

    return editing.deleteCharacter(tx, node, coor, direction, {
      node: container,
      editing: this,
    }, root)
  }
}
