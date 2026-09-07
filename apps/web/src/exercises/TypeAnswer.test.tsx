import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newCard, type Card, type Lexeme } from '@lang/core';
import { TypeAnswer } from './TypeAnswer.js';

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  // @ts-expect-error - test-only cleanup of a property we may have added
  delete window.matchMedia;
});

/** jsdom has no matchMedia; simulate a device's pointer type for one test. */
function mockPointer(coarse: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('coarse') ? coarse : !coarse,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

const T0 = Date.UTC(2026, 0, 1);

/** קָטָן — "small". Chosen because its final nun exercises the final-form rule. */
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

const card: Card = newCard('lx_1', 'type_he', T0);

function renderExercise(onAnswer = vi.fn()) {
  render(<TypeAnswer card={card} lexeme={lexeme} onAnswer={onAnswer} />);
  return {
    onAnswer,
    input: screen.getByLabelText('Type the Hebrew word') as HTMLInputElement,
    key: (ch: string) => screen.getByRole('button', { name: ch }),
  };
}

describe('the on-screen keyboard drives the exercise', () => {
  it('is available without needing a Hebrew input method installed', () => {
    renderExercise();
    expect(screen.getByRole('group', { name: 'Hebrew keyboard' })).toBeInTheDocument();
  });

  it('builds a word letter by letter and grades it correct', async () => {
    const user = userEvent.setup();
    const { onAnswer, input, key } = renderExercise();

    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    expect(input.value).toBe('קטן');

    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByText('Correct')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAnswer).toHaveBeenCalledWith(true, expect.any(Number), false);
  });

  it('accepts the unpointed spelling even though the card is pointed', async () => {
    const user = userEvent.setup();
    const { key } = renderExercise();

    // The keyboard offers no niqqud; typing קטן must still match קָטָן.
    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('Correct')).toBeInTheDocument();
  });

  it('forgives a non-final nun, since the keyboard offers both', async () => {
    const user = userEvent.setup();
    const { key } = renderExercise();

    for (const ch of ['ק', 'ט', 'נ']) await user.click(key(ch)); // plain nun, not ן
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('Correct')).toBeInTheDocument();
  });

  it('still marks a genuine misspelling wrong', async () => {
    const user = userEvent.setup();
    const { key } = renderExercise();

    for (const ch of ['ק', 'ת', 'ן']) await user.click(key(ch)); // tav, not tet
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.queryByText('Correct')).toBeNull();
    expect(screen.getByText('The answer was')).toBeInTheDocument();
  });

  it('deletes the last letter on backspace', async () => {
    const user = userEvent.setup();
    const { input, key } = renderExercise();

    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    await user.click(screen.getByRole('button', { name: 'Backspace' }));

    expect(input.value).toBe('קט');
  });

  it('does nothing on backspace when the field is empty', async () => {
    const user = userEvent.setup();
    const { input } = renderExercise();

    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(input.value).toBe('');
  });

  it('submits from the keyboard return key', async () => {
    const user = userEvent.setup();
    const { key } = renderExercise();

    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    await user.click(screen.getByRole('button', { name: 'Check answer' }));

    expect(screen.getByText('Correct')).toBeInTheDocument();
  });

  it('hides the keyboard once the answer is in', async () => {
    const user = userEvent.setup();
    const { key } = renderExercise();

    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.queryByRole('group', { name: 'Hebrew keyboard' })).toBeNull();
  });
});

