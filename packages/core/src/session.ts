/**
 * Building a study session.
 *
 * The hard part of a spaced-repetition app is not the algorithm, it is the
 * queue: what to show, in what order, and when to stop. The rules here are
 * deliberately conservative about workload, because the failure mode that
 * kills SRS habits is opening the app to 400 due cards.
 *
 * Ordering, and the reasoning behind it:
 *
 *   1. warm-up   a few healthy due cards. You asked not to open with a
 *                challenge, and starting on a word you know builds momentum.
 *   2. gym       the struggling words, while attention is still fresh.
 *   3. reviews   the rest of the backlog.
 *   4. new       introductions last, and only if the backlog is under control.
 *
 * Every stage is capped, so the returned plan is bounded regardless of how
 * large the collection grows.
 */

import { assessLeech, buildGymPlan, DEFAULT_LEECH_POLICY, type GymPlan, type LeechPolicy } from './leech.js';
import { isUnlocked } from './cards.js';
import type { Card, ExerciseKind, Lexeme, ReviewLog } from './types.js';

export interface SessionConfig {
  maxReviews: number;
  maxNew: number;
  maxGym: number;
  /**
   * Stop introducing new words when this many reviews are already due.
   * Without this, a week away turns into a spiral you never dig out of.
   */
  newIntroBacklogLimit: number;
  warmUpCount: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxReviews: 60,
  maxNew: 8,
  maxGym: 3,
  newIntroBacklogLimit: 80,
  warmUpCount: 3,
};

export type SessionItemKind = 'warmup' | 'review' | 'new' | 'gym';

export interface SessionItem {
  kind: SessionItemKind;
  cardId: string;
  lexemeId: string;
  exercise: ExerciseKind;
  /** Present only on gym items. */
  gymPlan?: GymPlan;
}

export interface SessionStats {
  dueCount: number;
  newAvailable: number;
  leechCount: number;
  /** True when new words were withheld because the backlog is too big. */
  newHeldBack: boolean;
}

export interface SessionPlan {
  items: SessionItem[];
  stats: SessionStats;
}

export interface BuildSessionInput {
  cards: readonly Card[];
  lexemes: readonly Lexeme[];
  /** Recent logs per card id, newest last. May be empty. */
  logsByCard: ReadonlyMap<string, readonly ReviewLog[]>;
  now: number;
  config?: Partial<SessionConfig>;
  policy?: LeechPolicy;
}

/** Which exercise to render a normal review as. */
function exerciseFor(card: Card): ExerciseKind {
  switch (card.template) {
    case 'type_he':
      return 'type';
    case 'cloze':
      return 'cloze';
    case 'form_fs':
    case 'form_mp':
    case 'form_fp':
      return 'form';
    default:
      return 'flashcard';
  }
}

export function buildSession(input: BuildSessionInput): SessionPlan {
  const config = { ...DEFAULT_SESSION_CONFIG, ...input.config };
  const policy = input.policy ?? DEFAULT_LEECH_POLICY;
  const { cards, lexemes, logsByCard, now } = input;

  const lexemeById = new Map(lexemes.map((l) => [l.id, l]));
  const active = cards.filter((c) => !c.suspended && lexemeById.has(c.lexemeId));

  const due: Card[] = [];
  const leeches: Card[] = [];
  const fresh: Card[] = [];

  for (const card of active) {
    if (card.fsrs.state === 0) {
      fresh.push(card);
      continue;
    }
    if (card.fsrs.due > now) continue;

    const verdict = assessLeech(card, logsByCard.get(card.id) ?? [], policy);
    if (verdict.isLeech) leeches.push(card);
    else due.push(card);
  }

  due.sort((a, b) => a.fsrs.due - b.fsrs.due);
  leeches.sort((a, b) => b.fsrs.lapses - a.fsrs.lapses);

  // New words follow the path: by unit, then by the order they appear in the
  // content file, so the sequence you author is the sequence you learn.
  const unitOf = (c: Card) => lexemeById.get(c.lexemeId)?.unit ?? Number.MAX_SAFE_INTEGER;
  const lineOf = (c: Card) => lexemeById.get(c.lexemeId)?.sourceLine ?? 0;
  fresh.sort((a, b) => unitOf(a) - unitOf(b) || lineOf(a) - lineOf(b));

  const items: SessionItem[] = [];
  // One card per word per session: seeing קטן twice in five minutes teaches
  // you the session, not the word. This is sibling burying.
  const usedLexemes = new Set<string>();

  const take = (card: Card, kind: SessionItemKind, gymPlan?: GymPlan) => {
    if (usedLexemes.has(card.lexemeId)) return false;
    usedLexemes.add(card.lexemeId);
    const item: SessionItem = {
      kind,
      cardId: card.id,
      lexemeId: card.lexemeId,
      exercise: gymPlan ? 'flashcard' : exerciseFor(card),
    };
    if (gymPlan) item.gymPlan = gymPlan;
    items.push(item);
    return true;
  };

  // --- 1. warm-up
  let dueIndex = 0;
  let warmedUp = 0;
  while (warmedUp < config.warmUpCount && dueIndex < due.length) {
    if (take(due[dueIndex] as Card, 'warmup')) warmedUp++;
    dueIndex++;
  }

  // --- 2. gym
  const fillerPool = active
    .filter((c) => c.fsrs.state === 2 && !c.isLeech)
    .slice(0, 20)
    .map((c) => c.id);

  let gymCount = 0;
  for (const card of leeches) {
    if (gymCount >= config.maxGym) break;
    const lexeme = lexemeById.get(card.lexemeId);
    if (!lexeme) continue;
    if (usedLexemes.has(card.lexemeId)) continue;

    const verdict = assessLeech(card, logsByCard.get(card.id) ?? [], policy);
    const plan = buildGymPlan({
      card,
      lexeme,
      verdict,
      fillerCardIds: fillerPool.filter((id) => id !== card.id),
      matchingPoolIds: fillerPool.filter((id) => id !== card.id).slice(0, 4),
    });
    if (take(card, 'gym', plan)) gymCount++;
  }

  // --- 3. the rest of the backlog
  let reviewCount = warmedUp;
  for (; dueIndex < due.length && reviewCount < config.maxReviews; dueIndex++) {
    if (take(due[dueIndex] as Card, 'review')) reviewCount++;
  }

  // --- 4. new introductions
  const backlog = due.length + leeches.length;
  const newHeldBack = backlog > config.newIntroBacklogLimit;
  let newCount = 0;
  if (!newHeldBack) {
    for (const card of fresh) {
      if (newCount >= config.maxNew) break;
      if (!isUnlocked(card, active)) continue;
      if (take(card, 'new')) newCount++;
    }
  }

  return {
    items,
    stats: {
      dueCount: due.length + leeches.length,
      newAvailable: fresh.length,
      leechCount: leeches.length,
      newHeldBack,
    },
  };
}
