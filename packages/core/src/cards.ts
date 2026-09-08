/**
 * Turning one lexeme into its family of cards.
 *
 * This is the classic note/card split, and it is the reason your adjective-endings
 * requirement is cheap rather than tedious: you author קָטָן once, and the app
 * derives recognition, production and three agreement cards from it. Edit the
 * word later and every card follows, because they are generated, not copied.
 *
 * Tiers stop that generosity from becoming a wall. All the cards exist from
 * day one, but a tier-2 card is not introduced until its tier-1 sibling has
 * actually graduated - so a new word costs you one card today, not six.
 */

import type { Card, CardTemplate, Lexeme } from './types.js';
import { newCard } from './scheduler.js';

export const CARD_TIER: Readonly<Record<CardTemplate, number>> = {
  recall_he_en: 1, // read it - always first, it is the easiest direction
  recall_en_he: 2, // produce it from memory
  type_he: 2, // spell it
  cloze: 2, // use it in context
  form_fs: 3, // the grammar track
  form_mp: 3,
  form_fp: 3,
};

/** Every template, in tier order. Handy for building "all but X" filters. */
export const ALL_CARD_TEMPLATES: readonly CardTemplate[] = Object.keys(CARD_TIER) as CardTemplate[];

/** Which templates make sense for this particular word. */
export function templatesFor(lexeme: Lexeme): CardTemplate[] {
  const templates: CardTemplate[] = ['recall_he_en', 'recall_en_he'];

  // Typing a whole phrase is punishing and mostly tests patience.
  if (lexeme.pos !== 'phrase') templates.push('type_he');

  if (lexeme.examples.length > 0) templates.push('cloze');

  // Agreement cards only where there is a real, non-degenerate contrast.
  if (lexeme.pos === 'adj') {
    const ms = lexeme.forms.ms?.value;
    for (const slot of ['form_fs', 'form_mp', 'form_fp'] as const) {
      const key = slot.replace('form_', '') as 'fs' | 'mp' | 'fp';
      const form = lexeme.forms[key]?.value;
      // Skip a slot whose form is spelled identically to the base: asking
      // someone to "change" יפה into יפה teaches nothing.
      if (form && form !== ms) templates.push(slot);
    }
  }

  return templates;
}

export function cardsForLexeme(lexeme: Lexeme, now: number): Card[] {
  return templatesFor(lexeme).map((t) => newCard(lexeme.id, t, now));
}

/** Generate cards for many lexemes, skipping any that already exist. */
export function syncCards(
  lexemes: readonly Lexeme[],
  existing: readonly Card[],
  now: number,
): { created: Card[]; orphaned: Card[] } {
  const existingIds = new Set(existing.map((c) => c.id));
  const liveLexemeIds = new Set(lexemes.map((l) => l.id));

  const created: Card[] = [];
  for (const lexeme of lexemes) {
    for (const card of cardsForLexeme(lexeme, now)) {
      if (!existingIds.has(card.id)) created.push(card);
    }
  }

  // Cards whose word was deleted from the content files. Reported rather than
  // deleted: throwing away review history on a content edit would be rude, and
  // the word may simply have moved.
  const orphaned = existing.filter((c) => !liveLexemeIds.has(c.lexemeId));

  return { created, orphaned };
}

/**
 * Is this card allowed to be introduced yet?
 *
 * A tier-N card unlocks once every lower-tier sibling has reached the Review
 * state (FSRS state 2), i.e. has genuinely graduated out of learning.
 */
export function isUnlocked(card: Card, siblings: readonly Card[]): boolean {
  const tier = CARD_TIER[card.template];
  if (tier === 1) return true;

  const prerequisites = siblings.filter(
    (s) => s.lexemeId === card.lexemeId && CARD_TIER[s.template] < tier,
  );
  if (prerequisites.length === 0) return true;
  return prerequisites.every((s) => s.fsrs.state === 2);
}
