import { useState, type ReactNode } from 'react';
import { assignForklift, chargeForklift, dockTruck, setDockState, type ActionResult } from '../app/actions.ts';
import type { Dock, Forklift, Truck, WarehouseData } from '../data/index.ts';
import { can, requiredRole, ROLE_LABEL, type Ability } from '../domain/permissions.ts';
import { activeShipmentOfTruck, byId, forkliftsOnShipment, truckAtDock } from '../domain/selectors.ts';
import { useWarehouse } from '../store/warehouseStore.ts';

/** Battery below which the server refuses to assign a forklift (Rates.BATTERY_CRITICAL). */
const MIN_ASSIGN_BATTERY = 15;

type Feedback = { tone: 'ok' | 'alert'; text: string } | null;

/** Runs one action at a time and remembers how the last one went. */
function useRunner() {
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const run = async (key: string, action: () => Promise<ActionResult>, success: string) => {
    setPending(key);
    setFeedback(null);
    const result = await action();
    setPending(null);
    setFeedback(result.ok ? { tone: 'ok', text: success } : { tone: 'alert', text: result.message });
  };
  return { pending, feedback, run };
}

function Actions({ ability, children, feedback }: { ability: Ability; children?: ReactNode; feedback: Feedback }) {
  const role = useWarehouse((s) => s.workspace?.role);
  return (
    <section className="section actions" aria-label="Actions">
      <h3 className="eyebrow section__title">Actions</h3>
      {can(role, ability) ? (
        <>
          {children}
          {feedback && (
            <p className="actions__feedback" data-tone={feedback.tone} role={feedback.tone === 'alert' ? 'alert' : 'status'}>
              {feedback.text}
            </p>
          )}
        </>
      ) : (
        <p className="empty">
          As {ROLE_LABEL[role as keyof typeof ROLE_LABEL] ?? 'a guest'}, you can follow this but not change it. Changing it
          needs the {ROLE_LABEL[requiredRole(ability)]} role.
        </p>
      )}
    </section>
  );
}

function Option({
  label,
  meta,
  disabled,
  pending,
  current,
  onClick,
}: {
  label: string;
  meta?: string;
  disabled?: boolean;
  pending?: boolean;
  current?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="action-option"
      data-current={current || undefined}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      onClick={onClick}
    >
      <span className="action-option__label">{pending ? 'Working…' : label}</span>
      {meta && <span className="action-option__meta">{meta}</span>}
    </button>
  );
}

/** A truck waiting in the yard can be sent to a dock of its site. */
export function TruckActions({ data, truck }: { data: WarehouseData; truck: Truck }) {
  const { pending, feedback, run } = useRunner();
  const shipment = activeShipmentOfTruck(data, truck.id);
  if (truck.status !== 'waiting' || !shipment) {
    // Once docked the truck has nothing left to send; keep the confirmation in view.
    return feedback ? <Actions ability="truck.dock" feedback={feedback} /> : null;
  }

  const docks = data.docks.filter((d) => d.siteId === truck.siteId).sort((a, b) => a.number - b.number);
  return (
    <Actions ability="truck.dock" feedback={feedback}>
      <p className="actions__hint">Send to a dock</p>
      <div className="action-options">
        {docks.map((dock) => {
          const occupant = truckAtDock(data, dock.id);
          const meta =
            dock.state === 'maintenance' ? 'Maintenance' : occupant ? occupant.name : dock.id === shipment.dockId ? 'Planned' : 'Free';
          return (
            <Option
              key={dock.id}
              label={dock.name}
              meta={meta}
              disabled={dock.state === 'maintenance' || Boolean(occupant)}
              pending={pending === dock.id}
              current={dock.id === shipment.dockId}
              onClick={() => void run(dock.id, () => dockTruck(truck.id, dock.id), `${truck.name} sent to ${dock.name}.`)}
            />
          );
        })}
      </div>
    </Actions>
  );
}

/** A forklift can be put on a docked shipment of its site, released, or sent to charge. */
export function ForkliftActions({ data, forklift }: { data: WarehouseData; forklift: Forklift }) {
  const { pending, feedback, run } = useRunner();
  if (forklift.status === 'maintenance') return null;

  const docked = data.shipments.filter((s) => s.siteId === forklift.siteId && s.status === 'at_dock');
  const blocked = !forklift.operator
    ? 'No operator on this forklift.'
    : forklift.batteryPct < MIN_ASSIGN_BATTERY
      ? 'Battery too low: charge it first.'
      : null;

  return (
    <Actions ability="forklift.assign" feedback={feedback}>
      <p className="actions__hint">Work a shipment at the docks</p>
      {docked.length ? (
        <div className="action-options">
          {docked.map((shipment) => {
            const dock = shipment.dockId ? byId(data.docks, shipment.dockId) : undefined;
            const crew = forkliftsOnShipment(data, shipment.id).filter((f) => f.id !== forklift.id);
            const current = forklift.shipmentId === shipment.id;
            return (
              <Option
                key={shipment.id}
                label={shipment.reference}
                meta={current ? 'Current' : [dock?.name, crew.length ? `+${crew.length} forklift` : null].filter(Boolean).join(' · ')}
                current={current}
                disabled={current || Boolean(blocked)}
                pending={pending === shipment.id}
                onClick={() =>
                  void run(shipment.id, () => assignForklift(forklift.id, shipment.id), `${forklift.name} assigned to ${shipment.reference}.`)
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="empty">No shipment is being handled at a dock of this site.</p>
      )}
      {blocked && <p className="actions__note">{blocked}</p>}
      <div className="action-row">
        {forklift.shipmentId && (
          <button
            type="button"
            className="action-button"
            disabled={pending !== null}
            onClick={() => void run('release', () => assignForklift(forklift.id, null), `${forklift.name} released.`)}
          >
            {pending === 'release' ? 'Working…' : 'Release'}
          </button>
        )}
        {forklift.status !== 'charging' && (
          <button
            type="button"
            className="action-button"
            disabled={pending !== null}
            onClick={() => void run('charge', () => chargeForklift(forklift.id), `${forklift.name} sent to the charger.`)}
          >
            {pending === 'charge' ? 'Working…' : 'Send to charger'}
          </button>
        )}
      </div>
    </Actions>
  );
}

/** Admins take a dock out of service, or put it back. */
export function DockActions({ data, dock }: { data: WarehouseData; dock: Dock }) {
  const { pending, feedback, run } = useRunner();
  const occupant = truckAtDock(data, dock.id);
  const toMaintenance = dock.state === 'operational';
  return (
    <Actions ability="dock.state" feedback={feedback}>
      <div className="action-row">
        <button
          type="button"
          className="action-button"
          data-variant={toMaintenance ? 'caution' : 'primary'}
          disabled={pending !== null || (toMaintenance && Boolean(occupant))}
          onClick={() =>
            void run(
              'state',
              () => setDockState(dock.id, toMaintenance ? 'maintenance' : 'operational'),
              toMaintenance ? `${dock.name} is in maintenance.` : `${dock.name} is back in service.`,
            )
          }
        >
          {pending ? 'Working…' : toMaintenance ? 'Put in maintenance' : 'Back in service'}
        </button>
      </div>
      {toMaintenance && occupant && <p className="actions__note">{occupant.name} is at this dock: wait until it leaves.</p>}
    </Actions>
  );
}
