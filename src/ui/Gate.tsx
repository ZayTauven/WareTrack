import { useEffect, useId, useState, type FormEvent } from 'react';
import type { ApiInvitationPreview } from '../api/contract.ts';
import { ApiError, fetchInvitation } from '../api/http.ts';
import { joinWithInvitation, retryLoading, signInWithPassword, signOutNow } from '../app/session.ts';
import { ROLE_LABEL, type Role } from '../domain/permissions.ts';
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

const UNUSABLE: Record<string, string> = {
  expired: 'This invitation has expired. Ask the person who invited you for a new link.',
  accepted: 'This invitation has already been used. Sign in with your account instead.',
  revoked: 'This invitation was withdrawn. Ask the person who invited you for a new link.',
  missing: 'This invitation link is not valid. Check that you copied all of it.',
};

/** The page an invitation link opens: shows what it is for, then creates the account or confirms it. */
export function AcceptInviteScreen({ token, onLeave }: { token: string; onLeave: () => void }) {
  const [preview, setPreview] = useState<ApiInvitationPreview | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const errorId = useId();

  useEffect(() => {
    let cancelled = false;
    fetchInvitation(token)
      .then((value) => !cancelled && setPreview(value))
      .catch((failure: unknown) => !cancelled && setError(failure instanceof ApiError ? failure.message : 'The invitation could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!preview) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (!preview.accountExists && password !== String(form.get('confirm') ?? '')) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await joinWithInvitation(token, preview.slug, {
        password,
        firstName: String(form.get('firstName') ?? '').trim(),
        lastName: String(form.get('lastName') ?? '').trim(),
      });
      window.history.replaceState(null, '', '/');
      onLeave();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Joining failed. Check your connection, then try again.');
      setSubmitting(false);
    }
  };

  const unusable = preview === null ? 'missing' : preview && preview.status !== 'pending' ? preview.status : null;

  return (
    <main className="gate">
      <section className="gate__card hud-panel" aria-labelledby="invite-title" aria-busy={preview === undefined}>
        <Brand />
        <p className="eyebrow">Invitation</p>
        {preview === undefined && !error && <p className="gate__progress">Opening your invitation</p>}
        {unusable && (
          <>
            <h1 id="invite-title" className="gate__title">
              Link unavailable
            </h1>
            <p className="gate__notice">{UNUSABLE[unusable]}</p>
            <button type="button" className="gate__submit" onClick={onLeave}>
              Go to sign in
            </button>
          </>
        )}
        {preview && !unusable && (
          <>
            <h1 id="invite-title" className="gate__title">
              Join {preview.organization}
            </h1>
            <p className="gate__lede">
              <strong>{preview.email}</strong> is invited as <strong>{ROLE_LABEL[preview.role as Role] ?? preview.role}</strong>.
              {preview.accountExists ? ' Confirm with the password of your existing account.' : ' Set up your account.'}
            </p>
            <form className="gate__form" onSubmit={onSubmit}>
              <input type="email" name="email" value={preview.email} autoComplete="username" readOnly hidden />
              {!preview.accountExists && (
                <div className="gate__pair">
                  <label className="field">
                    <span className="field__label">First name</span>
                    <input className="field__input" name="firstName" autoComplete="given-name" />
                  </label>
                  <label className="field">
                    <span className="field__label">Last name</span>
                    <input className="field__input" name="lastName" autoComplete="family-name" />
                  </label>
                </div>
              )}
              <label className="field">
                <span className="field__label">{preview.accountExists ? 'Current password' : 'Password'}</span>
                <input
                  className="field__input"
                  name="password"
                  type="password"
                  required
                  autoFocus
                  minLength={preview.accountExists ? undefined : 10}
                  autoComplete={preview.accountExists ? 'current-password' : 'new-password'}
                  aria-describedby={error ? errorId : undefined}
                />
              </label>
              {!preview.accountExists && (
                <label className="field">
                  <span className="field__label">Confirm password</span>
                  <input className="field__input" name="confirm" type="password" required autoComplete="new-password" />
                </label>
              )}
              {error && (
                <p id={errorId} className="gate__error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="gate__submit" disabled={submitting}>
                {submitting ? 'Joining…' : `Join ${preview.organization}`}
              </button>
            </form>
          </>
        )}
        {error && preview === undefined && (
          <p className="gate__error" role="alert">
            {error}
          </p>
        )}
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
