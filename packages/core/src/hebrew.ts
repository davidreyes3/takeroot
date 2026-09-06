/**
 * Hebrew text handling.
 *
 * Everything the app compares, indexes, or generates goes through here.
 * Getting this wrong is the single most likely source of "I typed it right
 * and it said I was wrong" bugs, so it is pure, total, and heavily tested.
 */

import type { Gender, GramNumber, Pos } from './types.js';

// --- Unicode ranges --------------------------------------------------------

/**
 * Points and cantillation marks. Deliberately excludes the characters in
 * U+0591..U+05C7 that are punctuation rather than marks: maqaf (U+05BE),
 * paseq (U+05C0) and sof pasuq (U+05C3).
 */
const MARKS = /[֑-ׇֽֿׁׂׅׄ]/gu;

const MAQAF = '־';
const GERESH = '׳';
const GERSHAYIM = '״';

const FINAL_TO_PLAIN: Readonly<Record<string, string>> = {
  'ך': 'כ', // ך -> כ
  'ם': 'מ', // ם -> מ
  'ן': 'נ', // ן -> נ
  'ף': 'פ', // ף -> פ
  'ץ': 'צ', // ץ -> צ
};

const PLAIN_TO_FINAL: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FINAL_TO_PLAIN).map(([f, p]) => [p, f]),
);

const HEBREW_LETTER = /[א-ת]/u;

/** True if the string contains at least one Hebrew letter. */
export function hasHebrew(s: string): boolean {
  return HEBREW_LETTER.test(s);
}

/** True if the string carries any niqqud/cantillation. */
export function hasNiqqud(s: string): boolean {
  MARKS.lastIndex = 0;
  return MARKS.test(s.normalize('NFC'));
}

/** Remove vowel points and cantillation, preserving letters and punctuation. */
export function stripNiqqud(s: string): string {
  return s.normalize('NFC').replace(MARKS, '');
}

/** Convert a word-final letter form to its plain form (ן -> נ). */
export function unfinalize(ch: string): string {
  return FINAL_TO_PLAIN[ch] ?? ch;
}

/** Convert a plain letter to its word-final form (נ -> ן). */
export function finalize(ch: string): string {
  return PLAIN_TO_FINAL[ch] ?? ch;
}

/** Apply final-form spelling to the last letter of a word. */
export function applyFinalForm(word: string): string {
  if (word.length === 0) return word;
  const last = word[word.length - 1] as string;
  return word.slice(0, -1) + finalize(last);
}

/** Strip final forms everywhere, so ן and נ compare equal. */
export function normalizeFinals(s: string): string {
  let out = '';
  for (const ch of s) out += unfinalize(ch);
  return out;
}

/**
 * Canonical form for equality checks between what the learner typed and what
 * the card expects.
 *
 * Deliberately forgiving: a learner typing unpointed text should match a
 * pointed answer, and should not be punished for a final-form slip or for
 * omitting a maqaf. Deliberately *not* forgiving about letters themselves -
 * ט and ת stay distinct, because that is a real spelling error.
 */
