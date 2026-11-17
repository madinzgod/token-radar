// Token launch radar: the program behind the dashboard.
//
// It reads the sealed DefiLlama snapshot (in the grader's container, /input/snapshot.json; here,
// --input <file|directory>), ranks every protocol that records no token by the accrued launch
// value model in lib/model.ts, and writes the handover the scorer and the judge read:
//
//   <output>/board.json        the ranked board, one row per protocol, farm plan included
//   <output>/radar-data.js     the dashboard's dataset, written beside dashboard/ as the page
//                              expects it, from the same rows so page and board cannot disagree
//   <output>/dashboard/        a copy of this repository's dashboard/
//   <output>/screenshots/      a copy of this repository's screenshots/
//   <output>/dossier.json      the judge's summary, written last with the vendored library,
//                              byte for byte what the scorer rebuilds from the same files
//
// The program is deterministic: it reads no clock and no randomness, so two runs over the same
// snapshot write the same bytes. Node 22, standard library only.
//
// Outside the container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** The gate's caps, as the kit's reference/gate.json states them and the scorer enforces them. */
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMITS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** One --flag's value from the command line, in `--flag value` or `--flag=value` form. */
function flagValue(flag: string, fallback: string): string {
  const prefix = `--${flag}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const at = process.argv.indexOf(`--${flag}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, data } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`);
writeFileSync(join(outputDir, 'radar-data.js'), dataScript(data));

/** Copy a directory's regular files into the output, skipping dotfiles; returns the names copied. */
function copyInto(fromDir: string, toDir: string): string[] {
  if (!existsSync(fromDir)) return [];
  mkdirSync(toDir, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = join(fromDir, name);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(toDir, name));
    names.push(name);
  }
  return names;
}

const dashboardFiles = copyInto(join(repoDir, 'dashboard'), join(outputDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no stylesheet');
if (!dashboardFiles.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no script');

const shots = copyInto(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ holds ${shots.length} images: the handover takes 3 or 4 (the board, a detail view, a filtered view)`);
}
for (const name of shots) {
  if (!PLAIN_FILE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// Written last, over the files above, exactly as the scorer rebuilds it for dossier_matches.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_LIMITS,
    dashboard: DASHBOARD_LIMITS,
  }),
);

process.stdout.write(
  `token-radar: snapshot of ${snapshot.as_of}: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist\n` +
    `token-radar: ranked ${board.length} pre-token protocols (${data.counts.set_aside} set aside, ${data.counts.live} already trading)\n` +
    `token-radar: wrote board.json (${board.length} rows), radar-data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shots.length} images), dossier.json\n`,
);
