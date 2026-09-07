/**
 * Parser for the hand-authored vocabulary markdown in `content/`.
 *
 * Design goals, in priority order:
 *  1. The minimum viable line is `- קָטָן = small`. Everything else optional.
 *  2. Nothing is ever silently invented. Anything the parser works out for
 *     itself is tagged `derived` or `suggested`, never `authored`, so the UI
 *     can show it as provisional and the validator can ask you to confirm it.
 *  3. Ids are stable across edits. Fixing a typo in a gloss must not orphan
 *     months of scheduling history.
 */

import {
  deriveGenderNumber,
  hasHebrew,
  hasNiqqud,
  stripNiqqud,
  suggestRoot,
  transliterate,
} from '../hebrew.js';
import { inflectAdjective } from '../grammar/inflect.js';
import type {
  AgreementSlot,
  Example,
  Gender,
  GramNumber,
  Lexeme,
  Pos,
  Sourced,
} from '../types.js';

// --- Stable ids ------------------------------------------------------------

/** FNV-1a. Not cryptographic - we need determinism and speed, not secrecy. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/**
 * Identity is (bare lemma + part of speech + optional explicit key).
 *
 * Excluding the gloss, the file and the niqqud is what lets you retranslate,
 * add vowel points, or reorganise files without losing review history.
 *
 * But ignoring niqqud means true minimal pairs collide: מוֹרֶה (male teacher)
 * and מוֹרָה (female teacher) are spelled identically once the points are
 * stripped, and Hebrew has many such pairs. Rather than fold niqqud back into
 * the identity - which would break history the day you point a word - the
 * second entry declares `; key: f`. Explicit, and stable: adding a key only
 * ever affects an entry that was colliding anyway, so nothing with real
 * history ever changes id.
 */
export function lexemeId(lemma: string, pos: Pos, key = ''): string {
  return `lx_${hash(`${stripNiqqud(lemma).trim()}|${pos}|${key}`)}`;
}

// --- Part-of-speech headings ----------------------------------------------

const POS_ALIASES: Readonly<Record<string, Pos>> = {
  noun: 'noun', nouns: 'noun',
  verb: 'verb', verbs: 'verb',
  adj: 'adj', adjective: 'adj', adjectives: 'adj',
  adv: 'adv', adverb: 'adv', adverbs: 'adv',
  prep: 'prep', preposition: 'prep', prepositions: 'prep',
  pron: 'pron', pronoun: 'pron', pronouns: 'pron',
  num: 'num', number: 'num', numbers: 'num',
  particle: 'particle', particles: 'particle',
  phrase: 'phrase', phrases: 'phrase',
};

function parsePos(heading: string): Pos | null {
  return POS_ALIASES[heading.trim().toLowerCase()] ?? null;
}

// --- Issues ----------------------------------------------------------------

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ContentIssue {
  severity: IssueSeverity;
  file: string;
  line: number;
  message: string;
  /** The entry this concerns, when there is one. */
  lemma?: string;
}

export interface ParseResult {
  lexemes: Lexeme[];
  issues: ContentIssue[];
}

// --- Frontmatter -----------------------------------------------------------

interface Frontmatter {
  unit: number;
  title: string;
  tags: string[];
  /** File-wide default, so headings are free to name a topic instead of a pos. */
  pos: Pos | null;
}

/**
 * Deliberately tiny YAML subset: `key: value` and `tags: [a, b]`. Pulling in a
 * full YAML parser for three keys would be a dependency we have to keep
 * patched forever, and arbitrary YAML in content files is a footgun anyway.
 */
