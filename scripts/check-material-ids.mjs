// Material id uniqueness check — a build guard.
//
// Every material registers itself with a numeric `id` (materials/registry.ts),
// and that id is the array index every material resolves to on the sim/render
// hot path. Two materials claiming the same id is a silent data-corruption bug:
// the later import clobbers the earlier one, so one material vanishes from the
// palette while its `.id` resolves to the wrong material everywhere else.
//
// registry.ts already throws at *runtime* when this happens, but that only
// fires once the module graph is actually loaded in a browser. This script is
// the *build-time* guard: it statically scans every material file, so a
// duplicate id fails the Cloudflare Workers build (see package.json `build`)
// instead of shipping and blowing up in a player's tab.
//
// Usage:
//   node scripts/check-material-ids.mjs
// Exits 0 when all ids are unique, 1 (with a report) when any id collides.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MATERIALS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'game',
  'materials',
);

// Every material is created by a `register({ ... })` call. Rather than try to
// brace-match the (sometimes nested) object literal, we anchor on each
// `register(` and read the *first* `id:` / `name:` that follows it — a register
// object has exactly one of each, so the first match is the material's own.
const REGISTER_RE = /register\(\s*\{/g;
const ID_RE = /\bid:\s*(\d+)/;
const NAME_RE = /\bname:\s*['"`]([^'"`]+)['"`]/;

/** @returns {{id:number, name:string, file:string, line:number}[]} */
function collectMaterials() {
  const entries = [];
  const files = readdirSync(MATERIALS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort();

  for (const file of files) {
    const path = join(MATERIALS_DIR, file);
    const src = readFileSync(path, 'utf8');

    let m;
    while ((m = REGISTER_RE.exec(src)) !== null) {
      // Look only at the slice starting at this register( call so the first
      // id:/name: we find belongs to it, not to a later material in the file.
      const rest = src.slice(m.index);
      const idMatch = ID_RE.exec(rest);
      if (!idMatch) continue; // register() without a literal id — skip.
      const nameMatch = NAME_RE.exec(rest);
      const line = src.slice(0, m.index).split('\n').length;
      entries.push({
        id: Number(idMatch[1]),
        name: nameMatch ? nameMatch[1] : '(unknown)',
        file,
        line,
      });
    }
  }
  return entries;
}

function main() {
  const materials = collectMaterials();

  const byId = new Map();
  for (const entry of materials) {
    if (!byId.has(entry.id)) byId.set(entry.id, []);
    byId.get(entry.id).push(entry);
  }

  const duplicates = [...byId.entries()]
    .filter(([, list]) => list.length > 1)
    .sort((a, b) => a[0] - b[0]);

  if (duplicates.length > 0) {
    console.error('✗ Duplicate material id(s) found:\n');
    for (const [id, list] of duplicates) {
      console.error(`  id ${id} is claimed by ${list.length} materials:`);
      for (const e of list) {
        console.error(`    - ${e.name}  (${e.file}:${e.line})`);
      }
      console.error('');
    }
    console.error(
      `Material ids must be unique. Fix the collisions above and re-run.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ ${materials.length} materials, all ids unique.`,
  );
}

main();
