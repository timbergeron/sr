// Nginx caches scripts and styles for 30 days. Publish new URLs with every edit.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, '..');
const file = path.join(root, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const updated = html.replace(/(src|href)="([a-z-]+(?:\.min)?\.(?:js|css))(?:\?[^"]*)?"/g, (_, attr, asset) => {
  const hash = createHash('sha256').update(fs.readFileSync(path.join(root, asset))).digest('hex').slice(0, 12);
  return `${attr}="${asset}?v=${hash}"`;
});
fs.writeFileSync(file, updated);
console.log('Updated local script and stylesheet content hashes.');
