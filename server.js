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

  fs.readFile(absolutePath, (error, file) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Archivo no encontrado");
      return;
    }

    const contentType = MIME_TYPES[path.extname(absolutePath).toLowerCase()] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    });
    response.end(file);
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    process.exit(0);
  }
  throw error;
});

server.listen(PORT, HOST);
