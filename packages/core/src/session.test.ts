import { describe, it, expect } from 'vitest';
import { buildSession, DEFAULT_SESSION_CONFIG } from './session.js';
import { cardsForLexeme, templatesFor, isUnlocked, syncCards, CARD_TIER } from './cards.js';
import { newCard, createScheduler, reviewCard } from './scheduler.js';
import type { Card, Lexeme, ReviewLog } from './types.js';

const T0 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function lexeme(id: string, overrides: Partial<Lexeme> = {}): Lexeme {
  return {
    id,
    lemma: 'קָטָן',
    lemmaBare: 'קטן',
    translit: { value: 'katan', provenance: 'derived' },
    glosses: ['small'],
    pos: 'adj',
    root: { value: ['ק', 'ט', 'נ'], provenance: 'authored' },
    forms: {
      ms: { value: 'קטן', provenance: 'derived' },
      fs: { value: 'קטנה', provenance: 'derived' },
      mp: { value: 'קטנים', provenance: 'derived' },
      fp: { value: 'קטנות', provenance: 'derived' },
    },
    examples: [],
    tags: [],
    unit: 1,
    group: 'Test',
    sourceFile: 'test.md',
    sourceLine: 1,
    ...overrides,
  };
}

function dueCard(lexemeId: string, dueAt: number, overrides: Partial<Card> = {}): Card {
  const base = newCard(lexemeId, 'recall_he_en', T0);
  return {
    ...base,
    ...overrides,
    fsrs: { ...base.fsrs, state: 2, stability: 5, difficulty: 5, reps: 3, due: dueAt, ...(overrides.fsrs ?? {}) },
  };
}

const noLogs = new Map<string, ReviewLog[]>();

describe('templatesFor', () => {
  it('generates recognition, production and agreement cards for an adjective', () => {
    const t = templatesFor(lexeme('lx_1'));
    expect(t).toEqual(
      expect.arrayContaining(['recall_he_en', 'recall_en_he', 'type_he', 'form_fs', 'form_mp', 'form_fp']),
    );
  });

  it('skips an agreement slot spelled identically to the base form', () => {
    // יפה: masculine and feminine singular are spelled the same.
    const yafe = lexeme('lx_y', {
      forms: {
        ms: { value: 'יפה', provenance: 'derived' },
        fs: { value: 'יפה', provenance: 'derived' },
        mp: { value: 'יפים', provenance: 'derived' },
        fp: { value: 'יפות', provenance: 'derived' },
      },
    });
    const t = templatesFor(yafe);
    expect(t).not.toContain('form_fs');
    expect(t).toContain('form_mp');
  });

  it('does not make you type out a whole phrase', () => {
    expect(templatesFor(lexeme('lx_p', { pos: 'phrase' }))).not.toContain('type_he');
  });

  it('adds a cloze card only when there is an example sentence', () => {
    expect(templatesFor(lexeme('lx_1'))).not.toContain('cloze');
    expect(
      templatesFor(lexeme('lx_2', { examples: [{ he: 'הכלב קטן', en: 'The dog is small' }] })),
    ).toContain('cloze');
  });
});

describe('syncCards', () => {
  it('creates cards for new words without duplicating existing ones', () => {
    const lx = lexeme('lx_1');
    const first = syncCards([lx], [], T0);
    expect(first.created.length).toBeGreaterThan(0);
    const second = syncCards([lx], first.created, T0);
    expect(second.created).toHaveLength(0);
  });

  it('reports orphans rather than deleting review history', () => {
    const existing = cardsForLexeme(lexeme('lx_gone'), T0);
    const { orphaned } = syncCards([lexeme('lx_1')], existing, T0);
    expect(orphaned).toHaveLength(existing.length);
  });
});

