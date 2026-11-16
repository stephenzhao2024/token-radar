// token-radar-01 entry: reads the sealed snapshot, ranks every launchable protocol by what its
// token would be worth if its record stood still, and hands in the board, the page and the dossier.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// node22, standard library only, no network: every figure comes from /input/snapshot.json.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
  type Snapshot,
} from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the dossier, the rest refuse what it would. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT = { max: 4, max_bytes: 512 * 1024 };
const DASHBOARD = { max_files: 400, max_bytes: 4 * 1024 * 1024 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && index + 1 < process.argv.length) return process.argv[index + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`radar: ${message}\n`);
  process.exit(1);
}

const input = flag('input', '/input');
const file = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(file)) fail(`no snapshot at ${file}: pass --input <snapshot.json|directory>, or mount the sealed /input`);
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot: Snapshot;
try {
  snapshot = parseSnapshot(readFileSync(file, 'utf8'));
} catch (error) {
  fail(`the snapshot is not one this radar can read: ${(error as Error).message}`);
}

const { rows, radar } = buildRadar(snapshot);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's plain files, skipping dotted names, and say what went. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const page = copyDir(join(ROOT, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(ROOT, 'screenshots'), join(out, 'screenshots'));
if (page.length < 2) fail('dashboard/ is missing: it needs index.html, a stylesheet and a script');
if (shots.length < 3 || shots.length > SCREENSHOT.max) {
  fail(`screenshots/ holds ${shots.length}: hand in 3 or 4, the board, a detail view and a filtered view`);
}
for (const name of shots) if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);

// Written last: the scorer rebuilds the dossier from this /output and compares byte for byte.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT, dashboard: DASHBOARD }));

const top = rows[0]!;
process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols, ${radar.counts.launchable} launchable, ${snapshot.watchlist.length} on the watchlist, ${rows.length} rows ranked\n` +
  `radar: top of the board is ${top.name} at ${top.implied_value_usd} USD implied (TVL ${top.tvl_usd}, x${top.sector_multiple} sector, x${top.growth_multiple} growth, x${top.maturity_multiple} maturity)\n` +
  `radar: wrote board.json, data.js, dashboard (${page.length} files), screenshots (${shots.length}) and dossier.json to ${out}\n`,
);
