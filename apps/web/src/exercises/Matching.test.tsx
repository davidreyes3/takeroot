import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Lexeme } from '@lang/core';
import { Matching } from './Matching.js';

afterEach(cleanup);

function word(id: string, lemma: string, gloss: string): Lexeme {
  return {
    id,
    lemma,
    lemmaBare: lemma,
    translit: { value: '', provenance: 'derived' },
    glosses: [gloss],
    pos: 'noun',
    root: { value: [], provenance: 'suggested' },
    forms: {},
    examples: [],
    tags: [],
    unit: 1,
    group: 'Test',
    sourceFile: 'test.md',
    sourceLine: 1,
  };
}

const target = word('lx_lo', 'לֹא', 'no');
const others = [
  word('lx_we', 'אֲנַחְנוּ', 'we'),
  word('lx_night', 'לַיְלָה טוֹב', 'good night'),
  word('lx_how', 'מָה שְׁלוֹמְךָ', 'how are you'),
];

/** Clear the grid by pairing every word with its meaning. */
async function solve(user: ReturnType<typeof userEvent.setup>, words: Lexeme[]) {
  for (const w of words) {
    await user.click(screen.getByRole('button', { name: w.lemma }));
    await user.click(screen.getByRole('button', { name: w.glosses[0] as string }));
  }
}

describe('completing the grid', () => {
  it('reports done once every pair is matched', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Matching target={target} pool={others} onDone={onDone} />);

    await solve(user, [target, ...others]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('counts a mistake without blocking completion', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Matching target={target} pool={others} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: target.lemma }));
    await user.click(screen.getByRole('button', { name: 'we' })); // wrong pairing

    // The board flashes the wrong pair and ignores taps until it clears.
    await waitFor(() => expect(container.querySelector('[data-state="wrong"]')).toBeNull(), {
      timeout: 2000,
    });

    await solve(user, [target, ...others]);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0]?.[0].mistakes).toBe(1);
  });

  it('ignores taps while the wrong pair is still flashing', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Matching target={target} pool={others} onDone={onDone} />);

    await user.click(screen.getByRole('button', { name: target.lemma }));
    await user.click(screen.getByRole('button', { name: 'we' }));

    // Clicking during the flash used to land against the still-selected tile
    // and score phantom mistakes.
    await user.click(screen.getByRole('button', { name: 'good night' }));
    await user.click(screen.getByRole('button', { name: 'how are you' }));

    await waitFor(() => expect(container.querySelector('[data-state="wrong"]')).toBeNull(), {
      timeout: 2000,
    });
    await solve(user, [target, ...others]);

    expect(onDone.mock.calls[0]?.[0].mistakes).toBe(1);
  });
});

describe('duplicate words cannot strand the learner', () => {
  it('shows a repeated word only once', () => {
    // The gym pool is built from cards, and one word has several cards, so the
    // same word really can arrive twice.
    render(<Matching target={target} pool={[...others, target]} onDone={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: target.lemma })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'no' })).toHaveLength(1);
  });

  it('still completes when the pool repeats a word', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(<Matching target={target} pool={[...others, target]} onDone={onDone} />);

    await solve(user, [target, ...others]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('still completes when the pool repeats a non-target word', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    const dupe = others[0] as Lexeme;
    render(<Matching target={target} pool={[...others, dupe]} onDone={onDone} />);

    await solve(user, [target, ...others]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not hang when there is nothing to match against', () => {
    const onDone = vi.fn();
    render(<Matching target={target} pool={[target]} onDone={onDone} />);
    // A grid of one pair is not a game; it must hand back rather than stick.
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('grid contents', () => {
  it('always includes the word being drilled', () => {
    render(<Matching target={target} pool={others} onDone={vi.fn()} />);
    expect(screen.getByRole('button', { name: target.lemma })).toBeInTheDocument();
  });

  it('caps the grid at five pairs', () => {
    const many = Array.from({ length: 12 }, (_, i) => word(`lx_${i}`, `מילה${i}`, `word ${i}`));
    const { container } = render(<Matching target={target} pool={many} onDone={vi.fn()} />);
    expect(container.querySelectorAll('.match')).toHaveLength(10); // 5 Hebrew + 5 English
  });
});
