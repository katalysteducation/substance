import annotationHelpers from './annotationHelpers'
import documentHelpers from './documentHelpers'

export default class NodeEditing {
  /**
   * Split this |node|.
   *
   * This function should split |node| into two or more nodes such that one contains
   * content from start of |node| until |coor| and the other content from
   * |coor| until end of |node|.
   *
   * The returned object should contain zero or more of the following
   * properties:
   *
   * - |before|: a list of nodes before |coor|.
   * - |after|: a list of nodes after |coor|.
   * - |replace|: a node to replace |node| with.
   *
   * Omitting |before| or |after| is equivalent to setting them to empty lists.
   * Omitting |replace| is equivalent to setting it to |node|, except that it
   * may be more efficient.
   *
   * If all those properties are missing from the returned object then the split
   * was handled internally by |node| (for example if |coor| was pointing to
   * a node within |node|, such as a list item). In such case the returned
   * object may include |selection| property, which contains selection of the
   * splitting point.
   *
   * Sometimes it may be desirable to force a split even if it could be handled
   * internally by |node|. In such cases set |options.mustSplit| to true and
   * |node| will be disallowed from returning "replace" or "ignore".
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node  node to split
   * @param {Coordinate}        coor  coordinate within |node| at which it
   *                                  should be split
   * @param {Object}            options
   *
   * @return {Object}
   */
  splitNode(tx, node, coor, options={}) {
    throw new Error("not implemented")
  }

  /**
   * Break a node within this |container|.
   *
   * This operation is only well-defined for {@link Container}s
   * and container-like nodes.
   *
   * @param {EditingInterface}  tx
   * @param {Container}         container   container in which to split a node
   * @param {Coordinate}        coor        coordinate of the node to split
   *
   * @return {Selection} the newly created node containing content of node
   *                     at |coor| after |coor|.
   */
  break(tx, container, coor) {
    throw new Error(`NodeEditing#break is not supported for ${container.type} nodes`)
  }

  /**
   * Delete a range from this |node|.
   *
   * Note that the range may span multiple nodes, and both start and end points
   * need not be direct children of |node|.
   *
   * If one of |start| or |end| is null then it is assumed to be a coordinate on
   * the same path as the other coordinate and with offset of 0 for |start| or
   * equal to length of node (on appropriate property) minus one. |start| and
   * |end| may not both be null.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              container
   * @param {Coordinate}        start
   * @param {Coordinate}        end
   * @param {Object}            options
   *
   * @return {Selection}
   */
  deleteRange(tx, node, start, end, options={}) {
    throw new Error("not implemented")
  }

  deleteCharacter(tx, node, coor, direction, container, root) {
    let offset = coor.offset
    let path = coor.path
    let startOffset = direction === 'left' ? offset - 1 : offset
    let start = { path: path, offset: startOffset }
    let end = { path: path, offset: startOffset + 1 }
    documentHelpers.deleteTextRange(tx, start, end)

    return tx.createSelection({
      type: 'property',
      path, startOffset,
    })
  }

  /**
   * Get list of types that the merge source (|node|) can be converted into.
   *
   * The returned list should be sorted such that the most desirable type
   * comes first.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node   merge source
   * @param {Coordinate}        coor
   *
   * @return {[String]}
   */
  getMergeAsTypes(tx, node, coor) {
    return coor.path[0] === node.id ? [node.type] : []
  }

  /**
   * Select type of the merge source.
   *
   * This function should select from |types| the first type which can be merged
   * into |node|. If there is no such type then |null| should be returned.
   *
   * Since node mergers are always performed “upwards”, node of the selected
   * type will be merged at the end of |node|.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node
   * @param {[String]}          types
   * @param {Coordinate}        coor
   *
   * @return {String?}
   */
  selectMergeType(tx, node, types, coor) {
    return null
  }

  /**
   * Convert this |node| into a specified |type| for merging.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node
   * @param {Coordinate}        coor
   * @param {String}            type
   * @param {Container}         container
   * @param {containerEditing}  containerEditing
   *
   * @return {Node}
   */
  convertForMerge(tx, node, coor, type, container, containerEditing) {
    console.assert(coor.path[0] === node.id && type === node.type)
    containerEditing.hide(tx, container, node)
    return node
  }

