// Usage: node check-md-links.mjs <repo-root> <md file>...
// Checks relative markdown links and #anchors (GitHub-style heading slugs and <a id="..."> tags),
// and balanced ``` code fences. Reports counts and any missing targets.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const [root, ...files] = process.argv.slice(2);
if (!root || files.length === 0) {
  console.error('usage: node check-md-links.mjs <repo-root> <md>...');
  process.exit(2);
}

function slugify(heading) {
  // GitHub-style: lowercase, strip punctuation except hyphen/space/underscore, spaces->hyphens
  let s = heading.trim().toLowerCase();
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/[^\p{L}\p{N}\s_-]/gu, '');
  s = s.replace(/\s+/g, '-');
  return s;
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const text = readFileSync(file, 'utf8');
  const set = new Set();
  const counts = new Map();
  for (const line of text.split('\n')) {
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      let slug = slugify(h[1]);
      const n = counts.get(slug) ?? 0;
      counts.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      set.add(slug);
    }
    for (const m of line.matchAll(/<a\s+id="([^"]+)"/g)) set.add(m[1]);
  }
  anchorCache.set(file, set);
  return set;
}

let linkCount = 0;
let anchorCount = 0;
let fenceProblems = 0;
const missing = [];

for (const f of files) {
  const abs = resolve(root, f);
  const text = readFileSync(abs, 'utf8');
  // fences
  const fences = (text.match(/^```/gm) ?? []).length;
  if (fences % 2 !== 0) {
    fenceProblems++;
    console.log(`FENCE: ${f} has odd number of \`\`\` (${fences})`);
  }
  // links: [text](target) excluding images handled same way
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [pathPart, anchor] = target.split('#');
    let targetFile = abs;
    if (pathPart) {
      linkCount++;
      targetFile = resolve(dirname(abs), decodeURIComponent(pathPart));
      if (!existsSync(targetFile)) {
        missing.push(`${f}: missing file ${target}`);
        continue;
      }
    }
    if (anchor !== undefined) {
      anchorCount++;
      if (statSync(targetFile).isDirectory()) continue;
      if (!targetFile.endsWith('.md')) continue;
      const set = anchorsOf(targetFile);
      if (!set.has(anchor) && !set.has(anchor.toLowerCase())) {
        missing.push(`${f}: missing anchor ${target}`);
      }
    }
  }
}

console.log(`files=${files.length} links=${linkCount} anchors=${anchorCount} fenceProblems=${fenceProblems} missing=${missing.length}`);
for (const m of missing) console.log('MISSING: ' + m);
process.exit(missing.length || fenceProblems ? 1 : 0);
