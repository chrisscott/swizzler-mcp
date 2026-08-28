#!/usr/bin/env node
/**
 * Builds the .mcpb bundle.
 *
 * An MCPB has no install step on the user's machine, so every dependency has to ship
 * inside it. Packing node_modules would mean ~24 MB and 3,500 files, almost all of it
 * HTTP transport code this stdio server never touches, so esbuild collapses it to one
 * file instead.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const staging = join(root, "bundle");
const output = join(root, "swizzler.mcpb");
const bin = (name) => join(root, "node_modules", ".bin", name);

const step = (message) => console.log(`  ${message}`);

rmSync(staging, { recursive: true, force: true });
rmSync(output, { force: true });
mkdirSync(join(staging, "server"), { recursive: true });

step("bundling server");
execFileSync(
  bin("esbuild"),
  [
    join(root, "src/index.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--target=node20",
    `--outfile=${join(staging, "server/server.js")}`,
  ],
  { stdio: "inherit" },
);

step("staging manifest");
cpSync(join(root, "manifest.json"), join(staging, "manifest.json"));

step("packing");
execFileSync(bin("mcpb"), ["pack", staging, output], { stdio: "inherit" });

const size = statSync(output).size;
console.log(`\n${output} — ${(size / 1024 / 1024).toFixed(2)} MB`);
