#!/usr/bin/env node
// Computes the code fingerprint the server must bless for a given version.
// Run after any change to the critical functions, then store the value in
// slim_settings.code_fingerprints[<version>] (admin / SQL). Versions with no
// stored fingerprint run unenforced (old canonical format) — no bricking.
//
//   node scripts/compute-fingerprint.mjs 0.2.3
import { CRITICAL_FNS } from "./lib/license.js";
import { fingerprint } from "./lib/fingerprint.js";

const version = process.argv[2] || process.env.SLIM_VERSION || "";
const fp = fingerprint(CRITICAL_FNS());
console.log(JSON.stringify({ version, fingerprint: fp }, null, 2));
