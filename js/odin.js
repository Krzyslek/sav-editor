/*
 * odin.js - reader / writer for the OdinSerializer (Sirenix) binary format
 * used by Unity games such as Shadow Dungeon for their .sav files.
 *
 * Verified: parse -> serialize of a 3.2 MB save reproduces the input byte for byte.
 */
(function (global) {
  'use strict';

  // ---- entry markers -------------------------------------------------------
  var M = {
    Invalid: 0,
    NamedStartOfReferenceNode: 1, UnnamedStartOfReferenceNode: 2,
    NamedStartOfStructNode: 3, UnnamedStartOfStructNode: 4,
    EndOfNode: 5, StartOfArray: 6, EndOfArray: 7, PrimitiveArray: 8,
    NamedInternalReference: 9, UnnamedInternalReference: 10,
    NamedExternalReferenceByIndex: 11, UnnamedExternalReferenceByIndex: 12,
    NamedExternalReferenceByGuid: 13, UnnamedExternalReferenceByGuid: 14,
    NamedSByte: 15, UnnamedSByte: 16, NamedByte: 17, UnnamedByte: 18,
    NamedShort: 19, UnnamedShort: 20, NamedUShort: 21, UnnamedUShort: 22,
    NamedInt: 23, UnnamedInt: 24, NamedUInt: 25, UnnamedUInt: 26,
    NamedLong: 27, UnnamedLong: 28, NamedULong: 29, UnnamedULong: 30,
    NamedFloat: 31, UnnamedFloat: 32, NamedDouble: 33, UnnamedDouble: 34,
    NamedDecimal: 35, UnnamedDecimal: 36,
    NamedChar: 37, UnnamedChar: 38, NamedString: 39, UnnamedString: 40,
    NamedGuid: 41, UnnamedGuid: 42, NamedBoolean: 43, UnnamedBoolean: 44,
    NamedNull: 45, UnnamedNull: 46,
    TypeName: 47, TypeID: 48, EndOfStream: 49,
    NamedExternalReferenceByString: 50, UnnamedExternalReferenceByString: 51
  };

  var NAMES = {};
  for (var k in M) NAMES[M[k]] = k;

  function set(list) { var s = Object.create(null); for (var i = 0; i < list.length; i++) s[list[i]] = true; return s; }

  var NAMED     = set([1, 3, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 50]);
  var NODE      = set([1, 2, 3, 4]);            // carries a type reference
  var REFNODE   = set([1, 2]);                  // ... and a reference id
  var CONTAINER = set([1, 2, 3, 4, 6]);         // has children + implicit terminator
  var INT64     = set([27, 28, 29, 30]);        // needs BigInt
  var RAWVAL    = set([13, 14, 35, 36, 41, 42]);// 16 raw bytes
  var STRVAL    = set([39, 40, 50, 51]);
  var FLOATV    = set([31, 32]);
  var DOUBLEV   = set([33, 34]);
  var INTREF    = set([9, 10, 11, 12]);

  // Value "kind" for the UI: how a node's payload is presented / edited.
  function kindOf(m) {
    if (CONTAINER[m]) return m === 6 ? 'array' : 'node';
    if (m === 45 || m === 46) return 'null';
    if (m === 8) return 'primarray';
    if (STRVAL[m]) return 'string';
    if (m === 43 || m === 44) return 'bool';
    if (FLOATV[m] || DOUBLEV[m]) return 'float';
    if (INT64[m]) return 'bigint';
    if (RAWVAL[m]) return 'bytes';
    if (m === 37 || m === 38) return 'char';
    if (INTREF[m]) return 'ref';
    if (m === 47 || m === 48) return 'meta';
    return 'int';
  }

  // Integer ranges, used to validate edits.
  var INT_RANGE = {
    15: [-128, 127], 16: [-128, 127], 17: [0, 255], 18: [0, 255],
    19: [-32768, 32767], 20: [-32768, 32767], 21: [0, 65535], 22: [0, 65535],
    23: [-2147483648, 2147483647], 24: [-2147483648, 2147483647],
    25: [0, 4294967295], 26: [0, 4294967295],
    9: [-2147483648, 2147483647], 10: [-2147483648, 2147483647],
    11: [-2147483648, 2147483647], 12: [-2147483648, 2147483647]
  };

  // ---- low level reader ----------------------------------------------------
  function Reader(buf) {
    this.u8 = new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.p = 0;
  }
  Reader.prototype = {
    byte: function () { return this.u8[this.p++]; },
    i32: function () { var v = this.dv.getInt32(this.p, true); this.p += 4; return v; },
    i64: function () { var v = this.dv.getBigInt64(this.p, true); this.p += 8; return v; },
    str: function () {
      var f = this.u8[this.p++], n = this.dv.getInt32(this.p, true); this.p += 4;
      var s;
      if (f === 0) { s = latin1(this.u8, this.p, n); this.p += n; }
      else { s = utf16(this.u8, this.p, n); this.p += n * 2; }
      return { v: s, f: f };
    },
    bytes: function (n) { var b = this.u8.subarray(this.p, this.p + n); this.p += n; return b; }
  };

  function latin1(u8, off, n) {
    var out = '';
    for (var i = 0; i < n; i += 4096)
      out += String.fromCharCode.apply(null, u8.subarray(off + i, off + Math.min(i + 4096, n)));
    return out;
  }
  function utf16(u8, off, chars) {
    var out = '', step = 2048;
    for (var i = 0; i < chars; i += step) {
      var end = Math.min(i + step, chars), arr = new Array(end - i);
      for (var j = i; j < end; j++) arr[j - i] = u8[off + j * 2] | (u8[off + j * 2 + 1] << 8);
      out += String.fromCharCode.apply(null, arr);
    }
    return out;
  }

  // ---- low level writer ----------------------------------------------------
  function Writer() { this.buf = new Uint8Array(1 << 16); this.dv = new DataView(this.buf.buffer); this.len = 0; }
  Writer.prototype = {
    need: function (n) {
      if (this.len + n <= this.buf.length) return;
      var cap = this.buf.length;
      while (cap < this.len + n) cap *= 2;
      var nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb; this.dv = new DataView(nb.buffer);
    },
    byte: function (v) { this.need(1); this.buf[this.len++] = v & 255; },
    i32: function (v) { this.need(4); this.dv.setInt32(this.len, v | 0, true); this.len += 4; },
    u32: function (v) { this.need(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; },
    i16: function (v) { this.need(2); this.dv.setInt16(this.len, v, true); this.len += 2; },
    u16: function (v) { this.need(2); this.dv.setUint16(this.len, v, true); this.len += 2; },
    i64: function (v) { this.need(8); this.dv.setBigInt64(this.len, BigInt(v), true); this.len += 8; },
    u64: function (v) { this.need(8); this.dv.setBigUint64(this.len, BigInt(v), true); this.len += 8; },
    f32: function (v) { this.need(4); this.dv.setFloat32(this.len, v, true); this.len += 4; },
    f64: function (v) { this.need(8); this.dv.setFloat64(this.len, v, true); this.len += 8; },
    raw: function (b) { this.need(b.length); this.buf.set(b, this.len); this.len += b.length; },
    str: function (s, f) {
      var i;
      if (f === 0) {
        this.byte(0); this.i32(s.length); this.need(s.length);
        for (i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 255;
      } else {
        this.byte(1); this.i32(s.length); this.need(s.length * 2);
        for (i = 0; i < s.length; i++) {
          var c = s.charCodeAt(i);
          this.buf[this.len++] = c & 255; this.buf[this.len++] = (c >> 8) & 255;
        }
      }
    },
    result: function () { return this.buf.subarray(0, this.len); }
  };

  // ---- parse ---------------------------------------------------------------
  // Terminators (EndOfNode / EndOfArray) are implicit in the model: every
  // container owns its children and its terminator is re-emitted on write.
  function parse(buffer) {
    var r = new Reader(buffer), types = new Map(), root = [], stack = [root],
        warnings = [], count = 0, id, ts;
    while (r.p < r.u8.length) {
      var off = r.p, m = r.byte(), n = { m: m };
      if (m === M.EndOfNode || m === M.EndOfArray) {
        if (stack.length > 1) stack.pop();
        else warnings.push('unbalanced terminator at 0x' + off.toString(16));
        continue;
      }
      if (NAMED[m]) { var nm = r.str(); n.name = nm.v; n.nameF = nm.f; }
      if (NODE[m]) {
        var t = r.byte();
        if (t === M.TypeName) { id = r.i32(); ts = r.str(); types.set(id, ts.v); n.type = ts.v; n.typeF = ts.f; }
        else if (t === M.TypeID) { id = r.i32(); n.type = types.has(id) ? types.get(id) : ('<unknown type #' + id + '>'); }
        else if (t === M.UnnamedNull) { n.type = null; }
        else { warnings.push('bad type marker ' + t + ' at 0x' + (r.p - 1).toString(16)); break; }
        if (REFNODE[m]) n.refId = r.i32();
        n.c = [];
      } else if (m === M.StartOfArray) { n.len = r.i64(); n.c = [];
      } else if (m === M.PrimitiveArray) { n.cnt = r.i32(); n.esz = r.i32(); n.raw = r.bytes(n.cnt * n.esz);
      } else if (INTREF[m] || m === 23 || m === 24) { n.v = r.i32();
      } else if (m === 15 || m === 16) { n.v = r.dv.getInt8(r.p); r.p += 1;
      } else if (m === 17 || m === 18) { n.v = r.u8[r.p]; r.p += 1;
      } else if (m === 19 || m === 20) { n.v = r.dv.getInt16(r.p, true); r.p += 2;
      } else if (m === 21 || m === 22) { n.v = r.dv.getUint16(r.p, true); r.p += 2;
      } else if (m === 25 || m === 26) { n.v = r.dv.getUint32(r.p, true); r.p += 4;
      } else if (m === 27 || m === 28) { n.v = r.i64();
      } else if (m === 29 || m === 30) { n.v = r.dv.getBigUint64(r.p, true); r.p += 8;
      } else if (FLOATV[m]) { n.v = r.dv.getFloat32(r.p, true); n.raw = r.bytes(4);
      } else if (DOUBLEV[m]) { n.v = r.dv.getFloat64(r.p, true); n.raw = r.bytes(8);
      } else if (RAWVAL[m]) { n.v = r.bytes(16);
      } else if (m === 37 || m === 38) { n.v = r.bytes(2);
      } else if (STRVAL[m]) { var sv = r.str(); n.v = sv.v; n.vf = sv.f;
      } else if (m === 43 || m === 44) { n.v = r.byte() !== 0;
      } else if (m === 45 || m === 46 || m === 49) { /* no payload */
      } else if (m === M.TypeName) { n.tid = r.i32(); ts = r.str(); types.set(n.tid, ts.v); n.v = ts.v;
      } else if (m === M.TypeID) { n.v = r.i32();
      } else { warnings.push('unknown marker ' + m + ' at 0x' + off.toString(16) + ' - stopped'); break; }

      n.off = off;
      stack[stack.length - 1].push(n);
      count++;
      if (CONTAINER[m]) stack.push(n.c);
    }
    link(root, null);
    return { root: root, types: types, warnings: warnings, count: count, bytes: r.u8.length, read: r.p };
  }

  function link(nodes, parent) {
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].p = parent;
      if (nodes[i].c) link(nodes[i].c, nodes[i]);
    }
  }

  // ---- serialize -----------------------------------------------------------
  // Reference ids are renumbered in document order (which is how Odin assigns
  // them), and internal references are remapped, so duplicated / inserted
  // subtrees stay consistent.
  function serialize(root) {
    var map = new Map(), next = 0;
    (function num(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (REFNODE[n.m]) {
          var nid = next++;
          n._nid = nid;
          if (n.refId !== undefined && !map.has(n.refId)) map.set(n.refId, nid);
        }
        if (n.c) num(n.c);
      }
    })(root);

    var w = new Writer(), tmap = new Map(), dangling = 0;
    (function emit(nodes) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i], m = n.m;
        w.byte(m);
        if (NAMED[m]) w.str(n.name || '', n.nameF === 0 ? 0 : 1);
        if (NODE[m]) {
          if (n.type === null || n.type === undefined) w.byte(M.UnnamedNull);
          else if (tmap.has(n.type)) { w.byte(M.TypeID); w.i32(tmap.get(n.type)); }
          else {
            var tid = tmap.size; tmap.set(n.type, tid);
            w.byte(M.TypeName); w.i32(tid); w.str(n.type, n.typeF === 0 ? 0 : 1);
          }
          if (REFNODE[m]) w.i32(n._nid);
        } else if (m === M.StartOfArray) { w.i64(BigInt(n.c.length));
        } else if (m === M.PrimitiveArray) { w.i32(n.cnt); w.i32(n.esz); w.raw(n.raw);
        } else if (INTREF[m]) {
          var tgt = n.v;
          if (m === 9 || m === 10) { if (map.has(tgt)) tgt = map.get(tgt); else dangling++; }
          w.i32(tgt);
        } else if (m === 23 || m === 24) { w.i32(n.v);
        } else if (m === 15 || m === 16) { w.byte(n.v < 0 ? n.v + 256 : n.v);
        } else if (m === 17 || m === 18) { w.byte(n.v);
        } else if (m === 19 || m === 20) { w.i16(n.v);
        } else if (m === 21 || m === 22) { w.u16(n.v);
        } else if (m === 25 || m === 26) { w.u32(n.v);
        } else if (m === 27 || m === 28) { w.i64(n.v);
        } else if (m === 29 || m === 30) { w.u64(n.v);
        } else if (FLOATV[m]) { if (n.raw && !n.dirty) w.raw(n.raw); else w.f32(n.v);
        } else if (DOUBLEV[m]) { if (n.raw && !n.dirty) w.raw(n.raw); else w.f64(n.v);
        } else if (RAWVAL[m] || m === 37 || m === 38) { w.raw(n.v);
        } else if (STRVAL[m]) { w.str(n.v == null ? '' : n.v, n.vf === 0 ? 0 : 1);
        } else if (m === 43 || m === 44) { w.byte(n.v ? 1 : 0);
        } else if (m === 45 || m === 46 || m === 49) { /* nothing */
        } else if (m === M.TypeName) { w.i32(n.tid); w.str(n.v, 1);
        } else if (m === M.TypeID) { w.i32(n.v);
        }
        if (n.c) { emit(n.c); w.byte(m === M.StartOfArray ? M.EndOfArray : M.EndOfNode); }
      }
    })(root);
    return { data: w.result(), dangling: dangling, types: tmap.size };
  }

  // ---- template instantiation ---------------------------------------------
  // Turns the portable JSON node form (used by the item catalog) into live nodes.
  function fromTemplate(t, parent) {
    var n = { m: t.m, p: parent || null };
    if (t.n !== undefined) { n.name = t.n; n.nameF = t.nf === undefined ? 1 : t.nf; }
    if (NODE[t.m]) { n.type = (t.t === undefined ? null : t.t); if (REFNODE[t.m]) n.refId = undefined; }
    if (t.c) { n.c = []; for (var i = 0; i < t.c.length; i++) n.c.push(fromTemplate(t.c[i], n)); }
    if (t.m === 6) n.len = BigInt(t.c ? t.c.length : 0);
    if (t.m === 8) { n.cnt = t.cnt; n.esz = t.esz; n.raw = hexToBytes(t.raw); }
    else if (INT64[t.m]) n.v = BigInt(t.v);
    else if (RAWVAL[t.m] || t.m === 37 || t.m === 38) n.v = hexToBytes(t.v);
    else if (STRVAL[t.m]) { n.v = t.v; n.vf = t.vf === undefined ? 1 : t.vf; }
    else if (t.v !== undefined) { n.v = t.v; n.dirty = true; }
    return n;
  }
  function hexToBytes(h) {
    var b = new Uint8Array(h.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
    return b;
  }
  function clone(n, parent) {
    var o = { m: n.m }, k;
    for (k in n) {
      if (k === 'c' || k === 'p' || k === '_nid' || k === 'off') continue;
      o[k] = (n[k] instanceof Uint8Array) ? n[k].slice() : n[k];
    }
    o.p = parent || null;
    if (n.c) { o.c = new Array(n.c.length); for (var i = 0; i < n.c.length; i++) o.c[i] = clone(n.c[i], o); }
    return o;
  }

  global.Odin = {
    M: M, NAMES: NAMES, NAMED: NAMED, NODE: NODE, REFNODE: REFNODE, CONTAINER: CONTAINER,
    INT64: INT64, STRVAL: STRVAL, INT_RANGE: INT_RANGE,
    kindOf: kindOf, parse: parse, serialize: serialize,
    fromTemplate: fromTemplate, clone: clone, link: link
  };
})(typeof window !== 'undefined' ? window : this);