  /**
   * Merge |source| at the end of this |node|.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node
   * @param {String}            type
   * @param {Node}              source
   * @param {Coordinate}        coor
   * @param {Container}         container
   * @param {ContainerEditing}  containerEditing
   *
   * @return {Selection}
   */
  mergeNode(tx, node, type, source, coor, container, containerEditing) {
    documentHelpers.deleteNode(tx, source)
    return null
  }

  deletePropertySelection(tx, container, sel) {
    let path = sel.start.path
    let start = sel.start.offset
    let end = sel.end.offset
    tx.update(path, { type: 'delete', start: start, end: end })
    annotationHelpers.deletedText(tx, path, start, end)
  }

  /**
   * Insert |text| into this |node| at a given |coor|dinate.
   *
   * @param {EditingInterface}  tx
   * @param {Node}              node
   * @param {Coordinate}        coor
   * @param {String}            text
   *
   * @return {Selection} cursor after the inserted text
   */
  insertText(tx, node, coor, text) {
    return this.replaceText(tx, node, coor, coor, text)
  }

  /**
   * Replace contents of this |node| between |start| and |end| coordinates with
   * a given |text|.
   *
   * @param {EditingInterface} tx
   * @param {Node} node
   * @param {Coordinate} start
   * @param {Coordinate} end
   * @param {String} text
   *
   * @return {Selection} cursor after the inserted text
   */
  replaceText(tx, node, start, end, text) {
    let path = start.path
    let typeover = false

    // replace text
    if (start.offset !== end.offset) {
      tx.update(path, { type: 'delete', start: start.offset, end: end.offset })
      typeover = true
    }
    tx.update(path, { type: 'insert', start: start.offset, text })

    // update annotations
    tx.getAnnotations(path).forEach(anno => {
      if (anno.end.offset < start.offset) {
        // Annotation is before the altered area
        return
      }

      if (anno.start.offset >= end.offset) {
        // Annotation is after the altered area
        let shift = start.offset - end.offset + text.length
        tx.update([anno.id, 'start'], { type: 'shift', value: shift })
        tx.update([anno.id, 'end'], { type: 'shift', value: shift })
      } else if (anno.start.offset >= start.offset && (
        anno.end.offset < end.offset ||
        (anno.end.offset <= end.offset && anno._isInlineNode)
      )) {
        // Annotation is deleted
        // NOTE: InlineNodes only have a length of one character
        // so they are always 'covered', and as they can not expand
        // they are deleted
        tx.delete(anno.id)
      } else if (anno.start.offset >= start.offset && anno.end.offset >= end.offset) {
        // Annotation starts within the altered area ends past it
        if (anno.start.offset > start.offset || !typeover) {
          // Do not move start anchor if typing over
          let shift = start.offset - anno.start.offset + text.length
          tx.update([anno.id, 'start'], { type: 'shift', value: shift })
        }
        let shift = start.offset - end.offset + text.length
        tx.update([anno.id, 'end'], { type: 'shift', value: shift })
      } else if (anno.start.offset < start.offset && anno.end.offset < end.offset) {
        // Annotation starts before the altered area and ends within
        // NOTE: here the anno gets expanded (that's the common way)
        let shift = start.offset - anno.end.offset + text.length
        tx.update([anno.id, 'end'], { type: 'shift', value: shift })
      } else if (anno.end.offset === start.offset && !anno.constructor.autoExpandRight) {
        // skip
      } else if (anno.start.offset < start.offset && anno.end.offset >= end.offset) {
        // Annotation starts before the altered area and ends past it
        if (anno._isInlineNode) {
          // skip
        } else {
          let shift = start.offset - end.offset + text.length
          tx.update([anno.id, 'end'], { type: 'shift', value: shift })
        }
      } else {
        console.warn('TODO: handle annotation update case.')
      }
    })

    return tx.createSelection({
      type: 'property',
      path: start.path,
      startOffset: start.offset + text.length,
    })
  }

  insertNode(tx, node, coor, data) {
    throw new Error(`It is not possible to insert node into a ${node.type} node`)
  }
}
