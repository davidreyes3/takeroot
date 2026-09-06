/**
 * The scheduling layer: a thin, well-typed shell around ts-fsrs (FSRS-6).
 *
 * We deliberately do NOT reimplement FSRS. The 21 weights and their update
 * rules are a fitted model, and a hand-rolled approximation would quietly
 * schedule worse while looking fine. What lives here instead is everything
 * ts-fsrs does not decide for us:
 *
 *   - conversion between library `Date` objects and our stored epoch millis
 *   - how an auto-graded exercise result becomes an Again/Hard/Good/Easy
 *   - which reviews are allowed to influence the schedule at all
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  type FSRS,
  type FSRSParameters,
  type Card as FsrsCard,
  type Grade,
} from 'ts-fsrs';
import type { Card, CardTemplate, ExerciseKind, FsrsState, Rating, ReviewLog } from './types.js';

export interface SchedulerOptions {
  /**
   * Target probability of recall at review time. 0.9 is the FSRS default and
   * a good place to stay: pushing it to 0.95 roughly doubles daily workload
   * for a few points of retention, and dropping below 0.85 makes reviews feel
   * like relearning. Exposed in settings, clamped here.
   */
  requestRetention?: number;
  maximumInterval?: number;
  /** Randomises intervals slightly so cards learned together do not clump. */
  enableFuzz?: boolean;
  /** Personalised weights from the optimizer. Falls back to FSRS-6 defaults. */
  weights?: number[];
}

const MIN_RETENTION = 0.7;
const MAX_RETENTION = 0.98;

export function clampRetention(value: number): number {
  if (!Number.isFinite(value)) return 0.9;
  return Math.min(MAX_RETENTION, Math.max(MIN_RETENTION, value));
}

export function buildParameters(opts: SchedulerOptions = {}): FSRSParameters {
  const base: Parameters<typeof generatorParameters>[0] = {
    request_retention: clampRetention(opts.requestRetention ?? 0.9),
    maximum_interval: opts.maximumInterval ?? 36500,
    enable_fuzz: opts.enableFuzz ?? true,
    enable_short_term: true,
  };
  if (opts.weights && opts.weights.length > 0) base.w = opts.weights;
  return generatorParameters(base);
}

export function createScheduler(opts: SchedulerOptions = {}): FSRS {
  return fsrs(buildParameters(opts));
}

// --- Conversion ------------------------------------------------------------

/**
 * Timestamps are stored as epoch millis, not Date objects. Dates do not
 * survive IndexedDB round-trips or JSON export cleanly, and mutable Date
 * instances shared between records are a classic source of "why did this
 * card's due date change" bugs.
 */
function toFsrsCard(state: FsrsState): FsrsCard {
  const card = {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days,
    scheduled_days: state.scheduled_days,
    reps: state.reps,
    lapses: state.lapses,
    learning_steps: state.learning_steps,
    state: state.state,
  } as FsrsCard;
  if (state.last_review !== undefined) card.last_review = new Date(state.last_review);
  return card;
}

function fromFsrsCard(card: FsrsCard): FsrsState {
  const state: FsrsState = {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state as FsrsState['state'],
  };
  if (card.last_review) state.last_review = card.last_review.getTime();
  return state;
}

export function newFsrsState(now: number): FsrsState {
  return fromFsrsCard(createEmptyCard(new Date(now)));
}

export function newCard(lexemeId: string, template: CardTemplate, now: number): Card {
  return {
    id: `${lexemeId}:${template}`,
    lexemeId,
    template,
    fsrs: newFsrsState(now),
    againStreak: 0,
    isLeech: false,
    suspended: false,
  };
}

// --- Reviewing -------------------------------------------------------------

export interface ReviewInput {
  card: Card;
  rating: Rating;
  now: number;
  durationMs: number;
  exercise: ExerciseKind;
  /**
   * False for massed in-session drilling. The review is still logged for
   * analytics, but the card's schedule is left untouched. See
   * "Why drills are not reviews" in docs/PLAN.md.
   */
  countsForScheduling?: boolean;
}

export interface ReviewOutput {
  card: Card;
  log: ReviewLog;
}

