#!/usr/bin/env node
// Tiny localhost HTTP server that re-renders dashboard on each request.
import http from "node:http";
import { buildDashboard } from "../scripts/lib/dashboard.js";
import { readFileSync } from "node:fs";

const PORT = +(process.env.SLIM_DASH_PORT || 24843);
const HOST = process.env.SLIM_DASH_HOST || "127.0.0.1";

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url.startsWith("/dashboard") || req.url === "/index.html") {
    try {
      const { path } = buildDashboard();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(readFileSync(path));
    } catch (e) {
      res.writeHead(500); res.end("render error: " + e.message);
    }
  } else { res.writeHead(404); res.end("not found"); }
});
server.listen(PORT, HOST, () => {
  console.log(`slim dashboard → http://${HOST}:${PORT}/`);
});
