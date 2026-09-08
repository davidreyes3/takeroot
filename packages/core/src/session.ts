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
 * Every stage is capped, and the session as a whole is capped again on top of
 * that, so the returned plan is bounded regardless of how large the collection
 * grows - and short enough to actually finish in one sitting.
 *
 * A session can also be narrowed to a set of templates or a set of words. That
 * is what makes a reading-only session, a writing-practice session and a
 * single-lesson practice run all the same code path rather than three queues
 * that drift apart.
 */

import {
  assessLeech,
  buildGymPlan,
  DEFAULT_LEECH_POLICY,
  type GymPlan,
  type LeechPolicy,
  type LeechVerdict,
} from './leech.js';
import { isUnlocked } from './cards.js';
import type { Card, CardTemplate, ExerciseKind, Lexeme, ReviewLog } from './types.js';

export interface SessionConfig {
  /**
   * Hard ceiling on the whole session, every stage included.
   *
   * The per-stage caps below bound each queue independently, which is not the
   * same thing: a full backlog plus a full new batch still adds up to a sitting
   * long enough that you stop opening the app. This is the number that decides
   * how long one session actually is, and it is the one the learner controls.
   */
  maxItems: number;
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
  maxItems: 12,
  maxReviews: 60,
  maxNew: 5,
  maxGym: 2,
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
  /**
   * Due cards this session did not have room for.
   *
   * They are not lost - they stay due and lead the next session. Surfacing the
   * number keeps the session cap honest: a short session is a choice about one
   * sitting, not a claim that the backlog is smaller than it is.
   */
  dueRemaining: number;
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
  /**
   * Which templates this session is allowed to ask. Writing practice passes
   * `['type_he']`; leave it unset for everything.
   *
   * This narrows the queue only. Cards left out are still *studiable* in
   * general, so they still gate their tier - which is what stops writing
   * practice from asking you to spell a word you cannot yet read.
   */
  templates?: readonly CardTemplate[];
  /**
   * Templates switched off entirely, not merely absent from this queue.
   *
   * Turning typing off passes `['type_he']` here, and the difference from
   * `templates` matters: a disabled card is invisible to tier gating too.
   * `type_he` is tier 2, so a card that can never be studied would otherwise
   * sit in the prerequisite set forever and lock the tier-3 agreement cards
   * away permanently.
   */
  disabledTemplates?: readonly CardTemplate[];
  /**
   * Restrict the session to these words. This is how practising one lesson
   * stays inside that lesson instead of turning into a general review.
   */
  lexemeIds?: readonly string[];
}

/**
 * How much this card is struggling, higher meaning shakier.
 *
 * Lapses dominate because a word you have actually forgotten more than once is
 * the clearest evidence of trouble. Difficulty (FSRS's 1-10 resistance
 * measure) breaks ties among cards with equal lapse counts, and a card already
 * flagged as a leech outranks both.
 */
function struggleScore(card: Card): number {
  return card.fsrs.lapses * 2 + card.fsrs.difficulty + (card.isLeech ? 5 : 0);
}

/**
 * Lapses on this card's opposite-direction recognition sibling, if it has
 * one - recall_he_en's is recall_en_he and vice versa. Fed to `assessLeech`
 * so a word failed from both directions is caught even though neither card
 * alone has reached the threshold; see the comment there. Any other template
 * (typing, cloze, the form drills) has no such counterpart and gets 0.
 */
function companionLapses(card: Card, cardById: ReadonlyMap<string, Card>): number {
  const other =
    card.template === 'recall_he_en'
      ? 'recall_en_he'
      : card.template === 'recall_en_he'
        ? 'recall_he_en'
        : null;
  if (!other) return 0;
  return cardById.get(`${card.lexemeId}:${other}`)?.fsrs.lapses ?? 0;
}

/**
 * Is this word shaky enough to be worth drilling?
 *
 * FSRS difficulty centres around 5, so "harder than average" is the 5.5 line.
 * Any lapse at all counts: forgetting a word once already marks it out from
 * the ones that are simply known.
 */
function needsWork(card: Card): boolean {
  return card.fsrs.lapses > 0 || card.fsrs.difficulty >= 5.5 || card.isLeech;
}