let logCounter = 0;
function logId(now: number): string {
  logCounter = (logCounter + 1) % 1_000_000;
  return `rl_${now.toString(36)}_${logCounter.toString(36)}`;
}

/**
 * Apply a rating to a card.
 *
 * Pure: returns new objects and never mutates its input, so React state and
 * undo both work without defensive copying at every call site.
 */
export function reviewCard(scheduler: FSRS, input: ReviewInput): ReviewOutput {
  const { card, rating, now, durationMs, exercise } = input;
  const counts = input.countsForScheduling ?? true;
  const before = card.fsrs;

  const log: ReviewLog = {
    id: logId(now),
    cardId: card.id,
    lexemeId: card.lexemeId,
    rating,
    state: before.state,
    due: before.due,
    stability: before.stability,
    difficulty: before.difficulty,
    elapsed_days: before.elapsed_days,
    last_elapsed_days: before.elapsed_days,
    scheduled_days: before.scheduled_days,
    review: now,
    durationMs,
    exercise,
    countsForScheduling: counts,
  };

  const againStreak = rating === 1 ? card.againStreak + 1 : 0;

  if (!counts) {
    return { card: { ...card, againStreak }, log };
  }

  const { card: nextCard } = scheduler.next(toFsrsCard(before), new Date(now), rating as Grade);

  return {
    card: {
      ...card,
      fsrs: fromFsrsCard(nextCard),
      againStreak,
      introducedAt: card.introducedAt ?? now,
    },
    log,
  };
}

/** Days until due, for the "next review" hint under the answer buttons. */
export function previewIntervals(
  scheduler: FSRS,
  card: Card,
  now: number,
): Record<Rating, { due: number; days: number }> {
  const record = scheduler.repeat(toFsrsCard(card.fsrs), new Date(now));
  const out = {} as Record<Rating, { due: number; days: number }>;
  for (const rating of [1, 2, 3, 4] as const) {
    const due = record[rating].card.due.getTime();
    out[rating] = { due, days: (due - now) / 86_400_000 };
  }
  return out;
}

/** Current probability of recall, 0..1. Drives the "fading" UI on the path. */
export function retrievability(scheduler: FSRS, card: Card, now: number): number {
  if (card.fsrs.state === 0) return 0;
  return scheduler.get_retrievability(toFsrsCard(card.fsrs), new Date(now), false) as number;
}

// --- Auto-grading ----------------------------------------------------------

export interface GradeInput {
  correct: boolean;
  /** Time from prompt shown to answer submitted. */
  elapsedMs: number;
  /** The learner's rolling median answer time, for a personal "slow" baseline. */
  medianMs: number;
  usedHint: boolean;
  exercise: ExerciseKind;
}

const SLOW_MULTIPLIER = 2.5;
const FAST_MULTIPLIER = 0.5;
const SLOW_FLOOR_MS = 6000;

/**
 * Turn an auto-graded exercise result into an FSRS rating.
 *
 * The judgement calls here, and why:
 *
 *  - Wrong is always Again. No partial credit; a lapse is a lapse.
 *  - A hint caps the result at Hard. You recalled it with scaffolding, which
 *    is not the same as recalling it.
 *  - Slow-but-correct is Hard. Retrieval latency is a genuine signal of weak
 *    memory strength, and it is the signal a self-graded flashcard throws away.
 *  - Easy is only ever available on *production* exercises (typing). On
 *    recognition exercises - multiple choice, matching - a fast correct answer
 *    might just be a lucky guess from four options, and handing that an Easy
 *    would inflate the interval badly. Capping recognition at Good is the
 *    conservative, and correct, choice.
 */
export function gradeFromResult(input: GradeInput): Rating {
  if (!input.correct) return 1;
  if (input.usedHint) return 2;

  const baseline = Number.isFinite(input.medianMs) && input.medianMs > 0 ? input.medianMs : 4000;
  const slowThreshold = Math.max(baseline * SLOW_MULTIPLIER, SLOW_FLOOR_MS);

  if (input.elapsedMs > slowThreshold) return 2;

  const isProduction = input.exercise === 'type' || input.exercise === 'form';
  if (isProduction && input.elapsedMs < baseline * FAST_MULTIPLIER) return 4;

  return 3;
}

/** Rolling median without keeping every sample in memory forever. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}
