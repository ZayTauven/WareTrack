import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { ApiInvitation, ApiInvitationCreated, ApiMember } from '../api/contract.ts';
import { changeRole, invite, listInvitations, listMembers, removeMember, revokeInvitation } from '../app/team.ts';
import { assignableRoles, can, canManageMember, ROLE_LABEL, type Role } from '../domain/permissions.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import './team.css';

type Feedback = { tone: 'ok' | 'alert'; text: string } | null;

const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const roleLabel = (role: string) => ROLE_LABEL[role as Role] ?? role;

function initials(member: ApiMember): string {
  const name = `${member.firstName} ${member.lastName}`.trim();
  return (name || member.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function MemberRow({
  member,
  actorRole,
  isSelf,
  onChanged,
  report,
}: {
  member: ApiMember;
  actorRole: string | undefined;
  isSelf: boolean;
  onChanged: () => void;
  report: (feedback: Feedback) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const manageable = canManageMember(actorRole, member.role, isSelf);
  const name = `${member.firstName} ${member.lastName}`.trim();

  const setRole = async (role: Role) => {
    setBusy(true);
    const result = await changeRole(member.id, role);
    setBusy(false);
    report(result.ok ? { tone: 'ok', text: `${name || member.email} is now ${roleLabel(role)}.` } : { tone: 'alert', text: result.message });
    if (result.ok) onChanged();
  };

  const remove = async () => {
    setBusy(true);
    const result = await removeMember(member.id);
    setBusy(false);
    setConfirming(false);
    report(result.ok ? { tone: 'ok', text: `${name || member.email} was removed.` } : { tone: 'alert', text: result.message });
    if (result.ok) onChanged();
  };

  return (
    <li className="member">
      <span className="member__avatar" aria-hidden="true">
        {initials(member)}
      </span>
      <span className="member__who">
        <span className="member__name">
          {name || member.email}
          {isSelf && <span className="tag">You</span>}
        </span>
        {name && <span className="member__email">{member.email}</span>}
      </span>
      {manageable ? (
        <select
          className="member__role"
          value={member.role}
          disabled={busy}
          aria-label={`Role of ${name || member.email}`}
          onChange={(event) => void setRole(event.target.value as Role)}
        >
          {assignableRoles(actorRole).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      ) : (
        <span className="member__role-tag">{roleLabel(member.role)}</span>
      )}
      {manageable &&
        (confirming ? (
          <span
            className="member__confirm"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.stopPropagation(); // cancel the confirmation, not the whole dialog
              event.preventDefault();
              setConfirming(false);
            }}
          >
            <button
              type="button"
              className="team-button"
              data-variant="danger"
              disabled={busy}
              autoFocus
              aria-label={`Confirm removing ${name || member.email}`}
              onClick={() => void remove()}
            >
              Remove
            </button>
            <button type="button" className="team-link" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="team-link"
            aria-label={`Remove ${name || member.email}`}
            onClick={() => setConfirming(true)}
          >
            Remove
          </button>
        ))}
    </li>
  );
}

function InviteForm({ actorRole, onCreated }: { actorRole: string | undefined; onCreated: (created: ApiInvitationCreated) => void }) {
  const roles = assignableRoles(actorRole);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorId = useId();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    const result = await invite(String(data.get('email') ?? '').trim(), String(data.get('role')) as Role);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    form.reset();
    onCreated(result.value);
  };

  return (
    <form className="invite" onSubmit={submit}>
      <label className="field">
        <span className="field__label">Email</span>
        <input className="field__input" name="email" type="email" required placeholder="name@company.com" aria-describedby={error ? errorId : undefined} />
      </label>
      <label className="field invite__role">
        <span className="field__label">Role</span>
        <select className="field__input" name="role" defaultValue="operator">
          {roles.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="team-button" data-variant="primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create invite link'}
      </button>
      {error && (
        <p id={errorId} className="team-feedback" data-tone="alert" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function CreatedLink({ created, onDismiss }: { created: ApiInvitationCreated; onDismiss: () => void }) {
  const url = `${window.location.origin}${created.path}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="created-link" role="status">
      <p className="created-link__title">
        Invite link for <strong>{created.email}</strong> ({roleLabel(created.role)})
      </p>
      <div className="created-link__row">
        <input className="field__input created-link__url" readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          className="team-button"
          onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="created-link__note">
        Send it to them yourself. It works once, expires {dateFormat.format(new Date(created.expiresAt))}, and will not be
        shown again.
      </p>
      <button type="button" className="team-link" onClick={onDismiss}>
        Done
      </button>
    </div>
  );
}

/** Team of the organization in focus: members, roles, invitations. */
export function TeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const workspace = useWarehouse((s) => s.workspace);
  const user = useWarehouse((s) => s.user);
  const actorRole = workspace?.role;
  const manages = can(actorRole, 'members.manage');

  const [members, setMembers] = useState<ApiMember[] | null>(null);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [created, setCreated] = useState<ApiInvitationCreated | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [team, pending] = await Promise.all([listMembers(), manages ? listInvitations() : Promise.resolve(null)]);
    if (!team.ok) return setLoadError(team.message);
    setLoadError(null);
    setMembers(team.value);
    if (pending?.ok) setInvitations(pending.value);
  }, [manages]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      setFeedback(null);
      setCreated(null);
      void load();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, load]);

  const revoke = async (invitation: ApiInvitation) => {
    const result = await revokeInvitation(invitation.id);
    setFeedback(result.ok ? { tone: 'ok', text: `Invitation for ${invitation.email} withdrawn.` } : { tone: 'alert', text: result.message });
    void load();
  };

  return (
    <dialog
      ref={dialogRef}
      className="team hud-panel"
      aria-labelledby="team-title"
      onClose={onClose}
      onKeyDown={(event) => event.key === 'Escape' && event.stopPropagation()}
    >
      <header className="team__header">
        <p className="eyebrow">Team</p>
        <h2 id="team-title" className="team__title">
          {workspace?.name}
        </h2>
        <button type="button" className="inspector__close" aria-label="Close team" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </header>

      <div className="team__body">
        {loadError && (
          <p className="team-feedback" data-tone="alert" role="alert">
            {loadError}
          </p>
        )}

        <section aria-labelledby="members-title">
          <h3 id="members-title" className="eyebrow section__title">
            Members {members && <span className="muted">· {members.length}</span>}
          </h3>
          {members ? (
            <ul className="members">
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  actorRole={actorRole}
                  isSelf={member.email === user?.email}
                  onChanged={() => void load()}
                  report={setFeedback}
                />
              ))}
            </ul>
          ) : (
            !loadError && <p className="empty">Loading the team…</p>
          )}
          {feedback && (
            <p className="team-feedback" data-tone={feedback.tone} role={feedback.tone === 'alert' ? 'alert' : 'status'}>
              {feedback.text}
            </p>
          )}
        </section>

        {manages ? (
          <section className="team__section" aria-labelledby="invite-title">
            <h3 id="invite-title" className="eyebrow section__title">
              Invite someone
            </h3>
            {created ? (
              <CreatedLink created={created} onDismiss={() => setCreated(null)} />
            ) : (
              <InviteForm
                actorRole={actorRole}
                onCreated={(value) => {
                  setCreated(value);
                  void load();
                }}
              />
            )}
            {invitations.length > 0 && (
              <>
                <h3 className="eyebrow section__title team__pending-title">Waiting to join</h3>
                <ul className="invitations">
                  {invitations.map((invitation) => (
                    <li key={invitation.id} className="invitation">
                      <span className="invitation__email">{invitation.email}</span>
                      <span className="member__role-tag">{roleLabel(invitation.role)}</span>
                      <span className="invitation__expiry">until {dateFormat.format(new Date(invitation.expiresAt))}</span>
                      <button type="button" className="team-link" onClick={() => void revoke(invitation)}>
                        Withdraw
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : (
          <p className="empty team__section">Admins and owners can invite people and change roles.</p>
        )}
      </div>
    </dialog>
  );
}
