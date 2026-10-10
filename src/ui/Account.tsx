import { useEffect, useId, useRef, useState } from 'react';
import { signOutNow, switchWorkspace } from '../app/session.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import type { Tone } from './format.ts';
import { TeamDialog } from './TeamDialog.tsx';

const LIVE_LABEL = {
  live: { label: 'Live', tone: 'ok' },
  connecting: { label: 'Connecting', tone: 'work' },
  reconnecting: { label: 'Reconnecting', tone: 'work' },
} as const satisfies Record<string, { label: string; tone: Tone }>;

/** Whether the map is receiving live updates. */
export function LiveBadge() {
  const live = useWarehouse((s) => s.live);
  const { label, tone } = LIVE_LABEL[live];
  return (
    <span className="live-badge" data-tone={tone} data-state={live} role="status" aria-live="polite">
      <span className="live-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', operator: 'Operator', viewer: 'Viewer' };

/** Signed-in user, their organization and sign-out. Disclosure: a button and the panel it opens. */
export function AccountMenu() {
  const user = useWarehouse((s) => s.user);
  const workspace = useWarehouse((s) => s.workspace);
  const [open, setOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const initials = (name || user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="account" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="account__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account: ${user.email}`}
        onClick={() => setOpen((value) => !value)}
      >
        {initials}
      </button>
      {open && (
        <div id={panelId} className="account__panel hud-panel">
          <p className="eyebrow">Signed in as</p>
          <p className="account__email">{name || user.email}</p>
          {name && <p className="account__meta">{user.email}</p>}
          {workspace && (
            <p className="account__org">
              {workspace.name}
              <span className="tag">{ROLE_LABEL[workspace.role] ?? workspace.role}</span>
            </p>
          )}
          {user.organizations.length > 1 && (
            <div className="account__switch" role="group" aria-label="Switch organization">
              {user.organizations
                .filter((org) => org.slug !== workspace?.slug)
                .map((org) => (
                  <button
                    key={org.slug}
                    type="button"
                    className="account__switch-option"
                    onClick={() => {
                      setOpen(false);
                      void switchWorkspace(org.slug);
                    }}
                  >
                    Switch to {org.name}
                    <span className="tag">{ROLE_LABEL[org.role] ?? org.role}</span>
                  </button>
                ))}
            </div>
          )}
          <button
            type="button"
            className="account__team"
            onClick={() => {
              setOpen(false);
              setTeamOpen(true);
            }}
          >
            Team
          </button>
          <button
            type="button"
            className="account__signout"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOutNow();
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
      <TeamDialog
        open={teamOpen}
        onClose={() => {
          setTeamOpen(false);
          buttonRef.current?.focus();
        }}
      />
    </div>
  );
}
