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
 *
 * The technique is not self-evident, though, and an empty box labelled
 * "keyword" teaches nobody anything. So the worked example is shown by default
 * the first few times and can be collapsed once it is familiar.
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
  const [showHelp, setShowHelp] = useState(true);
  const canSave = keyword.trim() !== '' && image.trim() !== '';

  return (
    <div>
      <div className="card">
        <Word text={lexeme.lemma} hebrew size="prompt" />
        {lexeme.translit.value && <div className="translit">{lexeme.translit.value}</div>}
        <Word text={lexeme.glosses.join(', ')} hebrew={false} size="answer" />

        <div className="explainer">
          <button
            type="button"
            className="explainer-toggle"
            onClick={() => setShowHelp(!showHelp)}
            aria-expanded={showHelp}
          >
            How this works {showHelp ? '−' : '+'}
          </button>

          {showHelp && (
            <div className="explainer-body">
              <p>
                You are building a <b>bridge</b> between how the word sounds and what it
                means, so that hearing one drags the other along with it.
              </p>
              <ol>
                <li>
                  Find an English word or phrase that <b>sounds like</b> the Hebrew. It does
                  not have to be exact, and it does not have to make sense.
                </li>
                <li>
                  Picture the sound-alike and the meaning together, doing something
                  <b> ridiculous</b>. Odd, vivid, and a bit silly beats sensible every time —
                  that is the part your memory actually keeps.
                </li>
              </ol>
              <p className="worked">
                <b>Worked example.</b> <bdi className="he" lang="he" dir="rtl">קָטָן</bdi>{' '}
                <i>katan</i> means "small". It sounds a bit like <b>cotton</b>. So: a cotton
                ball so tiny you need tweezers to pick it up. Now "katan" pulls "cotton"
                which pulls "tiny".
              </p>
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="mn-keyword">1. An English word it sounds like</label>
          <input
            id="mn-keyword"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={lexeme.translit.value ? `what does "${lexeme.translit.value}" sound like?` : 'sound-alike'}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label htmlFor="mn-image">
            2. Picture that together with "{lexeme.glosses[0] ?? 'the meaning'}" — the sillier the better
          </label>
          <input
            id="mn-image"
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="what do you see?"
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
