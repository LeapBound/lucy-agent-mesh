#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const thisDir = dirname(thisFile);
const repoRoot = resolve(thisDir, "..");
const mcpDir = resolve(repoRoot, "apps/mcp-server");
const packageJsonPath = resolve(mcpDir, "package.json");
const serverJsonPath = resolve(mcpDir, "server.json");
const distIndexPath = resolve(mcpDir, "dist/index.js");

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[OK] ${message}`);
}

function readJson(path) {
  if (!existsSync(path)) {
    fail(`missing file: ${path}`);
  }

  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    fail(`failed to parse ${path}: ${message}`);
  }
}

const pkg = readJson(packageJsonPath);
const server = readJson(serverJsonPath);

if (typeof pkg.name !== "string" || pkg.name.length === 0) {
  fail("apps/mcp-server/package.json must contain non-empty name");
}

if (typeof pkg.version !== "string" || pkg.version.length === 0) {
  fail("apps/mcp-server/package.json must contain non-empty version");
}

if (!/^\d+\.\d+\.\d+([-.][A-Za-z0-9]+)*$/.test(pkg.version)) {
  fail(`invalid package version format: ${pkg.version}`);
}

if (typeof server.name !== "string" || server.name.length === 0) {
  fail("apps/mcp-server/server.json must contain non-empty name");
}

if (
  typeof server.version_detail !== "object" ||
  server.version_detail === null ||
  typeof server.version_detail.version !== "string"
) {
  fail("apps/mcp-server/server.json must contain version_detail.version");
}

if (server.version_detail.version !== pkg.version) {
  fail(
    `version mismatch: package.json=${pkg.version}, server.json=${server.version_detail.version}`
  );
}

if (!Array.isArray(server.packages)) {
  fail("apps/mcp-server/server.json must contain packages[]");
}

const npmPackage = server.packages.find(
  (item) => item && item.registryType === "npm"
);

if (!npmPackage) {
  fail("server.json packages[] must include an npm entry");
}

if (npmPackage.identifier !== pkg.name) {
  fail(
    `package identifier mismatch: package.json name=${pkg.name}, server.json identifier=${npmPackage.identifier}`
  );
}

if (npmPackage.version !== pkg.version) {
  fail(
    `package version mismatch: package.json=${pkg.version}, server.json packages[].version=${npmPackage.version}`
  );
}

if (
  typeof npmPackage.transport !== "object" ||
  npmPackage.transport === null ||
  npmPackage.transport.type !== "stdio"
) {
  fail("server.json npm package transport.type must be stdio");
}

if (!existsSync(distIndexPath)) {
  fail(
    "missing dist/index.js. Run: ./node_modules/.bin/tsc -p apps/mcp-server/tsconfig.json"
  );
}

pass("version and metadata are consistent");
pass("dist/index.js exists");

const packResult = spawnSync("npm", ["pack", "--dry-run"], {
  cwd: mcpDir,
  encoding: "utf8",
  stdio: "pipe"
});

if (packResult.status !== 0) {
  if (packResult.stdout) {
    process.stdout.write(packResult.stdout);
  }
  if (packResult.stderr) {
    process.stderr.write(packResult.stderr);
  }
  fail("npm pack --dry-run failed");
}

const output = `${packResult.stdout}${packResult.stderr}`;
const noticeLines = output
  .split("\n")
  .filter((line) => line.trim().startsWith("npm notice"));

for (const line of noticeLines) {
  console.log(line);
}

pass("npm pack --dry-run passed");
console.log("MCP release preflight check passed.");
