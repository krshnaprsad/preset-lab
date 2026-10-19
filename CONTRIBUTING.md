# Contributing

No dependencies to install. You need Node 18 or newer.

```
npm test
```

That runs `xmp.test.js`: curves, the .xmp writer, reader and validity check, and the matching.

Layout:

- `xmp.js` has no browser code, so Node can test it. Everything that touches colour or the file format lives here.
- `app.js` is the page: pictures, the before and after view, and the download button.

The preview and the download use the same settings object and the same render code. On every download the page also reads the file text back and compares the result with the preview. Keep it that way: do not add a second path for the preview.

Ideas that fit: more colour mixer checks, undo, a Camera Raw version note. Ideas that do not fit: accounts, uploads, watermarks, paid sizes.
