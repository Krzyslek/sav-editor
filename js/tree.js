/*
 * tree.js - virtualised, paginated tree view.
 * Renders only the rows inside the viewport, so a 200k-node save stays fluid.
 */
(function (global) {
  'use strict';
  var O = global.Odin, Mo = global.Model;
  var ROW = 24, PAGE = 200, OVERSCAN = 12;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function TreeView(host, opts) {
    this.host = host;
    this.opts = opts || {};
    this.expanded = new Set();
    this.page = new Map();       // container node -> page index
    this.rows = [];
    this.selected = null;
    this.root = [];
    this.filter = null;          // Set of nodes to keep (search filter), or null

    host.classList.add('tree');
    this.spacer = el('div', 'tree-spacer');
    this.canvas = el('div', 'tree-canvas');
    host.appendChild(this.spacer);
    host.appendChild(this.canvas);

    var self = this;
    this._onScroll = function () { self.paint(); };
    host.addEventListener('scroll', this._onScroll);
    host.addEventListener('click', function (e) { self.onClick(e); });
    host.addEventListener('dblclick', function (e) { self.onDblClick(e); });
  }

  TreeView.prototype = {
    setRoot: function (root) {
      this.root = root;
      this.expanded.clear(); this.page.clear();
      for (var i = 0; i < root.length; i++) this.expanded.add(root[i]);
      this.build();
    },

    // ---- row list ---------------------------------------------------------
    build: function () {
      var rows = [], self = this;
      (function walk(nodes, depth, parent) {
        var total = nodes.length, start = 0, end = total, pageIdx = 0, paged = total > PAGE;
        if (paged) {
          pageIdx = self.page.get(parent) || 0;
          var pages = Math.ceil(total / PAGE);
          if (pageIdx >= pages) { pageIdx = pages - 1; self.page.set(parent, pageIdx); }
          start = pageIdx * PAGE; end = Math.min(start + PAGE, total);
          rows.push({ kind: 'pager', parent: parent, depth: depth, page: pageIdx, pages: pages, total: total });
        }
        for (var i = start; i < end; i++) {
          var n = nodes[i];
          if (self.filter && !self.filter.has(n)) continue;
          rows.push({ kind: 'node', node: n, depth: depth, index: i });
          if (n.c && n.c.length && self.expanded.has(n)) walk(n.c, depth + 1, n);
        }
      })(this.root, 0, null);
      this.rows = rows;
      this.spacer.style.height = (rows.length * ROW) + 'px';
      this.paint();
      if (this.opts.onCount) this.opts.onCount(rows.length);
    },

    paint: function () {
      var top = this.host.scrollTop, h = this.host.clientHeight;
      var first = Math.max(0, Math.floor(top / ROW) - OVERSCAN);
      var last = Math.min(this.rows.length, Math.ceil((top + h) / ROW) + OVERSCAN);
      var frag = document.createDocumentFragment();
      for (var i = first; i < last; i++) frag.appendChild(this.renderRow(this.rows[i], i));
      this.canvas.textContent = '';
      this.canvas.appendChild(frag);
    },

    renderRow: function (r, i) {
      var row = el('div', 'row');
      row.style.top = (i * ROW) + 'px';
      row.dataset.i = i;

      if (r.kind === 'pager') {
        row.className = 'row pager';
        row.style.paddingLeft = (8 + r.depth * 14) + 'px';
        row.appendChild(el('span', 'pg-label', r.total.toLocaleString() + ' elements - page ' + (r.page + 1) + ' / ' + r.pages));
        var prev = el('button', 'pg-btn', '<'); prev.dataset.act = 'pgprev'; prev.disabled = r.page === 0;
        var next = el('button', 'pg-btn', '>'); next.dataset.act = 'pgnext'; next.disabled = r.page >= r.pages - 1;
        var jump = el('input', 'pg-jump'); jump.type = 'number'; jump.value = r.page + 1;
        jump.min = 1; jump.max = r.pages; jump.dataset.act = 'pgjump';
        row.appendChild(prev); row.appendChild(jump); row.appendChild(next);
        row._row = r;
        return row;
      }

      var n = r.node, kind = O.kindOf(n.m);
      if (n === this.selected) row.classList.add('sel');
      if (n.dirty || n._added) row.classList.add('dirty');
      row.style.paddingLeft = (8 + r.depth * 14) + 'px';

      var tw = el('span', 'twisty');
      if (n.c && n.c.length) { tw.textContent = this.expanded.has(n) ? '▾' : '▸'; tw.dataset.act = 'toggle'; }
      else tw.textContent = '';
      row.appendChild(tw);

      row.appendChild(el('span', 'name', Mo.label(n)));

      if (n.c) {
        row.appendChild(el('span', 'type', n.type === null ? (n.m === 6 ? '' : 'struct') : Mo.shortType(n.type)));
        row.appendChild(el('span', 'count', n.m === 6 ? ('[' + n.c.length + ']') : ('{' + n.c.length + '}')));
      } else {
        var v = el('span', 'val ' + kind, Mo.valueText(n));
        v.dataset.act = 'edit';
        v.title = 'Click to edit (' + O.NAMES[n.m] + ')';
        row.appendChild(v);
        row.appendChild(el('span', 'mtype', O.NAMES[n.m].replace(/^(Named|Unnamed)/, '')));
      }
      row._row = r;
      return row;
    },

    // ---- interaction ------------------------------------------------------
    onClick: function (e) {
      var t = e.target, row = t.closest ? t.closest('.row') : null;
      if (!row) return;
      var r = row._row, act = t.dataset ? t.dataset.act : null;
      if (r.kind === 'pager') {
        if (act === 'pgprev') { this.page.set(r.parent, r.page - 1); this.build(); }
        else if (act === 'pgnext') { this.page.set(r.parent, r.page + 1); this.build(); }
        return;
      }
      var n = r.node;
      if (act === 'toggle') { this.toggle(n); return; }
      this.select(n);
      if (act === 'edit') this.beginEdit(n, t);
    },

    onDblClick: function (e) {
      var row = e.target.closest ? e.target.closest('.row') : null;
      if (!row || row._row.kind !== 'node') return;
      var n = row._row.node;
      if (n.c && n.c.length) this.toggle(n);
    },

    toggle: function (n) {
      if (this.expanded.has(n)) this.expanded.delete(n); else this.expanded.add(n);
      this.build();
    },

    select: function (n) {
      this.selected = n;
      this.paint();
      if (this.opts.onSelect) this.opts.onSelect(n);
    },

    beginEdit: function (n, span) {
      var kind = O.kindOf(n.m), self = this;
      if (kind === 'bytes' || kind === 'primarray' || kind === 'null' || kind === 'char') return;
      if (kind === 'bool') {
        this.opts.onEdit(n, !n.v);
        return;
      }
      var inp = el('input', 'val-edit');
      inp.value = kind === 'string' ? (n.v || '') : Mo.valueText(n);
      span.textContent = '';
      span.appendChild(inp);
      inp.focus(); inp.select();
      var done = false;
      function commit(ok) {
        if (done) return; done = true;
        var raw = inp.value;
        if (ok) self.opts.onEdit(n, raw);
        self.paint();
      }
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        ev.stopPropagation();
      });
      inp.addEventListener('blur', function () { commit(true); });
      inp.addEventListener('click', function (ev) { ev.stopPropagation(); });
    },

    // ---- navigation -------------------------------------------------------
    expandTo: function (n) {
      var chain = Mo.ancestors(n);
      for (var i = 0; i < chain.length; i++) {
        var a = chain[i];
        this.expanded.add(a);
        if (a.c && a.c.length > PAGE) {
          var child = (i + 1 < chain.length) ? chain[i + 1] : n;
          var idx = a.c.indexOf(child);
          if (idx >= 0) this.page.set(a, Math.floor(idx / PAGE));
        }
      }
      this.build();
    },

    reveal: function (n) {
      this.expandTo(n);
      var idx = -1;
      for (var i = 0; i < this.rows.length; i++)
        if (this.rows[i].kind === 'node' && this.rows[i].node === n) { idx = i; break; }
      if (idx < 0) return false;
      var want = idx * ROW - this.host.clientHeight / 2;
      this.host.scrollTop = Math.max(0, want);
      this.select(n);
      this.paint();
      return true;
    },

    collapseAll: function () {
      this.expanded.clear();
      for (var i = 0; i < this.root.length; i++) this.expanded.add(this.root[i]);
      this.build();
    },

    setFilter: function (nodeSet) {
      this.filter = nodeSet;
      this.build();
    }
  };

  global.TreeView = TreeView;
  global.TreeView.ROW = ROW;
  global.TreeView.PAGE = PAGE;
})(typeof window !== 'undefined' ? window : this);
