import { beforeAll, describe, expect, test } from 'vitest';

interface Text {
  source: string;
  text: string;
}
interface Hit {
  source: string;
  ref: string;
  phrase: string;
}
interface Guard {
  findOverlaps(app: Text[], refs: Text[], n?: number): Hit[];
  normalise(text: string): string[];
  collectAppTexts(): Text[];
  collectRefTexts(): { refs: Text[]; pdf: boolean };
}

// Variable specifier: the guard is plain .mjs (no .d.ts); typed via the Guard interface above.
const GUARD_PATH = '../../scripts/check-paraphrase.mjs';

// Overlaps with docs/BOOK_NOTES.md (own paraphrase, not book text) present when T603 landed.
// Content owners reword these; delete each entry once it no longer hits. New hits fail the test.
const KNOWN_NOTES_HITS: string[] = [];

let guard: Guard;
let refs: Text[] = [];
let hasPdf = false;

beforeAll(async () => {
  guard = (await import(GUARD_PATH)) as Guard;
  ({ refs, pdf: hasPdf } = guard.collectRefTexts());
}, 30_000);

describe('paraphrase guard', () => {
  const ref: Text[] = [
    { source: 'ref', text: 'The middle lobe vein drains into the superior pulmonary vein, usually.' },
  ];

  test('planted 8-word overlap is detected despite case and punctuation', () => {
    const app = [
      { source: 'app', text: 'Note: the MIDDLE lobe vein drains into the superior pulmonary-vein!' },
    ];
    const hits = guard.findOverlaps(app, ref);
    expect(hits).toEqual([
      { source: 'app', ref: 'ref', phrase: 'the middle lobe vein drains into the superior pulmonary vein' },
    ]);
  });

  test('a 7-word shared run passes', () => {
    const app = [{ source: 'app', text: 'Here the middle lobe vein drains into the lower trunk.' }];
    expect(guard.findOverlaps(app, ref)).toEqual([]);
  });

  test('real app content has no new overlaps with the references', () => {
    const hits = guard.findOverlaps(guard.collectAppTexts(), refs);
    const fresh = hits.filter((h) => h.ref !== 'docs/BOOK_NOTES.md' || !KNOWN_NOTES_HITS.includes(h.phrase));
    expect(fresh).toEqual([]);
  });

  test('book PDF text is searchable when pdftotext is available', (ctx) => {
    if (!hasPdf) ctx.skip();
    const pdf = refs.find((r) => r.source.endsWith('.pdf'));
    const words = guard.normalise(pdf?.text ?? '');
    const mid = Math.floor(words.length / 2);
    const planted = [{ source: 'app', text: words.slice(mid, mid + 8).join(' ') }];
    expect(guard.findOverlaps(planted, pdf ? [pdf] : []).length).toBe(1);
  });
});
