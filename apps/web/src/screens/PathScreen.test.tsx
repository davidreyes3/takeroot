import { describe, it, expect } from 'vitest';
import type { Card, Lexeme } from '@lang/core';
import { newCard } from '@lang/core';
import { packLessons, buildPath } from './PathScreen.js';

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
