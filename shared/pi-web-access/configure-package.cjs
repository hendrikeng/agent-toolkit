#!/usr/bin/env node

const fs = require("node:fs");
const lockfile = require("proper-lockfile");

const [settingsPath, source] = process.argv.slice(2);
if (!settingsPath || !source) {
  console.error("usage: configure-package.cjs <settings.json> <package-source>");
  process.exit(2);
}

let release;
for (let attempt = 1; attempt <= 10; attempt += 1) {
  try {
    release = lockfile.lockSync(settingsPath, { realpath: false });
    break;
  } catch (error) {
    if (error?.code !== "ELOCKED" || attempt === 10) throw error;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}

try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const packages = Array.isArray(settings.packages) ? settings.packages : [];
  let found = false;
  settings.packages = packages.flatMap((entry) => {
    const value = typeof entry === "string" ? entry : entry?.source;
    if (!/^npm:pi-web-access(?:@|$)/.test(value ?? "")) return [entry];
    if (found) return [];
    found = true;
    return [{ source, skills: [] }];
  });
  if (!found) settings.packages.push({ source, skills: [] });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
} finally {
  release();
}
