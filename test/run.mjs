// Runs every JavaScript builder on its input.json, checks the result matches
// output.jsonld exactly, and checks output.jsonld with the SchemaCDN
// validator (no errors allowed).
//   node test/run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../validator/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dirs = ['frameworks', 'page-types'].flatMap((g) =>
  fs.readdirSync(path.join(ROOT, g)).sort().map((d) => path.join(ROOT, g, d))
);
const homepage = read(path.join(ROOT, 'page-types', 'homepage', 'output.jsonld'));
const homeNodes = homepage['@graph'].map((n) => ({ '@context': 'https://schema.org', ...n }));

let failed = 0;
for (const dir of dirs) {
  const name = path.relative(ROOT, dir);
  const meta = read(path.join(dir, 'meta.json'));
  const input = read(path.join(dir, 'input.json'));
  const expected = read(path.join(dir, 'output.jsonld'));
  const problems = [];

  const build = require(path.join(dir, meta.js.file))[meta.js.fn];
  const actual = build(structuredClone(input));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push('JavaScript output differs from output.jsonld');

  // Validate the output and the nested parts that are rich results of their
  // own; page types resolve @id links against the homepage graph.
  const siblings = meta.linksTo === 'homepage' ? homeNodes : [];
  const nodes = Array.isArray(expected['@graph']) ? expected['@graph'] : [expected];
  const nested = nodes.flatMap((n) => [...[].concat(n.hasVariant || []), n.hasMerchantReturnPolicy, n.hasShippingService, n.hasMemberProgram, n.video].filter((x) => x && typeof x === 'object' && !Array.isArray(x)));
  const all = [...siblings, ...nodes.map((n) => ({ '@context': 'https://schema.org', ...n }))];
  const runs = [validateSchema(expected, { siblings }), ...nested.map((x) => validateSchema({ '@context': 'https://schema.org', ...x }, { siblings: all }))];
  for (const r of runs) for (const e of r.errors) problems.push(`validator: ${e.message}`);

  if (problems.length) {
    failed += 1;
    console.log(`FAIL ${name}\n  ${problems.join('\n  ')}`);
  } else console.log(`ok   ${name}`);
}
console.log(`\n${dirs.length - failed} of ${dirs.length} passed`);
process.exitCode = failed ? 1 : 0;
