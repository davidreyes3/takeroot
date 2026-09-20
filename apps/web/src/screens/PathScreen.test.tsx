import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Card, CardTemplate, Lexeme } from '@lang/core';
import { newCard } from '@lang/core';
import { packLessons, buildPath, buildUnits, chooseOpenUnit, LessonPath } from './PathScreen.js';
import type { UnitSummary } from './PathScreen.js';

afterEach(cleanup);

const DAY = 24 * 60 * 60 * 1000;

const T0 = Date.UTC(2026, 0, 1);

function word(id: string, group: string, unit = 1): Lexeme {
  return {
    id,
    lemma: 'קָטָן',
    lemmaBare: 'קטן',
    translit: { value: 'katan', provenance: 'derived' },
    glosses: [id],
    pos: 'adj',
    root: { value: [], provenance: 'suggested' },
    forms: {},
    examples: [],
    tags: [],
    unit,
    group,
    sourceFile: 'test.md',
    sourceLine: 1,
  };
}

function group(name: string, count: number, unit = 1): Lexeme[] {
  return Array.from({ length: count }, (_, i) => word(`${name}-${i}`, name, unit));
}

/**
 * Cards for a set of words: one recall_he_en each, since that is what mastery
 * is read from, plus whatever answer history a test needs.
 */
function cardsWith(
  words: readonly Lexeme[],
  options: {
    mastered?: readonly string[];
    /** lexeme id -> when it was last answered. */
    studied?: Record<string, number>;
    /** Which card the answer landed on. Defaults to the one mastery reads. */
    studiedTemplate?: CardTemplate;
  } = {},
): Map<string, Card> {
  const { mastered = [], studied = {}, studiedTemplate = 'recall_he_en' } = options;
  const map = new Map<string, Card>();
  for (const w of words) {
    const base = newCard(w.id, 'recall_he_en', T0);
    map.set(base.id, mastered.includes(w.id) ? { ...base, fsrs: { ...base.fsrs, state: 2 } } : base);
  }
  for (const [id, at] of Object.entries(studied)) {
    const existing = map.get(`${id}:${studiedTemplate}`) ?? newCard(id, studiedTemplate, T0);
    map.set(existing.id, { ...existing, fsrs: { ...existing.fsrs, last_review: at } });
  }
  return map;
}

