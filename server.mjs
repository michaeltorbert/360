import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const imagesDir = path.join(rootDir, "images");
const port = Number.parseInt(process.env.PORT || "4173", 10);
const supportedImageExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);

const mimeTypes = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"]
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/images") {
      await serveImageList(response);
      return;
    }

    await serveStaticFile(url.pathname, response);
  } catch (error) {
    console.error(error);
    writeText(response, 500, "Internal server error");
  }
});

server.listen(port, () => {
  console.log(`360 viewer running at http://localhost:${port}`);
});

async function serveImageList(response) {
  const images = await readImagesFolder();
  writeJson(response, 200, { images });
}

async function readImagesFolder() {
  const entries = await readdir(imagesDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && supportedImageExtensions.has(path.extname(entry.name).toLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
    .map((entry, index) => ({
      src: `images/${encodeURIComponent(entry.name)}`,
      title: titleFromFilename(entry.name, index)
    }));
}

async function serveStaticFile(urlPath, response) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    writeText(response, 400, "Bad request");
    return;
  }

  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(rootDir, `.${normalizedPath}`);

  if (!isInsideRoot(filePath)) {
    writeText(response, 403, "Forbidden");
    return;
  }

  let fileStat;

  try {
    fileStat = await stat(filePath);
  } catch {
    writeText(response, 404, "Not found");
    return;
  }

  if (!fileStat.isFile()) {
    writeText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Length": fileStat.size,
    "Content-Type": mimeTypes.get(extension) || "application/octet-stream"
  });

  createReadStream(filePath).pipe(response);
}

function isInsideRoot(filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function writeText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  response.end(body);
}

function titleFromFilename(filename, index = 0) {
  const basename = filename.replace(/\.[^.]+$/, "");

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(basename)) {
    return `Panorama ${index + 1}`;
  }

  return basename
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