function parseFrontmatter(lines: string[]): { fm: Frontmatter; endLine: number } {
  const fm: Frontmatter = { unit: 1, title: '', tags: [], pos: null };
  if (lines[0]?.trim() !== '---') return { fm, endLine: 0 };

  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.trim() === '---') {
      i++;
      break;
    }
    const m = /^(\w+)\s*:\s*(.*)$/u.exec(line);
    if (!m) continue;
    const key = (m[1] as string).toLowerCase();
    const raw = (m[2] as string).trim();
    if (key === 'unit') {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) fm.unit = n;
    } else if (key === 'title') {
      fm.title = raw.replace(/^["']|["']$/gu, '');
    } else if (key === 'pos') {
      fm.pos = parsePos(raw);
    } else if (key === 'tags') {
      fm.tags = raw
        .replace(/^\[|\]$/gu, '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }
  return { fm, endLine: i };
}

// --- Entry lines -----------------------------------------------------------

const SLOT_KEYS = new Set<string>(['ms', 'fs', 'mp', 'fp']);

interface RawEntry {
  lemma: string;
  glosses: string[];
  fields: Map<string, string[]>;
}

/**
 * Split `- לָבָן = white ; root: ל-ב-נ ; fs: לבנה` into its parts.
 *
 * Semicolons separate fields, so a gloss may not contain one. Commas separate
 * multiple glosses. Both are documented in content/README.md.
 */
function parseEntryLine(body: string): RawEntry | null {
  const parts = body.split(';');
  const head = (parts[0] as string).trim();

  const eq = head.indexOf('=');
  if (eq === -1) return null;

  const lemma = head.slice(0, eq).trim();
  const glossText = head.slice(eq + 1).trim();
  if (lemma === '' || glossText === '') return null;

  const glosses = glossText
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  const fields = new Map<string, string[]>();
  for (const part of parts.slice(1)) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const key = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (key === '' || value === '') continue;
    const existing = fields.get(key);
    if (existing) existing.push(value);
    else fields.set(key, [value]);
  }

  return { lemma, glosses, fields };
}

function authored<T>(value: T): Sourced<T> {
  return { value, provenance: 'authored' };
}

function derived<T>(value: T, note?: string): Sourced<T> {
  return note === undefined ? { value, provenance: 'derived' } : { value, provenance: 'derived', note };
}

// --- Main parser -----------------------------------------------------------

/**
 * Parse one markdown vocabulary file.
 *
 * Never throws on malformed input: a bad line becomes an `error` issue and the
 * rest of the file still loads. A content typo must not take the app down.
 */
export function parseContentFile(source: string, filePath: string): ParseResult {
  const lines = source.split(/\r?\n/u);
  const issues: ContentIssue[] = [];
  const lexemes: Lexeme[] = [];
  const seen = new Map<string, number>();

  const { fm, endLine } = parseFrontmatter(lines);
  if (fm.title === '') {
    issues.push({
      severity: 'info',
      file: filePath,
      line: 1,
      message: 'No `title:` in frontmatter; the file name will be used on the path screen.',
    });
  }

  let currentPos: Pos | null = fm.pos;
  let currentGroup = fm.title === '' ? 'Words' : fm.title;

  for (let i = endLine; i < lines.length; i++) {
    const raw = lines[i] as string;
    const line = raw.trim();
    const lineNo = i + 1;

    if (line === '' || line.startsWith('<!--')) continue;

    const heading = /^#{1,6}\s+(.*)$/u.exec(line);
    if (heading) {
      // A heading always names the lesson. If it happens to name a part of
      // speech too, it sets that as well - which keeps "## Adjectives" working
      // exactly as before while freeing "## Greetings" to be a topic.
      currentGroup = (heading[1] as string).trim();
      const pos = parsePos(currentGroup);
      if (pos) currentPos = pos;
      continue;
    }

    if (!line.startsWith('- ')) continue;

    const entry = parseEntryLine(line.slice(2));
    if (!entry) {
      issues.push({
        severity: 'error',
        file: filePath,
        line: lineNo,
        message: 'Could not parse this entry. Expected `- <hebrew> = <english>`.',
      });
      continue;
    }

    const posField = entry.fields.get('pos')?.[0];
    const pos: Pos | null = posField ? parsePos(posField) : currentPos;
    if (!pos) {
      issues.push({
        severity: 'error',
        file: filePath,
        line: lineNo,
        lemma: entry.lemma,
        message:
          'No part of speech. Add a `## Nouns` style heading above, or `; pos: noun` on the line.',
      });
      continue;
    }

    if (!hasHebrew(entry.lemma)) {
      issues.push({
        severity: 'error',
        file: filePath,
        line: lineNo,
        lemma: entry.lemma,
        message: 'The left side of `=` contains no Hebrew letters.',
      });
      continue;
    }

    const id = lexemeId(entry.lemma, pos, entry.fields.get('key')?.[0] ?? '');
    const prior = seen.get(id);
    if (prior !== undefined) {
      issues.push({
        severity: 'error',
        file: filePath,
        line: lineNo,
        lemma: entry.lemma,
        message:
          `Collides with the entry on line ${prior} (they are spelled the same without niqqud). ` +
          'If they are the same word, merge the glosses; if they are a minimal pair, add `; key: f` to this one.',
      });
      continue;
    }
    seen.set(id, lineNo);

    lexemes.push(buildLexeme(entry, pos, id, fm, currentGroup, filePath, lineNo, issues));
  }

  return { lexemes, issues };
}

function buildLexeme(
  entry: RawEntry,
  pos: Pos,
  id: string,
  fm: Frontmatter,
  group: string,
  filePath: string,
  lineNo: number,
  issues: ContentIssue[],
): Lexeme {
  const { lemma, glosses, fields } = entry;
  const lemmaBare = stripNiqqud(lemma);
  const push = (severity: IssueSeverity, message: string) =>
    issues.push({ severity, file: filePath, line: lineNo, lemma, message });

  // --- transliteration
  const trField = fields.get('tr')?.[0];
  let translit: Sourced<string>;
  if (trField) {
    translit = authored(trField);
  } else {
    const auto = transliterate(lemma);
    if (auto) {
      translit = derived(auto, 'Generated from niqqud; edit with `; tr: ...` if wrong.');
    } else {
      translit = { value: '', provenance: 'derived', note: 'No niqqud, so none could be generated.' };
      if (!hasNiqqud(lemma)) {
        push('warning', 'No niqqud, so no transliteration could be generated. Add points, or `; tr: ...`.');
      }
    }
  }

  // --- gender and number
  let gender: Sourced<Gender> | undefined;
  let grammaticalNumber: Sourced<GramNumber> | undefined;

  const gField = fields.get('gender')?.[0];
  const nField = fields.get('number')?.[0];
  const guess = deriveGenderNumber(lemma, pos);

  if (gField === 'm' || gField === 'f' || gField === 'mf') {
    gender = authored(gField);
  } else if (guess) {
    gender = derived(guess.gender, guess.confident ? undefined : 'Guessed from the ending; please confirm.');
    if (!guess.confident && pos === 'noun') {
      push('warning', `Gender guessed as "${guess.gender}" from the ending. Add \`; gender: m\` or \`; gender: f\` to be sure.`);
    }
  }

  if (nField === 'sg' || nField === 'pl' || nField === 'dual') {
    grammaticalNumber = authored(nField);
  } else if (guess) {
    grammaticalNumber = derived(guess.number);
  }

  // --- root
  const rootField = fields.get('root')?.[0];
  let root: Sourced<string[]>;
  if (rootField) {
    root = authored(rootField.split(/[-־\s.]+/u).filter(Boolean));
  } else {
    const suggested = suggestRoot(lemma, pos);
    if (suggested) {
      root = { value: suggested, provenance: 'suggested', note: 'Heuristic guess; confirm with `; root: ...`.' };
    } else {
      root = { value: [], provenance: 'suggested', note: 'Could not be worked out from the spelling.' };
      if (pos === 'verb' || pos === 'adj') {
        push('warning', 'No root, and it could not be guessed. Add `; root: ק-ט-נ`.');
      }
    }
  }

  // --- inflected forms
  const forms: Partial<Record<AgreementSlot, Sourced<string>>> = {};
  if (pos === 'adj') {
    const table = inflectAdjective(lemma);
    if (table) {
      for (const [slot, value] of Object.entries(table.forms) as [AgreementSlot, string][]) {
        forms[slot] = derived(value, table.rule);
      }
    }
  }
  // Authored slots always win over generated ones.
  for (const key of fields.keys()) {
    if (!SLOT_KEYS.has(key)) continue;
    const value = fields.get(key)?.[0];
    if (value) forms[key as AgreementSlot] = authored(value);
  }

  // --- examples
  const examples: Example[] = [];
  for (const ex of fields.get('ex') ?? []) {
    const pipe = ex.indexOf('|');
    if (pipe === -1) {
      push('warning', 'Example ignored: expected `; ex: <hebrew> | <english>`.');
      continue;
    }
    const he = ex.slice(0, pipe).trim();
    const en = ex.slice(pipe + 1).trim();
    if (he && en) examples.push({ he, en });
  }

  const noteField = fields.get('note')?.[0];
  const lexeme: Lexeme = {
    id,
    lemma,
    lemmaBare,
    translit,
    glosses,
    pos,
    root,
    forms,
    examples,
    tags: [...fm.tags, ...(fields.get('tags')?.[0]?.split(/[\s,]+/u).filter(Boolean) ?? [])],
    unit: fm.unit,
    group,
    sourceFile: filePath,
    sourceLine: lineNo,
  };
  if (gender) lexeme.gender = gender;
  if (grammaticalNumber) lexeme.number = grammaticalNumber;
  if (noteField) lexeme.notes = noteField;

  return lexeme;
}

/** Parse many files and merge, reporting cross-file duplicates. */
export function parseContentFiles(files: { path: string; source: string }[]): ParseResult {
  const lexemes: Lexeme[] = [];
  const issues: ContentIssue[] = [];
  const byId = new Map<string, Lexeme>();

  for (const { path, source } of files) {
    const result = parseContentFile(source, path);
    issues.push(...result.issues);
    for (const lx of result.lexemes) {
      const existing = byId.get(lx.id);
      if (existing) {
        issues.push({
          severity: 'error',
          file: path,
          line: lx.sourceLine,
          lemma: lx.lemma,
          message: `Already defined in ${existing.sourceFile}:${existing.sourceLine}.`,
        });
        continue;
      }
      byId.set(lx.id, lx);
      lexemes.push(lx);
    }
  }

  lexemes.sort((a, b) => a.unit - b.unit || a.sourceLine - b.sourceLine);
  return { lexemes, issues };
}
