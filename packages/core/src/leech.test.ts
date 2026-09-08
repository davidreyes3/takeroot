import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  assessLeech,
  buildDrillSequence,
  buildGymPlan,
  graduatesFromGym,
  DEFAULT_LEECH_POLICY,
} from './leech.js';
import { newCard } from './scheduler.js';
import type { Card, Lexeme, Rating, ReviewLog } from './types.js';

const T0 = Date.UTC(2026, 0, 1);

function card(overrides: Partial<Card> = {}): Card {
  const base = newCard('lx_1', 'recall_he_en', T0);
  return { ...base, ...overrides, fsrs: { ...base.fsrs, ...(overrides.fsrs ?? {}) } };
}

function log(rating: Rating, counts = true): ReviewLog {
  return {
    id: `rl_${Math.random()}`,
    cardId: 'lx_1:recall_he_en',
    lexemeId: 'lx_1',
    rating,
    state: 2,
    due: T0,
    stability: 5,
    difficulty: 5,
    elapsed_days: 1,
    last_elapsed_days: 1,
    scheduled_days: 1,
    review: T0,
    durationMs: 2000,
    exercise: 'flashcard',
    countsForScheduling: counts,
  };
}

const lexeme: Lexeme = {
  id: 'lx_1',
  lemma: 'קָטָן',
  lemmaBare: 'קטן',
  translit: { value: 'katan', provenance: 'derived' },
  glosses: ['small'],
  pos: 'adj',
  root: { value: ['ק', 'ט', 'נ'], provenance: 'authored' },
  forms: {},
  examples: [],
  tags: [],
  unit: 1,
  group: 'Test',
  sourceFile: 'test.md',
  sourceLine: 1,
};

