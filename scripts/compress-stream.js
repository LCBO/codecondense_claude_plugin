#!/usr/bin/env node
// Read stdin, apply compressor by kind, write stdout. Used to wrap test/build
// commands so the model only sees compressed output.
//
// Usage: <cmd> 2>&1 | node scripts/compress-stream.js <kind>
//   kind ∈ jest | pytest | tsc | auto
// Exit code = original command exit code (preserved via PIPESTATUS in caller).

import { compressByKind, detectKind } from "./lib/bash-compress.js";

const kindArg = process.argv[2] || "auto";

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { buf += c; });
process.stdin.on("end", () => {
  const kind = kindArg === "auto" ? (detectKind(process.env.SLIM_CMD || "") || "generic") : kindArg;
  const { compressed, savedBytes } = compressByKind(kind, buf);
  const orig = Buffer.byteLength(buf);
  process.stdout.write(compressed);
  if (savedBytes > 500) {
    process.stdout.write(`\n\n[slim:${kind}] compressed ${(orig/1024).toFixed(1)}KB → ${((orig-savedBytes)/1024).toFixed(1)}KB (-${Math.round(savedBytes/orig*100)}%)\n`);
  }
});
