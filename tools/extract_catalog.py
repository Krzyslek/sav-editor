"""
Rebuild the item catalogue used by the web editor from a real save file.

    python tools/extract_catalog.py path/to/slot_1.sav

Writes:
    data/shadow-dungeon-items.json      light index (names, stats) - loaded eagerly
    data/shadow-dungeon-templates.json  full node templates        - loaded on demand

Every catalogue entry is a real, game-produced item structure taken from the
save, so inserting one back into a save yields data the game already accepts.
"""
import sys, os, json
from odin_format import load

LONGS = {27, 28, 29, 30}
RAWH = {35, 36, 13, 14, 41, 42, 37, 38}
STRS = {39, 40, 50, 51}
NODES = {1, 2, 3, 4}

WEAPON = 'Data.SaveData.WeaponSaveData'
BAOSHI = 'Data.SaveData.BaoshiSaveData'
USEITEM = 'Data.SaveData.UseItemSaveData'
CONTAINER = 'Data.SaveData.ContainerItemSaveData'

CHAR_NAMES = {0: 'Archer', 1: 'Arrow slot', 2: 'Head', 3: 'Body', 4: 'Hand',
              5: 'Leg', 6: 'Ring', 7: 'Amulet', 8: 'Trinket', 9: 'Charm'}
SLOT_LABEL = {'hand': 'Gloves', 'leg': 'Boots', 'body': 'Armor', 'head': 'Helmet',
              'little': 'Accessory', 'bow': 'Bow', 'arrow': 'Arrow'}


def nm(n):
    return n.get('n', {}).get('v')


def kids(n):
    return n.get('c', [])


def tname(n):
    t = n.get('t')
    return None if not t or t['k'] == 'null' else t['s']['v']


def sval(n):
    v = n.get('v')
    return v['v'] if isinstance(v, dict) else v


def to_tpl(n):
    """Portable JSON node form: {m, n?, nf?, t?, v?, c?} - mirrors odin.js fromTemplate."""
    o = {'m': n['m']}
    if 'n' in n:
        o['n'] = n['n']['v']
        if n['n']['f'] != 1:
            o['nf'] = n['n']['f']
    if n['m'] in NODES:
        o['t'] = tname(n)
    if 'c' in n:
        o['c'] = [to_tpl(c) for c in kids(n) if c['m'] not in (5, 7)]
    elif n['m'] == 8:
        o.update(cnt=n['cnt'], esz=n['esz'], raw=n['raw'].hex())
    elif n['m'] in LONGS:
        o['v'] = str(n['v'])
    elif n['m'] in RAWH:
        o['v'] = n['v'].hex()
    elif n['m'] in STRS:
        o['v'] = n['v']['v']
        if n['v']['f'] != 1:
            o['vf'] = n['v']['f']
    elif n['m'] in (43, 44):
        o['v'] = bool(n['v'])
    elif n['m'] in (45, 46, 5, 7, 49):
        pass
    else:
        o['v'] = n.get('v')
    return o


def flat(n):
    """Scalar fields of a node, by name."""
    return {nm(c): sval(c) for c in kids(n) if c['m'] not in (5, 7) and 'c' not in c}


def findall(nodes, want, out=None):
    out = [] if out is None else out
    for n in nodes:
        if 'c' in n:
            t = tname(n)
            if t and t.split(',')[0] == want:
                out.append(n)
            findall(kids(n), want, out)
    return out


def vec(node, name):
    """An IntVector2 child as (x, y)."""
    for c in kids(node):
        if nm(c) == name and 'c' in c:
            f = flat(c)
            return [f.get('x') or f.get('X') or 0, f.get('y') or f.get('Y') or 0]
    return [1, 1]


def affix_rows(node, group):
    """[[Index, EL, number], ...] of one modifier array."""
    for c in kids(node):
        if nm(c) == group and 'c' in c:
            for a in kids(c):
                if a['m'] == 6:
                    rows = []
                    for el in kids(a):
                        if 'c' in el:
                            f = flat(el)
                            rows.append([f.get('Index') or 0, f.get('EL') or 0,
                                         round(f.get('number') or 0, 4)])
                    return rows
    return []


STAT_KEYS = ('Damage', 'Health', 'Mana', 'Fire', 'Frozen', 'Thunder', 'Poison', 'Physics', 'Shadow')


def score(node):
    """How strong one weapon instance is - used to pick the best of a kind."""
    f = flat(node)
    total = sum(f.get(k) or 0 for k in STAT_KEYS)
    total += sum(r[2] for r in affix_rows(node, 'Main'))
    return total


def element_template(root):
    """A single WPDT_A modifier node, so the app can rebuild Main/DOT arrays."""
    for n in findall(root, WEAPON):
        for c in kids(n):
            if nm(c) in ('Main', 'DOT') and 'c' in c:
                for a in kids(c):
                    if a['m'] == 6:
                        for el in kids(a):
                            if 'c' in el:
                                t = to_tpl(el)
                                t.pop('n', None)
                                t['m'] = 2
                                return t
    return None


def affixes(node):
    """Rolled Main/DOT modifier entries of a weapon."""
    res = []
    for c in kids(node):
        if nm(c) in ('Main', 'DOT') and 'c' in c:
            for arr in kids(c):
                if arr['m'] == 6:
                    for el in kids(arr):
                        if 'c' in el:
                            f = flat(el)
                            res.append({'g': nm(c), 'i': f.get('Index'), 'el': f.get('EL'),
                                        'n': round(f.get('number') or 0, 2)})
    return res


