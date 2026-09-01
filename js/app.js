/*
 * app.js - wiring: file IO, search, node editing, item insertion.
 */
(function () {
  'use strict';
  var O = window.Odin, Mo = window.Model, It = window.Items;

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    file: null, original: null, doc: null, tree: null,
    edits: null, dirty: false, catalog: new It.Catalog(), items: [], targets: []
  };

  // ---------------------------------------------------------------- helpers
  function status(msg, cls) {
    var s = $('status');
    s.textContent = msg;
    s.parentElement.className = 'status' + (cls ? ' ' + cls : '');
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function markDirty() {
    state.dirty = true;
    $('btnSave').disabled = false;
    $('btnUndo').disabled = !state.edits.canUndo();
    $('btnRedo').disabled = !state.edits.canRedo();
    updateStats();
  }
  function updateStats() {
    if (!state.doc) return;
    $('stats').textContent = state.doc.count.toLocaleString() + ' entries - ' +
      state.doc.types.size + ' types' + (state.dirty ? ' - modified' : '');
  }

  // ---------------------------------------------------------------- loading
  function openFile(file) {
    status('Reading ' + file.name + '...');
    var fr = new FileReader();
    fr.onload = function () {
      try { loadBuffer(file, fr.result); }
      catch (e) { console.error(e); status('Failed to parse: ' + e.message, 'err'); }
    };
    fr.onerror = function () { status('Could not read the file.', 'err'); };
    fr.readAsArrayBuffer(file);
  }

  function loadBuffer(file, buf) {
    var t0 = performance.now();
    var doc = O.parse(buf);
    if (!doc.count) throw new Error('no entries found - is this an OdinSerializer save?');
    state.file = file;
    state.original = new Uint8Array(buf);
    state.doc = doc;
    state.dirty = false;
    state.edits = new Mo.Edits(function () { markDirty(); render(); });

    $('empty').hidden = true;
    $('fileinfo').hidden = false;
    $('fname').textContent = file.name;
    $('fmeta').textContent = fmtBytes(file.size) + ' - ' + doc.count.toLocaleString() + ' entries';
    $('btnSave').disabled = false;
    $('btnVerify').disabled = false;

    state.tree = new TreeView($('tree'), { onSelect: showDetails, onEdit: commitEdit });
    state.tree.setRoot(doc.root);

    buildGoto(doc.root);
    buildTargets(doc.root);
    updateStats();

    var ms = Math.round(performance.now() - t0);
    var warn = doc.warnings.length ? ' - ' + doc.warnings.length + ' warning(s): ' + doc.warnings[0] : '';
    if (doc.read < doc.bytes) {
      status('Parsed ' + doc.count.toLocaleString() + ' entries but stopped at byte ' + doc.read +
             ' of ' + doc.bytes + '.' + warn, 'err');
    } else {
      status('Loaded ' + file.name + ' in ' + ms + ' ms.' + warn, warn ? '' : 'ok');
    }
  }

  function buildGoto(root) {
    var sel = $('goto');
    sel.innerHTML = '<option value="">Go to...</option>';
    var top = root[0] && root[0].c ? root[0].c : root;
    top.forEach(function (n, i) {
      if (!n.c) return;
      var o = document.createElement('option');
      o.value = i; o.textContent = Mo.label(n) + '  (' + n.c.length + ')';
      sel.appendChild(o);
    });
    sel._nodes = top;
  }

  // ---------------------------------------------------------------- editing
  function parseValue(node, raw) {
    var kind = O.kindOf(node.m);
    if (kind === 'bool') return typeof raw === 'boolean' ? raw : /^(1|true|yes)$/i.test(String(raw).trim());
    if (kind === 'string') return String(raw);
    if (kind === 'bigint') {
      var s = String(raw).trim();
      if (!/^-?\d+$/.test(s)) throw new Error('expected a whole number');
      return BigInt(s);
    }
    if (kind === 'float') {
      var f = parseFloat(String(raw).replace(',', '.'));
      if (!isFinite(f) && !/^-?(inf|nan)/i.test(String(raw))) throw new Error('expected a number');
      return f;
    }
    if (kind === 'int' || kind === 'ref') {
      var v = Math.trunc(Number(String(raw).trim()));
      if (!isFinite(v)) throw new Error('expected a whole number');
      var r = O.INT_RANGE[node.m];
      if (r && (v < r[0] || v > r[1])) throw new Error('value must be between ' + r[0] + ' and ' + r[1]);
      return v;
    }
    throw new Error('this entry type cannot be edited inline');
  }

  function commitEdit(node, raw) {
    var v;
    try { v = parseValue(node, raw); }
    catch (e) { status(e.message, 'err'); return; }
    var same = (O.kindOf(node.m) === 'bigint') ? (node.v === v) : (node.v === v);
    if (same) { render(); return; }
    state.edits.apply(Mo.setValue(node, v));
    status('Set ' + Mo.label(node) + ' = ' + Mo.valueText(node), 'ok');
  }

  function render() {
    if (state.tree) state.tree.build();
    if (state.tree && state.tree.selected) showDetails(state.tree.selected);
  }

  // ---------------------------------------------------------------- details
  function showDetails(n) {
    if (!n) { $('det').hidden = true; $('detEmpty').hidden = false; return; }
    $('det').hidden = false; $('detEmpty').hidden = true;
    $('detPath').textContent = Mo.pathOf(n);
    $('detName').value = n.name === undefined ? '' : n.name;
    $('detName').disabled = !O.NAMED[n.m];
    $('detMarker').textContent = O.NAMES[n.m] + ' (' + n.m + ')';
    $('detTypeRow').hidden = !O.NODE[n.m];
    $('detType').textContent = n.type === null ? '(null type)' : (n.type || '');

    var cell = $('detValCell'); cell.textContent = '';
    var kind = O.kindOf(n.m);
    $('detValRow').hidden = !!n.c;
    if (!n.c) {
      if (kind === 'bool') {
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!n.v;
        cb.onchange = function () { state.edits.apply(Mo.setValue(n, cb.checked)); };
        cell.appendChild(cb);
      } else if (kind === 'string') {
        var ta = document.createElement('textarea'); ta.className = 'in'; ta.value = n.v || '';
        ta.onchange = function () { commitEdit(n, ta.value); };
        cell.appendChild(ta);
      } else if (kind === 'null' || kind === 'bytes' || kind === 'primarray' || kind === 'char') {
        cell.textContent = Mo.valueText(n);
      } else {
        var inp = document.createElement('input'); inp.className = 'in'; inp.value = Mo.valueText(n);
        inp.onchange = function () { commitEdit(n, inp.value); };
        cell.appendChild(inp);
      }
    }

    $('addBox').hidden = !n.c;
    $('actDupLast').hidden = !(n.m === O.M.StartOfArray && n.c.length);
    $('detItemCard').innerHTML = itemCardHtml(n);
  }

  // Shows a compact card when the selected node (or its child) is a game item.
  function itemCardHtml(n) {
    var host = n;
    if (n.type && n.type.indexOf(Mo.CONTAINER_ITEM) === 0) {
      for (var i = 0; i < n.c.length; i++) if (n.c[i].c && n.c[i].type) { host = n.c[i]; break; }
    }
    if (!host.c) return '';
    var f = Mo.itemFields(host);
    if (!f.ItemName || !f.GlobalID) return '';
    var it = {
      gid: f.GlobalID.v, name: f.ItemName.v, quality: f.Quality ? f.Quality.v : 5,
      level: f.Level ? f.Level.v : 0, price: f.Price ? f.Price.v : 0,
      kind: f.ItemType ? ['weapon', 'gem', 'use'][f.ItemType.v] || 'use' : 'use',
      slot: f.WeaponType ? f.WeaponType.v : null, bstype: f.BStype ? f.BStype.v : null,
      useType: f.UseType ? f.UseType.v : null
    };
    var qq = It.q(it.quality);
    return '<div class="itemcard" style="border-left:3px solid ' + qq.c + '">' +
      It.iconSvg(it, 38) +
      '<div><div class="nm">' + esc(it.name) + '</div>' +
      '<div class="sub">' + qq.n + ' - lvl ' + it.level + ' - id ' + it.gid + '</div></div></div>';
  }
  function tailPath(n, keep) {
    var parts = Mo.pathOf(n).split(' / ');
    keep = keep || 3;
    return (parts.length > keep ? '... / ' : '') + parts.slice(-keep).join(' / ');
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
  }

  // ---------------------------------------------------------------- search
  var searchTimer = null;
  function runSearch() {
    if (!state.doc) return;
    var q = $('q').value;
    if (!q) { $('results').hidden = true; state.tree.setFilter(null); return; }
    var r = Mo.search(state.doc.root, {
      query: q, regex: $('qRegex').checked, caseSensitive: $('qCase').checked,
      inNames: $('qNames').checked, inValues: $('qValues').checked, inTypes: $('qTypes').checked,
      limit: 5000
    });
    if (r.error) { status('Bad regex: ' + r.error, 'err'); return; }

    if ($('qFilter').checked) {
      var keep = new Set();
      r.list.forEach(function (h) {
        keep.add(h.node);
        Mo.ancestors(h.node).forEach(function (a) { keep.add(a); });
      });
      state.tree.setFilter(keep);
      state.tree.expanded = new Set(keep);
      state.tree.build();
    } else {
      state.tree.setFilter(null);
    }

    var list = $('resList');
    list.textContent = '';
    var frag = document.createDocumentFragment();
    var shown = Math.min(r.list.length, 400);
    for (var i = 0; i < shown; i++) {
      var h = r.list[i], d = document.createElement('div');
      d.className = 'res';
      d.innerHTML = '<span class="rname">' + esc(Mo.label(h.node)) + '</span>' +
        '<span class="rval">' + esc(h.node.c ? Mo.shortType(h.node.type) : Mo.valueText(h.node)) + '</span>' +
        '<span class="rpath" title="' + esc(Mo.pathOf(h.node)) + '">' + esc(tailPath(h.node.p || h.node)) + '</span>';
      (function (node) { d.onclick = function () { state.tree.reveal(node); }; })(h.node);
      frag.appendChild(d);
    }
    list.appendChild(frag);
    $('resCount').textContent = r.list.length.toLocaleString() + ' match(es)' +
      (r.truncated ? ' (stopped at limit)' : '') + (shown < r.list.length ? ' - showing first ' + shown : '');
    $('results').hidden = false;
  }

  // ---------------------------------------------------------------- items
  function buildTargets(root) {
    var sel = $('target');
    sel.innerHTML = '';
    var list = Mo.findItemContainers(root);
    state.targets = list;
    list.forEach(function (t, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = t.name + ' (' + t.array.c.length + ' items)';
      sel.appendChild(o);
    });
    if (!list.length) {
      var o2 = document.createElement('option');
      o2.value = ''; o2.textContent = 'no item containers found';
      sel.appendChild(o2);
    }
  }

  function loadCatalog() {
    var base = location.pathname.replace(/[^/]*$/, '');
    return state.catalog.load(base).then(function (j) {
      state.items = j.items;
      var slots = {}, quals = {};
      j.items.forEach(function (i) { if (i.slot) slots[i.slot] = i.slotLabel || i.slot; quals[i.quality] = 1; });
      var fs = $('fSlot');
      Object.keys(slots).forEach(function (s) {
        var o = document.createElement('option'); o.value = s; o.textContent = slots[s]; fs.appendChild(o);
      });
      var fq = $('fQuality');
      Object.keys(quals).sort(function (a, b) { return b - a; }).forEach(function (q) {
        var o = document.createElement('option'); o.value = q; o.textContent = It.q(+q).n + ' (' + q + ')'; fq.appendChild(o);
      });
      $('aboutVer').textContent = 'Catalogue: ' + j.items.length + ' items from ' + j.game + ' ' + j.gameVersion + '.';
      renderItems();
      return state.catalog.loadTemplates(base);
    }).catch(function (e) {
      $('itemGrid').innerHTML = '<div class="pad muted">Item catalogue unavailable: ' + esc(e.message) + '</div>';
    });
  }

  function renderItems() {
    var f = {
      query: $('itemQ').value, kind: $('fKind').value, slot: $('fSlot').value,
      quality: $('fQuality').value, sort: $('fSort').value
    };
    var list = It.filterItems(state.items, f);
    $('itemCount').textContent = list.length + ' of ' + state.items.length + ' items';
    var grid = $('itemGrid');
    grid.textContent = '';
    var frag = document.createDocumentFragment();
    var shown = Math.min(list.length, 400);
    for (var i = 0; i < shown; i++) {
      var it = list[i], qq = It.q(it.quality);
      var c = document.createElement('div');
      c.className = 'card';
      c.style.borderTopColor = qq.c;
      c.innerHTML = '<div class="ico">' + state.catalog.iconHtml(it, 40) + '</div>' +
        '<div class="cname" style="color:' + qq.c + '">' + esc(it.name) + '</div>' +
        '<div class="cmeta"><span>lvl ' + it.level + '</span><span>#' + it.gid + '</span></div>' +
        '<button class="add" title="Insert into the selected container">+</button>';
      bindCard(c, it);
      frag.appendChild(c);
    }
    grid.appendChild(frag);
    if (shown < list.length) {
      var more = document.createElement('div');
      more.className = 'pad muted small';
      more.textContent = 'Showing the first ' + shown + ' - refine the search to see the rest.';
      grid.appendChild(more);
    }
  }

  function bindCard(c, it) {
    c.onmouseenter = function (e) { showTip(it, e); };
    c.onmousemove = function (e) { moveTip(e); };
    c.onmouseleave = hideTip;
    c.onclick = function () { insertItem(it); };
  }

  function showTip(it, e) {
    var d = It.describe(it, state.catalog.index.charTypes), qq = It.q(it.quality);
    var html = '<h4 style="color:' + qq.c + '">' + esc(it.name) + '</h4>' +
      '<div class="tsub">' + qq.n + ' - ' + (it.kind === 'weapon' ? (it.slotLabel || it.slot) :
        it.kind === 'gem' ? 'gem / rune' : 'consumable') + '</div><table>';
    d.rows.forEach(function (r) { html += '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; });
    d.stats.forEach(function (r) { html += '<tr class="stat"><th>' + esc(r[0]) + '</th><td>+' + esc(r[1]) + '</td></tr>'; });
    html += '</table>';
    if (d.affixes.length) {
      html += '<div class="aff">' + d.affixes.length + ' rolled affix(es): ' +
        d.affixes.slice(0, 6).map(function (a) { return a.g + '#' + a.i + ' ' + a.n; }).join(', ') + '</div>';
    }
    var tip = $('tip');
    tip.innerHTML = html; tip.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    var tip = $('tip'), pad = 14;
    var x = e.clientX - tip.offsetWidth - pad, y = e.clientY + pad;
    if (x < 4) x = e.clientX + pad;
    if (y + tip.offsetHeight > innerHeight - 4) y = innerHeight - tip.offsetHeight - 4;
    tip.style.left = Math.max(4, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { $('tip').hidden = true; }

  function insertItem(it) {
    if (!state.doc) { status('Open a save file first.', 'err'); return; }
    if (!state.catalog.templates) { status('Item templates are still loading...'); return; }
    var ti = $('target').value;
    if (ti === '') { status('No item container found in this save.', 'err'); return; }
    var target = state.targets[+ti];
    var info = Mo.gridInfo(target.array);
    var cell = Mo.freeCell(info, 0);
    var qty = Math.max(1, Math.min(999, parseInt($('itemQty').value, 10) || 1));
    var node;
    try {
      node = It.buildContainerItem(state.catalog, it, { page: cell.page, x: cell.x, y: cell.y, count: qty });
    } catch (e) { status('Could not build the item: ' + e.message, 'err'); return; }

    state.edits.apply(Mo.insertNode(target.array, node, target.array.c.length));
    buildTargets(state.doc.root);
    $('target').value = ti;
    state.tree.reveal(node);
    status('Inserted "' + it.name + '" into ' + target.name +
           ' at page ' + cell.page + ', cell ' + cell.x + ':' + cell.y + '.', 'ok');
  }

  // ---------------------------------------------------------------- saving
  function serializeNow() {
    var t0 = performance.now();
    var out = O.serialize(state.doc.root);
    return { out: out, ms: Math.round(performance.now() - t0) };
  }

  function download() {
    var r = serializeNow();
    var blob = new Blob([r.out.data], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    status('Wrote ' + fmtBytes(r.out.data.length) + ' in ' + r.ms + ' ms' +
      (r.out.dangling ? ' - warning: ' + r.out.dangling + ' dangling internal reference(s)' : '') + '.', 'ok');
  }

  function verify() {
    var r = serializeNow(), a = r.out.data, b = state.original;
    if (a.length === b.length) {
      var diff = 0, first = -1;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff++; if (first < 0) first = i; }
      if (!diff) { status('Re-encoded output is byte-identical to the loaded file (' + r.ms + ' ms).', 'ok'); return; }
      status('Same size, ' + diff + ' byte(s) differ, first at 0x' + first.toString(16) + '.', 'ok');
      return;
    }
    status('Re-encoded size ' + fmtBytes(a.length) + ' vs original ' + fmtBytes(b.length) +
           ' (' + (a.length > b.length ? '+' : '') + (a.length - b.length) + ' bytes).', 'ok');
  }

  // ---------------------------------------------------------------- events
  function on(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); }

  on('btnOpen', 'click', function () { $('file').click(); });
  on('file', 'change', function (e) { if (e.target.files[0]) openFile(e.target.files[0]); });

  var dz = document.body;
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); $('dropzone').classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); $('dropzone').classList.remove('drag'); });
  });
  dz.addEventListener('drop', function (e) {
    var f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  on('q', 'input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 220); });
  ['qNames', 'qValues', 'qTypes', 'qCase', 'qRegex', 'qFilter'].forEach(function (id) { on(id, 'change', runSearch); });
  on('btnResClose', 'click', function () {
    $('results').hidden = true; $('q').value = '';
    if (state.tree) state.tree.setFilter(null);
  });
  on('btnCollapse', 'click', function () { if (state.tree) state.tree.collapseAll(); });
  on('goto', 'change', function (e) {
    var i = e.target.value;
    if (i === '' || !state.tree) return;
    state.tree.reveal($('goto')._nodes[+i]);
    e.target.value = '';
  });

  on('btnUndo', 'click', function () { state.edits.undo(); status('Undone.'); });
  on('btnRedo', 'click', function () { state.edits.redo(); status('Redone.'); });
  on('btnSave', 'click', download);
  on('btnVerify', 'click', verify);

  on('detName', 'change', function () {
    var n = state.tree.selected;
    if (n && O.NAMED[n.m]) state.edits.apply(Mo.setName(n, $('detName').value));
  });
  on('actDup', 'click', function () {
    var n = state.tree.selected;
    if (n && n.p) { var op = Mo.duplicateNode(n); state.edits.apply(op); status('Duplicated.'); }
  });
  on('actDel', 'click', function () {
    var n = state.tree.selected;
    if (n && n.p) { state.edits.apply(Mo.removeNode(n)); state.tree.selected = null; showDetails(null); status('Deleted.'); }
  });
  on('actUp', 'click', function () { var n = state.tree.selected; if (n && n.p) state.edits.apply(Mo.moveNode(n, -1)); });
  on('actDown', 'click', function () { var n = state.tree.selected; if (n && n.p) state.edits.apply(Mo.moveNode(n, 1)); });
  on('actAdd', 'click', function () {
    var n = state.tree.selected;
    if (!n || !n.c) return;
    var m = parseInt($('addType').value, 10);
    var node = Mo.newNode(m, $('addName').value, $('addValue').value, $('addCsType').value || null);
    if (n.m === O.M.StartOfArray && O.NAMED[m]) { delete node.name; node.m = m + 1; }
    state.edits.apply(Mo.insertNode(n, node, n.c.length));
    state.tree.expanded.add(n);
    state.tree.build();
    state.tree.reveal(node);
    status('Added ' + Mo.label(node) + '.', 'ok');
  });
  on('actDupLast', 'click', function () {
    var n = state.tree.selected;
    if (!n || !n.c || !n.c.length) return;
    var last = n.c[n.c.length - 1];
    var copy = O.clone(last, n);
    state.edits.apply(Mo.insertNode(n, copy, n.c.length));
    state.tree.reveal(copy);
    status('Cloned the last element.', 'ok');
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      ['details', 'items', 'about'].forEach(function (id) { $('tab-' + id).hidden = (id !== t.dataset.tab); });
      if (t.dataset.tab === 'items' && !state.items.length) loadCatalog();
    });
  });

  ['itemQ', 'fKind', 'fSlot', 'fQuality', 'fSort'].forEach(function (id) {
    on(id, 'input', function () { if (state.items.length) renderItems(); });
    on(id, 'change', function () { if (state.items.length) renderItems(); });
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (!(e.ctrlKey && (e.key === 's' || e.key === 'z' || e.key === 'y'))) return;
    }
    if (e.ctrlKey && e.key === 'f') { e.preventDefault(); $('q').focus(); $('q').select(); }
    else if (e.ctrlKey && e.key === 's') { e.preventDefault(); if (!$('btnSave').disabled) download(); }
    else if (e.ctrlKey && e.key === 'z') { e.preventDefault(); if (state.edits) state.edits.undo(); }
    else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); if (state.edits) state.edits.redo(); }
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // populate the "add entry" type list
  (function () {
    var sel = $('addType');
    Mo.NEW_TYPES.forEach(function (t) {
      var o = document.createElement('option'); o.value = t.m; o.textContent = t.label; sel.appendChild(o);
    });
  })();

  // expose for the self-test page
  window.__app = state;
})();