/** Which exercise to render a normal review as. */
export function exerciseFor(card: Card): ExerciseKind {
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

  // Two different worlds, and keeping them apart is the whole subtlety here.
  //
  // `active` is every card that still exists as far as this learner is
  // concerned. It is what tier gating and the gym's pools reason over, so a
  // card left out of today's queue still counts as a prerequisite.
  //
  // `queueable` is the subset this particular session may actually ask.
  const disabled = new Set(input.disabledTemplates ?? []);
  const askable = input.templates ? new Set(input.templates) : null;
  const allowedLexemes = input.lexemeIds ? new Set(input.lexemeIds) : null;

  const active = cards.filter(
    (c) =>
      !c.suspended &&
      lexemeById.has(c.lexemeId) &&
      !disabled.has(c.template) &&
      (!allowedLexemes || allowedLexemes.has(c.lexemeId)),
  );
  const queueable = askable ? active.filter((c) => askable.has(c.template)) : active;

  // Typing is the gym's default closing test. A learner who has switched
  // typing off cannot be asked to close a gym that way.
  const typedFinalTest = !disabled.has('type_he');

  // Looked up by id (`${lexemeId}:${template}`) to find each recognition
  // card's opposite-direction sibling - see companionLapses.
  const cardById = new Map(active.map((c) => [c.id, c]));

  const due: Card[] = [];
  const leeches: Card[] = [];
  const fresh: Card[] = [];
  // Reused when building each leech's gym plan below, so the verdict that
  // decided a card belongs in the gym is exactly the one the plan is built
  // from - assessLeech is never called twice for the same card with a
  // chance of disagreeing with itself.
  const verdictByCardId = new Map<string, LeechVerdict>();

  for (const card of queueable) {
    if (card.fsrs.state === 0) {
      fresh.push(card);
      continue;
    }
    if (card.fsrs.due > now) continue;

    const verdict = assessLeech(
      card,
      logsByCard.get(card.id) ?? [],
      policy,
      companionLapses(card, cardById),
    );
    verdictByCardId.set(card.id, verdict);
    if (verdict.isLeech) leeches.push(card);
    else due.push(card);
  }

  due.sort((a, b) => a.fsrs.due - b.fsrs.due);
  // Combined lapses when available (a word failed from both directions
  // should outrank one failed from only one), falling back to the card's own
  // count for the rare case a card enters here without a stored verdict.
  leeches.sort(
    (a, b) =>
      (verdictByCardId.get(b.id)?.totalLapses ?? b.fsrs.lapses) -
      (verdictByCardId.get(a.id)?.totalLapses ?? a.fsrs.lapses),
  );

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

  // How the single session cap is shared out.
  //
  // Applying it as a plain running total would let a backlog swallow every
  // slot, and a learner who is permanently a little behind would never meet
  // another new word - the exact spiral that makes people give up. So the new
  // words are budgeted for first, and the earlier stages get whatever is left.
  const backlog = due.length + leeches.length;
  const newHeldBack = backlog > config.newIntroBacklogLimit;
  const introducible = newHeldBack
    ? []
    : dedupeByLexeme(fresh.filter((c) => isUnlocked(c, active)));
  const newTarget = Math.min(config.maxNew, introducible.length);
  const backlogBudget = Math.max(0, config.maxItems - newTarget);
  const roomForBacklog = () => items.length < backlogBudget;

  // --- 1. warm-up
  let dueIndex = 0;
  let warmedUp = 0;
  while (warmedUp < config.warmUpCount && dueIndex < due.length && roomForBacklog()) {
    if (take(due[dueIndex] as Card, 'warmup')) warmedUp++;
    dueIndex++;
  }

  // --- 2. gym
  //
  // Two rules govern the pool the gym drills against.
  //
  // One card per word. A word owns up to six cards, so taking cards directly
  // would put the same word into a matching grid several times over - two
  // identical tiles that clear together, which is not a puzzle. Distractors
  // have to be distinct *words* to be distractors at all.
  //
  // Then: prefer words that are themselves shaky. The interleaved items exist
  // to open a gap between sightings of the target, but they are still full
  // prompts the learner has to answer, so spending that time on words they
  // already know well is waste. Ranking by struggle turns the filler from
  // padding into a second helping of practice where it is actually needed.
  // Only words already seen can be interleaved; you cannot drill against a
  // word you have never met.
  const seen = active
    .filter((c) => c.fsrs.state === 2 || c.fsrs.state === 3)
    .sort((a, b) => struggleScore(b) - struggleScore(a));

  const byLexeme = new Map<string, Card>();
  for (const candidate of seen) {
    if (!byLexeme.has(candidate.lexemeId)) byLexeme.set(candidate.lexemeId, candidate);
  }
  const ranked = [...byLexeme.values()].slice(0, 20);
  const needy = ranked.filter(needsWork);

  let gymCount = 0;
  for (const card of leeches) {
    if (gymCount >= config.maxGym || !roomForBacklog()) break;
    const lexeme = lexemeById.get(card.lexemeId);
    if (!lexeme) continue;
    if (usedLexemes.has(card.lexemeId)) continue;

    // Exclude the target's own word, not merely its own card: a sibling card
    // of the same word would give the answer away mid-drill.
    const notTarget = (c: Card) => c.lexemeId !== card.lexemeId;
    const needyOthers = needy.filter(notTarget);
    const allOthers = ranked.filter(notTarget);

    // The drill cycles a short list of genuinely shaky words. Repeating two
    // struggling words is better practice than padding with six solid ones.
    // When nothing qualifies the drill runs with no filler at all, which is
    // fine now that the target alternates direction each time round.
    const drillPool = needyOthers.slice(0, 6);

    // The target's own recognition cards, primary first. Rotating through them
    // means each repetition asks a different direction rather than repeating a
    // prompt the learner can echo from short-term memory.
    const variants = [
      card,
      ...active.filter(
        (c) =>
          c.lexemeId === card.lexemeId &&
          c.id !== card.id &&
          (c.template === 'recall_he_en' || c.template === 'recall_en_he'),
      ),
    ].map((c) => c.id);

    // Every card in `leeches` got a verdict when the queue was classified
    // above; reusing it means the plan is built from the exact judgement
    // that put the card here, not a fresh (and possibly different) one.
    const verdict = verdictByCardId.get(card.id)!;
    const plan = buildGymPlan({
      card,
      lexeme,
      verdict,
      targetVariantIds: variants,
      fillerCardIds: drillPool.map((c) => c.id),
      // Matching wants contrast, so a known word is a perfectly good
      // distractor there - it is discrimination being tested, not recall.
      matchingPoolIds: allOthers.slice(0, 4).map((c) => c.id),
      typedFinalTest,
    });
    if (take(card, 'gym', plan)) gymCount++;
  }

  // --- 3. the rest of the backlog
  let reviewCount = warmedUp;
  for (; dueIndex < due.length && reviewCount < config.maxReviews; dueIndex++) {
    if (!roomForBacklog()) break;
    if (take(due[dueIndex] as Card, 'review')) reviewCount++;
  }

  // --- 4. new introductions
  //
  // These fill up to the full cap rather than only to their own budget: if the
  // backlog came in short, the spare room is better spent moving forward.
  let newCount = 0;
  for (const card of introducible) {
    if (newCount >= config.maxNew || items.length >= config.maxItems) break;
    if (take(card, 'new')) newCount++;
  }

  const backlogShown = items.filter((i) => i.kind !== 'new').length;

  return {
    items,
    stats: {
      dueCount: backlog,
      newAvailable: fresh.length,
      leechCount: leeches.length,
      newHeldBack,
      dueRemaining: Math.max(0, backlog - backlogShown),
    },
  };
}

/**
 * One card per word, keeping the first of each.
 *
 * The new-word budget has to be counted in words, not cards, because `take`
 * refuses a second card of a word already in the session - so counting cards
 * would reserve slots that can never be filled.
 */
function dedupeByLexeme(cards: readonly Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of cards) {
    if (seen.has(card.lexemeId)) continue;
    seen.add(card.lexemeId);
    out.push(card);
  }
  return out;
}
