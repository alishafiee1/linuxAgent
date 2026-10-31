#!/usr/bin/env node
// linuxAgent desktop bridge. Runs on your own computer with Node 18 or newer, and needs no install.
//
//   node bridge.mjs --url https://agent.roditeam.ir --folder "D:\Work" --folder "D:\Downloads"
//
// Put the device token from the panel in the CWP_BRIDGE_TOKEN environment variable.
// It only connects out; nothing on this computer is exposed. Only the folders named here are
// reachable, whatever the panel asks. Stop it with Ctrl+C and the bots lose access at once.
import { exec } from "node:child_process";
import { readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_OUTPUT = 200_000;
const RUN_TIMEOUT_MS = 5 * 60_000;

function parseArgs(argv) {
  const out = { folders: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") out.url = argv[++i];
    else if (argv[i] === "--folder") out.folders.push(argv[++i]);
  }
  return out;
}

/** Resolves links, so a shortcut inside an allowed folder cannot lead outside it. */
export async function insideFolders(path, folders) {
  const abs = resolve(path);
  let real;
  try {
    real = await realpath(abs);
  } catch {
    // a new file: its folder must exist and be inside
    real = join(await realpath(dirname(abs)), abs.slice(dirname(abs).length + 1));
  }
  const roots = await Promise.all(folders.map((f) => realpath(f)));
  const norm = (p) => (sep === "\\" ? p.toLowerCase() : p);
  if (!roots.some((r) => norm(real) === norm(r) || norm(real).startsWith(norm(r.endsWith(sep) ? r : r + sep)))) throw new Error(`Outside the allowed folders: ${abs}`);
  return real;
}

export async function execute(c, folders) {
  switch (c.kind) {
    case "list": {
      const dir = await insideFolders(c.path, folders);
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((e) => `${e.isDirectory() ? "dir " : "file"} ${e.name}`).join("\n") || "(empty)";
    }
    case "read": {
      const file = await insideFolders(c.path, folders);
      if ((await stat(file)).size > MAX_OUTPUT) throw new Error("File is too big to read here.");
      return readFile(file, "utf8");
    }
    case "write": {
      const file = await insideFolders(c.path, folders);
      await writeFile(file, c.content);
      return `Wrote ${file}`;
    }
    case "run": {
      const cwd = await insideFolders(c.cwd, folders);
      return new Promise((res) => {
        exec(c.command, { cwd, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true }, (err, stdout, stderr) => {
          res(`${stdout}${stderr}${err ? `\n(exit: ${err.code ?? err.signal ?? err.message})` : ""}`.slice(0, MAX_OUTPUT));
        });
      });
    }
    default:
      throw new Error(`Unknown command: ${c.kind}`);
  }
}

async function main() {
  const { url, folders } = parseArgs(process.argv.slice(2));
  const token = process.env.CWP_BRIDGE_TOKEN;
  if (!url || !folders.length || !token) {
    console.error("Usage: CWP_BRIDGE_TOKEN=... node bridge.mjs --url <panel> --folder <path> [--folder <path>]");
    process.exit(2);
  }
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  console.log(`Connected to ${url}. Allowed: ${folders.join(", ")}`);
  for (;;) {
    try {
      const res = await fetch(`${url}/bridge/poll`, { headers: { authorization: headers.authorization }, signal: AbortSignal.timeout(40_000) });
      if (res.status === 401) {
        console.error("The panel refused this token.");
        process.exit(1);
      }
      const { next } = await res.json();
      if (!next) continue;
      console.log(`${new Date().toISOString()} ${next.command.kind} ${next.command.path ?? next.command.command ?? ""}`);
      let body;
      try {
        body = { id: next.id, ok: true, output: await execute(next.command, folders) };
      } catch (e) {
        body = { id: next.id, ok: false, output: e.message };
      }
      await fetch(`${url}/bridge/result`, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) {
      console.error(`Connection problem: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
