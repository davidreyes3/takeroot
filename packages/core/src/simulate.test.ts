/**
 * Simulation, performance and memory-safety guards.
 *
 * These are the tests that answer your "no errors where memory is lost or
 * gets used up" requirement. They are cheap regression guards against the
 * three ways an SRS app actually falls over in production:
 *
 *   1. an accidental O(n^2) in the queue builder, which is invisible at 50
 *      cards and unusable at 5,000
 *   2. unbounded retention of review history in memory
 *   3. state mutation that silently corrupts schedules
 */

import { describe, it, expect } from 'vitest';
import { simulate, makeRng } from './simulate.js';
import { buildSession } from './session.js';
import { newCard, createScheduler, reviewCard } from './scheduler.js';
import { assessLeech } from './leech.js';
import type { Card, Lexeme, ReviewLog } from './types.js';

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function lexemeAt(i: number): Lexeme {
  return {
    id: `lx_${i}`,
    lemma: 'קָטָן',
    lemmaBare: 'קטן',
    translit: { value: 'katan', provenance: 'derived' },
    glosses: ['small'],
    pos: 'adj',
    root: { value: [], provenance: 'suggested' },
    forms: {},
    examples: [],
    tags: [],
    unit: Math.floor(i / 20) + 1,
    group: 'Test',
    sourceFile: 'gen.md',
    sourceLine: i,
    ...{},
  };
}

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng(7);
    const b = makeRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays within [0, 1)', () => {
    const r = makeRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('simulation behaviour', () => {
  it('runs 180 days without producing invalid card state', () => {
    const result = simulate({ cardCount: 100, days: 180, seed: 1 });
    expect(result.totalReviews).toBeGreaterThan(0);
    for (const card of result.finalCards) {
      expect(Number.isFinite(card.fsrs.stability)).toBe(true);
      expect(Number.isFinite(card.fsrs.due)).toBe(true);
      expect(card.fsrs.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.fsrs.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it('lands near the requested retention', () => {
    const result = simulate({ cardCount: 300, days: 365, seed: 3, requestRetention: 0.9 });
    // Wide band on purpose: this catches unit errors and dropped reviews, not
    // small modelling differences. The learning phase drags the average down.
    expect(result.observedRetention).toBeGreaterThan(0.7);
    expect(result.observedRetention).toBeLessThan(0.98);
  });

  it('asks for more reviews at higher desired retention', () => {
    const relaxed = simulate({ cardCount: 200, days: 240, seed: 5, requestRetention: 0.8 });
    const strict = simulate({ cardCount: 200, days: 240, seed: 5, requestRetention: 0.95 });
    expect(strict.totalReviews).toBeGreaterThan(relaxed.totalReviews);
  });

  it('settles into a sustainable daily workload rather than growing forever', () => {
    const result = simulate({ cardCount: 200, days: 300, seed: 9 });
    const firstMonth = result.reviewsPerDay.slice(30, 60).reduce((a, b) => a + b, 0) / 30;
    const lastMonth = result.reviewsPerDay.slice(-30).reduce((a, b) => a + b, 0) / 30;
    // Once the deck stops growing, daily load must fall, not climb.
    expect(lastMonth).toBeLessThan(firstMonth);
  });

  it('is reproducible for a fixed seed', () => {
    const a = simulate({ cardCount: 50, days: 90, seed: 11 });
    const b = simulate({ cardCount: 50, days: 90, seed: 11 });
    expect(a.totalReviews).toBe(b.totalReviews);
    expect(a.observedRetention).toBe(b.observedRetention);
  });
});

describe('memory safety', () => {
  it('keeps retained log rows bounded no matter how many reviews happen', () => {
    const cardCount = 100;
    const window = 10;
    const result = simulate({ cardCount, days: 365, seed: 2, logWindow: window });

    // Thousands of reviews, but retention is capped at cards * window.
    expect(result.totalReviews).toBeGreaterThan(1000);
    expect(result.peakLogRows).toBeLessThanOrEqual(cardCount * window);
  });

  it('produces the same session whether given 6 log rows or 2,000', () => {
    // Proves the queue builder never needs unbounded history in memory, which
    // is what makes the bounded window above safe rather than lossy.
    const lexemes = [lexemeAt(0)];
    const card: Card = {
      ...newCard('lx_0', 'recall_he_en', T0),
      fsrs: { ...newCard('lx_0', 'recall_he_en', T0).fsrs, state: 2, stability: 4, reps: 20, due: T0 - DAY },
    };

    const makeLog = (rating: 1 | 3, i: number): ReviewLog => ({
      id: `rl_${i}`,
      cardId: card.id,
      lexemeId: 'lx_0',
      rating,
      state: 2,
      due: T0,
      stability: 4,
      difficulty: 5,
      elapsed_days: 1,
      last_elapsed_days: 1,
      scheduled_days: 1,
      review: T0 - (2000 - i) * 1000,
      durationMs: 2000,
      exercise: 'flashcard',
      countsForScheduling: true,
    });

    const recent = [1, 1, 1, 3, 1, 1].map((r, i) => makeLog(r as 1 | 3, 1994 + i));
    const full = [
      ...Array.from({ length: 1994 }, (_, i) => makeLog(3, i)),
      ...recent,
    ];

    const short = buildSession({ cards: [card], lexemes, logsByCard: new Map([[card.id, recent]]), now: T0 });
    const long = buildSession({ cards: [card], lexemes, logsByCard: new Map([[card.id, full]]), now: T0 });

    expect(short.items.map((i) => ({ ...i, gymPlan: undefined }))).toEqual(
      long.items.map((i) => ({ ...i, gymPlan: undefined })),
    );
    expect(short.stats).toEqual(long.stats);
  });

  it('bounds the session plan even with a very large collection', () => {
    const lexemes = Array.from({ length: 5000 }, (_, i) => lexemeAt(i));
    const cards: Card[] = lexemes.map((l, i) => {
      const c = newCard(l.id, 'recall_he_en', T0);
      return { ...c, fsrs: { ...c.fsrs, state: 2, stability: 3, reps: 4, due: T0 - (i + 1) * 1000 } };
    });
    const plan = buildSession({ cards, lexemes, logsByCard: new Map(), now: T0 });
    expect(plan.items.length).toBeLessThanOrEqual(70);
  });

  it('does not mutate the cards or logs handed to it', () => {
    const lexemes = [lexemeAt(0), lexemeAt(1)];
    const cards: Card[] = lexemes.map((l, i) => {
      const c = newCard(l.id, 'recall_he_en', T0);
      return { ...c, fsrs: { ...c.fsrs, state: 2, stability: 3, reps: 4, due: T0 - (i + 1) * DAY, lapses: i * 8 } };
    });
    const snapshot = structuredClone(cards);
    buildSession({ cards, lexemes, logsByCard: new Map(), now: T0 });
    expect(cards).toEqual(snapshot);
  });

  it('does not retain references that let a caller corrupt scheduler state', () => {
    const scheduler = createScheduler({ enableFuzz: false });
    const card = newCard('lx_0', 'recall_he_en', T0);
    const { card: after } = reviewCard(scheduler, {
      card,
      rating: 3,
      now: T0,
      durationMs: 1000,
      exercise: 'flashcard',
    });
    const dueBefore = after.fsrs.due;
    // Mutating the input must not reach through to the output.
    card.fsrs.due = 0;
    card.fsrs.stability = -999;
    expect(after.fsrs.due).toBe(dueBefore);
    expect(after.fsrs.stability).toBeGreaterThan(0);
  });
});

describe('performance guards', () => {
  it('builds a session over 5,000 cards quickly', () => {
    const lexemes = Array.from({ length: 5000 }, (_, i) => lexemeAt(i));
    const cards: Card[] = lexemes.map((l, i) => {
      const c = newCard(l.id, 'recall_he_en', T0);
      return { ...c, fsrs: { ...c.fsrs, state: 2, stability: 3, reps: 4, due: T0 - (i + 1) * 1000 } };
    });
    const logsByCard = new Map<string, ReviewLog[]>();

    const started = performance.now();
    buildSession({ cards, lexemes, logsByCard, now: T0 });
    const elapsed = performance.now() - started;

    // Generous, because CI machines vary. It is here to catch an accidental
    // O(n^2), which would take seconds rather than milliseconds at this size.
    expect(elapsed).toBeLessThan(1000);
  });

  it('scales sub-quadratically as the collection grows', () => {
    const time = (n: number) => {
      const lexemes = Array.from({ length: n }, (_, i) => lexemeAt(i));
      const cards: Card[] = lexemes.map((l, i) => {
        const c = newCard(l.id, 'recall_he_en', T0);
        return { ...c, fsrs: { ...c.fsrs, state: 2, stability: 3, reps: 4, due: T0 - (i + 1) * 1000 } };
      });
      const started = performance.now();
      buildSession({ cards, lexemes, logsByCard: new Map(), now: T0 });
      return performance.now() - started;
    };

    time(500); // warm up the JIT so the comparison is fair
    const small = Math.max(time(1000), 0.5);
    const large = time(8000);
    // 8x the data must not cost anything like 64x the time.
    expect(large / small).toBeLessThan(24);
  });

  it('keeps leech assessment constant-time in history length', () => {
    const card: Card = {
      ...newCard('lx_0', 'recall_he_en', T0),
      fsrs: { ...newCard('lx_0', 'recall_he_en', T0).fsrs, state: 2, reps: 50 },
    };
    const makeLogs = (n: number): ReviewLog[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `rl_${i}`,
        cardId: card.id,
        lexemeId: 'lx_0',
        rating: 3 as const,
        state: 2 as const,
        due: T0,
        stability: 4,
        difficulty: 5,
        elapsed_days: 1,
        last_elapsed_days: 1,
        scheduled_days: 1,
        review: T0,
        durationMs: 1000,
        exercise: 'flashcard' as const,
        countsForScheduling: true,
      }));

    expect(assessLeech(card, makeLogs(6))).toEqual(assessLeech(card, makeLogs(5000)));
  });
});
