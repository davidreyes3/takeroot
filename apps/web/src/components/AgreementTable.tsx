import { SLOT_LABELS, type AgreementSlot, type Lexeme } from '@lang/core';
import { Word } from './Word.js';

/**
 * The agreement table for an adjective, plus the rule that generated it.
 *
 * Showing the rule alongside the forms is the whole point: the goal is that
 * you can inflect the *next* adjective you meet, not just this one.
 */
export function AgreementTable({ lexeme }: { lexeme: Lexeme }) {
  const slots: AgreementSlot[] = ['ms', 'fs', 'mp', 'fp'];
  const present = slots.filter((s) => lexeme.forms[s]?.value);
  if (present.length < 2) return null;

  const rule = lexeme.forms.fs?.note ?? lexeme.forms.mp?.note;

  return (
    <div className="stack" style={{ width: '100%' }}>
      <div className="forms">
        {present.map((slot) => {
          const form = lexeme.forms[slot];
          if (!form) return null;
          return (
            <div key={slot} className="form-cell">
              <span className="slot">{SLOT_LABELS[slot]}</span>
              <Word text={form.value} hebrew />
            </div>
          );
        })}
      </div>
      {rule && <p className="rule">{rule}</p>}
      {lexeme.root.value.length > 0 && (
        <div className="meta">
          <span className={`tag ${lexeme.root.provenance === 'authored' ? '' : 'derived'}`}>
            root <Word text={lexeme.root.value.join('־')} hebrew />
            {lexeme.root.provenance !== 'authored' ? ' (guess)' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
