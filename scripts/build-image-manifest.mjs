import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const imagesDir = path.join(rootDir, "images");
const manifestPath = path.join(imagesDir, "manifest.json");
const supportedImageExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);

const entries = await readdir(imagesDir, { withFileTypes: true });
const images = entries
  .filter((entry) => entry.isFile() && supportedImageExtensions.has(path.extname(entry.name).toLowerCase()))
  .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  .map((entry, index) => ({
    src: `images/${encodeURIComponent(entry.name)}`,
    title: titleFromFilename(entry.name, index)
  }));

await writeFile(manifestPath, `${JSON.stringify({ images }, null, 2)}\n`);
console.log(`Wrote ${images.length} images to ${path.relative(rootDir, manifestPath)}`);

function titleFromFilename(filename, index = 0) {
  const basename = filename.replace(/\.[^.]+$/, "");

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)) {
    return `Panorama ${index + 1}`;
  }

  return basename
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