describe('isUnlocked', () => {
  it('always allows the tier-1 recognition card', () => {
    const c = newCard('lx_1', 'recall_he_en', T0);
    expect(isUnlocked(c, [c])).toBe(true);
  });

  it('holds back a tier-2 card until its tier-1 sibling has graduated', () => {
    const tier1 = newCard('lx_1', 'recall_he_en', T0); // state 0, New
    const tier2 = newCard('lx_1', 'type_he', T0);
    expect(isUnlocked(tier2, [tier1, tier2])).toBe(false);

    const graduated: Card = { ...tier1, fsrs: { ...tier1.fsrs, state: 2 } };
    expect(isUnlocked(tier2, [graduated, tier2])).toBe(true);
  });

  it('holds back a tier-3 agreement card until tier 2 is done too', () => {
    const tier1: Card = { ...newCard('lx_1', 'recall_he_en', T0), fsrs: { ...newCard('lx_1', 'recall_he_en', T0).fsrs, state: 2 } };
    const tier2 = newCard('lx_1', 'type_he', T0); // still New
    const tier3 = newCard('lx_1', 'form_fs', T0);
    expect(CARD_TIER.form_fs).toBe(3);
    expect(isUnlocked(tier3, [tier1, tier2, tier3])).toBe(false);
  });
});

describe('buildSession ordering', () => {
  it('opens with warm-up cards, not with a challenge', () => {
    const lexemes = Array.from({ length: 8 }, (_, i) => lexeme(`lx_${i}`));
    const cards = lexemes.map((l, i) => dueCard(l.id, T0 - (i + 1) * DAY));
    // Make one of them a leech.
    cards[0] = { ...(cards[0] as Card), fsrs: { ...(cards[0] as Card).fsrs, lapses: 6 } };

    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    expect(plan.items[0]?.kind).toBe('warmup');
    const firstGym = plan.items.findIndex((i) => i.kind === 'gym');
    const lastWarmup = plan.items.map((i) => i.kind).lastIndexOf('warmup');
    expect(firstGym).toBeGreaterThan(lastWarmup);
  });

  it('puts the gym before the ordinary backlog', () => {
    const lexemes = Array.from({ length: 10 }, (_, i) => lexeme(`lx_${i}`));
    const cards = lexemes.map((l, i) => dueCard(l.id, T0 - (i + 1) * DAY));
    cards[9] = { ...(cards[9] as Card), fsrs: { ...(cards[9] as Card).fsrs, lapses: 6 } };

    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    const firstGym = plan.items.findIndex((i) => i.kind === 'gym');
    const firstReview = plan.items.findIndex((i) => i.kind === 'review');
    expect(firstGym).toBeGreaterThanOrEqual(0);
    expect(firstGym).toBeLessThan(firstReview);
  });

  it('introduces new words last', () => {
    const lexemes = Array.from({ length: 6 }, (_, i) => lexeme(`lx_${i}`));
    const cards = [
      ...lexemes.slice(0, 3).map((l, i) => dueCard(l.id, T0 - (i + 1) * DAY)),
      ...lexemes.slice(3).map((l) => newCard(l.id, 'recall_he_en', T0)),
    ];
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    const kinds = plan.items.map((i) => i.kind);
    const lastNonNew = Math.max(kinds.lastIndexOf('warmup'), kinds.lastIndexOf('review'), kinds.lastIndexOf('gym'));
    const firstNew = kinds.indexOf('new');
    if (firstNew !== -1) expect(firstNew).toBeGreaterThan(lastNonNew);
  });
});

describe('buildSession limits', () => {
  it('never exceeds the review cap', () => {
    const lexemes = Array.from({ length: 500 }, (_, i) => lexeme(`lx_${i}`));
    const cards = lexemes.map((l, i) => dueCard(l.id, T0 - (i + 1) * 1000));
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    const reviewish = plan.items.filter((i) => i.kind === 'review' || i.kind === 'warmup');
    expect(reviewish.length).toBeLessThanOrEqual(DEFAULT_SESSION_CONFIG.maxReviews);
  });

  it('never exceeds the gym cap', () => {
    const lexemes = Array.from({ length: 30 }, (_, i) => lexeme(`lx_${i}`));
    const cards = lexemes.map((l, i) =>
      dueCard(l.id, T0 - (i + 1) * DAY, { fsrs: { ...dueCard(l.id, T0).fsrs, lapses: 9 } }),
    );
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    expect(plan.items.filter((i) => i.kind === 'gym').length).toBeLessThanOrEqual(
      DEFAULT_SESSION_CONFIG.maxGym,
    );
  });

  it('withholds new words when the backlog is out of control', () => {
    const lexemes = Array.from({ length: 200 }, (_, i) => lexeme(`lx_${i}`));
    const cards = [
      ...lexemes.slice(0, 150).map((l, i) => dueCard(l.id, T0 - (i + 1) * 1000)),
      ...lexemes.slice(150).map((l) => newCard(l.id, 'recall_he_en', T0)),
    ];
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    expect(plan.stats.newHeldBack).toBe(true);
    expect(plan.items.some((i) => i.kind === 'new')).toBe(false);
  });

  it('does introduce new words when the backlog is small', () => {
    const lexemes = Array.from({ length: 10 }, (_, i) => lexeme(`lx_${i}`));
    const cards = lexemes.map((l) => newCard(l.id, 'recall_he_en', T0));
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    expect(plan.stats.newHeldBack).toBe(false);
    expect(plan.items.filter((i) => i.kind === 'new').length).toBe(DEFAULT_SESSION_CONFIG.maxNew);
  });
});

