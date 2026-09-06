import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import {
  createScheduler,
  newCard,
  reviewCard,
  previewIntervals,
  retrievability,
  gradeFromResult,
  clampRetention,
  median,
} from './scheduler.js';
import type { Card, Rating } from './types.js';

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

let scheduler = createScheduler();
beforeEach(() => {
  scheduler = createScheduler({ enableFuzz: false });
});

function review(card: Card, rating: Rating, now: number) {
  return reviewCard(scheduler, {
    card,
    rating,
    now,
    durationMs: 2000,
    exercise: 'flashcard',
  });
}

describe('newCard', () => {
  it('starts in the New state with no history', () => {
    const c = newCard('lx_1', 'recall_he_en', T0);
    expect(c.fsrs.state).toBe(0);
    expect(c.fsrs.reps).toBe(0);
    expect(c.fsrs.lapses).toBe(0);
    expect(c.isLeech).toBe(false);
  });

  it('derives a deterministic id from lexeme and template', () => {
    expect(newCard('lx_1', 'recall_he_en', T0).id).toBe('lx_1:recall_he_en');
    expect(newCard('lx_1', 'recall_en_he', T0).id).not.toBe(newCard('lx_1', 'recall_he_en', T0).id);
  });
});

describe('reviewCard', () => {
  it('does not mutate the card it is given', () => {
    const card = newCard('lx_1', 'recall_he_en', T0);
    const snapshot = structuredClone(card);
    review(card, 3, T0);
    expect(card).toEqual(snapshot);
  });

  it('advances reps and records a review timestamp', () => {
    const { card } = review(newCard('lx_1', 'recall_he_en', T0), 3, T0);
    expect(card.fsrs.reps).toBe(1);
    expect(card.fsrs.last_review).toBe(T0);
    expect(card.introducedAt).toBe(T0);
  });

  it('schedules the card into the future', () => {
    const { card } = review(newCard('lx_1', 'recall_he_en', T0), 3, T0);
    expect(card.fsrs.due).toBeGreaterThan(T0);
  });

  it('writes a log row capturing the state *before* the review', () => {
    const first = review(newCard('lx_1', 'recall_he_en', T0), 3, T0);
    const second = review(first.card, 3, T0 + 3 * DAY);
    expect(second.log.stability).toBe(first.card.fsrs.stability);
    expect(second.log.state).toBe(first.card.fsrs.state);
    expect(second.log.review).toBe(T0 + 3 * DAY);
  });

  it('counts lapses when a mature card is failed', () => {
    let card = newCard('lx_1', 'recall_he_en', T0);
    let t = T0;
    for (let i = 0; i < 4; i++) {
      card = review(card, 3, t).card;
      t = card.fsrs.due;
    }
    const lapsesBefore = card.fsrs.lapses;
    card = review(card, 1, t).card;
    expect(card.fsrs.lapses).toBe(lapsesBefore + 1);
  });

  it('tracks consecutive Again ratings and resets on a pass', () => {
    let card = newCard('lx_1', 'recall_he_en', T0);
    card = review(card, 1, T0).card;
    expect(card.againStreak).toBe(1);
    card = review(card, 1, T0 + 60_000).card;
    expect(card.againStreak).toBe(2);
    card = review(card, 3, T0 + 120_000).card;
    expect(card.againStreak).toBe(0);
  });
});

describe('reviewCard with countsForScheduling: false', () => {
  it('leaves the schedule completely untouched', () => {
    const card = review(newCard('lx_1', 'recall_he_en', T0), 3, T0).card;
    const { card: after, log } = reviewCard(scheduler, {
      card,
      rating: 3,
      now: T0 + 60_000,
      durationMs: 1500,
      exercise: 'matching',
      countsForScheduling: false,
    });
    expect(after.fsrs).toEqual(card.fsrs);
    expect(log.countsForScheduling).toBe(false);
  });

  it('still logs the attempt, so drill performance is measurable', () => {
    const card = newCard('lx_1', 'recall_he_en', T0);
    const { log } = reviewCard(scheduler, {
      card,
      rating: 1,
      now: T0,
      durationMs: 900,
      exercise: 'speed',
      countsForScheduling: false,
    });
    expect(log.exercise).toBe('speed');
    expect(log.rating).toBe(1);
  });

  it('still tracks the Again streak, so drills can feed leech detection', () => {
    const card = newCard('lx_1', 'recall_he_en', T0);
    const { card: after } = reviewCard(scheduler, {
      card,
      rating: 1,
      now: T0,
      durationMs: 900,
      exercise: 'speed',
      countsForScheduling: false,
    });
    expect(after.againStreak).toBe(1);
  });
});

