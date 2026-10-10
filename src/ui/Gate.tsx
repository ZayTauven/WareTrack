import { useId, useState, type FormEvent } from 'react';
import { ApiError } from '../api/http.ts';
import { retryLoading, signInWithPassword, signOutNow } from '../app/session.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import { BrandMark } from './BrandMark.tsx';
import './gate.css';

function Brand() {
  return (
    <div className="gate__brand">
      <BrandMark className="gate__mark" />
      <span className="gate__name">WareTrack</span>
    </div>
  );
}

export function SignInScreen() {
  const notice = useWarehouse((s) => s.notice);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await signInWithPassword(String(form.get('email') ?? '').trim(), String(form.get('password') ?? ''));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Signing in failed. Check your connection, then try again.');
      setSubmitting(false);
    }
  };

  return (
    <main className="gate">
      <section className="gate__card hud-panel" aria-labelledby="sign-in-title">
        <Brand />
        <p className="eyebrow">Operations console</p>
        <h1 id="sign-in-title" className="gate__title">
          Sign in
        </h1>
        {notice && !error && <p className="gate__notice">{notice}</p>}
        <form className="gate__form" onSubmit={onSubmit} noValidate={false}>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="field__input"
              name="email"
              type="email"
              autoComplete="username"
              required
              autoFocus
              aria-describedby={error ? errorId : undefined}
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="field__input"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-describedby={error ? errorId : undefined}
            />
          </label>
          {error && (
            <p id={errorId} className="gate__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="gate__submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

/** Shown while restoring a session, loading the operation, or after loading failed. */
export function StatusScreen() {
  const status = useWarehouse((s) => s.status);
  const workspace = useWarehouse((s) => s.workspace);
  const notice = useWarehouse((s) => s.notice);
  const failed = status === 'failed';
  const message = failed ? notice : status === 'loading' && workspace ? `Loading ${workspace.name}` : 'Restoring your session';

  return (
    <main className="gate" aria-busy={!failed}>
      <section className="gate__status" aria-live="polite">
        <BrandMark className={failed ? 'gate__mark gate__mark--large' : 'gate__mark gate__mark--large gate__mark--busy'} />
        <p className={failed ? 'gate__failure' : 'gate__progress'}>{message}</p>
        {failed && (
          <div className="gate__actions">
            <button type="button" className="gate__submit" onClick={retryLoading}>
              Retry
            </button>
            <button type="button" className="gate__link" onClick={() => void signOutNow()}>
              Sign out
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
