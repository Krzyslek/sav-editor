# Item sprites (optional)

Drop real item sprites here as `<GlobalID>.png` and list their ids in `index.json`:

```json
{ "base": "assets/icons/", "ext": "png", "items": [40249, 50034, 60069] }
```

Ids that are listed load their image; everything else falls back to a generated
glyph based on the item's category and quality. Without `index.json` the app
never requests any image, so there are no 404s.