describe('packLessons', () => {
  it('keeps a well-sized group as its own lesson, named for the heading', () => {
    const lessons = packLessons([...group('Greetings', 6), ...group('Pronouns', 6)]);
    expect(lessons.map((l) => l.title)).toEqual(['Greetings', 'Pronouns']);
    expect(lessons.map((l) => l.lexemes.length)).toEqual([6, 6]);
  });

  it('never mixes two groups that are both big enough to stand alone', () => {
    const lessons = packLessons([...group('Greetings', 5), ...group('Colours', 5)]);
    for (const lesson of lessons) {
      expect(new Set(lesson.lexemes.map((l) => l.group)).size).toBe(1);
    }
  });

  it('absorbs a group too small to stand alone into the one before it', () => {
    const lessons = packLessons([...group('Greetings', 5), ...group('Yes and no', 2)]);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.title).toBe('Greetings & Yes and no');
    expect(lessons[0]?.lexemes).toHaveLength(7);
  });

  it('splits a group too large for one sitting into numbered parts', () => {
    const lessons = packLessons(group('Colours', 14));
    expect(lessons.map((l) => l.title)).toEqual(['Colours 1', 'Colours 2']);
    expect(lessons.map((l) => l.lexemes.length)).toEqual([7, 7]);
  });

  it('never leaves a tail small enough to finish in two answers', () => {
    // Regression: unit 1 used to end in a two-word lesson that completed
    // almost immediately, so the path showed a later node as done while the
    // learner was still on the first one.
    for (const total of [9, 10, 11, 13, 17, 21, 26]) {
      const lessons = packLessons(group('Words', total));
      for (const lesson of lessons) {
        expect(lesson.lexemes.length, `total ${total}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('caps every lesson at eight words', () => {
    for (const total of [9, 12, 20, 33, 50]) {
      for (const lesson of packLessons(group('Words', total))) {
        expect(lesson.lexemes.length, `total ${total}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('loses no words, whatever the shape of the input', () => {
    const words = [
      ...group('A', 3),
      ...group('B', 9),
      ...group('C', 1),
      ...group('D', 6),
      ...group('E', 2),
    ];
    const lessons = packLessons(words);
    const packed = lessons.flatMap((l) => l.lexemes.map((x) => x.id));
    expect(packed).toHaveLength(words.length);
    expect(new Set(packed).size).toBe(words.length);
  });

  it('preserves the order words were written in', () => {
    const words = [...group('A', 5), ...group('B', 5)];
    const packed = packLessons(words).flatMap((l) => l.lexemes.map((x) => x.id));
    expect(packed).toEqual(words.map((w) => w.id));
  });

  it('handles an empty unit', () => {
    expect(packLessons([])).toEqual([]);
  });

  it('keeps a single small group rather than dropping it', () => {
    const lessons = packLessons(group('Only', 2));
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.lexemes).toHaveLength(2);
  });
});

describe('buildPath', () => {
  const words = [...group('Greetings', 6), ...group('Pronouns', 6), ...group('Colours', 6, 2)];

  function cardsFor(mastered: string[]): Map<string, Card> {
    const map = new Map<string, Card>();
    for (const w of words) {
      const c = newCard(w.id, 'recall_he_en', T0);
      map.set(c.id, mastered.includes(w.id) ? { ...c, fsrs: { ...c.fsrs, state: 2 } } : c);
    }
    return map;
  }

  it('names nodes after the heading, not the first word', () => {
    const nodes = buildPath(words, cardsFor([]));
    expect(nodes.map((n) => n.title)).toEqual(['Greetings', 'Pronouns', 'Colours']);
  });

  it('opens every node, regardless of mastery elsewhere on the path', () => {
    // Nodes used to unlock only once the one before hit 60% mastery. That
    // gated the whole course behind a single stubborn word with no way to
    // jump ahead (or back) on purpose - removed deliberately, see buildPath.
    const nodes = buildPath(words, cardsFor([]));
    expect(nodes.every((n) => n.status === 'available' || n.status === 'complete')).toBe(true);
  });

  it('still reports partial mastery even though it no longer gates anything', () => {
    const fourOfSix = group('Greetings', 6).slice(0, 4).map((w) => w.id);
    const nodes = buildPath(words, cardsFor(fourOfSix));
    expect(nodes[0]?.mastery).toBeCloseTo(4 / 6);
    expect(nodes[1]?.status).toBe('available');
  });

  it('does not mark a node complete until every word in it has graduated', () => {
    const fiveOfSix = group('Greetings', 6).slice(0, 5).map((w) => w.id);
    const nodes = buildPath(words, cardsFor(fiveOfSix));
    expect(nodes[0]?.status).not.toBe('complete');
  });

  it('separates units', () => {
    const nodes = buildPath(words, cardsFor([]));
    expect(nodes.filter((n) => n.unit === 1)).toHaveLength(2);
    expect(nodes.filter((n) => n.unit === 2)).toHaveLength(1);
  });
});

describe('buildUnits', () => {
  const words = [...group('Greetings', 6), ...group('Pronouns', 6), ...group('Colours', 6, 2)];

  it('gathers every lesson of a unit into one section, in unit order', () => {
    const units = buildUnits(buildPath(words, cardsWith(words)));
    expect(units.map((u) => u.unit)).toEqual([1, 2]);
    expect(units[0]?.nodes.map((n) => n.title)).toEqual(['Greetings', 'Pronouns']);
    expect(units[0]?.words).toBe(12);
  });

  it('counts a section as far along as its words, not its lessons', () => {
    // Four of Greetings' six words is a third of the unit's twelve, even
    // though one of its two lessons has been started and the other has not.
    const mastered = group('Greetings', 6).slice(0, 4).map((w) => w.id);
    const units = buildUnits(buildPath(words, cardsWith(words, { mastered })));
    expect(units[0]?.mastered).toBe(4);
    expect(units[0]?.mastery).toBeCloseTo(4 / 12);
  });

  it('dates a section by the most recent answer anywhere in it', () => {
    const cards = cardsWith(words, { studied: { 'Greetings-0': T0, 'Pronouns-3': T0 + DAY } });
    const units = buildUnits(buildPath(words, cards));
    expect(units[0]?.lastStudiedAt).toBe(T0 + DAY);
    expect(units[1]?.lastStudiedAt).toBeUndefined();
  });

  it('counts a word as studied from any of its cards, not only the one mastery reads', () => {
    // Typing a word is still working on it, even though only recall_he_en
    // decides whether it counts as mastered.
    const cards = cardsWith(words, { studied: { 'Greetings-0': T0 }, studiedTemplate: 'type_he' });
    expect(buildUnits(buildPath(words, cards))[0]?.lastStudiedAt).toBe(T0);
  });
});

describe('chooseOpenUnit', () => {
  function summary(unit: number, mastery: number, lastStudiedAt?: number): UnitSummary {
    const base: UnitSummary = { unit, nodes: [], words: 10, mastered: mastery * 10, mastery };
    return lastStudiedAt === undefined ? base : { ...base, lastStudiedAt };
  }

  it('opens the section answered most recently', () => {
    const units = [summary(1, 0.5, T0), summary(2, 0.2, T0 + DAY), summary(3, 0)];
    expect(chooseOpenUnit(units, T0 + 2 * DAY)).toBe(2);
  });

  it('opens the first section when nothing has been studied yet', () => {
    expect(chooseOpenUnit([summary(1, 0), summary(2, 0)], T0)).toBe(1);
  });

  it('keeps a nearly finished section open while it is still being worked on', () => {
    // 90% is not finished; only walking away from it for days settles it.
    expect(chooseOpenUnit([summary(1, 0.95, T0), summary(2, 0)], T0 + 2 * 60 * 60 * 1000)).toBe(1);
  });

  it('moves on from a nearly finished section left alone for days', () => {
    expect(chooseOpenUnit([summary(1, 0.95, T0), summary(2, 0.1)], T0 + 5 * DAY)).toBe(2);
  });

  it('skips past every section already all but done', () => {
    const units = [summary(1, 1, T0), summary(2, 0.92), summary(3, 0.3)];
    expect(chooseOpenUnit(units, T0 + 5 * DAY)).toBe(3);
  });

  it('leaves everything closed when there is nothing left worth opening', () => {
    expect(chooseOpenUnit([summary(1, 1, T0), summary(2, 1)], T0 + 5 * DAY)).toBeNull();
  });

  it('handles an empty path', () => {
    expect(chooseOpenUnit([], T0)).toBeNull();
  });
});

describe('LessonPath', () => {
  const words = [
    ...group('Greetings', 6),
    ...group('Pronouns', 6),
    ...group('Colours', 6, 2),
    ...group('Numbers', 6, 3),
  ];
  const unitTitles = new Map([
    [1, 'people'],
    [2, 'colours'],
    [3, 'numbers'],
  ]);

  function show(cards: Map<string, Card>) {
    const onSelect = vi.fn();
    render(<LessonPath nodes={buildPath(words, cards)} unitTitles={unitTitles} onSelect={onSelect} />);
    return onSelect;
  }

  /** The sections currently open, named by their collapse control. */
  function openSections() {
    return screen.queryAllByRole('button', { name: /^Collapse / }).map((b) => b.getAttribute('aria-label'));
  }

  it('opens only the section last studied, and closes every other', () => {
    show(cardsWith(words, { studied: { 'Colours-0': Date.now() } }));
    expect(openSections()).toEqual([expect.stringContaining('Collapse colours')]);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(2);
  });

  it('opens the first section when there is no history to go on', () => {
    show(cardsWith(words));
    expect(openSections()).toEqual([expect.stringContaining('Collapse people')]);
  });

  it('says what is inside a closed section, so choosing one needs no opening', () => {
    show(cardsWith(words));
    const closed = screen.getByRole('button', { name: /^Open colours/ });
    expect(within(closed).getByText('Colours')).toBeTruthy();
  });

  it('says how far along a closed section is', () => {
    show(cardsWith(words, { mastered: group('Colours', 6, 2).slice(0, 3).map((w) => w.id) }));
    const closed = screen.getByRole('button', { name: /^Open colours/ });
    expect(closed.getAttribute('aria-label')).toContain('3 of 6 words mastered');
    expect(within(closed).getByText('/6')).toBeTruthy();
  });

  it('opens a section tapped anywhere on it, not only on its title', () => {
    show(cardsWith(words));
    const closed = screen.getByRole('button', { name: /^Open colours/ });
    return userEvent.click(within(closed).getByText('Colours')).then(() => {
      expect(screen.getByRole('button', { name: /^Collapse colours/ })).toBeTruthy();
    });
  });

  it('closes an open section from its header bar', async () => {
    show(cardsWith(words));
    await userEvent.click(screen.getByRole('button', { name: /^Collapse people/ }));
    expect(screen.queryByRole('button', { name: /^Collapse people/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Open people/ })).toBeTruthy();
  });

  it('studies the lesson when a lesson is tapped, and leaves the section open', async () => {
    // Regression guard: a tap inside an open section must never be read as a
    // tap on the section itself, which would collapse the path out from under
    // the finger reaching for a lesson.
    const onSelect = show(cardsWith(words));
    await userEvent.click(screen.getByRole('button', { name: /^Greetings,/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.title).toBe('Greetings');
    expect(screen.getByRole('button', { name: /^Collapse people/ })).toBeTruthy();
  });

  it('leaves the other sections as they were when one is opened', async () => {
    show(cardsWith(words));
    await userEvent.click(screen.getByRole('button', { name: /^Open colours/ }));
    expect(openSections()).toHaveLength(2);
  });

  it('offers every lesson of an open section', () => {
    show(cardsWith(words));
    expect(screen.getByRole('button', { name: /^Greetings,/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Pronouns,/ })).toBeTruthy();
  });
});
