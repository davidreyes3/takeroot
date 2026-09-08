import { useRef, useState } from 'react';
import type { Lexeme } from '@lang/core';
import { useApp, SESSION_LENGTHS } from '../store.js';
import { exportBackup, importBackup } from '../db.js';
import { WordListManager } from './WordListManager.js';

export interface SettingsScreenProps {
  /** The whole corpus, hidden words included - the word list needs to see it all. */
  lexemes: Lexeme[];
  unitTitles: Map<number, string>;
}

type Tab = 'general' | 'words';

/**
 * Backup, the manual answer to "sync later".
 *
 * There is no server and no account, so moving progress anywhere - a new
 * phone, an installed home-screen app, a different browser - means carrying
 * a file across yourself. Import is a full replace, not a merge: it exists to
 * move progress from one place to another, not to reconcile two places that
 * were both studied in. Study in one place, back up, restore elsewhere.
 */
export function SettingsScreen({ lexemes, unitTitles }: SettingsScreenProps) {
  const init = useApp((s) => s.init);
  const { sessionLength, setSessionLength, typingEnabled, setTypingEnabled } = useApp();
  const [tab, setTab] = useState<Tab>('general');
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setBusy(true);
    try {
      const json = await exportBackup();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = url;
      a.download = `takeroot-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'ok', text: 'Backup downloaded.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Export failed.' });
    } finally {
      setBusy(false);
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    e.target.value = '';
    if (!file) return;

    const proceed = window.confirm(
      'Importing replaces everything on this device with the contents of this file. ' +
        'This cannot be undone. Continue?',
    );
    if (!proceed) return;

    setBusy(true);
    try {
      const text = await file.text();
      await importBackup(text);
      await init();
      setStatus({ kind: 'ok', text: 'Backup imported.' });
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? `Import failed: ${err.message}` : 'Import failed.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="tabs sub">
        <button className="tab" data-active={tab === 'general'} onClick={() => setTab('general')}>
          General
        </button>
        <button className="tab" data-active={tab === 'words'} onClick={() => setTab('words')}>
          Word list
        </button>
      </div>

      {tab === 'general' ? (
        <>
          <p className="muted">
            Your progress lives only in this browser, on this device - there is no account and no
            server. Moving it anywhere else, including into an installed home-screen copy of this
            same app, means exporting it here and importing it there.
          </p>

          <div className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Cards per session</div>
              <div className="muted" style={{ fontSize: 13 }}>
                The ceiling on one sitting, everything included. Nothing is skipped by choosing a
                short session - whatever does not fit stays due and leads the next one.
              </div>
            </div>
            <div className="row" role="group" aria-label="Cards per session">
              {SESSION_LENGTHS.map((n) => (
                <button
                  key={n}
                  className="pill pressable"
                  aria-pressed={sessionLength === n}
                  data-active={sessionLength === n}
                  onClick={() => void setSessionLength(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Typing exercises</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Off means sessions ask you to read and recall, never to spell. Spelling is still
                there whenever you want it, under Extras &gt; Writing practice, and the cards keep
                their history either way.
              </div>
            </div>
            <button
              className="btn secondary"
              aria-pressed={typingEnabled}
              onClick={() => void setTypingEnabled(!typingEnabled)}
            >
              {typingEnabled ? 'Typing is on — turn it off' : 'Typing is off — turn it on'}
            </button>
          </div>

          <div className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Export a backup</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Downloads every word's progress, review history and mnemonics as one file.
              </div>
            </div>
            <button className="btn secondary" onClick={() => void handleExport()} disabled={busy}>
              Download backup
            </button>
          </div>

          <div className="card" style={{ minHeight: 0, alignItems: 'stretch', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Import a backup</div>
              <div className="muted" style={{ fontSize: 13 }}>
                Replaces everything on this device with what's in the file - there is no merge, so
                only do this on the device you want the backup's data to win on.
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              aria-label="Backup file"
              onChange={(e) => void handleFileChange(e)}
              style={{ display: 'none' }}
            />
            <button className="btn secondary" onClick={handleImportClick} disabled={busy}>
              Choose backup file
            </button>
          </div>

          {status && <div className={status.kind === 'ok' ? 'banner calm' : 'banner'}>{status.text}</div>}
        </>
      ) : (
        <>
          <p className="muted">
            Remove a word or a whole lesson to hide it from the path, sessions and Extras - nothing
            is deleted, and unchecking it brings it straight back. Add a word to start a new lesson
            or extend one you already made.
          </p>
          <WordListManager lexemes={lexemes} unitTitles={unitTitles} />
        </>
      )}
    </div>
  );
}