describe('the keyboard can be hidden behind a toggle', () => {
  it('is shown by default on a desktop (fine pointer)', () => {
    mockPointer(false);
    renderExercise();
    expect(screen.getByRole('group', { name: 'Hebrew keyboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide keyboard' })).toBeInTheDocument();
  });

  it('is hidden by default on a touch device (coarse pointer)', () => {
    mockPointer(true);
    renderExercise();
    expect(screen.queryByRole('group', { name: 'Hebrew keyboard' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show keyboard' })).toBeInTheDocument();
  });

  it('toggles on click and remembers the choice for next time', async () => {
    mockPointer(false);
    const user = userEvent.setup();
    renderExercise();

    await user.click(screen.getByRole('button', { name: 'Hide keyboard' }));
    expect(screen.queryByRole('group', { name: 'Hebrew keyboard' })).toBeNull();

    cleanup();
    renderExercise();
    expect(screen.queryByRole('group', { name: 'Hebrew keyboard' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show keyboard' })).toBeInTheDocument();
  });

  it('still lets you type with the keyboard hidden, using the physical keyboard', async () => {
    mockPointer(true);
    const user = userEvent.setup();
    const { input } = renderExercise();

    await user.click(input);
    await user.keyboard('קטן{Enter}');

    expect(screen.getByText('Correct')).toBeInTheDocument();
  });
});

describe('caret handling', () => {
  it('inserts at the caret rather than jumping to the end', async () => {
    const user = userEvent.setup();
    const { input, key } = renderExercise();

    for (const ch of ['ק', 'ן']) await user.click(key(ch));
    expect(input.value).toBe('קן');

    // Put the caret between the two letters and insert the missing tet.
    input.setSelectionRange(1, 1);
    await user.click(key('ט'));

    expect(input.value).toBe('קטן');
    expect(input.selectionStart).toBe(2);
  });

  it('replaces a selection instead of inserting alongside it', async () => {
    const user = userEvent.setup();
    const { input, key } = renderExercise();

    for (const ch of ['ק', 'ת', 'ן']) await user.click(key(ch));
    input.setSelectionRange(1, 2); // select the wrong letter
    await user.click(key('ט'));

    expect(input.value).toBe('קטן');
  });

  it('deletes a selection on backspace', async () => {
    const user = userEvent.setup();
    const { input, key } = renderExercise();

    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    input.setSelectionRange(0, 2);
    await user.click(screen.getByRole('button', { name: 'Backspace' }));

    expect(input.value).toBe('ן');
  });
});

describe('the physical keyboard keeps working', () => {
  it('accepts typed input and mixes with taps', async () => {
    const user = userEvent.setup();
    const { input, key } = renderExercise();

    await user.click(input);
    await user.keyboard('קט');
    await user.click(key('ן'));

    expect(input.value).toBe('קטן');
  });

  it('submits on Enter', async () => {
    const user = userEvent.setup();
    const { input } = renderExercise();

    await user.click(input);
    await user.keyboard('קטן{Enter}');

    expect(screen.getByText('Correct')).toBeInTheDocument();
  });
});

describe('hints', () => {
  it('reports that a hint was used, so grading can cap the rating', async () => {
    const user = userEvent.setup();
    const { onAnswer, key } = renderExercise();

    await user.click(screen.getByRole('button', { name: /show me a hint/i }));
    for (const ch of ['ק', 'ט', 'ן']) await user.click(key(ch));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onAnswer).toHaveBeenCalledWith(true, expect.any(Number), true);
  });
});

describe('the field follows the answer, not an assumption', () => {
  /**
   * Regression: the gym's final test uses whichever card is struggling. For a
   * Hebrew-to-English card the answer is English, but the field was hard-wired
   * to Hebrew - right-to-left, Hebrew font, Hebrew keyboard - which made
   * typing an English answer close to unusable.
   */
  const englishAnswerCard: Card = newCard('lx_1', 'recall_he_en', T0);

  function renderEnglish(onAnswer = vi.fn()) {
    render(<TypeAnswer card={englishAnswerCard} lexeme={lexeme} onAnswer={onAnswer} />);
    return { onAnswer, input: screen.getByLabelText('Type the English meaning') as HTMLInputElement };
  }

  it('shows no Hebrew keyboard when the answer is English', () => {
    renderEnglish();
    expect(screen.queryByRole('group', { name: 'Hebrew keyboard' })).toBeNull();
  });

  it('sets the field left-to-right and in English', () => {
    const { input } = renderEnglish();
    expect(input.getAttribute('dir')).toBe('ltr');
    expect(input.getAttribute('lang')).toBe('en');
    expect(input.className).not.toMatch(/\bhe\b/);
  });

  it('accepts and grades an English answer', async () => {
    const user = userEvent.setup();
    const { onAnswer, input } = renderEnglish();

    await user.click(input);
    await user.keyboard('small');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(screen.getByText('Correct')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAnswer).toHaveBeenCalledWith(true, expect.any(Number), false);
  });

  it('keeps the Hebrew field right-to-left with its keyboard', () => {
    render(<TypeAnswer card={card} lexeme={lexeme} onAnswer={vi.fn()} />);
    const input = screen.getByLabelText('Type the Hebrew word');
    expect(input.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('group', { name: 'Hebrew keyboard' })).toBeInTheDocument();
  });
});