describe('buildSession selection rules', () => {
  it('never shows two cards of the same word in one session', () => {
    const lx = lexeme('lx_1');
    const cards = cardsForLexeme(lx, T0).map((c) => ({
      ...c,
      fsrs: { ...c.fsrs, state: 2 as const, stability: 5, reps: 2, due: T0 - DAY },
    }));
    const plan = buildSession({ cards, lexemes: [lx], logsByCard: noLogs, now: T0 });
    expect(plan.items).toHaveLength(1);
  });

  it('skips suspended cards entirely', () => {
    const lx = lexeme('lx_1');
    const cards = [dueCard(lx.id, T0 - DAY, { suspended: true })];
    const plan = buildSession({ cards, lexemes: [lx], logsByCard: noLogs, now: T0 });
    expect(plan.items).toHaveLength(0);
  });

  it('skips cards whose word no longer exists in the content files', () => {
    const cards = [dueCard('lx_deleted', T0 - DAY)];
    const plan = buildSession({ cards, lexemes: [], logsByCard: noLogs, now: T0 });
    expect(plan.items).toHaveLength(0);
  });

  it('does not include cards that are not due yet', () => {
    const lx = lexeme('lx_1');
    const plan = buildSession({
      cards: [dueCard(lx.id, T0 + 5 * DAY)],
      lexemes: [lx],
      logsByCard: noLogs,
      now: T0,
    });
    expect(plan.items).toHaveLength(0);
  });

  it('attaches a gym plan to gym items and nothing else', () => {
    const lexemes = [lexeme('lx_0'), lexeme('lx_1')];
    const cards = [
      dueCard('lx_0', T0 - DAY),
      dueCard('lx_1', T0 - 2 * DAY, { fsrs: { ...dueCard('lx_1', T0).fsrs, lapses: 7 } }),
    ];
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0, config: { warmUpCount: 1 } });
    for (const item of plan.items) {
      if (item.kind === 'gym') expect(item.gymPlan).toBeDefined();
      else expect(item.gymPlan).toBeUndefined();
    }
  });

  it('picks the right exercise for each card template', () => {
    const lx = lexeme('lx_1');
    const typeCard: Card = {
      ...newCard(lx.id, 'type_he', T0),
      fsrs: { ...newCard(lx.id, 'type_he', T0).fsrs, state: 2, stability: 5, reps: 2, due: T0 - DAY },
    };
    const plan = buildSession({ cards: [typeCard], lexemes: [lx], logsByCard: noLogs, now: T0 });
    expect(plan.items[0]?.exercise).toBe('type');
  });
});

describe('buildSession stats', () => {
  it('reports counts that match reality', () => {
    const lexemes = Array.from({ length: 12 }, (_, i) => lexeme(`lx_${i}`));
    const cards = [
      ...lexemes.slice(0, 5).map((l, i) => dueCard(l.id, T0 - (i + 1) * DAY)),
      ...lexemes.slice(5, 7).map((l, i) =>
        dueCard(l.id, T0 - (i + 1) * DAY, { fsrs: { ...dueCard(l.id, T0).fsrs, lapses: 8 } }),
      ),
      ...lexemes.slice(7).map((l) => newCard(l.id, 'recall_he_en', T0)),
    ];
    const plan = buildSession({ cards, lexemes, logsByCard: noLogs, now: T0 });
    expect(plan.stats.leechCount).toBe(2);
    expect(plan.stats.dueCount).toBe(7);
    expect(plan.stats.newAvailable).toBe(5);
  });
});

