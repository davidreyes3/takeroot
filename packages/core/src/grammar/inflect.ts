/**
 * Hebrew inflection rules.
 *
 * The point of this module is your "I don't just want the word, I want the
 * rule behind it" requirement: from a single masculine-singular adjective we
 * generate the whole agreement table *and* the human-readable rule that
 * produced it, so the app can teach the pattern rather than four separate
 * flashcards.
 *
 * Scope note: these rules operate on the *unpointed* consonantal spelling
 * (ktiv male), which is how Hebrew is actually written day to day. Generating
 * correct niqqud requires real morphology - stem vowels reduce (גָּדוֹל ->
 * גְּדוֹלָה) in ways a suffix rule cannot predict - so pointed forms are only
 * ever produced when the content author supplies them. See `docs/PLAN.md`.
 */

import { applyFinalForm, stripNiqqud, unfinalize } from '../hebrew.js';
import type { AgreementSlot, Pos } from '../types.js';

/** Suffixes, written with explicit code points so the final mem is unambiguous. */
const SUF_A = 'ה'; // ה
const SUF_IM = 'ים'; // ים  (yod + FINAL mem)
const SUF_OT = 'ות'; // ות  (vav + tav)
const SUF_T = 'ת'; // ת
const SUF_IYIM = 'יים'; // יים
const SUF_IYOT = 'יות'; // יות
const HE = 'ה';
const YOD = 'י';

export type AdjectivePattern = 'regular' | 'ends_he' | 'nisba';

export interface InflectionResult {
  forms: Record<AgreementSlot, string>;
  pattern: AdjectivePattern;
  /** Plain-English statement of the rule, shown in the grammar lesson. */
  rule: string;
  /**
   * True when the generated forms are a rule-based guess that a human should
   * confirm. Irregular adjectives will be wrong and must be overridden in the
   * content file.
   */
  needsReview: boolean;
}

/**
 * Build the four agreement forms of an adjective from its masculine singular.
 *
 * Three patterns cover the overwhelming majority of Modern Hebrew adjectives:
 *
 *   regular   קטן  -> קטנה   קטנים   קטנות     (add ה / ים / ות)
 *   ends_he   יפה  -> יפה    יפים    יפות      (drop ה, then add)
 *   nisba     ישראלי -> ישראלית ישראליים ישראליות  (the -i relational adjectives)
 *
 * The final-form rule matters and is easy to get wrong: לבן ends in a final
 * nun, but the feminine is לבנה - the nun stops being word-final the moment a
 * suffix is attached, so it must revert to its plain form first.
 */
export function inflectAdjective(masculineSingular: string): InflectionResult | null {
  const ms = stripNiqqud(masculineSingular).trim();
  if (ms.length < 2 || /\s/u.test(ms)) return null;

  // Nisba (relational) adjectives: ישראלי, אמיתי, רגיל-style -i endings.
  if (ms.endsWith(YOD)) {
    return {
      forms: {
        ms,
        fs: ms + SUF_T,
        mp: ms + SUF_IYIM.slice(1), // already ends in yod, so add ים not יים
        fp: ms + SUF_IYOT.slice(1),
      },
      pattern: 'nisba',
      rule: 'Adjectives ending in -i (nisba): feminine adds ת, plurals add ים / ות.',
      needsReview: false,
    };
  }

  // Adjectives already ending in ה: drop it, then attach the endings.
  if (ms.endsWith(HE)) {
    const stem = ms.slice(0, -1);
    return {
      forms: {
        ms,
        fs: stem + SUF_A, // identical spelling to ms; the vowels differ
        mp: stem + SUF_IM,
        fp: stem + SUF_OT,
      },
      pattern: 'ends_he',
      rule: 'Adjectives ending in ה: drop the ה, then add ה / ים / ות. The feminine singular is spelled like the masculine but pronounced differently.',
      needsReview: false,
    };
  }

  // Regular: un-finalize the last letter, then attach.
  const last = ms[ms.length - 1] as string;
  const stem = ms.slice(0, -1) + unfinalize(last);

  return {
    forms: {
      ms: applyFinalForm(ms),
      fs: stem + SUF_A,
      mp: stem + SUF_IM,
      fp: stem + SUF_OT,
    },
    pattern: 'regular',
    rule: 'Regular adjectives: add ה for feminine, ים for masculine plural, ות for feminine plural. A final letter (ך ם ן ף ץ) reverts to its plain form before the ending is attached.',
    needsReview: false,
  };
}

export interface PluralResult {
  plural: string;
  rule: string;
  needsReview: boolean;
}

/**
 * Guess a noun's plural.
 *
 * Far less reliable than adjective agreement - Hebrew noun plurals are full of
 * gender-crossing irregulars (אָב -> אָבוֹת, אִשָּׁה -> נָשִׁים, שֻׁלְחָן ->
 * שֻׁלְחָנוֹת) - so this always reports `needsReview: true` and exists to
 * pre-fill the content editor, never to grade an answer.
 */
export function pluralizeNoun(singular: string, gender: 'm' | 'f' | 'mf'): PluralResult | null {
  const s = stripNiqqud(singular).trim();
  if (s.length < 2 || /\s/u.test(s)) return null;

  if (s.endsWith(HE)) {
    return {
      plural: s.slice(0, -1) + SUF_OT,
      rule: 'Feminine nouns ending in ה usually drop it and take ות.',
      needsReview: true,
    };
  }
  if (s.endsWith(SUF_T)) {
    return {
      plural: s.slice(0, -1) + SUF_OT,
      rule: 'Feminine nouns ending in ת usually drop it and take ות.',
      needsReview: true,
    };
  }

  const last = s[s.length - 1] as string;
  const stem = s.slice(0, -1) + unfinalize(last);
  return {
    plural: gender === 'f' ? stem + SUF_OT : stem + SUF_IM,
    rule:
      gender === 'f'
        ? 'Unmarked feminine nouns still take ות in the plural.'
        : 'Masculine nouns take ים in the plural.',
    needsReview: true,
  };
}

/** Human-readable label for an agreement slot, used in exercise prompts. */
export const SLOT_LABELS: Readonly<Record<AgreementSlot, string>> = {
  ms: 'masculine singular',
  fs: 'feminine singular',
  mp: 'masculine plural',
  fp: 'feminine plural',
};

/** Which parts of speech we can generate an agreement table for. */
export function canInflect(pos: Pos): boolean {
  return pos === 'adj' || pos === 'noun';
}
