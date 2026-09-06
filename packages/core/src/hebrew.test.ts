import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  hasHebrew,
  hasNiqqud,
  stripNiqqud,
  unfinalize,
  finalize,
  applyFinalForm,
  normalizeForCompare,
  answersMatch,
  transliterate,
  deriveGenderNumber,
  suggestRoot,
} from './hebrew.js';

describe('stripNiqqud', () => {
  it('removes vowel points but keeps letters', () => {
    expect(stripNiqqud('שָׁלוֹם')).toBe('שלום');
    expect(stripNiqqud('קָטָן')).toBe('קטן');
    expect(stripNiqqud('אָדֹם')).toBe('אדם'); // holam haser, no vav mater
  });

  it('is a no-op on already-bare text', () => {
    expect(stripNiqqud('שלום')).toBe('שלום');
  });

  it('preserves maqaf, which is punctuation rather than a mark', () => {
    expect(stripNiqqud('בֵּית־סֵפֶר')).toBe('בית־ספר');
  });

  it('leaves Latin text untouched', () => {
    expect(stripNiqqud('hello world')).toBe('hello world');
  });
});

describe('hasNiqqud / hasHebrew', () => {
  it('detects pointed vs unpointed', () => {
    expect(hasNiqqud('שָׁלוֹם')).toBe(true);
    expect(hasNiqqud('שלום')).toBe(false);
  });

  it('detects Hebrew letters', () => {
    expect(hasHebrew('שלום')).toBe(true);
    expect(hasHebrew('shalom')).toBe(false);
    expect(hasHebrew('')).toBe(false);
  });
});

describe('final forms', () => {
  it('round-trips plain and final letters', () => {
    expect(unfinalize('ן')).toBe('נ');
    expect(finalize('נ')).toBe('ן');
    expect(unfinalize('א')).toBe('א'); // unaffected letters pass through
  });

  it('applies the final form to the last letter only', () => {
    // לבנ + ה is not final; לבנ alone must become לבן
    expect(applyFinalForm('לבנ')).toBe('לבן');
    expect(applyFinalForm('לבנה')).toBe('לבנה');
    expect(applyFinalForm('')).toBe('');
  });
});

describe('normalizeForCompare', () => {
  it('makes pointed and unpointed spellings equal', () => {
    expect(answersMatch('שָׁלוֹם', 'שלום')).toBe(true);
  });

  it('forgives a final-form slip', () => {
    expect(answersMatch('לבן', 'לבנ')).toBe(true);
  });

  it('ignores surrounding whitespace and punctuation', () => {
    expect(answersMatch('  שלום! ', 'שלום')).toBe(true);
  });

  it('is case-insensitive for English answers', () => {
    expect(answersMatch('Red', 'red')).toBe(true);
  });

  it('still rejects a genuine spelling error', () => {
    // ט vs ת is a real mistake, not a typography difference.
    expect(answersMatch('קטן', 'קתן')).toBe(false);
  });

  it('rejects a different word', () => {
    expect(answersMatch('גדול', 'קטן')).toBe(false);
  });
});

describe('normalizeForCompare properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = normalizeForCompare(s);
        expect(normalizeForCompare(once)).toBe(once);
      }),
    );
  });

  it('never throws on arbitrary unicode', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => normalizeForCompare(s)).not.toThrow();
      }),
    );
  });

  it('is reflexive: every string matches itself', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(answersMatch(s, s)).toBe(true);
      }),
    );
  });
});

describe('transliterate', () => {
  it('refuses to guess when there is no niqqud', () => {
    expect(transliterate('שלום')).toBeNull();
    expect(transliterate('hello')).toBeNull();
  });

  it('handles common pointed words', () => {
    expect(transliterate('שָׁלוֹם')).toBe('shalom');
    expect(transliterate('קָטָן')).toBe('katan');
    expect(transliterate('גָּדוֹל')).toBe('gadol');
  });

  it('drops the silent he at the end of a word', () => {
    // יָפָה is "yafa", not "yafah"
    expect(transliterate('יָפָה')).toBe('yafa');
  });

  it('renders shuruk as a vowel, not a consonant', () => {
    expect(transliterate('סוּס')).toBe('sus');
  });

  it('distinguishes shin from sin', () => {
    expect(transliterate('שֶׁמֶשׁ')).toBe('shemesh');
    expect(transliterate('שָׂמֵחַ')?.startsWith('s')).toBe(true);
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => transliterate(s)).not.toThrow();
      }),
    );
  });
});

describe('deriveGenderNumber', () => {
  it('reads the regular endings', () => {
    expect(deriveGenderNumber('ילדים', 'noun')).toMatchObject({ gender: 'm', number: 'pl' });
    expect(deriveGenderNumber('בנות', 'noun')).toMatchObject({ gender: 'f', number: 'pl' });
    expect(deriveGenderNumber('ילדה', 'noun')).toMatchObject({ gender: 'f', number: 'sg' });
    expect(deriveGenderNumber('ילד', 'noun')).toMatchObject({ gender: 'm', number: 'sg' });
  });

  it('flags the ambiguous endings as unconfident', () => {
    // Bare masculine singular is a default, not a signal.
    expect(deriveGenderNumber('ילד', 'noun')?.confident).toBe(false);
    // -it/-et feminines are common but so are masculine nouns ending in tav.
    expect(deriveGenderNumber('מרפסת', 'noun')?.confident).toBe(false);
  });

  it('declines for parts of speech that do not inflect this way', () => {
    expect(deriveGenderNumber('מהר', 'adv')).toBeNull();
  });

  it('works through niqqud', () => {
    expect(deriveGenderNumber('יַלְדָּה', 'noun')).toMatchObject({ gender: 'f', number: 'sg' });
  });
});

describe('suggestRoot', () => {
  it('peels regular suffixes down to three letters', () => {
    expect(suggestRoot('קטנים', 'adj')).toEqual(['ק', 'ט', 'נ']);
    expect(suggestRoot('גדולה', 'adj')).toEqual(['ג', 'ד', 'ל']);
  });

  it('returns null rather than guessing when it cannot reduce cleanly', () => {
    expect(suggestRoot('אינטרנט', 'noun')).toBeNull();
    expect(suggestRoot('בית ספר', 'noun')).toBeNull();
  });

  it('declines for parts of speech without a root system', () => {
    expect(suggestRoot('שלוש', 'num')).toBeNull();
  });

  it('never throws', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString(), (s) => {
        expect(() => suggestRoot(s, 'noun')).not.toThrow();
      }),
    );
  });
});