describe('end to end: a card travels from new to scheduled', () => {
  it('graduates through the session queue', () => {
    const scheduler = createScheduler({ enableFuzz: false });
    const lx = lexeme('lx_1');
    let cards = cardsForLexeme(lx, T0);

    const plan = buildSession({ cards, lexemes: [lx], logsByCard: noLogs, now: T0 });
    expect(plan.items[0]?.kind).toBe('new');

    const first = cards.find((c) => c.id === plan.items[0]?.cardId) as Card;
    const { card: after } = reviewCard(scheduler, {
      card: first,
      rating: 3,
      now: T0,
      durationMs: 1800,
      exercise: 'flashcard',
    });
    cards = cards.map((c) => (c.id === after.id ? after : c));

    expect(after.fsrs.due).toBeGreaterThan(T0);
    // It should not come back in the same session.
    const replan = buildSession({ cards, lexemes: [lx], logsByCard: noLogs, now: T0 });
    expect(replan.items.some((i) => i.cardId === after.id)).toBe(false);
  });
});

describe('gym pool contains distinct words', () => {
  /**
   * Regression: the pool was built from cards, and a word owns several cards,
   * so the same word reached the matching grid more than once. Two identical
   * tiles greyed out together and the grid could never be completed.
   */
  function matureCard(lexemeId: string, template: Card['template']): Card {
    const c = newCard(lexemeId, template, T0);
    return { ...c, fsrs: { ...c.fsrs, state: 2, stability: 8, reps: 5, due: T0 + 30 * DAY } };
  }

  it('never offers two cards of the same word as distractors', () => {
    const lexemes = [lexeme('lx_leech'), ...Array.from({ length: 4 }, (_, i) => lexeme(`lx_${i}`))];

    // Every healthy word contributes three mature cards.
    const healthy = lexemes
      .slice(1)
      .flatMap((l) => [
        matureCard(l.id, 'recall_he_en'),
        matureCard(l.id, 'recall_en_he'),
        matureCard(l.id, 'type_he'),
      ]);

    const leech = dueCard('lx_leech', T0 - DAY, {
      fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 },
    });

    const plan = buildSession({
      cards: [leech, ...healthy],
      lexemes,
      logsByCard: noLogs,
      now: T0,
      config: { warmUpCount: 0 },
    });

    const gym = plan.items.find((i) => i.kind === 'gym');
    expect(gym?.gymPlan).toBeDefined();

    const cardToLexeme = new Map([leech, ...healthy].map((c) => [c.id, c.lexemeId]));
    for (const step of gym!.gymPlan!.steps) {
      if (step.kind !== 'matching') continue;
      const words = step.sequence.map((id) => cardToLexeme.get(id));
      expect(new Set(words).size).toBe(words.length);
    }
  });

  it('does not put the word being drilled in its own distractor list', () => {
    const lexemes = [lexeme('lx_leech'), ...Array.from({ length: 4 }, (_, i) => lexeme(`lx_${i}`))];
    const healthy = lexemes.slice(1).map((l) => matureCard(l.id, 'recall_he_en'));
    const leech = dueCard('lx_leech', T0 - DAY, {
      fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 },
    });

    const plan = buildSession({
      cards: [leech, ...healthy],
      lexemes,
      logsByCard: noLogs,
      now: T0,
      config: { warmUpCount: 0 },
    });

    const gym = plan.items.find((i) => i.kind === 'gym')!.gymPlan!;
    const matching = gym.steps.find((s) => s.kind === 'matching');
    // The target heads the sequence exactly once.
    expect(matching?.sequence.filter((id) => id === gym.targetCardId)).toHaveLength(1);
  });
});

