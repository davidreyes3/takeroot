/**
 * Words and lessons added from inside the app, as opposed to authored in
 * `content/hebrew/*.md`.
 *
 * These do not touch the markdown files - the app cannot write to disk from
 * a browser, and in-app editing that writes back to markdown is a bigger,
 * separate piece of work that is not built yet (see CLAUDE.md). Instead a
 * custom word is stored in its own IndexedDB table and turned into an
 * ordinary `Lexeme` at load time, merged into the same list every other
 * lexeme lives in. Nothing downstream - cards, sessions, the path, the gym -
 * needs to know a word came from here rather than from a file.
 */

import { stripNiqqud, type Lexeme, type Pos } from '@lang/core';

/** Stored shape. Deliberately smaller than `Lexeme`: no root, no forms, no
 * examples - those are exactly the fields the content pipeline derives from
 * real morphology, which a quick add-a-word form has no business guessing. */
export interface CustomWord {
  id: string;
  lemma: string;
  lemmaBare: string;
  translit: string;
  glosses: string[];
  pos: Pos;
  group: string;
  createdAt: number;
}

export interface AddCustomWordInput {
  lemma: string;
  translit: string;
  glosses: string[];
  /** Left unset when the learner doesn't know or doesn't care - see `resolvePos`. */
  pos?: Pos;
  group: string;
}

/**
 * Part of speech is the one field on the add-a-word form that isn't obvious
 * to someone who isn't already thinking grammatically - most people adding a
 * word know the Hebrew and the meaning, not whether it's a "particle". Rather
 * than block on a guess, an unset choice quietly becomes a noun: it's the
 * most common category, and the only consequence is losing the adjective
 * agreement cards a real `adj` tag would have unlocked, which the learner can
 * always fix by re-adding the word with a part of speech once they know it.
 */
export const DEFAULT_POS: Pos = 'noun';

export function resolvePos(pos: Pos | undefined): Pos {
  return pos ?? DEFAULT_POS;
}

/** Turn a candidate input into a validated record, or say what's wrong. */
export function validateCustomWord(
  input: AddCustomWordInput,
  hasHebrew: (s: string) => boolean,
): string | null {
  if (!input.lemma.trim()) return 'Add the Hebrew word.';
  if (!hasHebrew(input.lemma)) return "That doesn't look like Hebrew.";
  if (input.glosses.length === 0) return 'Add at least one English meaning.';
  if (!input.group.trim()) return 'Give the lesson a name.';
  return null;
}

/**
 * Order custom words for the path: by the lesson they belong to, in the
 * order that lesson was first started, and within a lesson by when the word
 * was added.
 *
 * Plain creation order would not do. `packLessons` (and the plain grouping in
 * the word-list manager) both bucket lexemes by looking for *runs* of the
 * same `group` - that is how the real content files work, since a heading is
 * always contiguous. But adding word A to "Colors", then B to "Animals", then
 * C back to "Colors" creates two separate "Colors" runs unless the words are
 * reordered first. This groups by first appearance instead, so a lesson stays
 * one lesson no matter what order you add to it in.
 */
export function orderCustomWords(records: readonly CustomWord[]): CustomWord[] {
  const byCreation = [...records].sort((a, b) => a.createdAt - b.createdAt);
  const firstSeen = new Map<string, number>();
  for (const r of byCreation) {
    if (!firstSeen.has(r.group)) firstSeen.set(r.group, firstSeen.size);
  }
  return byCreation.sort((a, b) => {
    const groupOrder = (firstSeen.get(a.group) ?? 0) - (firstSeen.get(b.group) ?? 0);
    return groupOrder !== 0 ? groupOrder : a.createdAt - b.createdAt;
  });
}

/**
 * Build a fresh custom word record. `unit` is not stored on it - see
 * `customWordToLexeme`, which assigns it fresh every load so newly authored
 * content always sorts before it.
 */
export function makeCustomWord(id: string, input: AddCustomWordInput): CustomWord {
  return {
    id,
    lemma: input.lemma.trim(),
    lemmaBare: stripNiqqud(input.lemma.trim()),
    translit: input.translit.trim(),
    glosses: input.glosses,
    pos: resolvePos(input.pos),
    group: input.group.trim(),
    createdAt: Date.now(),
  };
}

/**
 * Turn a stored record into a real `Lexeme`.
 *
 * `unit` always lands one past the highest unit any content file uses,
 * recomputed on every load - so custom words sit after the authored course
 * even if a unit is added or renumbered later, rather than carrying a number
 * that can drift out of place.
 */
export function customWordToLexeme(record: CustomWord, unit: number, sourceLine: number): Lexeme {
  return {
    id: record.id,
    lemma: record.lemma,
    lemmaBare: record.lemmaBare,
    translit: { value: record.translit, provenance: 'authored' },
    glosses: record.glosses,
    pos: record.pos,
    root: { value: [], provenance: 'authored' },
    forms: {},
    examples: [],
    tags: [],
    unit,
    group: record.group,
    sourceFile: 'custom',
    sourceLine,
  };
}
