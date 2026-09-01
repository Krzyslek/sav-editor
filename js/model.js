/*
 * model.js - tree navigation, search, and undoable edit operations
 * on top of the node model produced by odin.js.
 */
(function (global) {
  'use strict';
  var O = global.Odin;

  // ---- naming --------------------------------------------------------------
  function shortType(t) {
    if (!t) return '';
    var s = String(t).split(',')[0];
    var g = s.indexOf('`');
    if (g > 0) {
      var inner = s.substring(s.indexOf('[[') + 2).split(',')[0];
      var base = s.substring(0, g);
      base = base.substring(base.lastIndexOf('.') + 1);
      var arg = inner.substring(inner.lastIndexOf('.') + 1);
      return base + '<' + arg + (s.indexOf('],[') > 0 ? ',…' : '') + '>';
    }
    return s.substring(s.lastIndexOf('.') + 1);
  }

  function label(n) {
    if (n.name !== undefined && n.name !== '') return n.name;
    if (n.m === O.M.StartOfArray) return '(items)';
    var p = n.p;
    if (p && p.m === O.M.StartOfArray) return '[' + p.c.indexOf(n) + ']';
    return '(unnamed)';
  }

  function pathOf(n) {
    var parts = [];
    while (n) { parts.push(label(n)); n = n.p; }
    return parts.reverse().join(' / ');
  }

  function valueText(n) {
    var k = O.kindOf(n.m);
    switch (k) {
      case 'node': return n.type === null ? '{ }' : '{ ' + shortType(n.type) + ' }';
      case 'array': return '[ ' + n.c.length + ' ]';
      case 'null': return 'null';
      case 'bool': return n.v ? 'true' : 'false';
      case 'string': return n.v;
      case 'bigint': return n.v.toString();
      case 'float': return formatFloat(n.v);
      case 'bytes': case 'char': return hex(n.v);
      case 'primarray': return 'byte[' + n.cnt + ' x ' + n.esz + ']';
      case 'ref': return '-> #' + n.v;
      default: return String(n.v);
    }
  }
  function formatFloat(v) {
    if (!isFinite(v)) return String(v);
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    var s = v.toPrecision(9).replace(/0+$/, '').replace(/\.$/, '');
    return (parseFloat(s) === v) ? s : String(v);
  }
  function hex(b) {
    var s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }

  // ---- search --------------------------------------------------------------
  // Walks the whole tree; cheap enough for ~200k nodes and keeps memory flat.
  function search(root, opts) {
    var q = opts.query, res = [], limit = opts.limit || 5000, rx = null;
    if (!q) return res;
    if (opts.regex) {
      try { rx = new RegExp(q, opts.caseSensitive ? '' : 'i'); } catch (e) { return { error: e.message, list: [] }; }
    } else if (!opts.caseSensitive) { q = q.toLowerCase(); }

    function match(s) {
      if (s === undefined || s === null) return false;
      s = String(s);
      if (rx) return rx.test(s);
      if (!opts.caseSensitive) s = s.toLowerCase();
      return s.indexOf(q) >= 0;
    }

    var stop = false;
    (function walk(nodes) {
      for (var i = 0; i < nodes.length && !stop; i++) {
        var n = nodes[i], hit = false, where = '';
        if (opts.inNames !== false && match(n.name)) { hit = true; where = 'name'; }
        if (!hit && opts.inValues !== false && !n.c && n.m !== 8 && match(valueText(n))) { hit = true; where = 'value'; }
        if (!hit && opts.inTypes && n.type && match(n.type)) { hit = true; where = 'type'; }
        if (hit) {
          res.push({ node: n, where: where });
          if (res.length >= limit) { stop = true; return; }
        }
        if (n.c) walk(n.c);
      }
    })(root);
    return { list: res, truncated: stop };
  }

  function findByType(root, typeStart, out, limit) {
    out = out || [];
    (function walk(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.type && n.type.indexOf(typeStart) === 0) { out.push(n); if (limit && out.length >= limit) return; }
        if (n.c) walk(n.c);
      }
    })(root);
    return out;
  }

  function ancestors(n) {
    var a = [];
    for (var p = n.p; p; p = p.p) a.push(p);
    return a.reverse();
  }

  // ---- edit operations (each returns an undo record) -----------------------
  function Edits(onChange) { this.undoStack = []; this.redoStack = []; this.onChange = onChange || function () {}; }
  Edits.prototype = {
    apply: function (op) {
      op.redo();
      this.undoStack.push(op);
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.redoStack.length = 0;
      this.onChange(op);
      return op;
    },
    undo: function () {
      var op = this.undoStack.pop();
      if (!op) return null;
      op.undo(); this.redoStack.push(op); this.onChange(op); return op;
    },
    redo: function () {
      var op = this.redoStack.pop();
      if (!op) return null;
      op.redo(); this.undoStack.push(op); this.onChange(op); return op;
    },
    canUndo: function () { return this.undoStack.length > 0; },
    canRedo: function () { return this.redoStack.length > 0; }
  };

  function setValue(node, value) {
    var old = node.v, oldDirty = node.dirty;
    return {
      label: 'edit ' + label(node),
      node: node,
      redo: function () { node.v = value; node.dirty = true; },
      undo: function () { node.v = old; node.dirty = oldDirty; }
    };
  }
  function setName(node, name) {
    var old = node.name;
    return {
      label: 'rename ' + old, node: node,
      redo: function () { node.name = name; },
      undo: function () { node.name = old; }
    };
  }
  function removeNode(node) {
    var parent = node.p, list = parent ? parent.c : null, idx = list ? list.indexOf(node) : -1;
    return {
      label: 'delete ' + label(node), node: parent,
      redo: function () { if (idx >= 0) list.splice(idx, 1); syncLen(parent); },
      undo: function () { if (idx >= 0) list.splice(idx, 0, node); syncLen(parent); }
    };
  }
  function insertNode(parent, node, index) {
    if (index === undefined || index === null || index < 0) index = parent.c.length;
    node.p = parent;
    return {
      label: 'insert ' + label(node), node: parent,
      redo: function () { parent.c.splice(index, 0, node); syncLen(parent); },
      undo: function () { parent.c.splice(index, 1); syncLen(parent); }
    };
  }
  function duplicateNode(node) {
    var copy = O.clone(node, node.p);
    return insertNode(node.p, copy, node.p.c.indexOf(node) + 1);
  }
  function moveNode(node, delta) {
    var list = node.p.c, from = list.indexOf(node), to = from + delta;
    return {
      label: 'move ' + label(node), node: node.p,
      redo: function () { if (to < 0 || to >= list.length) return; list.splice(from, 1); list.splice(to, 0, node); },
      undo: function () { if (to < 0 || to >= list.length) return; list.splice(to, 1); list.splice(from, 0, node); }
    };
  }
  function syncLen(parent) {
    if (parent && parent.m === O.M.StartOfArray) parent.len = BigInt(parent.c.length);
  }

  // ---- creating new nodes --------------------------------------------------
  var NEW_TYPES = [
    { m: 23, label: 'Int32' }, { m: 31, label: 'Float' }, { m: 39, label: 'String' },
    { m: 43, label: 'Boolean' }, { m: 27, label: 'Int64' }, { m: 29, label: 'UInt64' },
    { m: 33, label: 'Double' }, { m: 17, label: 'Byte' }, { m: 19, label: 'Int16' },
    { m: 25, label: 'UInt32' }, { m: 45, label: 'Null' },
    { m: 1, label: 'Reference node {}' }, { m: 3, label: 'Struct node {}' }
  ];
  function newNode(m, name, value, typeName) {
    var n = { m: m, p: null };
    if (O.NAMED[m]) { n.name = name || 'NewField'; n.nameF = 1; }
    if (O.NODE[m]) { n.type = typeName || null; n.c = []; if (O.REFNODE[m]) n.refId = undefined; }
    else if (m === 6) { n.c = []; n.len = 0n; }
    else if (m === 45 || m === 46) { /* no value */ }
    else if (O.STRVAL[m]) { n.v = value === undefined ? '' : String(value); n.vf = 1; }
    else if (m === 43 || m === 44) { n.v = !!value; }
    else if (O.INT64[m]) { n.v = BigInt(value || 0); }
    else { n.v = Number(value) || 0; n.dirty = true; }
    return n;
  }

  // ---- game-aware helpers (Shadow Dungeon containers) ----------------------
  var CONTAINER_ITEM = 'Data.SaveData.ContainerItemSaveData';

  // Locates every List<ContainerItemSaveData> (inventory, chest, ...) and
  // returns the inner array node that actually holds the elements.
  function findItemContainers(root) {
    var out = [];
    (function walk(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.type && n.type.indexOf('List`1[[' + CONTAINER_ITEM) >= 0) {
          var arr = null;
          for (var j = 0; j < n.c.length; j++) if (n.c[j].m === O.M.StartOfArray) arr = n.c[j];
          if (arr) out.push({ node: n, array: arr, name: label(n), path: pathOf(n) });
        }
        if (n.c) walk(n.c);
      }
    })(root);
    return out;
  }

  function itemFields(container) {
    var f = {};
    for (var i = 0; i < container.c.length; i++) {
      var c = container.c[i];
      if (!c.c && c.name) f[c.name] = c;
    }
    return f;
  }

  // Reads Page/GridX/GridY of every element and proposes a free cell.
  function gridInfo(arrayNode) {
    var occ = {}, maxPage = 0, maxX = 0, maxY = 0;
    for (var i = 0; i < arrayNode.c.length; i++) {
      var f = itemFields(arrayNode.c[i]);
      if (!f.Page) continue;
      var pg = f.Page.v, x = f.GridX ? f.GridX.v : 0, y = f.GridY ? f.GridY.v : 0;
      occ[pg + ':' + x + ':' + y] = true;
      if (pg > maxPage) maxPage = pg;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { occupied: occ, maxPage: maxPage, cols: maxX + 1, rows: maxY + 1 };
  }
  function freeCell(info, startPage) {
    var cols = Math.max(info.cols, 1), rows = Math.max(info.rows, 1);
    for (var pg = startPage === undefined ? 0 : startPage; pg <= info.maxPage + 1; pg++)
      for (var y = 0; y < rows; y++)
        for (var x = 0; x < cols; x++)
          if (!info.occupied[pg + ':' + x + ':' + y]) return { page: pg, x: x, y: y };
    return { page: info.maxPage + 1, x: 0, y: 0 };
  }

  global.Model = {
    shortType: shortType, label: label, pathOf: pathOf, valueText: valueText, hex: hex,
    search: search, findByType: findByType, ancestors: ancestors,
    Edits: Edits, setValue: setValue, setName: setName, removeNode: removeNode,
    insertNode: insertNode, duplicateNode: duplicateNode, moveNode: moveNode, syncLen: syncLen,
    NEW_TYPES: NEW_TYPES, newNode: newNode,
    findItemContainers: findItemContainers, itemFields: itemFields,
    gridInfo: gridInfo, freeCell: freeCell, CONTAINER_ITEM: CONTAINER_ITEM
  };
})(typeof window !== 'undefined' ? window : this);