def build(root):
    cat = {}
    best_node = {}
    affix_max = {}
    slot_mj_max = {}

    def note_affixes(node):
        for group in ('Main', 'DOT'):
            for idx, el, num in affix_rows(node, group):
                key = '%s:%s' % (group, idx)
                if num > affix_max.get(key, 0):
                    affix_max[key] = round(num, 4)

    def add(node, kind):
        f = flat(node)
        gid = f.get('GlobalID')
        if gid is None:
            return
        key = str(gid)
        if key in cat:
            cat[key]['count'] += 1
            if kind == 'weapon':
                cat[key]['statsMax'] = {k: max(cat[key]['statsMax'].get(k, 0), f.get(k) or 0)
                                        for k in STAT_KEYS}
                cat[key]['mjMax'] = max(cat[key]['mjMax'], f.get('MJ_Level') or 0)
                if score(node) > score(best_node[key]):
                    best_node[key] = node
            return
        e = {'gid': gid, 'name': f.get('ItemName') or ('#%s' % gid), 'kind': kind, 'count': 1,
             'quality': f.get('Quality'), 'level': f.get('Level'), 'price': f.get('Price'),
             'itemType': f.get('ItemType')}
        if kind == 'weapon':
            e.update(slot=f.get('WeaponType'), slotLabel=SLOT_LABEL.get(f.get('WeaponType'), f.get('WeaponType')),
                     charType=f.get('CharType'), mj=f.get('MJ_Level'), setIndex=f.get('Set_Index'),
                     stats={k: f[k] for k in STAT_KEYS if f.get(k)},
                     statsMax={k: f.get(k) or 0 for k in STAT_KEYS},
                     mjMax=f.get('MJ_Level') or 0,
                     affixes=affixes(node))
            best_node[key] = node
        elif kind == 'gem':
            e.update(bstype=f.get('BStype'), bsQuality=f.get('BS_Quality'), stackMax=f.get('MstackSize'),
                     skname=f.get('SKname'), el=f.get('EL'), index=f.get('Index'), number=f.get('Number'))
        else:
            e.update(useType=f.get('UseType'), infoType=f.get('InfoType'), number=f.get('Number'),
                     cd=f.get('CDTime'), duration=f.get('Duration'), stackMax=f.get('MstackSize'))
        e['size'] = vec(node, 'Size')
        e['stackMax'] = f.get('MstackSize') or 1
        e['tpl'] = to_tpl(node)
        cat[key] = e

    for n in findall(root, WEAPON):
        note_affixes(n)
        f = flat(n)
        slot = f.get('WeaponType')
        slot_mj_max[slot] = max(slot_mj_max.get(slot, 0), f.get('MJ_Level') or 0)
        add(n, 'weapon')
    for n in findall(root, BAOSHI):
        add(n, 'gem')
    for n in findall(root, USEITEM):
        add(n, 'use')

    # "Best" variant: the strongest instance of that item found in the save, with
    # every roll raised to the highest value the game produced for that modifier.
    for key, entry in cat.items():
        if entry['kind'] != 'weapon':
            continue
        node = best_node[key]
        # forge level: the highest this slot is ever seen at, not just this item
        best = {'mj': max(entry.pop('mjMax', 0), slot_mj_max.get(entry.get('slot'), 0)),
                'stats': {k: round(v, 4) for k, v in entry.pop('statsMax', {}).items() if v}}
        for group, field in (('Main', 'main'), ('DOT', 'dot')):
            rows = []
            for idx, el, num in affix_rows(node, group):
                rows.append([idx, el, max(num, affix_max.get('%s:%s' % (group, idx), 0))])
            if rows:
                best[field] = rows
        entry['best'] = best

    # the ContainerItemSaveData shell an item is placed in (payload slots blanked)
    shell = to_tpl(findall(root, CONTAINER)[0])
    for c in shell['c']:
        if c.get('n') in ('Weapon', 'Baoshi', 'UseItem'):
            c.pop('c', None)
            c.pop('t', None)
            c['m'] = 45
    return sorted(cat.values(), key=lambda e: (e['kind'], e['gid'])), shell, element_template(root)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    root, types, _ = load(sys.argv[1])
    items, shell, elem = build(root)

    version = ''
    for n in root[0].get('c', []):
        if nm(n) == 'GameVersion':
            version = sval(n)

    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, '..', 'data')
    os.makedirs(out_dir, exist_ok=True)

    templates = {str(i['gid']): i.pop('tpl') for i in items}
    index = {'game': 'Shadow Dungeon', 'gameVersion': version, 'source': 'extracted from a save file',
             'charTypes': CHAR_NAMES, 'slotLabels': SLOT_LABEL, 'items': items}

    for name, payload in (('shadow-dungeon-items.json', index),
                          ('shadow-dungeon-templates.json',
                           {'wrapper': shell, 'element': elem, 'templates': templates})):
        path = os.path.join(out_dir, name)
        with open(path, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
        print('%-34s %8.1f KB' % (name, os.path.getsize(path) / 1024))

    kinds = {}
    for i in items:
        kinds[i['kind']] = kinds.get(i['kind'], 0) + 1
    print('%d unique items %s from game version %s' % (len(items), kinds, version or '?'))


if __name__ == '__main__':
    main()
