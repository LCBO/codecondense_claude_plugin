// Patches dist/installer/install.mjs for the public repo.
// Source already uses slim/slimmer naming; only the repo URL needs patching.
const fs = require("fs");
const f = "dist/installer/install.mjs";
let s = fs.readFileSync(f, "utf8");
s = s.replace("https://github.com/LCBO/slimmer.git", "https://github.com/LCBO/codecondense_claude_plugin.git");
// always stamp current npm version
s = s.replace(/\"version\": \"0\.1\.\d+\"/, '"version": "0.1.2"');
fs.writeFileSync(f, s);
console.log("  patched installer/install.mjs");

// patch .claude-plugin/marketplace.json to point at public repo
const mf = ".claude-plugin/marketplace.json";
if (fs.existsSync("dist/" + mf)) {
  let m = fs.readFileSync("dist/" + mf, "utf8");
  m = m.replace(/\"repo\": \"LCBO\/slimmer\"/g, '"repo": "LCBO/codecondense_claude_plugin"');
  fs.writeFileSync("dist/" + mf, m);
  console.log("  patched .claude-plugin/marketplace.json");
}

// patch root plugin.json if it references the private repo
const pf = "dist/plugin.json";
if (fs.existsSync(pf)) {
  let p = fs.readFileSync(pf, "utf8");
  const before = p;
  p = p.replace(/LCBO\/slimmer/g, "LCBO/codecondense_claude_plugin");
  if (p !== before) {
    fs.writeFileSync(pf, p);
    console.log("  patched root plugin.json");
  }
}
