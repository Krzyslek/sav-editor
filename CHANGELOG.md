# Changelog

All notable changes to this project are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [semantic versioning](https://semver.org/).

---

## [1.1.0] — 2026-09-02

Bulk editing. Everything that previously took one click per item now has a button,
and each of those buttons is a **single undo step**.

### Added

**Cheats tab**

* **Max out every stack here** — fills every stack in the chosen container to the cap
  the item itself declares (`MstackSize`). It only ever *raises* a stack: items the game
  had already pushed above their own cap (17 of them in the reference save) are left
  untouched, so the button can never take anything away.
* **Give every item, max stacks** — inserts one of each of the 442 catalogue items,
  stacks filled.
* **Give every item at best rolls, max stacks** — the same, with equipment upgraded to
  its best form (see below).
* **Progression panel** — raises talent points (`TalentData.P_Base`), money, experience
  (`Xp_Total`) and depth experience (`DFXp_Total`), with character level and depth level
  offered but unchecked by default. Each row shows the value detected in the save next to
  an editable target, and every row has its own checkbox. `P_Used` is deliberately left
  alone, so spent points stay spent.

**Item catalogue**

* **max stack toggle** — a single item inserted from the *Items* tab now arrives as a full
  stack by default; untick it to use the quantity box instead. Equipment does not stack and
  is always inserted as one.
* Each catalogue entry now carries its grid footprint (`size`), its stack cap (`stackMax`)
  and, for equipment, a compact `best` patch.

**Best rolls**

Equipment is rolled per drop, so the same item exists in many strengths — in the reference
save 172 of 309 equipment ids appear more than once, with up to a twofold spread. The
catalogue therefore records, per item id:

* the **strongest instance** present in the source save (highest stats plus modifier total),
* every modifier roll raised to the **highest value that modifier reaches anywhere** in that
  save (`Main` index 10, for example, spans 8.53 – 110.30, so 110.30 is used),
* the **forge level** raised to the highest that equipment slot ever reaches (42).

No value is invented. Every number written into a save is one the game itself produced,
recombined into the best version of that item. Gems and consumables have no rolls; for them
"best" is simply a full stack.

### Changed

* **Insertion is footprint-aware.** Placement used to look for a free 1×1 cell, but most
  weapons occupy 2×4. `Model.Packer` now marks every cell an item's `Size` covers and scans
  pages for a rectangle that actually fits, so bulk grants never overlap. Grid dimensions are
  inferred from what the save already contains (15×15 for the inventory, 14×9 for the chest)
  and can be corrected in the UI.
* `PageCount` grows automatically when a bulk grant spills onto new pages.
* Both container pickers default to the inventory rather than the first list found.
* `Model.Edits` gained `batch()` and `insertMany()`, so a bulk edit is one entry on the
  undo stack instead of hundreds.

### Tests

`tests.html` now runs **41 assertions** (up from 23). New coverage:

* proposed stacks never exceed the cap the item states, and filling adds no over-cap items;
* the whole catalogue packs into the inventory with **0 overlaps across 5 505 occupied cells**;
* the resulting 4.40 MB save re-parses with no warnings and keeps its item count;
* the best variant raises forge level and modifier totals over the plain instance
  (112 → 244 on the sampled weapon) and serialises cleanly;
* progression fields are present and readable.

---

## [1.0.0] — 2026-09-02

First release: a dependency-free, fully client-side editor for Unity
[OdinSerializer](https://github.com/TeamSirenix/odin-serializer) binary saves,
built around Shadow Dungeon's `slot_*.sav`.

### Added

* **Format support** — reader and writer for Odin's binary stream: one-byte entry markers,
  interned type table (`TypeName` on first use, `TypeID` afterwards), reference ids renumbered
  in document order with internal references remapped, length-prefixed UTF-16LE strings,
  `int64` array lengths, and 64-bit values carried as `BigInt` so tick counts stay exact.
  Re-encoding an untouched save reproduces the original **byte for byte** — all 3 217 092 bytes
  of the 3.2 MB reference save.
* **Virtualised tree** — only visible rows are rendered; a 141 838-entry save parses in ~70 ms
  and scrolls smoothly. Lists longer than 200 elements are paginated in place.
* **Search** — substring or regex over names, values and C# types, with a clickable result list
  and a *filter tree* mode that reduces the tree to matches and their parents.
* **Editing** — inline value editing with per-type range checks, undo/redo, adding fields,
  cloning list elements, duplicating, reordering and deleting subtrees; array lengths and
  reference ids are recalculated on write.
* **Item catalogue** — 442 items extracted from a real save (309 equipment, 72 gems/runes,
  61 consumables), searchable and filterable, with generated icons and hover tooltips.
* **Verify** — re-encodes the current tree and reports the byte delta before download.
* **Tools** — `tools/odin_format.py` (the same format in Python, plus a round-trip check) and
  `tools/extract_catalog.py` (regenerates the catalogue from any save).
* **Tests** — `tests.html`, 23 in-browser assertions.
