import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { inflectAdjective, pluralizeNoun } from './inflect.js';

describe('inflectAdjective - regular pattern', () => {
  it('inflects קטן (small), the word you asked about', () => {
    const r = inflectAdjective('קטן');
    expect(r?.forms).toEqual({
      ms: 'קטן',
      fs: 'קטנה',
      mp: 'קטנים',
      fp: 'קטנות',
    });
    expect(r?.pattern).toBe('regular');
  });

  it('reverts a final letter before attaching an ending', () => {
    // לבן ends in final nun; every inflected form needs the plain nun.
    const r = inflectAdjective('לבן');
    expect(r?.forms.fs).toBe('לבנה');
    expect(r?.forms.mp).toBe('לבנים');
    expect(r?.forms.fp).toBe('לבנות');
  });

  it('handles final mem', () => {
    const r = inflectAdjective('אדום');
    expect(r?.forms.fs).toBe('אדומה');
    expect(r?.forms.mp).toBe('אדומים');
  });

  it('handles a stem ending in a non-final letter', () => {
    const r = inflectAdjective('גדול');
    expect(r?.forms).toEqual({
      ms: 'גדול',
      fs: 'גדולה',
      mp: 'גדולים',
      fp: 'גדולות',
    });
  });

  it('strips niqqud from the input before working', () => {
    const r = inflectAdjective('קָטָן');
    expect(r?.forms.fs).toBe('קטנה');
  });
});

describe('inflectAdjective - ה pattern', () => {
  it('inflects יפה (beautiful)', () => {
    const r = inflectAdjective('יפה');
    expect(r?.forms).toEqual({
      ms: 'יפה',
      fs: 'יפה', // same spelling, different vowels
      mp: 'יפים',
      fp: 'יפות',
    });
    expect(r?.pattern).toBe('ends_he');
  });

  it('explains that ms and fs look identical', () => {
    expect(inflectAdjective('יפה')?.rule).toMatch(/spelled like the masculine/i);
  });
});

describe('inflectAdjective - nisba pattern', () => {
  it('inflects ישראלי (Israeli)', () => {
    const r = inflectAdjective('ישראלי');
    expect(r?.forms).toEqual({
      ms: 'ישראלי',
      fs: 'ישראלית',
      mp: 'ישראליים',
      fp: 'ישראליות',
    });
    expect(r?.pattern).toBe('nisba');
  });
});

describe('inflectAdjective - guards', () => {
  it('declines multi-word input', () => {
    expect(inflectAdjective('בית ספר')).toBeNull();
  });

  it('declines input that is too short to inflect', () => {
    expect(inflectAdjective('א')).toBeNull();
    expect(inflectAdjective('')).toBeNull();
  });

  it('never throws, and always returns four distinct slots when it returns', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        const r = inflectAdjective(s);
        if (r) {
          expect(Object.keys(r.forms).sort()).toEqual(['fp', 'fs', 'mp', 'ms']);
          for (const v of Object.values(r.forms)) expect(typeof v).toBe('string');
        }
      }),
    );
  });

  it('always produces plural forms longer than the singular stem', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(...'אבגדהוזחטיכלמנסעפצקרשת'), { minLength: 2, maxLength: 8 }),
        (word) => {
          const r = inflectAdjective(word);
          if (r) {
            expect(r.forms.mp.length).toBeGreaterThanOrEqual(r.forms.ms.length);
            expect(r.forms.fp.length).toBeGreaterThanOrEqual(r.forms.ms.length);
          }
        },
      ),
    );
  });
});

describe('pluralizeNoun', () => {
  it('takes ים for masculine nouns', () => {
    expect(pluralizeNoun('ילד', 'm')?.plural).toBe('ילדים');
  });

  it('swaps ה for ות in feminine nouns', () => {
    expect(pluralizeNoun('ילדה', 'f')?.plural).toBe('ילדות');
  });

  it('always asks for human review, because noun plurals are full of irregulars', () => {
    // אב -> אבות, not אבים. The rule cannot know that, so it must not pretend to.
    expect(pluralizeNoun('אב', 'm')?.needsReview).toBe(true);
    expect(pluralizeNoun('ילדה', 'f')?.needsReview).toBe(true);
  });

  it('declines multi-word input', () => {
    expect(pluralizeNoun('בית ספר', 'm')).toBeNull();
  });
});
