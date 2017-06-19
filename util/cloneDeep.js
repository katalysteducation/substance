import isObject from './isObject'
import isArray from './isArray'
import forEach from './forEach'

export default function cloneDeep(val) {
  let marker = new Map()
  return _cloneDeep(val, marker)
}

function _cloneDeep(val, marker) {
  if (marker.has(val)) {
    return marker.get(val)
  }

  if (isArray(val)) {
    let result = new Array(val.length)
    marker.set(val, result)
    for (let i=0 ; i<val.length ; ++i) {
      result[i] = _cloneDeep(val[i], marker)
    }
    return result
  } else if (isObject(val)) {
    let result = {}
    marker.set(val, result)
    forEach(val, (prop, key) => {
      result[key] = _cloneDeep(prop, marker)
    })
    Object.setPrototypeOf(result, Object.getPrototypeOf(val))
    return result
  }

  // primitives don't need to be cloned
  // TODO: is that ok?
  return val
}
