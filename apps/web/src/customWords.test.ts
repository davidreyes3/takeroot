import { describe, it, expect } from 'vitest';
import { hasHebrew } from '@lang/core';
import {
  customWordToLexeme,
  makeCustomWord,
  orderCustomWords,
  validateCustomWord,
  type CustomWord,
} from './customWords.js';

function record(overrides: Partial<CustomWord> = {}): CustomWord {
  return {
    id: 'lx_test',
    lemma: 'מחשב',
    lemmaBare: 'מחשב',
    translit: 'machshev',
    glosses: ['computer'],
    pos: 'noun',
    group: 'Technology',
    createdAt: 0,
    ...overrides,
  };
}

describe('orderCustomWords', () => {
  it('keeps a lesson contiguous even when its words were added out of order', () => {
    // Added in the order: Technology, Reading, Technology - a plain
    // creation-order sort would put a Reading word between two Technology
    // ones, splitting the lesson in two on the path.
    const records = [
      record({ id: 'a', group: 'Technology', createdAt: 1 }),
      record({ id: 'b', group: 'Reading', createdAt: 2 }),
      record({ id: 'c', group: 'Technology', createdAt: 3 }),
    ];
    const ordered = orderCustomWords(records).map((r) => r.id);
    expect(ordered).toEqual(['a', 'c', 'b']);
  });

  it('orders lessons by when each was first started', () => {
    const records = [
      record({ id: 'a', group: 'Reading', createdAt: 1 }),
      record({ id: 'b', group: 'Technology', createdAt: 2 }),
      record({ id: 'c', group: 'Reading', createdAt: 3 }),
    ];
    const ordered = orderCustomWords(records).map((r) => r.group);
    expect(ordered).toEqual(['Reading', 'Reading', 'Technology']);
  });

  it('keeps words within the same lesson in the order they were added', () => {
    const records = [
      record({ id: 'a', group: 'Technology', createdAt: 5 }),
      record({ id: 'b', group: 'Technology', createdAt: 1 }),
    ];
    expect(orderCustomWords(records).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('does not mutate its input', () => {
    const records = [record({ id: 'a', createdAt: 2 }), record({ id: 'b', createdAt: 1 })];
    const copy = [...records];
    orderCustomWords(records);
    expect(records).toEqual(copy);
  });
});

describe('validateCustomWord', () => {
  const valid = { lemma: 'מחשב', translit: '', glosses: ['computer'], pos: 'noun' as const, group: 'Tech' };

  it('accepts a well-formed word', () => {
    expect(validateCustomWord(valid, hasHebrew)).toBeNull();
  });

  it('rejects text with no Hebrew in it', () => {
    expect(validateCustomWord({ ...valid, lemma: 'computer' }, hasHebrew)).not.toBeNull();
  });

  it('rejects an empty Hebrew field', () => {
    expect(validateCustomWord({ ...valid, lemma: '  ' }, hasHebrew)).not.toBeNull();
  });

  it('rejects no English meaning', () => {
    expect(validateCustomWord({ ...valid, glosses: [] }, hasHebrew)).not.toBeNull();
  });

  it('rejects a blank lesson name', () => {
    expect(validateCustomWord({ ...valid, group: '  ' }, hasHebrew)).not.toBeNull();
  });
});

describe('customWordToLexeme', () => {
  it('produces a valid Lexeme carrying the assigned unit and position', () => {
    const lexeme = customWordToLexeme(record(), 7, 2);
    expect(lexeme.unit).toBe(7);
    expect(lexeme.sourceLine).toBe(2);
    expect(lexeme.sourceFile).toBe('custom');
    expect(lexeme.translit).toEqual({ value: 'machshev', provenance: 'authored' });
    expect(lexeme.root).toEqual({ value: [], provenance: 'authored' });
  });
});

describe('makeCustomWord', () => {
  it('trims fields and strips niqqud into lemmaBare', () => {
    const w = makeCustomWord('lx_x', {
      lemma: ' קָטָן ',
      translit: ' katan ',
      glosses: ['small'],
      pos: 'adj',
      group: ' Adjectives ',
    });
    expect(w.lemma).toBe('קָטָן');
    expect(w.lemmaBare).toBe('קטן');
    expect(w.translit).toBe('katan');
    expect(w.group).toBe('Adjectives');
  });
});