describe('assessLeech', () => {
  it('clears a healthy card', () => {
    expect(assessLeech(card(), [log(3), log(3), log(3)]).isLeech).toBe(false);
  });

  it('flags a card on consecutive failures', () => {
    const v = assessLeech(card({ againStreak: 3 }), []);
    expect(v).toMatchObject({ isLeech: true, reason: 'again_streak' });
  });

  it('flags a card on two Agains in a row, not three', () => {
    // Missing the same card twice in one sitting is already good evidence,
    // not something that should need a third failure to act on.
    expect(assessLeech(card({ againStreak: 2 }), []).isLeech).toBe(true);
    expect(assessLeech(card({ againStreak: 1 }), []).isLeech).toBe(false);
  });

  it('flags a card that has accumulated lapses', () => {
    const v = assessLeech(card({ fsrs: { ...card().fsrs, lapses: 4 } }), []);
    expect(v).toMatchObject({ isLeech: true, reason: 'lapses' });
  });

  it('flags a card with poor rolling accuracy over a full window', () => {
    const logs = [log(1), log(1), log(3), log(1), log(1), log(3)]; // 2/6
    const v = assessLeech(card(), logs);
    expect(v).toMatchObject({ isLeech: true, reason: 'low_accuracy' });
  });

  it('does not judge accuracy before the window is full', () => {
    expect(assessLeech(card(), [log(1), log(1), log(1)]).isLeech).toBe(false);
  });

  it('ignores drill rows when judging accuracy', () => {
    // Six failed *drill* attempts must not by themselves condemn the card.
    const drills = Array.from({ length: 6 }, () => log(1, false));
    expect(assessLeech(card(), drills).isLeech).toBe(false);
  });

  it('never flags a suspended card', () => {
    expect(assessLeech(card({ suspended: true, againStreak: 9 }), []).isLeech).toBe(false);
  });

  it('combines lapses with the opposite-direction card when given a companion count', () => {
    // Neither direction alone has reached the threshold of 4, but a word
    // forgotten twice reading it and twice producing it has been forgotten
    // four times - it shouldn't matter which direction failed.
    const v = assessLeech(card({ fsrs: { ...card().fsrs, lapses: 2 } }), [], DEFAULT_LEECH_POLICY, 2);
    expect(v).toMatchObject({ isLeech: true, reason: 'lapses', totalLapses: 4 });
  });

  it('does not combine lapses when no companion count is given', () => {
    const v = assessLeech(card({ fsrs: { ...card().fsrs, lapses: 2 } }), []);
    expect(v.isLeech).toBe(false);
    expect(v.totalLapses).toBe(2);
  });

  it('reports total lapses even on a healthy card, for callers that want it', () => {
    const v = assessLeech(card({ fsrs: { ...card().fsrs, lapses: 1 } }), [], DEFAULT_LEECH_POLICY, 1);
    expect(v.isLeech).toBe(false);
    expect(v.totalLapses).toBe(2);
  });

  it('reports severity in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50 }),
        fc.integer({ min: 0, max: 50 }),
        (lapses, streak) => {
          const v = assessLeech(
            card({ againStreak: streak, fsrs: { ...card().fsrs, lapses } }),
            [],
            DEFAULT_LEECH_POLICY,
          );
          expect(v.severity).toBeGreaterThanOrEqual(0);
          expect(v.severity).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('buildDrillSequence', () => {
  it('interleaves the target at expanding gaps', () => {
    const seq = buildDrillSequence(['T'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    // gaps 0, 1, 2, 4 -> T a T b c T d e f g T
    expect(seq).toEqual(['T', 'a', 'T', 'b', 'c', 'T', 'd', 'e', 'f', 'g', 'T']);
  });

  it('shows the target the requested number of times', () => {
    const seq = buildDrillSequence(['T'], ['a', 'b', 'c'], 4);
    expect(seq.filter((x) => x === 'T')).toHaveLength(4);
  });

  it('increases the gap between successive target appearances', () => {
    const seq = buildDrillSequence(['T'], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const positions = seq.reduce<number[]>((acc, x, i) => (x === 'T' ? [...acc, i] : acc), []);
    const gaps = positions.slice(1).map((p, i) => p - (positions[i] as number));
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i] as number).toBeGreaterThanOrEqual(gaps[i - 1] as number);
    }
  });

  it('cycles a short filler pool instead of running out', () => {
    const seq = buildDrillSequence(['T'], ['a']);
    expect(seq.filter((x) => x === 'T')).toHaveLength(4);
    expect(seq.every((x) => x === 'T' || x === 'a')).toBe(true);
  });

  it('terminates with no fillers at all', () => {
    expect(buildDrillSequence(['T'], [])).toEqual(['T', 'T', 'T', 'T']);
  });

  it('is bounded no matter what repeat count is asked for', () => {
    fc.assert(
      fc.property(fc.integer({ min: -100, max: 10_000 }), (repeats) => {
        const seq = buildDrillSequence(['T'], ['a', 'b'], repeats);
        expect(seq.length).toBeGreaterThan(0);
        expect(seq.length).toBeLessThan(100);
      }),
    );
  });
});

describe('buildGymPlan', () => {
  const fillers = ['c1', 'c2', 'c3', 'c4', 'c5'];

  it('always starts with study and ends with a counting production test', () => {
    const plan = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.5 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(plan.steps[0]?.kind).toBe('study');
    const last = plan.steps[plan.steps.length - 1];
    expect(last?.kind).toBe('final_test');
    expect(last?.exercise).toBe('type');
    expect(last?.countsForScheduling).toBe(true);
  });

  it('marks every step except the final test as not counting', () => {
    const plan = buildGymPlan({
      card: card({ fsrs: { ...card().fsrs, lapses: 5 } }),
      lexeme,
      verdict: { isLeech: true, reason: 'lapses', severity: 0.9 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    const counting = plan.steps.filter((s) => s.countsForScheduling);
    expect(counting).toHaveLength(1);
    expect(counting[0]?.kind).toBe('final_test');
  });

  it('offers the mnemonic step only once repetition has already failed', () => {
    const mild = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.2 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(mild.steps.some((s) => s.kind === 'mnemonic')).toBe(false);

    const severe = buildGymPlan({
      card: card({ fsrs: { ...card().fsrs, lapses: 5 } }),
      lexeme,
      verdict: { isLeech: true, reason: 'lapses', severity: 0.9 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(severe.steps.some((s) => s.kind === 'mnemonic')).toBe(true);
  });

  it('offers the mnemonic on combined lapses even when severity alone would not ask for it', () => {
    // Severity here (0.2) is well under the 0.5 that would trigger a
    // mnemonic on its own, and this card's *own* lapses (1) are under the
    // old threshold of 3 too - but totalLapses, combining both recognition
    // directions, has reached 3. It shouldn't matter which direction failed.
    const plan = buildGymPlan({
      card: card({ fsrs: { ...card().fsrs, lapses: 1 } }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.2, totalLapses: 3 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(plan.steps.some((s) => s.kind === 'mnemonic')).toBe(true);
  });

  it('falls back to the card\'s own lapses when a hand-built verdict has no totalLapses', () => {
    const plan = buildGymPlan({
      card: card({ fsrs: { ...card().fsrs, lapses: 3 } }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.2 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(plan.steps.some((s) => s.kind === 'mnemonic')).toBe(true);
  });

  it('does not ask for a mnemonic the word already has', () => {
    const withMnemonic: Lexeme = {
      ...lexeme,
      mnemonic: { keyword: 'cotton', image: 'a tiny cotton ball', createdAt: T0, shownCount: 0 },
    };
    const plan = buildGymPlan({
      card: card({ fsrs: { ...card().fsrs, lapses: 5 } }),
      lexeme: withMnemonic,
      verdict: { isLeech: true, reason: 'lapses', severity: 0.9 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(plan.steps.some((s) => s.kind === 'mnemonic')).toBe(false);
  });

  it('withholds the timed speed round at low severity', () => {
    const plan = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.3 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
    });
    expect(plan.steps.some((s) => s.kind === 'speed')).toBe(false);
  });

  it('skips matching when there are not enough other words to fill a grid', () => {
    const plan = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.5 },
      fillerCardIds: [],
      matchingPoolIds: [],
    });
    expect(plan.steps.some((s) => s.kind === 'matching')).toBe(false);
    // ...but the plan is still coherent.
    expect(plan.steps[0]?.kind).toBe('study');
    expect(plan.steps[plan.steps.length - 1]?.kind).toBe('final_test');
  });
});

describe('graduatesFromGym', () => {
  it('requires a passing grade on the production test', () => {
    expect(graduatesFromGym(1)).toBe(false);
    expect(graduatesFromGym(2)).toBe(false);
    expect(graduatesFromGym(3)).toBe(true);
    expect(graduatesFromGym(4)).toBe(true);
  });
});

describe('the drill alternates direction', () => {
  it('rotates through the target variants instead of repeating one prompt', () => {
    // he->en, then en->he, then round again.
    const seq = buildDrillSequence(['T:he_en', 'T:en_he'], []);
    expect(seq).toEqual(['T:he_en', 'T:en_he', 'T:he_en', 'T:en_he']);
  });

  it('still works with no filler words at all', () => {
    // A brand-new collection has nothing else to interleave. The drill is
    // still useful because each repetition asks a different question.
    const seq = buildDrillSequence(['T:he_en', 'T:en_he'], []);
    expect(seq).toHaveLength(4);
    expect(new Set(seq).size).toBe(2);
  });

  it('combines alternation with expanding gaps when filler exists', () => {
    const seq = buildDrillSequence(['T1', 'T2'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(seq).toEqual(['T1', 'a', 'T2', 'b', 'c', 'T1', 'd', 'e', 'f', 'g', 'T2']);
  });

  it('falls back to plain repetition when the word has only one card', () => {
    expect(buildDrillSequence(['T'], [])).toEqual(['T', 'T', 'T', 'T']);
  });

  it('returns nothing rather than breaking when given no variants', () => {
    expect(buildDrillSequence([], ['a', 'b'])).toEqual([]);
  });

  it('gives every variant a turn', () => {
    const seq = buildDrillSequence(['A', 'B', 'C'], [], 6);
    expect(seq).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });
});

describe('the gym when typing is switched off', () => {
  const fillers = ['c1', 'c2', 'c3', 'c4', 'c5'];

  it('still ends on one counting test, self-graded instead of typed', () => {
    // The gym has to end on something that reschedules the card, or a leech
    // never graduates. With typing off that becomes a self-graded recall.
    const plan = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.5 },
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
      typedFinalTest: false,
    });
    const last = plan.steps[plan.steps.length - 1];
    expect(last?.kind).toBe('final_test');
    expect(last?.exercise).toBe('flashcard');
    expect(last?.countsForScheduling).toBe(true);
    expect(plan.steps.filter((s) => s.countsForScheduling)).toHaveLength(1);
  });

  it('still grades the leech card itself, so the again-streak can reset', () => {
    // Grading a sibling instead would leave the flagged card's againStreak
    // untouched, and it would be dragged back into the gym every session.
    const plan = buildGymPlan({
      card: card({ againStreak: 3 }),
      lexeme,
      verdict: { isLeech: true, reason: 'again_streak', severity: 0.5 },
      targetVariantIds: ['lx_1:recall_he_en', 'lx_1:recall_en_he'],
      fillerCardIds: fillers,
      matchingPoolIds: fillers,
      typedFinalTest: false,
    });
    const last = plan.steps[plan.steps.length - 1];
    expect(last?.sequence).toEqual([plan.targetCardId]);
  });
});
