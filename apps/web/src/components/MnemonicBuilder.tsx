import { useState } from 'react';
import type { Lexeme } from '@lang/core';
import { Word } from './Word.js';

/**
 * The keyword-mnemonic builder, in the "200 Words a Day" / Linkword tradition.
 *
 * Two fields on purpose. The keyword (an English word that *sounds* like the
 * Hebrew) gives the ear something to grab; the image links that sound to the
 * meaning. Splitting them forces both halves to exist - a vague "it sounds a
 * bit like cotton" with no picture attached does not stick.
 *
 * The learner writes it themselves. A mnemonic someone else invented is just
 * another sentence to memorise; the elaboration is where the encoding happens.
 */
export function MnemonicBuilder({
  lexeme,
  onSave,
  onSkip,
}: {
  lexeme: Lexeme;
  onSave: (keyword: string, image: string) => void;
  onSkip: () => void;
}) {
  const [keyword, setKeyword] = useState('');
  const [image, setImage] = useState('');
  const canSave = keyword.trim() !== '' && image.trim() !== '';

  return (
    <div>
      <div className="card">
        <Word text={lexeme.lemma} hebrew size="prompt" />
        {lexeme.translit.value && <div className="translit">{lexeme.translit.value}</div>}
        <Word text={lexeme.glosses.join(', ')} hebrew={false} size="answer" />

        <div className="field">
          <label htmlFor="mn-keyword">An English word it sounds like</label>
          <input
            id="mn-keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={lexeme.translit.value ? `something like "${lexeme.translit.value}"` : 'sound-alike'}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="mn-image">Now picture something ridiculous linking it to the meaning</label>
          <input
            id="mn-image"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="the more absurd, the better it sticks"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn secondary" onClick={onSkip}>
          Skip
        </button>
        <button className="btn" disabled={!canSave} onClick={() => onSave(keyword.trim(), image.trim())}>
          Save it
        </button>
      </div>
    </div>
  );
}
