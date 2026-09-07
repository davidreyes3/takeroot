import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { answersMatch, type Card, type Lexeme } from '@lang/core';
import { cardFace } from '../face.js';
import { Word } from '../components/Word.js';
import { HebrewKeyboard } from '../components/HebrewKeyboard.js';

export interface TypeAnswerProps {
  card: Card;
  lexeme: Lexeme;
  onAnswer: (correct: boolean, elapsedMs: number, usedHint: boolean) => void;
}

/**
 * Production recall: type the Hebrew.
 *
 * The hardest exercise in the app and the only one immune to guessing, which
 * is why it is what the Leech Gym ends on.
 *
 * Grading is forgiving about typography and strict about spelling: niqqud is
 * optional, final-form slips are forgiven, but a wrong letter is wrong. All of
 * that lives in `answersMatch` in core, tested independently.
 */
export function TypeAnswer({ card, lexeme, onAnswer }: TypeAnswerProps) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<'typing' | 'right' | 'wrong'>('typing');
  const [usedHint, setUsedHint] = useState(false);
  const shownAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const face = cardFace(lexeme, card.template);

  /**
   * Where to put the caret after an on-screen key. React re-renders a
   * controlled input with the caret at the end, so a tap in the middle of a
   * word would otherwise jump you to the end and make corrections impossible.
   */
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    setValue('');
    setState('typing');
    setUsedHint(false);
    shownAt.current = Date.now();
    inputRef.current?.focus();
  }, [card.id]);

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(caret, caret);
  }, [value]);

  /** Replace the selection (or insert at the caret) with `text`. */
  const insert = (text: string) => {
    if (state !== 'typing') return;
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    setValue(value.slice(0, start) + text + value.slice(end));
    pendingCaret.current = start + text.length;
  };

  /** Delete the selection, or the character before the caret. */
  const backspace = () => {
    if (state !== 'typing') return;
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;

    if (start !== end) {
      setValue(value.slice(0, start) + value.slice(end));
      pendingCaret.current = start;
      return;
    }
    if (start === 0) return;
    setValue(value.slice(0, start - 1) + value.slice(start));
    pendingCaret.current = start - 1;
  };

  const submit = () => {
    if (state !== 'typing') {
      onAnswer(state === 'right', Date.now() - shownAt.current, usedHint);
      return;
    }
    if (value.trim() === '') return;
    setState(answersMatch(face.answer, value) ? 'right' : 'wrong');
  };

  return (
    <div>
      <div className="card">
        <div className="muted">{face.instruction}</div>
        <Word text={face.prompt} hebrew={face.promptIsHebrew} size="prompt" />

        <input
          ref={inputRef}
          className="type-input he"
          data-state={state === 'typing' ? undefined : state}
          lang="he"
          dir="rtl"
          value={value}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          readOnly={state !== 'typing'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Type the Hebrew word"
        />

        {state === 'wrong' && (
          <div className="stack center">
            <div className="muted">The answer was</div>
            <Word text={face.answer} hebrew size="answer" />
            {lexeme.translit.value && <div className="translit">{lexeme.translit.value}</div>}
          </div>
        )}

        {state === 'right' && <div className="banner calm">Correct</div>}

        {state === 'typing' && !usedHint && (
          <button
            className="tag"
            onClick={() => setUsedHint(true)}
            style={{ cursor: 'pointer' }}
          >
            Show me a hint
          </button>
        )}

        {state === 'typing' && usedHint && (
          <div className="muted">
            Starts with <Word text={face.answer.slice(0, 1)} hebrew /> ·{' '}
            {face.answer.replace(/\s/gu, '').length} letters
          </div>
        )}

        {state === 'typing' && (
          <HebrewKeyboard onKey={insert} onBackspace={backspace} onSubmit={submit} />
        )}
      </div>

      <button className="btn" style={{ marginTop: 18 }} onClick={submit} disabled={state === 'typing' && value.trim() === ''}>
        {state === 'typing' ? 'Check' : 'Continue'}
      </button>
    </div>
  );
}