describe('drill filler is spent on words that need it', () => {
  function withStats(lexemeId: string, lapses: number, difficulty: number): Card {
    const c = newCard(lexemeId, 'recall_he_en', T0);
    return {
      ...c,
      fsrs: { ...c.fsrs, state: 2, stability: 20, reps: 10, due: T0 + 30 * DAY, lapses, difficulty },
    };
  }

  function gymFor(cards: Card[], lexemes: Lexeme[]) {
    const plan = buildSession({
      cards,
      lexemes,
      logsByCard: noLogs,
      now: T0,
      config: { warmUpCount: 0 },
    });
    return plan.items.find((i) => i.kind === 'gym')?.gymPlan;
  }

  it('puts shaky words into the drill ahead of well-known ones', () => {
    const lexemes = [
      lexeme('lx_leech'),
      lexeme('lx_shaky1'),
      lexeme('lx_shaky2'),
      ...Array.from({ length: 8 }, (_, i) => lexeme(`lx_solid${i}`)),
    ];
    const cards = [
      dueCard('lx_leech', T0 - DAY, { fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 } }),
      withStats('lx_shaky1', 5, 8),
      withStats('lx_shaky2', 4, 7),
      ...Array.from({ length: 8 }, (_, i) => withStats(`lx_solid${i}`, 0, 2)),
    ];

    const gym = gymFor(cards, lexemes);
    const drill = gym?.steps.find((s) => s.kind === 'drill');
    const fillers = drill!.sequence.filter((id) => id !== gym!.targetCardId);

    expect(fillers.length).toBeGreaterThan(0);
    // Every interleaved item should be one of the struggling words, not the
    // eight solid ones, because the shaky pool is large enough to fill it.
    for (const id of fillers) {
      expect(['lx_shaky1:recall_he_en', 'lx_shaky2:recall_he_en']).toContain(id);
    }
  });

  it('falls back to known words when there are not enough shaky ones', () => {
    const lexemes = [lexeme('lx_leech'), ...Array.from({ length: 6 }, (_, i) => lexeme(`lx_solid${i}`))];
    const cards = [
      dueCard('lx_leech', T0 - DAY, { fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 } }),
      ...Array.from({ length: 6 }, (_, i) => withStats(`lx_solid${i}`, 0, 2)),
    ];

    const gym = gymFor(cards, lexemes);
    const drill = gym?.steps.find((s) => s.kind === 'drill');
    // Still a usable drill rather than an empty one.
    expect(drill!.sequence.length).toBeGreaterThan(4);
  });

  it('never uses another card of the target word as filler', () => {
    // A sibling card would show the answer mid-drill.
    const lexemes = [lexeme('lx_leech'), ...Array.from({ length: 5 }, (_, i) => lexeme(`lx_o${i}`))];
    const leechCard = dueCard('lx_leech', T0 - DAY, {
      fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 },
    });
    const sibling: Card = {
      ...newCard('lx_leech', 'type_he', T0),
      fsrs: { ...newCard('lx_leech', 'type_he', T0).fsrs, state: 2, stability: 9, reps: 4, due: T0 + DAY },
    };
    const cards = [leechCard, sibling, ...Array.from({ length: 5 }, (_, i) => withStats(`lx_o${i}`, 1, 5))];

    const gym = gymFor(cards, lexemes);
    for (const step of gym!.steps) {
      const fillers = step.sequence.filter((id) => id !== gym!.targetCardId);
      expect(fillers).not.toContain(sibling.id);
    }
  });

  it('never drills a word that has never been seen', () => {
    const lexemes = [lexeme('lx_leech'), ...Array.from({ length: 5 }, (_, i) => lexeme(`lx_new${i}`))];
    const cards = [
      dueCard('lx_leech', T0 - DAY, { fsrs: { ...dueCard('lx_leech', T0).fsrs, lapses: 9 } }),
      ...Array.from({ length: 5 }, (_, i) => newCard(`lx_new${i}`, 'recall_he_en', T0)),
    ];

    const gym = gymFor(cards, lexemes);
    const drill = gym!.steps.find((s) => s.kind === 'drill');
    const fillers = drill!.sequence.filter((id) => id !== gym!.targetCardId);
    expect(fillers).toHaveLength(0); // nothing known enough to interleave
  });
});
