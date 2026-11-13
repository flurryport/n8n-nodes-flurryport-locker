'use strict';

/**
 * tsc compiles the TypeScript and nothing else. The node's icons (the two SVGs it names in
 * `icon`) and its codex file (`*.node.json`, the category and documentation links n8n reads)
 * sit beside the source and have to sit beside the compiled node too, or the published
 * package ships a node with a broken icon and no catalog entry. Copies every non-TypeScript
 * file under nodes/ and credentials/ into dist/.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const assets = /\.(svg|png|json)$/i;
let copied = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
    } else if (assets.test(entry.name)) {
      const to = path.join(root, 'dist', path.relative(root, from));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      copied += 1;
    }
  }
}

for (const dir of ['nodes', 'credentials']) {
  const full = path.join(root, dir);
  if (fs.existsSync(full)) walk(full);
}
console.log(`copy-assets: ${copied} file(s) into dist/`);