export function normalizeForCompare(s: string): string {
  return stripNiqqud(s)
    .replace(new RegExp(MAQAF, 'gu'), ' ')
    .replace(new RegExp(`[${GERESH}${GERSHAYIM}'"\`]`, 'gu'), '')
    .split('')
    .map(unfinalize)
    .join('')
    .replace(/[.,!?;:()[\]]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** Do two Hebrew (or English) strings count as the same answer? */
export function answersMatch(expected: string, actual: string): boolean {
  return normalizeForCompare(expected) === normalizeForCompare(actual);
}

// --- Transliteration -------------------------------------------------------

const DAGESH = 'ּ';
const SHIN_DOT = 'ׁ';
const SIN_DOT = 'ׂ';

const VOWELS: Readonly<Record<string, string>> = {
  'ְ': '', // shva - treated as silent; vocal shva handled below
  'ֱ': 'e', // hataf segol
  'ֲ': 'a', // hataf patah
  'ֳ': 'o', // hataf qamats
  'ִ': 'i', // hiriq
  'ֵ': 'e', // tsere
  'ֶ': 'e', // segol
  'ַ': 'a', // patah
  'ָ': 'a', // qamats
  'ֹ': 'o', // holam
  'ֺ': 'o', // holam haser
  'ֻ': 'u', // qubuts
  'ׇ': 'o', // qamats qatan
};

/** Consonant -> [without dagesh, with dagesh]. */
const CONSONANTS: Readonly<Record<string, readonly [string, string]>> = {
  'א': ['', ''], // alef
  'ב': ['v', 'b'], // bet
  'ג': ['g', 'g'],
  'ד': ['d', 'd'],
  'ה': ['h', 'h'],
  'ו': ['v', 'u'], // vav / shuruk
  'ז': ['z', 'z'],
  'ח': ['ch', 'ch'],
  'ט': ['t', 't'],
  'י': ['y', 'y'],
  'כ': ['kh', 'k'],
  'ל': ['l', 'l'],
  'מ': ['m', 'm'],
  'נ': ['n', 'n'],
  'ס': ['s', 's'],
  'ע': ['', ''], // ayin
  'פ': ['f', 'p'],
  'צ': ['ts', 'ts'],
  'ק': ['k', 'k'],
  'ר': ['r', 'r'],
  'ש': ['sh', 'sh'], // refined by shin/sin dot
  'ת': ['t', 't'],
};

interface Cluster {
  letter: string;
  marks: string;
}

function clusters(word: string): Cluster[] {
  const out: Cluster[] = [];
  for (const ch of word.normalize('NFC')) {
    MARKS.lastIndex = 0;
    const isMark = MARKS.test(ch);
    if (isMark && out.length > 0) {
      (out[out.length - 1] as Cluster).marks += ch;
    } else if (!isMark) {
      out.push({ letter: ch, marks: '' });
    }
  }
  return out;
}

/**
 * Approximate Modern Israeli transliteration from pointed Hebrew.
 *
 * Returns null when the input carries no niqqud - guessing vowels from
 * unpointed text is not something we should pretend to do. Callers should
 * treat a non-null result as `provenance: 'derived'` and let the content
 * author override it.
 */
export function transliterate(pointed: string): string | null {
  if (!hasNiqqud(pointed) || !hasHebrew(pointed)) return null;

  const cs = clusters(pointed);
  let out = '';

  for (let i = 0; i < cs.length; i++) {
    const c = cs[i] as Cluster;
    const plain = unfinalize(c.letter);
    const entry = CONSONANTS[plain];

    if (!entry) {
      // Spaces, maqaf, punctuation pass through.
      if (/\s/u.test(c.letter)) out += ' ';
      else if (c.letter === MAQAF) out += '-';
      continue;
    }

    const hasDagesh = c.marks.includes(DAGESH);
    let cons = hasDagesh ? entry[1] : entry[0];

    if (plain === 'ש') cons = c.marks.includes(SIN_DOT) ? 's' : 'sh';

    // Vav used as a mater lectionis is a vowel, not a consonant: with a
    // dagesh it is shuruk (u), with a holam it is holam male (o). Without
    // this, שָׁלוֹם transliterates as "shalvom".
    if (plain === 'ו' && hasDagesh) {
      out += 'u';
      continue;
    }
    if (plain === 'ו' && (c.marks.includes('ֹ') || c.marks.includes('ֺ'))) {
      out += 'o';
      continue;
    }
    // Silent he at the end of a word.
    if (plain === 'ה' && i === cs.length - 1 && !hasDagesh) {
      const vowel = [...c.marks].map((m) => VOWELS[m]).find((v) => v !== undefined);
      if (vowel === undefined || vowel === '') continue;
    }

    out += cons;

    for (const m of c.marks) {
      const v = VOWELS[m];
      if (v !== undefined) {
        // A shva on the first letter of a word is vocal ("shva na").
        if (m === 'ְ') out += i === 0 ? 'e' : '';
        else out += v;
      }
    }
  }

  return out.replace(/\s+/gu, ' ').trim();
}

// --- Morphology heuristics -------------------------------------------------

const SUF_IM = 'ים'; // ים (yod + final mem)
const SUF_OT = 'ות'; // ות (vav + tav)
const SUF_AYIM = 'יים'; // יים
const HE = 'ה';
const TAV = 'ת';
const YOD = 'י';

export interface GenderNumberGuess {
  gender: Gender;
  number: GramNumber;
  /** Rules in Hebrew have exceptions; true when this ending is unambiguous. */
  confident: boolean;
}

/**
 * Infer gender and number from a noun/adjective's ending.
 *
 * Reliable for the regular cases, which is most of them. Known misses:
 * masculine nouns with -ot plurals (אָבוֹת), feminine nouns with -im plurals
 * (נָשִׁים), and unmarked feminines (אֶרֶץ, עִיר). Those come back
 * `confident: false` or wrong, which is exactly why the content format lets
 * the author state gender explicitly and the validator asks them to.
 */
export function deriveGenderNumber(surface: string, pos: Pos): GenderNumberGuess | null {
  if (pos !== 'noun' && pos !== 'adj') return null;
  const bare = stripNiqqud(surface).trim();
  if (bare.length === 0) return null;

  if (bare.endsWith(SUF_AYIM)) return { gender: 'm', number: 'dual', confident: false };
  if (bare.endsWith(SUF_IM)) return { gender: 'm', number: 'pl', confident: true };
  if (bare.endsWith(SUF_OT)) return { gender: 'f', number: 'pl', confident: true };
  if (bare.endsWith(HE)) return { gender: 'f', number: 'sg', confident: true };
  if (bare.endsWith(TAV)) return { gender: 'f', number: 'sg', confident: false };
  return { gender: 'm', number: 'sg', confident: false };
}

/**
 * Best-effort three-letter root suggestion by peeling affixes.
 *
 * This is a heuristic, not a morphological analyser: weak roots (ל"ה, פ"נ,
 * ע"ו) and quadriliterals will defeat it. It returns a suggestion only when
 * exactly three consonants survive, and callers must mark the result
 * `provenance: 'suggested'` so the UI can show it as a guess to confirm.
 */
export function suggestRoot(surface: string, pos: Pos): string[] | null {
  if (pos === 'phrase' || pos === 'num' || pos === 'pron') return null;
  // Peel suffixes while the word still carries its final forms: the plural
  // suffix ים ends in a *final* mem, so collapsing finals first would stop it
  // ever matching. Normalise finals only once the peeling is done.
  let s = stripNiqqud(surface).trim();
  if (!hasHebrew(s) || /\s/u.test(s)) return null;

  for (const suf of [SUF_AYIM, SUF_IM, SUF_OT, TAV + HE, HE, TAV, YOD]) {
    if (s.length > 3 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length);
      break;
    }
  }
  s = normalizeFinals(s);
  // Nouns commonly take a mem or tav preformative.
  if (s.length === 4 && (s.startsWith('מ') || s.startsWith('ת'))) s = s.slice(1);
  // Drop internal matres lectionis.
  if (s.length === 4) {
    const middle = s.slice(1, -1).replace(/[וי]/u, '');
    s = (s[0] as string) + middle + (s[s.length - 1] as string);
  }

  return s.length === 3 ? [...s] : null;
}
