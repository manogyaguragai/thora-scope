// Paraphrase guard (T603): flags any run of >= N consecutive words shared between app teaching text
// (string literals in src/content/*.ts, string values in src/content/*.json) and the reference texts
// (docs/BOOK_NOTES.md, plus the Wells & Coonar PDF when `pdftotext` is on PATH). Exit 1 on any hit.
// The PDF is read-only input; its text goes to a pipe only, never to disk or the build.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

export const RUN_WORDS = 8;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Lowercase, join PDF line-break hyphenation, drop apostrophes, other punctuation -> space. */
export function normalise(text) {
  return text
    .toLowerCase()
    .replace(/-\s*\n\s*/g, '')
    .replace(/['’‘`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * @param {{source: string, text: string}[]} appTexts
 * @param {{source: string, text: string}[]} refTexts
 * @returns {{source: string, ref: string, phrase: string}[]} one entry per maximal shared run
 */
export function findOverlaps(appTexts, refTexts, n = RUN_WORDS) {
  const hits = [];
  for (const ref of refTexts) {
    const words = normalise(ref.text);
    const grams = new Set();
    for (let i = 0; i + n <= words.length; i++) grams.add(words.slice(i, i + n).join(' '));
    for (const app of appTexts) {
      const w = normalise(app.text);
      let start = -1;
      for (let i = 0; i + n <= w.length + 1; i++) {
        const hit = i + n <= w.length && grams.has(w.slice(i, i + n).join(' '));
        if (hit && start < 0) start = i;
        if (!hit && start >= 0) {
          hits.push({ source: app.source, ref: ref.source, phrase: w.slice(start, i - 1 + n).join(' ') });
          start = -1;
        }
      }
    }
  }
  return hits;
}

const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

function jsonStrings(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) jsonStrings(v, out);
  return out;
}

/** Every string literal / JSON string value in src/content, one entry per string. */
export function collectAppTexts(root = ROOT) {
  const dir = join(root, 'src/content');
  const texts = [];
  for (const name of readdirSync(dir).sort()) {
    const file = `src/content/${name}`;
    const raw = readFileSync(join(dir, name), 'utf8');
    if (name.endsWith('.ts')) {
      for (const m of raw.matchAll(STRING_LITERAL))
        texts.push({ source: file, text: m[1] ?? m[2] ?? m[3] ?? '' });
    } else if (name.endsWith('.json')) {
      for (const text of jsonStrings(JSON.parse(raw), [])) texts.push({ source: file, text });
    }
  }
  return texts;
}

/** Book PDF text via `pdftotext` (stdout pipe), or null when the tool or the PDF is unavailable. */
export function bookPdfText(root = ROOT) {
  const dir = join(root, 'assets_src');
  if (!existsSync(dir)) return null;
  const pdf = readdirSync(dir).find((f) => /^Francis C\. Wells.*\.pdf$/.test(f));
  if (!pdf) return null;
  const res = spawnSync('pdftotext', ['-q', '-enc', 'UTF-8', join(dir, pdf), '-'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return res.status === 0 && res.stdout ? { source: `assets_src/${pdf}`, text: res.stdout } : null;
}

export function collectRefTexts(root = ROOT) {
  const refs = [
    { source: 'docs/BOOK_NOTES.md', text: readFileSync(join(root, 'docs/BOOK_NOTES.md'), 'utf8') },
  ];
  const pdf = bookPdfText(root);
  if (pdf) refs.push(pdf);
  return { refs, pdf: Boolean(pdf) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { refs, pdf } = collectRefTexts();
  if (!pdf)
    console.warn('check-paraphrase: book PDF text unavailable (pdftotext missing?) - BOOK_NOTES only');
  const hits = findOverlaps(collectAppTexts(), refs);
  for (const h of hits) console.log(`${h.source}  ~  ${h.ref}\n    "${h.phrase}"`);
  console.log(`check-paraphrase: ${hits.length} shared run(s) of >= ${RUN_WORDS} words`);
  process.exit(hits.length ? 1 : 0);
}
