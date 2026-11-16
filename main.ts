// token-radar-01's entrypoint: read the sealed snapshot, rank every protocol that records no token by the value
// a token would carry if its record stood still, and hand in the board, the page and the dossier.
//
//   node main.ts --input ../input/snapshot.json --output out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input /input
//
// Node 22, the standard library only, no network: every figure comes out of the snapshot that was given.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, taken from its contract: the text cap shapes the dossier, the others only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SHOTS = { max: 4, max_bytes: 512 * 1024 };
const PAGE = { max_files: 400, max_bytes: 4 * 1024 * 1024 };
/** A plain file name, as the dossier reads the screenshots and the page: no dots first, no separators. */
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function stop(reason: string): never {
  process.stderr.write(`radar: ${reason}\n`);
  process.exit(1);
}

/** One flag's value: --name value, --name=value, else the fallback. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const glued = process.argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

const input = flag('input', '/input');
const snapshotPath = input.endsWith('.json') ? input : join(input, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  stop(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>, or mount the sealed /input`);
}
const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot: Snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
} catch (problem) {
  stop(`this is not a snapshot the radar can read: ${(problem as Error).message}`);
}

const { rows, radar } = buildRadar(snapshot);
const refusal = boardIssue(rows, snapshot);
if (refusal !== null) stop(`the board it built is one the gate refuses: ${refusal}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy the plain files of one directory beside the output, sorted, skipping dotted names and subdirectories. */
function copyPlain(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const moved: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    moved.push(name);
  }
  return moved;
}

const page = copyPlain(join(HERE, 'dashboard'), join(out, 'dashboard'));
const shots = copyPlain(join(HERE, 'screenshots'), join(out, 'screenshots'));
if (page.length < 2) stop('dashboard/ is short: the page needs index.html, a stylesheet and a script');
if (shots.length < 3 || shots.length > SHOTS.max) {
  stop(`screenshots/ holds ${shots.length}: hand in three or four, the board, one brief and one filtered view`);
}
for (const name of shots) {
  if (!PLAIN.test(name)) stop(`screenshots/${name}: a name is letters, digits and . _ -, one to 128 of them`);
}

// Written last, because the scorer rebuilds it from this /output and compares the two byte for byte.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SHOTS,
  dashboard: PAGE,
}));

const best = rows[0]!;
const used = radar.tests.find((t) => t.name === radar.variant);
process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols in the snapshot, ${radar.counts.launchable} record no token, `
  + `${snapshot.watchlist.length} on the watchlist, ${rows.length} ranked\n`
  + `radar: model ${radar.variant}, fit ${radar.fit.a} x TVL^${radar.fit.b} (r2 ${radar.fit.r2}), blind miss x${used?.miss}\n`
  + `radar: rank 1 is ${best.name} at ${best.implied_value_usd} USD implied (P10 to P90 ${best.low_usd} to ${best.high_usd}), `
  + `netting ${best.econ.net_usd} on a ${radar.model.ticket_usd} ticket\n`
  + `radar: on that ticket ${radar.counts.farm} farm, ${radar.counts.thin} thin, ${radar.counts.skip} skip; `
  + `best ${radar.counts.best_name} at ${radar.counts.best_per_hour} USD an hour\n`
  + `radar: wrote board.json, data.js, dashboard (${page.length} files), screenshots (${shots.length}) and dossier.json to ${out}\n`,
);