describe('interval ordering', () => {
  it('gives longer intervals for better ratings on a mature card', () => {
    let card = newCard('lx_1', 'recall_he_en', T0);
    let t = T0;
    for (let i = 0; i < 3; i++) {
      card = review(card, 3, t).card;
      t = card.fsrs.due;
    }
    const p = previewIntervals(scheduler, card, t);
    expect(p[1].days).toBeLessThanOrEqual(p[2].days);
    expect(p[2].days).toBeLessThanOrEqual(p[3].days);
    expect(p[3].days).toBeLessThanOrEqual(p[4].days);
  });

  it('holds that ordering across many random review histories', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Rating>(1, 2, 3, 4), { minLength: 1, maxLength: 15 }),
        (ratings) => {
          let card = newCard('lx_prop', 'recall_he_en', T0);
          let t = T0;
          for (const r of ratings) {
            card = review(card, r, t).card;
            t = Math.max(card.fsrs.due, t + 60_000);
          }
          const p = previewIntervals(scheduler, card, t);
          expect(p[1].days).toBeLessThanOrEqual(p[2].days + 1e-9);
          expect(p[2].days).toBeLessThanOrEqual(p[3].days + 1e-9);
          expect(p[3].days).toBeLessThanOrEqual(p[4].days + 1e-9);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('scheduling invariants', () => {
  it('never produces NaN, negative stability, or a due date in the past', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<Rating>(1, 2, 3, 4), { minLength: 1, maxLength: 40 }),
        (ratings) => {
          let card = newCard('lx_prop', 'recall_he_en', T0);
          let t = T0;
          for (const r of ratings) {
            const out = review(card, r, t);
            card = out.card;

            expect(Number.isFinite(card.fsrs.stability)).toBe(true);
            expect(Number.isFinite(card.fsrs.difficulty)).toBe(true);
            expect(Number.isFinite(card.fsrs.due)).toBe(true);
            expect(card.fsrs.stability).toBeGreaterThan(0);
            expect(card.fsrs.difficulty).toBeGreaterThanOrEqual(1);
            expect(card.fsrs.difficulty).toBeLessThanOrEqual(10);
            expect(card.fsrs.due).toBeGreaterThanOrEqual(t);
            expect(card.fsrs.reps).toBeGreaterThan(0);

            t = Math.max(card.fsrs.due, t + 60_000);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('keeps retrievability inside [0, 1]', () => {
    let card = newCard('lx_1', 'recall_he_en', T0);
    card = review(card, 3, T0).card;
    for (const offset of [0, DAY, 30 * DAY, 3650 * DAY]) {
      const r = retrievability(scheduler, card, card.fsrs.due + offset);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });

  it('reports retrievability decaying over time', () => {
    let card = newCard('lx_1', 'recall_he_en', T0);
    card = review(card, 3, T0).card;
    card = review(card, 3, card.fsrs.due).card;
    const soon = retrievability(scheduler, card, card.fsrs.due);
    const later = retrievability(scheduler, card, card.fsrs.due + 60 * DAY);
    expect(later).toBeLessThan(soon);
  });
});

describe('clampRetention', () => {
  it('keeps sane values and rejects absurd ones', () => {
    expect(clampRetention(0.9)).toBe(0.9);
    expect(clampRetention(0.999)).toBeLessThanOrEqual(0.98);
    expect(clampRetention(0.1)).toBeGreaterThanOrEqual(0.7);
    expect(clampRetention(Number.NaN)).toBe(0.9);
  });
});

describe('gradeFromResult', () => {
  const base = { elapsedMs: 2000, medianMs: 2000, usedHint: false, exercise: 'type' as const };

  it('grades a wrong answer as Again regardless of speed', () => {
    expect(gradeFromResult({ ...base, correct: false, elapsedMs: 200 })).toBe(1);
    expect(gradeFromResult({ ...base, correct: false, elapsedMs: 30_000 })).toBe(1);
  });

  it('caps a hinted answer at Hard', () => {
    expect(gradeFromResult({ ...base, correct: true, usedHint: true, elapsedMs: 100 })).toBe(2);
  });

  it('grades a slow correct answer as Hard', () => {
    expect(gradeFromResult({ ...base, correct: true, elapsedMs: 20_000 })).toBe(2);
  });

  it('grades a normal correct answer as Good', () => {
    expect(gradeFromResult({ ...base, correct: true, elapsedMs: 2000 })).toBe(3);
  });

  it('awards Easy only on production exercises', () => {
    expect(gradeFromResult({ ...base, correct: true, elapsedMs: 400, exercise: 'type' })).toBe(4);
    // A fast correct answer on a 4-option question may be a lucky guess.
    expect(gradeFromResult({ ...base, correct: true, elapsedMs: 400, exercise: 'choice' })).toBe(3);
    expect(gradeFromResult({ ...base, correct: true, elapsedMs: 400, exercise: 'matching' })).toBe(3);
  });

  it('uses a floor so fast learners are not punished for normal speed', () => {
    // Median 500ms would make 2s "slow" without the floor.
    expect(gradeFromResult({ ...base, correct: true, medianMs: 500, elapsedMs: 2000 })).toBe(3);
  });

  it('always returns a valid rating for arbitrary timings', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 600_000 }),
        fc.integer({ min: 0, max: 60_000 }),
        fc.boolean(),
        (correct, elapsedMs, medianMs, usedHint) => {
          const r = gradeFromResult({ correct, elapsedMs, medianMs, usedHint, exercise: 'type' });
          expect([1, 2, 3, 4]).toContain(r);
        },
      ),
    );
  });
});

describe('median', () => {
  it('handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});
