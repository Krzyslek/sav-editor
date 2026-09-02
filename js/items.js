/*
 * items.js - the Shadow Dungeon item catalogue: search, icons, stat tooltips
 * and insertion of ready-made, game-valid item structures into a save.
 */
(function (global) {
  'use strict';
  var O = global.Odin, Mo = global.Model;

  // Bumped on release so browsers do not mix a new page with cached old data.
  // Keep in step with the ?v= stamps on the script tags in index.html.
  var VERSION = '1.1.1';

  var QUALITY = {
    1: { n: 'Common',    c: '#9aa4b2' }, 2: { n: 'Common',    c: '#9aa4b2' },
    3: { n: 'Uncommon',  c: '#57b25b' }, 4: { n: 'Uncommon',  c: '#57b25b' },
    5: { n: 'Rare',      c: '#4a90d9' }, 6: { n: 'Epic',      c: '#a45cd6' },
    7: { n: 'Legendary', c: '#e08b2a' }, 8: { n: 'Mythic',    c: '#d64545' },
    9: { n: 'Divine',    c: '#e6c34a' }
  };
  function q(n) { return QUALITY[n] || { n: 'Q' + n, c: '#9aa4b2' }; }

  // ---- procedural icons ----------------------------------------------------
  // Real sprites can be dropped into assets/icons/<GlobalID>.png (see README);
  // until then every item gets a deterministic, category-specific glyph.
  var GLYPH = {
    bow:   '<path d="M9 4C22 10 22 22 9 28" fill="none" stroke="{c}" stroke-width="2.4"/><path d="M9 4L9 28" stroke="{c2}" stroke-width="1.2"/><path d="M9 16h16" stroke="{c2}" stroke-width="1.6"/>',
    arrow: '<path d="M6 26L26 6" stroke="{c}" stroke-width="2.4"/><path d="M26 6l-7 1 6 6z" fill="{c}"/><path d="M6 26l4-1-3-3z" fill="{c2}"/>',
    hand:  '<path d="M10 12v-4a2 2 0 014 0v4M14 12V7a2 2 0 014 0v5M18 12V8a2 2 0 014 0v8c0 6-3 10-7 10s-9-4-9-9v-5a2 2 0 014 0" fill="none" stroke="{c}" stroke-width="1.8"/>',
    leg:   '<path d="M11 5h8v12c0 4 3 5 3 8v3h-9v-6c0-4-2-5-2-9z" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M11 22h11" stroke="{c2}" stroke-width="1.4"/>',
    body:  '<path d="M8 8l6-3 2 3 2-3 6 3-2 7 2 3v9H8v-9l2-3z" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M16 8v18" stroke="{c2}" stroke-width="1.2"/>',
    head:  '<path d="M6 18a10 10 0 0120 0v8H6z" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M16 8v18M6 20h20" stroke="{c2}" stroke-width="1.2"/>',
    little:'<circle cx="16" cy="18" r="7" fill="none" stroke="{c}" stroke-width="2"/><path d="M16 11l3-5h-6z" fill="{c2}"/>',
    gem:   '<path d="M16 4l10 7-10 17L6 11z" fill="{c}" opacity=".65"/><path d="M16 4l10 7-10 17L6 11z" fill="none" stroke="{c2}" stroke-width="1.6"/><path d="M6 11h20M16 4v24" stroke="{c2}" stroke-width="1"/>',
    rune:  '<rect x="7" y="6" width="18" height="20" rx="3" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M12 11l8 10M20 11l-8 10" stroke="{c2}" stroke-width="1.6"/>',
    stone: '<path d="M8 20l3-10 10-4 6 8-4 10-11 1z" fill="{c}" opacity=".55" stroke="{c2}" stroke-width="1.5"/>',
    potion:'<path d="M13 5h6v6l5 10a5 5 0 01-4.5 7h-7A5 5 0 018 21l5-10z" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M10 19h12a5 5 0 01-4 9h-4a5 5 0 01-4-9z" fill="{c}" opacity=".6"/>',
    scroll:'<path d="M8 7h16v18H8z" fill="none" stroke="{c}" stroke-width="1.8"/><path d="M11 12h10M11 16h10M11 20h6" stroke="{c2}" stroke-width="1.4"/>',
    coin:  '<circle cx="16" cy="16" r="9" fill="{c}" opacity=".55" stroke="{c2}" stroke-width="1.6"/><path d="M16 10v12M13 13h6M13 19h6" stroke="{c2}" stroke-width="1.4"/>'
  };

  function glyphFor(it) {
    if (it.kind === 'weapon') return GLYPH[it.slot] || GLYPH.little;
    if (it.kind === 'gem') {
      var b = String(it.bstype || '');
      if (b.indexOf('FW_') === 0) return GLYPH.rune;
      if (b.indexOf('Stone') === 0) return GLYPH.stone;
      return GLYPH.gem;
    }
    var u = String(it.useType || '');
    if (u === 'health' || u === 'mana' || u === 'huoli' || u.indexOf('EL_') === 0 || u.indexOf('ST_') === 0) return GLYPH.potion;
    if (u === 'shenyou' || u === 'money' || u === 'gold') return GLYPH.coin;
    if (u.indexOf('rune') >= 0 || u.indexOf('Rune') >= 0) return GLYPH.rune;
    return GLYPH.scroll;
  }

  var ELEM_COLOR = { red: '#d64545', green: '#57b25b', blue: '#4a90d9', yellow: '#e0c02a', purple: '#a45cd6', white: '#dfe4ec' };

  function iconSvg(it, size) {
    var col = q(it.quality).c;
    if (it.kind === 'gem' && ELEM_COLOR[it.bstype]) col = ELEM_COLOR[it.bstype];
    var c2 = 'rgba(255,255,255,.72)';
    var body = glyphFor(it).replace(/\{c\}/g, col).replace(/\{c2\}/g, c2);
    return '<svg viewBox="0 0 32 32" width="' + size + '" height="' + size + '" aria-hidden="true">' + body + '</svg>';
  }

  // ---- catalogue -----------------------------------------------------------
  function Catalog() {
    this.index = null; this.templates = null; this.iconPack = null; this.loading = null;
  }
  Catalog.prototype = {
    load: function (base) {
      var self = this;
      if (this.loading) return this.loading;
      this.loading = fetch(base + 'data/shadow-dungeon-items.json?v=' + VERSION)
        .then(function (r) { if (!r.ok) throw new Error('catalogue not found (' + r.status + ')'); return r.json(); })
        .then(function (j) {
          self.index = j;
          // optional user-supplied sprite pack
          return fetch(base + 'assets/icons/index.json')
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; })
            .then(function (pack) { self.iconPack = pack; return j; });
        });
      return this.loading;
    },
    loadTemplates: function (base) {
      var self = this;
      if (this.templates) return Promise.resolve(this.templates);
      if (this.tLoading) return this.tLoading;
      this.tLoading = fetch(base + 'data/shadow-dungeon-templates.json?v=' + VERSION)
        .then(function (r) { if (!r.ok) throw new Error('templates not found'); return r.json(); })
        .then(function (j) { self.templates = j; return j; });
      return this.tLoading;
    },
    iconHtml: function (it, size) {
      if (this.iconPack && this.iconPack.items && this.iconPack.items.indexOf(it.gid) >= 0)
        return '<img src="' + this.iconPack.base + it.gid + '.' + (this.iconPack.ext || 'png') + '" width="' + size + '" height="' + size + '" alt="">';
      return iconSvg(it, size);
    }
  };

  // ---- stat description ----------------------------------------------------
  var STAT_LABEL = {
    Damage: 'Damage', Health: 'Health', Mana: 'Mana', Fire: 'Fire', Frozen: 'Frost',
    Thunder: 'Lightning', Poison: 'Poison', Physics: 'Physical', Shadow: 'Shadow'
  };

  function describe(it, charTypes) {
    var rows = [];
    rows.push(['Global ID', it.gid]);
    if (it.kind === 'weapon') {
      rows.push(['Slot', it.slotLabel || it.slot]);
      if (charTypes && charTypes[it.charType] !== undefined) rows.push(['Class slot', charTypes[it.charType] + ' (' + it.charType + ')']);
      if (it.mj) rows.push(['Forge level', it.mj]);
      if (it.setIndex) rows.push(['Set index', it.setIndex]);
    } else if (it.kind === 'gem') {
      rows.push(['Kind', it.bstype]);
      if (it.bsQuality) rows.push(['Gem grade', it.bsQuality]);
      if (it.skname) rows.push(['Skill', it.skname]);
      if (it.number) rows.push(['Stack', it.number + (it.stackMax ? ' / ' + it.stackMax : '')]);
    } else {
      rows.push(['Effect', it.useType]);
      if (it.number) rows.push(['Amount', it.number]);
      if (it.cd) rows.push(['Cooldown', it.cd + 's']);
      if (it.duration) rows.push(['Duration', it.duration + 's']);
    }
    rows.push(['Level', it.level]);
    rows.push(['Quality', q(it.quality).n + ' (' + it.quality + ')']);
    rows.push(['Price', (it.price || 0).toLocaleString()]);
    var stats = [];
    if (it.stats) for (var k in it.stats) if (it.stats[k]) stats.push([STAT_LABEL[k] || k, Math.round(it.stats[k] * 100) / 100]);
    return { rows: rows, stats: stats, affixes: it.affixes || [] };
  }

  // ---- building a live item ------------------------------------------------
  var SLOT_FIELD = { weapon: 'Weapon', gem: 'Baoshi', use: 'UseItem' };
  var ITEM_TYPE = { weapon: 0, gem: 1, use: 2 };

  // Wraps a catalogue item in a ContainerItemSaveData node ready to be pushed
  // into an inventory / chest list.
  function buildContainerItem(catalog, item, place) {
    var tpl = catalog.templates.templates[String(item.gid)];
    if (!tpl) throw new Error('no template for item ' + item.gid);
    var wrapper = O.fromTemplate(catalog.templates.wrapper, null);
    var payload = O.fromTemplate(tpl, wrapper);
    payload.m = O.M.NamedStartOfReferenceNode;
    payload.name = SLOT_FIELD[item.kind];
    payload.nameF = 1;

    for (var i = 0; i < wrapper.c.length; i++) {
      var c = wrapper.c[i];
      if (c.name === 'Page') { c.v = place.page; c.dirty = true; }
      else if (c.name === 'GridX') { c.v = place.x; c.dirty = true; }
      else if (c.name === 'GridY') { c.v = place.y; c.dirty = true; }
      else if (c.name === 'ItemType') { c.v = ITEM_TYPE[item.kind]; c.dirty = true; }
      else if (c.name === SLOT_FIELD[item.kind]) { wrapper.c[i] = payload; }
      else if (c.name === 'Weapon' || c.name === 'Baoshi' || c.name === 'UseItem') {
        wrapper.c[i] = { m: O.M.NamedNull, name: c.name, nameF: 1, p: wrapper };
      }
    }
    if (place.best) applyBest(payload, place.best, place.elementTpl);
    // stack size, when the item supports it
    if (place.maxStack) fillStack(payload);
    else if (place.count && place.count > 1) {
      setField(payload, 'Number', Math.min(place.count, stackMaxOf(payload)));
    }
    // keep the item's own slot bookkeeping in sync with where we put it
    setVector(payload, 'SaveSlot', place.x, place.y);
    wrapper._added = true;
    O.link([wrapper], null);
    return wrapper;
  }

  function setField(node, name, value) {
    for (var i = 0; i < node.c.length; i++)
      if (node.c[i].name === name && !node.c[i].c) { node.c[i].v = value; node.c[i].dirty = true; return true; }
    return false;
  }
  function setVector(node, name, x, y) {
    for (var i = 0; i < node.c.length; i++) {
      var c = node.c[i];
      if (c.name === name && c.c) {
        for (var j = 0; j < c.c.length; j++) {
          if (c.c[j].name === 'x' || c.c[j].name === 'X') { c.c[j].v = x; c.c[j].dirty = true; }
          if (c.c[j].name === 'y' || c.c[j].name === 'Y') { c.c[j].v = y; c.c[j].dirty = true; }
        }
        return true;
      }
    }
    return false;
  }

  // Builds a bare weapon node for a List<WeaponSaveData> (equipment slots).
  function buildBareItem(catalog, item) {
    var tpl = catalog.templates.templates[String(item.gid)];
    var n = O.fromTemplate(tpl, null);
    n.m = O.M.UnnamedStartOfReferenceNode;
    delete n.name; delete n.nameF;
    n._added = true;
    O.link([n], null);
    return n;
  }

  // ---- stacks and "best" rolls ---------------------------------------------
  function fieldOf(node, name) {
    if (!node || !node.c) return null;
    for (var i = 0; i < node.c.length; i++)
      if (node.c[i].name === name && !node.c[i].c) return node.c[i];
    return null;
  }

  // How many of this item one slot may hold, as the game itself states it.
  function stackMaxOf(payload) {
    var f = fieldOf(payload, 'MstackSize');
    return f && f.v > 0 ? f.v : 1;
  }

  // Fills a fresh item's stack to its own maximum. Equipment does not stack.
  function fillStack(payload) {
    var num = fieldOf(payload, 'Number'), max = stackMaxOf(payload);
    if (!num || max <= 1) return 0;
    num.v = max; num.dirty = true;
    return max;
  }

  // Every stack that is below its maximum in a container, as {node, value}
  // pairs so the caller can turn them into undoable edits.
  function stackTargets(arrayNode) {
    var out = [];
    for (var i = 0; i < arrayNode.c.length; i++) {
      var payload = payloadFor(arrayNode.c[i]);
      if (!payload) continue;
      var num = fieldOf(payload, 'Number'), max = stackMaxOf(payload);
      // only ever raises: a stack the game already put above its own cap is left alone
      if (num && max > 1 && num.v < max) out.push({ node: num, value: max });
    }
    return out;
  }
  function payloadFor(containerItem) {
    for (var i = 0; i < containerItem.c.length; i++)
      if (containerItem.c[i].c && containerItem.c[i].type) return containerItem.c[i];
    return null;
  }

  // Upgrades a freshly built item to the catalogue's "best" variant: the
  // strongest instance found in the source save, with every modifier roll
  // raised to the highest value that save ever produced for it.
  function applyBest(payload, best, elementTpl) {
    if (!best) return false;
    var changed = 0, k;
    if (best.mj) { if (setField(payload, 'MJ_Level', best.mj)) changed++; }
    if (best.stats) for (k in best.stats) if (setField(payload, k, best.stats[k])) changed++;
    if (best.main && setAffixArray(payload, 'Main', best.main, elementTpl)) changed++;
    if (best.dot && setAffixArray(payload, 'DOT', best.dot, elementTpl)) changed++;
    return changed > 0;
  }

  function setAffixArray(payload, group, rows, elementTpl) {
    if (!elementTpl) return false;
    var holder = null, i;
    for (i = 0; i < payload.c.length; i++)
      if (payload.c[i].name === group && payload.c[i].c) holder = payload.c[i];
    if (!holder) return false;
    var arr = null;
    for (i = 0; i < holder.c.length; i++) if (holder.c[i].m === O.M.StartOfArray) arr = holder.c[i];
    if (!arr) return false;
    arr.c = rows.map(function (r) {
      var e = O.fromTemplate(elementTpl, arr);
      setField(e, 'Index', r[0]);
      setField(e, 'EL', r[1]);
      setField(e, 'number', r[2]);
      return e;
    });
    arr.len = BigInt(arr.c.length);
    return true;
  }

  // ---- filtering -----------------------------------------------------------
  function filterItems(items, f) {
    var out = [], qy = (f.query || '').trim().toLowerCase();
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (f.kind && f.kind !== 'all' && it.kind !== f.kind) continue;
      if (f.slot && f.slot !== 'all' && it.slot !== f.slot) continue;
      if (f.quality && f.quality !== 'all' && String(it.quality) !== String(f.quality)) continue;
      if (qy) {
        var hay = (it.name + ' ' + it.gid + ' ' + (it.slot || '') + ' ' + (it.bstype || '') + ' ' + (it.useType || '') + ' ' + (it.skname || '')).toLowerCase();
        if (hay.indexOf(qy) < 0) continue;
      }
      out.push(it);
    }
    out.sort(function (a, b) {
      if (f.sort === 'quality') return (b.quality - a.quality) || a.name.localeCompare(b.name);
      if (f.sort === 'level') return (b.level - a.level) || a.name.localeCompare(b.name);
      if (f.sort === 'price') return (b.price - a.price) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });
    return out;
  }

  global.Items = {
    Catalog: Catalog, QUALITY: QUALITY, q: q, iconSvg: iconSvg, describe: describe,
    buildContainerItem: buildContainerItem, buildBareItem: buildBareItem,
    filterItems: filterItems, setField: setField, SLOT_FIELD: SLOT_FIELD, ITEM_TYPE: ITEM_TYPE,
    fieldOf: fieldOf, stackMaxOf: stackMaxOf, fillStack: fillStack, stackTargets: stackTargets,
    payloadFor: payloadFor, applyBest: applyBest
  };
})(typeof window !== 'undefined' ? window : this);
