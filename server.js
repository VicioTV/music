"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORTAL_PORT) || 4173;
const ROOT = __dirname;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
};

const server = http.createServer((request, response) => {
  const requestedPath = request.url === "/" ? "/index.html" : request.url;
  const decodedPath = decodeURIComponent(requestedPath.split("?")[0]);
  const absolutePath = path.resolve(ROOT, `.${decodedPath}`);

  if (!absolutePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Acceso denegado");
    return;
  }

  fs.stat(absolutePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Archivo no encontrado");
      return;
    }

    const contentType = MIME_TYPES[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    const rangeHeader = request.headers.range;
    const commonHeaders = {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
      "Accept-Ranges": "bytes",
    };

    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match) {
        response.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${stats.size}`,
        });
        response.end();
        return;
      }

      const requestedStart = match[1] === "" ? null : Number(match[1]);
      const requestedEnd = match[2] === "" ? null : Number(match[2]);
      const suffixLength = requestedStart === null ? requestedEnd : null;
      const start = suffixLength === null
        ? requestedStart
        : Math.max(0, stats.size - suffixLength);
      const end = suffixLength === null
        ? Math.min(requestedEnd ?? stats.size - 1, stats.size - 1)
        : stats.size - 1;

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stats.size) {
        response.writeHead(416, {
          ...commonHeaders,
          "Content-Range": `bytes */${stats.size}`,
        });
        response.end();
        return;
      }

      response.writeHead(206, {
        ...commonHeaders,
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
      });
      if (request.method === "HEAD") response.end();
      else fs.createReadStream(absolutePath, { start, end }).pipe(response);
      return;
    }

    response.writeHead(200, {
      ...commonHeaders,
      "Content-Length": stats.size,
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(absolutePath).pipe(response);
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    process.exit(0);
  }
  throw error;
});

server.listen(PORT, HOST);
