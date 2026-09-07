import { useState } from 'react';

/**
 * An on-screen Hebrew keyboard.
 *
 * Necessary rather than a convenience: most people don't have a Hebrew input
 * method installed, and on a phone switching keyboards mid-answer is enough
 * friction to end a study session. Without this, the typing exercise - the one
 * exercise immune to guessing, and the one the Leech Gym ends on - is
 * unavailable to most learners.
 *
 * Two layouts, because they serve different moments:
 *
 *   israeli       The standard Israeli layout, in physical key order. This is
 *                 what a real keyboard and the iOS/Android Hebrew keyboards
 *                 look like, so hunting for ק here builds muscle memory that
 *                 transfers. Default for that reason.
 *   alphabetical  א through ת in order, for when you just want to find the
 *                 letter. Laid out right-to-left, so א sits where a Hebrew
 *                 reader looks for it first.
 *
 * Purely presentational: it reports keystrokes and owns no text. The caller
 * holds the value and the caret, which is what lets the physical keyboard and
 * this one stay in sync.
 */

export type KeyboardLayout = 'israeli' | 'alphabetical';

/**
 * Standard Israeli layout, given in physical key order (left to right), which
 * is why these rows look "backwards" to a Hebrew reader - the leftmost key of
 * the home row really is ש. Punctuation keys are omitted; they are noise here.
 */
const ISRAELI_ROWS: readonly (readonly string[])[] = [
  ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'],
  ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
  ['ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'],
];

/** Alphabetical order. Rendered right-to-left, so א lands top-right. */
const ALPHABETICAL_ROWS: readonly (readonly string[])[] = [
  ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'],
  ['י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'],
  ['ק', 'ר', 'ש', 'ת', 'ך', 'ם', 'ן', 'ף', 'ץ'],
];

const STORAGE_KEY = 'keyboardLayout';

/**
 * Always reach through `window`. A bare `localStorage` is ambiguous under
 * Node 18+, which ships a global of that name, and would silently resolve to
 * the wrong store outside a browser.
 */
function loadLayout(): KeyboardLayout {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'israeli' || stored === 'alphabetical') return stored;
  } catch {
    // Private browsing, blocked site data, thumbnail capture: fall through.
  }
  return 'israeli';
}

function saveLayout(layout: KeyboardLayout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    // A remembered preference is a nicety; never let it break the exercise.
  }
}

export interface HebrewKeyboardProps {
  onKey: (char: string) => void;
  onBackspace: () => void;
  /** Rendered as the wide key at the end of the bottom row. */
  onSubmit?: () => void;
  disabled?: boolean;
}

export function HebrewKeyboard({ onKey, onBackspace, onSubmit, disabled = false }: HebrewKeyboardProps) {
  const [layout, setLayout] = useState<KeyboardLayout>(loadLayout);

  const rows = layout === 'israeli' ? ISRAELI_ROWS : ALPHABETICAL_ROWS;
  const rtl = layout === 'alphabetical';

  const toggle = () => {
    const next: KeyboardLayout = layout === 'israeli' ? 'alphabetical' : 'israeli';
    setLayout(next);
    saveLayout(next);
  };

  /**
   * Keep focus in the text field. Without this every tap blurs the input, the
   * caret is lost, and the physical keyboard stops working after one tap.
   */
  const holdFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="kbd" role="group" aria-label="Hebrew keyboard">
      <div className="kbd-bar">
        <button
          type="button"
          className="kbd-toggle"
          onMouseDown={holdFocus}
          onClick={toggle}
          aria-label={`Switch to ${layout === 'israeli' ? 'alphabetical' : 'keyboard'} order`}
        >
          {layout === 'israeli' ? 'א־ת order' : 'Keyboard order'}
        </button>
      </div>

      {rows.map((row, i) => (
        <div className="kbd-row" key={i} dir={rtl ? 'rtl' : 'ltr'}>
          {row.map((char) => (
            <button
              type="button"
              key={char}
              className="kbd-key he"
              disabled={disabled}
              onMouseDown={holdFocus}
              onClick={() => onKey(char)}
            >
              {char}
            </button>
          ))}
        </div>
      ))}

      <div className="kbd-row" dir="ltr">
        <button
          type="button"
          className="kbd-key wide"
          disabled={disabled}
          onMouseDown={holdFocus}
          onClick={onBackspace}
          aria-label="Backspace"
        >
          &#9003;
        </button>
        <button
          type="button"
          className="kbd-key space"
          disabled={disabled}
          onMouseDown={holdFocus}
          onClick={() => onKey(' ')}
          aria-label="Space"
        >
          &nbsp;
        </button>
        {onSubmit && (
          <button
            type="button"
            className="kbd-key wide accent"
            disabled={disabled}
            onMouseDown={holdFocus}
            onClick={onSubmit}
            aria-label="Check answer"
          >
            &crarr;
          </button>
        )}
      </div>
    </div>
  );
}

/** Exported for tests: every Hebrew letter must be reachable in both layouts. */
export const ALL_KEYS = {
  israeli: ISRAELI_ROWS.flat(),
  alphabetical: ALPHABETICAL_ROWS.flat(),
} as const;
