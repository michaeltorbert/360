# 360 Sydney

A dependency-free browser viewer for equirectangular 360 images.

## Use it locally

```sh
node server.mjs
```

Open `http://localhost:4173`. The local server scans `images/`, so any `.png`, `.jpg`, `.jpeg`, `.webp`, or `.avif` file added to that folder appears in the viewer after a page load or after clicking **Refresh images**.

Selector titles come from filenames. For example, `taj-mahal-kayak-wide.png` appears as `Taj Mahal Kayak Wide`.

## Static hosting

For static hosting, regenerate the manifest after adding or removing files:

```sh
node scripts/build-image-manifest.mjs
```

The app falls back to `images/manifest.json` when the local `/api/images` endpoint is not available.
