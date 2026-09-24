import { useEffect, useMemo, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp, visibleLexemes } from './store.js';
import { PathScreen, buildPath, courseProgress } from './screens/PathScreen.js';
import { ExtrasScreen } from './screens/ExtrasScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { SessionScreen } from './screens/SessionScreen.js';

type View = 'path' | 'extras' | 'settings';

export function App() {
  const { ready, lexemes, cards, plan, cursor, issues, init, endSession, excludedLexemeIds } = useApp();
  const [view, setView] = useState<View>('path');
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    void init();
  }, [init]);

  const visible = useMemo(
    () => visibleLexemes({ lexemes, excludedLexemeIds }),
    [lexemes, excludedLexemeIds],
  );

  const unitTitles = useMemo(() => {
    const titles = new Map<number, string>();
    for (const lexeme of lexemes) {
      if (!titles.has(lexeme.unit)) {
        // Words added from inside the app carry no source file to name a
        // unit after; they always land in one unit of their own.
        const title =
          lexeme.sourceFile === 'custom'
            ? 'Your words'
            : (/(\d+)-([\w-]+)\.md$/u.exec(lexeme.sourceFile)?.[2]?.replace(/-/gu, ' ') ?? `Unit ${lexeme.unit}`);
        titles.set(lexeme.unit, title);
      }
    }
    return titles;
  }, [lexemes]);

  // The whole course's standing, for the header. Counted over what the path
  // shows, so a word removed in Settings stops counting here too.
  const course = useMemo(() => courseProgress(buildPath(visible, cards)), [visible, cards]);
  const share = (n: number) => (course.words === 0 ? 0 : (n / course.words) * 100);

  if (!ready) {
    return (
      <div className="app">
        <p className="muted center">Loading…</p>
      </div>
    );
  }

  if (plan) {
    return (
      <div className="app">
        <SessionScreen plan={plan} cursor={cursor} cards={cards} lexemes={lexemes} onFinish={endSession} />
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead-title">
          <h1>Hebrew</h1>
          <bdi className="he" lang="he" dir="rtl" aria-hidden="true">
            עברית
          </bdi>
        </div>
        <div className="course-bar" aria-hidden="true">
          <span data-kind="known" style={{ width: `${share(course.mastered)}%` }} />
          <span data-kind="learning" style={{ width: `${share(course.learning)}%` }} />
        </div>
        {/* "Known" rather than "mastered": the lesson preview says "mastered"
            and sits under this header, and one screen should not carry two
            numbers labelled the same way. */}
        <div className="course-counts">
          <span>
            <b>{course.mastered}</b> of {course.words} words known
          </span>
          <span>
            <b>{course.learning}</b> in progress
          </span>
        </div>
      </header>

      {errors.length > 0 && (
        <div className="banner">
          {errors.length} content error{errors.length === 1 ? '' : 's'}. Run{' '}
          <code>npm run content:check</code> to see them.
        </div>
      )}

      {needRefresh && (
        <div className="banner calm">
          An update is ready.{' '}
          <button className="link-btn" onClick={() => void updateServiceWorker(true)}>
            Reload to apply
          </button>
        </div>
      )}

      <nav className="tabs">
        <button className="tab" data-active={view === 'path'} onClick={() => setView('path')}>
          Path
        </button>
        <button className="tab" data-active={view === 'extras'} onClick={() => setView('extras')}>
          Extras
        </button>
        <button className="tab" data-active={view === 'settings'} onClick={() => setView('settings')}>
          Settings
        </button>
      </nav>

      {view === 'path' && <PathScreen lexemes={visible} cards={cards} unitTitles={unitTitles} />}
      {view === 'extras' && <ExtrasScreen lexemes={visible} unitTitles={unitTitles} />}
      {view === 'settings' && <SettingsScreen lexemes={lexemes} unitTitles={unitTitles} />}
    </div>
  );
}
