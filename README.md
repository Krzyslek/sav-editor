# Shadow Dungeon `.sav` editor

A browser-based viewer and editor for Unity save files written with
[OdinSerializer](https://github.com/TeamSirenix/odin-serializer)'s **binary** format —
built around Shadow Dungeon's `slot_*.sav`, but it will open any save in that format.

Everything runs client-side. No upload, no server, no build step.

Release notes live in [CHANGELOG.md](CHANGELOG.md).

**Live version:** https://krzyslek.github.io/sav-editor/

---

## What it does

| | |
|---|---|
| **Read** | Parses the save into its real node tree — every entry keeps its original C# type (`Data.SaveData.WeaponSaveData`, `List<ContainerItemSaveData>`, …). |
| **Browse** | Virtualised tree: only visible rows are rendered, so a 3 MB / 140 000-entry save scrolls smoothly. Lists longer than 200 elements are paginated in place. |
| **Search** | Substring or regex, across names, values and C# types, with a clickable result list that jumps to the node — plus a *filter tree* mode that collapses the tree down to matches and their parents. |
| **Edit** | Click any value to change it. Numeric ranges are enforced per entry type (`Byte`, `Int16`, `UInt32`, `Int64`, …), 64-bit values are handled as `BigInt` so tick counts stay exact. Full undo/redo. |
| **Restructure** | Add a field to any node, clone the last element of a list, duplicate, reorder or delete any subtree. Array lengths and reference ids are recalculated automatically. |
| **Insert items** | A catalogue of 442 real Shadow Dungeon items — searchable, filterable by kind / slot / quality, with an icon per item and a hover tooltip showing its stats. One click drops a complete, game-valid item into the inventory or chest at the first free grid cell. |
| **Bulk edits** | A *Cheats* tab: fill every stack in a container, hand yourself one of every item in the game, the same again at the best rolls that exist in the save, and raise talent points / experience / money. Each button is one undo step. |
| **Download** | Re-encodes the tree and saves it under the original filename. |

### Correctness

Re-encoding an **untouched** save reproduces the original file **byte for byte** —
the 3.2 MB reference save included in development matched exactly, all 3 217 092 bytes.
That means an edited file differs from the original only where you edited it.

The **Verify** button re-encodes the current tree and reports the delta before you download,
and `tests.html` runs 23 assertions in the browser (round-trip, value edits, 64-bit
precision, insertion, deletion, reference-id uniqueness, grid packing without overlaps,
bulk insertion of the whole catalogue, best-roll application, and re-parse of edited output).

---

## Using it

1. Open the site (or `index.html` — it works straight from disk too).
2. Drop a `.sav` file on the page, or press **Open .sav**.
3. Edit, then press **Download .sav**.
4. Copy the file back over your save — **after backing the original up.**

Save location on Windows is typically:

```
%USERPROFILE%\AppData\LocalLow\<Company>\<Game>\
```

> Keep a backup. An edited save is not guaranteed to be accepted by every game build,
> and values outside the ranges the game expects can break a profile.

### Shortcuts

`Ctrl+F` search · `Ctrl+Z` undo · `Ctrl+Y` redo · `Ctrl+S` download

---

## The file format

Odin's binary stream is a flat sequence of entries, each starting with a one-byte marker:

```
02                                  UnnamedStartOfReferenceNode
  2f 00000000 01 27000000 "Data.SaveData.SaveData, Assembly-CSharp"
                                    TypeName: id 0 + UTF-16 type name
  00000000                          node id
  27 01 0b000000 "GameVersion" 01 05000000 "1.0.8"
                                    NamedString
  ...
05                                  EndOfNode
```

* Strings are length-prefixed (character count) with a leading flag: `0` = ASCII, `1` = UTF-16LE.
* Types are interned: the first use writes `TypeName` + a fresh id, later uses write `TypeID`.
* Reference nodes carry an id, and `NamedInternalReference` entries point back at them.
* Arrays are `StartOfArray` + an `int64` length, terminated by `EndOfArray`.

The writer here rebuilds the type table and renumbers reference ids in document order —
which is exactly how Odin assigns them — so untouched data round-trips identically and
inserted or duplicated subtrees stay consistent.

Implementation: [`js/odin.js`](js/odin.js) (reader/writer), with a matching Python
implementation in [`tools/odin_format.py`](tools/odin_format.py).

---

## Item catalogue

`data/shadow-dungeon-items.json` (index) and `data/shadow-dungeon-templates.json`
(full node templates) are generated **from a save file**, so every catalogue entry is a
structure the game itself produced:

```bash
python tools/extract_catalog.py path/to/slot_1.sav
```

442 items from game version 1.0.8: 309 pieces of equipment, 72 gems/runes, 61 consumables.
The catalogue contains item definitions only — no player name, session or transaction ids.

### What "best rolls" means

Equipment in this game is rolled per drop, so the same item exists in many strengths.
The catalogue therefore records, for every item id:

* the **strongest instance** found in the source save (highest stats plus modifier total),
* each of its modifier rolls raised to the **highest value that modifier ever reaches** in that save,
* the **forge level** raised to the highest that equipment slot is ever seen at (42).

Nothing is invented: every number written into a save is one the game itself produced,
just recombined into the best version of that item. Consumables and gems have no rolls —
for them "best" is simply a full stack.

Bulk insertion packs items by their real grid footprint (`Size`, e.g. 2x4 for most weapons),
so nothing ever lands on top of anything else, and `PageCount` grows if new pages are used.

### Real sprites

Icons are generated from each item's category and quality. To use the game's own sprites,
extract them (e.g. with [AssetStudio](https://github.com/Perfare/AssetStudio)) into
`assets/icons/` and add a manifest:

```json
{ "base": "assets/icons/", "ext": "png", "items": [40249, 50034, 60069] }
```

Save it as `assets/icons/index.json`; listed ids then load their image instead of a generated glyph.

---

## Project layout

```
index.html                 the app
tests.html                 in-browser test suite
CHANGELOG.md               release notes
css/app.css
js/odin.js                 OdinSerializer binary reader / writer
js/model.js                tree navigation, search, undoable edits
js/tree.js                 virtualised tree view
js/items.js                catalogue, icons, item construction
js/app.js                  wiring
data/                      generated item catalogue
tools/odin_format.py       the same format in Python (+ round-trip check)
tools/extract_catalog.py   regenerates the catalogue from a save
```

No dependencies, no bundler — the files are served as they are.

Static hosts cache assets (GitHub Pages sends `max-age=600`), so the script tags in
`index.html` and the catalogue fetches in `js/items.js` carry a `?v=` stamp. Bump it in both
places when releasing, otherwise a returning visitor can load a new page against stale scripts.

### Running locally

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`. Opening `index.html` directly works too, except that
the item catalogue needs `fetch`, which browsers block for `file://`.

### Tests

Put a save at `.local/sample.sav` (git-ignored) and open `tests.html`.

---

## Publishing to GitHub Pages

The repository is served straight from the branch — no build step, no Actions workflow:

```bash
git push origin main
```

Then in **Settings → Pages**, set *Source* to `Deploy from a branch`, branch `main`,
folder `/ (root)`. The site is live at <https://krzyslek.github.io/sav-editor/> a minute or two later.

---

## License

GPL-3.0 — see [LICENSE](LICENSE). Shadow Dungeon and its item data are property of their respective owners;
this project is an unofficial, fan-made save editor.
