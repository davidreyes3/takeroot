/**
 * A deterministic learner simulator.
 *
 * This exists for three reasons:
 *  - to sanity-check that the scheduler actually hits the retention we ask for
 *  - to show the workload a given desired-retention setting implies, before
 *    the learner commits months to it
 *  - as a load generator for the performance and memory guards in the tests
 *
 * The learner model is the FSRS forgetting curve itself, which makes this a
 * self-consistency check rather than independent proof - it will catch
 * integration mistakes (wrong units, mutated state, dropped reviews), not a
 * flaw in FSRS. That distinction matters and is stated in docs/PLAN.md.
 */

import { createScheduler, newCard, reviewCard, retrievability, type SchedulerOptions } from './scheduler.js';
import type { Card, Rating, ReviewLog } from './types.js';

/** Mulberry32: small, fast, and seeded, so failures are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimulationOptions extends SchedulerOptions {
  cardCount: number;
  days: number;
  seed?: number;
  /** Reviews the simulated learner will do per day before giving up. */
  dailyLimit?: number;
  /**
   * How often a recall the model says should succeed is fumbled anyway
   * (distraction, typos, genuinely harder words).
   */
  slipRate?: number;
  /** Cap on retained log rows. Mirrors what the app keeps in memory. */
  logWindow?: number;
}

export interface SimulationResult {
  totalReviews: number;
  /** Fraction of reviews that were passed. Should track desired retention. */
  observedRetention: number;
  lapses: number;
  reviewsPerDay: number[];
  /** Peak number of log rows held at once. Must stay bounded. */
  peakLogRows: number;
  finalCards: Card[];
}

const DAY = 86_400_000;

/**
 * Run the simulation.
 *
 * Memory discipline is deliberate and mirrors the app: per-card log history is
 * truncated to `logWindow`, so this function's footprint is O(cards), not
 * O(reviews). A months-long simulation must not accumulate hundreds of
 * thousands of log objects, and neither must a real user's session.
 */
export function simulate(options: SimulationOptions): SimulationResult {
  const {
    cardCount,
    days,
    seed = 42,
    dailyLimit = 9999,
    slipRate = 0.05,
    logWindow = 10,
  } = options;

  const rng = makeRng(seed);
  const scheduler = createScheduler({ ...options, enableFuzz: options.enableFuzz ?? true });
  const start = Date.UTC(2026, 0, 1);

  let cards: Card[] = Array.from({ length: cardCount }, (_, i) =>
    newCard(`lx_${i}`, 'recall_he_en', start),
  );

  const logsByCard = new Map<string, ReviewLog[]>();
  let totalReviews = 0;
  let passes = 0;
  let lapses = 0;
  let peakLogRows = 0;
  const reviewsPerDay: number[] = [];

  for (let day = 0; day < days; day++) {
    const now = start + day * DAY;
    let doneToday = 0;

    // Due first, then a trickle of new material - the same priority the real
    // session builder uses.
    const dueToday = cards.filter((c) => c.fsrs.state !== 0 && c.fsrs.due <= now);
    const newToday = cards.filter((c) => c.fsrs.state === 0).slice(0, 10);

    for (const card of [...dueToday, ...newToday]) {
      if (doneToday >= dailyLimit) break;

      const r = card.fsrs.state === 0 ? 0 : retrievability(scheduler, card, now);
      const recalled = card.fsrs.state === 0 ? rng() < 0.6 : rng() < r * (1 - slipRate);
      const rating: Rating = recalled ? (rng() < 0.15 ? 4 : 3) : 1;

      const out = reviewCard(scheduler, {
        card,
        rating,
        now,
        durationMs: 1500 + Math.floor(rng() * 3000),
        exercise: 'flashcard',
      });

      cards = cards.map((c) => (c.id === out.card.id ? out.card : c));

      const history = logsByCard.get(card.id) ?? [];
      history.push(out.log);
      // Bounded retention: drop the oldest rows past the window.
      if (history.length > logWindow) history.splice(0, history.length - logWindow);
      logsByCard.set(card.id, history);

      totalReviews++;
      doneToday++;
      if (rating > 1) passes++;
      else lapses++;
    }

    let rows = 0;
    for (const h of logsByCard.values()) rows += h.length;
    peakLogRows = Math.max(peakLogRows, rows);
    reviewsPerDay.push(doneToday);
  }

  return {
    totalReviews,
    observedRetention: totalReviews === 0 ? 0 : passes / totalReviews,
    lapses,
    reviewsPerDay,
    peakLogRows,
    finalCards: cards,
  };
}
