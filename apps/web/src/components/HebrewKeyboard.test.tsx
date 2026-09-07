import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HebrewKeyboard, ALL_KEYS } from './HebrewKeyboard.js';

afterEach(() => {
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

/** The 22 letters plus the 5 word-final forms. */
const HEBREW_LETTERS = 'אבגדהוזחטיכלמנסעפצקרשת'.split('');
const FINAL_FORMS = ['ך', 'ם', 'ן', 'ף', 'ץ'];

describe('coverage', () => {
  it('offers every Hebrew letter and every final form, in both layouts', () => {
    for (const layout of ['israeli', 'alphabetical'] as const) {
      const keys = new Set(ALL_KEYS[layout]);
      for (const letter of [...HEBREW_LETTERS, ...FINAL_FORMS]) {
        expect(keys.has(letter), `${layout} layout is missing ${letter}`).toBe(true);
      }
      expect(keys.size).toBe(27);
    }
  });

  it('has no duplicate keys', () => {
    for (const layout of ['israeli', 'alphabetical'] as const) {
      expect(new Set(ALL_KEYS[layout]).size).toBe(ALL_KEYS[layout].length);
    }
  });

  it('uses the real Israeli layout, not an invented one', () => {
    // The home row of a physical Israeli keyboard, left to right.
    expect(ALL_KEYS.israeli.slice(8, 18)).toEqual(
      ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
    );
  });

  it('orders the alphabetical layout from alef to tav', () => {
    expect(ALL_KEYS.alphabetical.slice(0, 22)).toEqual(HEBREW_LETTERS);
  });
});

describe('key presses', () => {
  it('reports the letter that was tapped', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<HebrewKeyboard onKey={onKey} onBackspace={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'ק' }));
    expect(onKey).toHaveBeenCalledWith('ק');
  });

  it('reports a space', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<HebrewKeyboard onKey={onKey} onBackspace={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Space' }));
    expect(onKey).toHaveBeenCalledWith(' ');
  });

  it('reports a backspace', async () => {
    const onBackspace = vi.fn();
    const user = userEvent.setup();
    render(<HebrewKeyboard onKey={vi.fn()} onBackspace={onBackspace} />);

    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(onBackspace).toHaveBeenCalledTimes(1);
  });

  it('shows a submit key only when the caller wants one', () => {
    const { rerender } = render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Check answer' })).toBeNull();

    rerender(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Check answer' })).toBeInTheDocument();
  });

  it('does not steal focus from the text field', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input data-testid="field" />
        <HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />
      </>,
    );

    const field = screen.getByTestId('field');
    field.focus();
    expect(document.activeElement).toBe(field);

    await user.click(screen.getByRole('button', { name: 'ק' }));
    // Without preventDefault on mousedown the caret would be lost after one tap.
    expect(document.activeElement).toBe(field);
  });

  it('goes quiet when disabled', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<HebrewKeyboard onKey={onKey} onBackspace={vi.fn()} disabled />);

    await user.click(screen.getByRole('button', { name: 'ק' }));
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe('layout switching', () => {
  it('starts in keyboard order and switches to alphabetical', async () => {
    const user = userEvent.setup();
    const { container } = render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />);

    const firstKey = () => within(container.querySelectorAll('.kbd-row')[0] as HTMLElement)
      .getAllByRole('button')[0];

    expect(firstKey()).toHaveTextContent('ק'); // Israeli top row starts with ק
    await user.click(screen.getByRole('button', { name: /alphabetical order/i }));
    expect(firstKey()).toHaveTextContent('א'); // alphabetical starts with א
  });

  it('lays the alphabetical rows out right-to-left, so alef reads first', async () => {
    const user = userEvent.setup();
    const { container } = render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />);

    expect((container.querySelector('.kbd-row') as HTMLElement).getAttribute('dir')).toBe('ltr');
    await user.click(screen.getByRole('button', { name: /alphabetical order/i }));
    expect((container.querySelector('.kbd-row') as HTMLElement).getAttribute('dir')).toBe('rtl');
  });

  it('remembers the choice for next time', async () => {
    const user = userEvent.setup();
    render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /alphabetical order/i }));

    cleanup();
    const { container } = render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />);
    const firstKey = within(container.querySelectorAll('.kbd-row')[0] as HTMLElement)
      .getAllByRole('button')[0];
    expect(firstKey).toHaveTextContent('א');
  });

  it('still renders when storage is unavailable', () => {
    // Private browsing and blocked site data make this throw on access.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => render(<HebrewKeyboard onKey={vi.fn()} onBackspace={vi.fn()} />)).not.toThrow();
    expect(screen.getByRole('button', { name: 'ק' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
