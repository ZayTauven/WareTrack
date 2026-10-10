import { useEffect, type ReactNode } from 'react';
import type { DockId, ForkliftId, RackId, Shipment, TruckId, TruckStatus, WarehouseData } from '../data/index.ts';
import {
  activeShipmentOfTruck,
  arrivalDelayMinutes,
  byId,
  dockOccupancy,
  forkliftsOnShipment,
  isActive,
  isLowStock,
  itemsInRack,
  truckAtDock,
} from '../domain/selectors.ts';
import { useWarehouse, type Selection } from '../store/warehouseStore.ts';
import {
  DOCK_STATUS,
  FORKLIFT_STATUS,
  SHIPMENT_STATUS,
  TRUCK_STATUS,
  formatAgo,
  formatClock,
  formatClockSeconds,
  formatPercent,
  type Tone,
} from './format.ts';
import { DockActions, ForkliftActions, TruckActions } from './Actions.tsx';
import { Meter } from './Meter.tsx';
import { useNow } from './useNow.ts';
import './inspector.css';

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const STAGES = ['Road', 'Yard', 'Dock'] as const;
const STAGE_OF: Record<TruckStatus, number> = { in_transit: 0, waiting: 1, loading: 2, unloading: 2, idle: -1 };

/** Where the truck is in its turn: road, yard, dock. */
function StageTrack({ status }: { status: TruckStatus }) {
  const current = STAGE_OF[status];
  return (
    <ol className="stages" aria-label="Progress through the site">
      {STAGES.map((stage, i) => (
        <li key={stage} className="stages__step" data-state={i < current ? 'done' : i === current ? 'current' : 'next'} aria-current={i === current ? 'step' : undefined}>
          <span className="stages__bar" />
          {stage}
        </li>
      ))}
    </ol>
  );
}

function Header({ eyebrow, title }: { eyebrow: string; title: string }) {
  const clearSelection = useWarehouse((s) => s.clearSelection);
  return (
    <header className="inspector__header">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="inspector__title">{title}</h2>
      <button type="button" className="inspector__close" onClick={clearSelection} aria-label="Close inspector">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </button>
    </header>
  );
}

function Status({ label, tone, meta }: { label: string; tone: Tone; meta?: string }) {
  return (
    <div className="status" data-tone={tone} aria-live="polite">
      <span className="status__dot" />
      <span className="status__label">{label}</span>
      {meta && <span className="status__meta">{meta}</span>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="eyebrow section__title">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/** Jumps the inspector to a related object. */
function Jump({ to, children }: { to: Selection; children: ReactNode }) {
  const select = useWarehouse((s) => s.select);
  return (
    <button type="button" className="jump" onClick={() => select(to)}>
      {children}
    </button>
  );
}

function LiveStamp({ updatedAt }: { updatedAt: string | null }) {
  const now = useNow();
  return (
    <footer className="live">
      {updatedAt ? (
        <>
          <span className="live__dot" key={updatedAt} aria-hidden="true" />
          <span>Updated {formatAgo(updatedAt, now)}</span>
          <time className="live__time" dateTime={updatedAt}>
            {formatClockSeconds(updatedAt)}
          </time>
        </>
      ) : (
        <span>No activity reported</span>
      )}
    </footer>
  );
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

function ShipmentDetails({ data, shipment }: { data: WarehouseData; shipment: Shipment }) {
  const delay = arrivalDelayMinutes(shipment);
  const dock = shipment.dockId ? byId(data.docks, shipment.dockId) : undefined;
  return (
    <>
      <div className="shipment__head">
        <span className="ref">{shipment.reference}</span>
        <span className="tag">{shipment.direction}</span>
      </div>
      <p className="shipment__party">{shipment.counterparty}</p>
      <dl className="facts">
        <dt>Status</dt>
        <dd>{SHIPMENT_STATUS[shipment.status]}</dd>
        <dt>{shipment.status === 'in_transit' || shipment.status === 'scheduled' ? 'Arrival' : 'Arrived'}</dt>
        <dd>
          <span className="mono">{formatClock(shipment.eta)}</span>
          <span className="chip" data-tone={delay > 0 ? 'alert' : 'ok'}>
            {delay > 0 ? `${delay} min late` : 'On time'}
          </span>
        </dd>
        <dt>Promised</dt>
        <dd className="mono">{formatClock(shipment.promisedAt)}</dd>
        {dock && (
          <>
            <dt>Dock</dt>
            <dd>
              <Jump to={{ kind: 'dock', id: dock.id }}>{dock.name}</Jump>
            </dd>
          </>
        )}
      </dl>
      {shipment.status === 'at_dock' && (
        <div className="gauge">
          <div className="gauge__label">
            <span>{shipment.direction === 'inbound' ? 'Unloaded' : 'Loaded'}</span>
            <span className="mono">{formatPercent(shipment.progress)}</span>
          </div>
          <Meter value={shipment.progress} label="Handling progress" tone="work" />
        </div>
      )}
      <ul className="lines">
        {shipment.lines.map((line) => {
          const item = byId(data.inventory, line.itemId);
          return (
            <li key={line.itemId}>
              <span className="mono">{item?.sku}</span>
              <span className="lines__name">{item?.name}</span>
              <span className="mono">{plural(line.quantity, item?.unit ?? 'unit')}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Panels, one per kind of object
// ---------------------------------------------------------------------------

function TruckPanel({ data, id }: { data: WarehouseData; id: TruckId }) {
  const truck = byId(data.trucks, id);
  if (!truck) return <Empty>This truck is no longer tracked.</Empty>;
  const shipment = activeShipmentOfTruck(data, id);
  const dock = truck.dockId ? byId(data.docks, truck.dockId) : undefined;
  const site = byId(data.sites, truck.siteId);
  return (
    <>
      <Header eyebrow={`Truck · ${truck.carrier}`} title={truck.name} />
      <div className="inspector__body">
        <Status {...TRUCK_STATUS[truck.status]} meta={dock?.name ?? site?.name} />
        {truck.status !== 'idle' && <StageTrack status={truck.status} />}
        <Section title="Current shipment">
          {shipment ? <ShipmentDetails data={data} shipment={shipment} /> : <Empty>No active shipment. Parked until the next dispatch.</Empty>}
        </Section>
        <TruckActions data={data} truck={truck} />
      </div>
      <LiveStamp updatedAt={truck.updatedAt} />
    </>
  );
}

function ForkliftPanel({ data, id }: { data: WarehouseData; id: ForkliftId }) {
  const forklift = byId(data.forklifts, id);
  if (!forklift) return <Empty>This forklift is no longer tracked.</Empty>;
  const shipment = forklift.shipmentId ? byId(data.shipments, forklift.shipmentId) : undefined;
  const site = byId(data.sites, forklift.siteId);
  const batteryTone: Tone = forklift.status === 'charging' ? 'ok' : forklift.batteryPct < 25 ? 'alert' : 'work';
  return (
    <>
      <Header eyebrow={`Forklift · ${site?.name ?? ''}`} title={forklift.name} />
      <div className="inspector__body">
        <Status {...FORKLIFT_STATUS[forklift.status]} meta={forklift.operator ?? 'No operator'} />
        <div className="gauge">
          <div className="gauge__label">
            <span>Battery</span>
            <span className="mono">{forklift.batteryPct}%</span>
          </div>
          <Meter value={forklift.batteryPct / 100} label="Battery level" tone={batteryTone} />
        </div>
        <Section title="Current shipment">
          {shipment ? (
            <ShipmentDetails data={data} shipment={shipment} />
          ) : (
            <Empty>{forklift.status === 'maintenance' ? 'Out of service until maintenance is signed off.' : 'Not assigned to a shipment.'}</Empty>
          )}
        </Section>
        <ForkliftActions data={data} forklift={forklift} />
      </div>
      <LiveStamp updatedAt={forklift.updatedAt} />
    </>
  );
}

function DockPanel({ data, id }: { data: WarehouseData; id: DockId }) {
  const dock = byId(data.docks, id);
  if (!dock) return <Empty>This dock no longer exists.</Empty>;
  const site = byId(data.sites, dock.siteId);
  const truck = truckAtDock(data, id);
  const shipment = truck ? activeShipmentOfTruck(data, truck.id) : undefined;
  const queued = data.shipments.filter((s) => s.dockId === id && s.status === 'at_yard');
  const crew = shipment ? forkliftsOnShipment(data, shipment.id) : [];
  return (
    <>
      <Header eyebrow={`Dock · ${site?.name ?? ''}`} title={dock.name} />
      <div className="inspector__body">
        <Status {...DOCK_STATUS[dockOccupancy(data, dock)]} meta={truck ? truck.name : undefined} />
        <Section title="Current shipment">
          {truck && shipment ? (
            <>
              <dl className="facts">
                <dt>Truck</dt>
                <dd>
                  <Jump to={{ kind: 'truck', id: truck.id }}>{truck.name}</Jump> <span className="muted">{truck.carrier}</span>
                </dd>
                <dt>Forklifts</dt>
                <dd>
                  {crew.length
                    ? crew.map((f) => (
                        <Jump key={f.id} to={{ kind: 'forklift', id: f.id }}>
                          {f.name}
                        </Jump>
                      ))
                    : 'None assigned'}
                </dd>
              </dl>
              <ShipmentDetails data={data} shipment={shipment} />
            </>
          ) : (
            <Empty>{dock.state === 'maintenance' ? 'Door closed for maintenance.' : 'No truck at this door.'}</Empty>
          )}
        </Section>
        {queued.length > 0 && (
          <Section title="Next in line">
            <ul className="list">
              {queued.map((s) => {
                const next = s.truckId ? byId(data.trucks, s.truckId) : undefined;
                return (
                  <li key={s.id}>
                    <span className="ref">{s.reference}</span>
                    {next && <Jump to={{ kind: 'truck', id: next.id }}>{next.name}</Jump>}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
        <DockActions data={data} dock={dock} />
      </div>
      <LiveStamp updatedAt={truck?.updatedAt ?? dock.updatedAt} />
    </>
  );
}

function RackPanel({ data, id }: { data: WarehouseData; id: RackId }) {
  const rack = byId(data.racks, id);
  if (!rack) return <Empty>This rack no longer exists.</Empty>;
  const site = byId(data.sites, rack.siteId);
  const items = itemsInRack(data, id);
  const low = items.filter(isLowStock).length;
  const itemIds = new Set(items.map((item) => item.id));
  const linked = data.shipments.filter((s) => isActive(s) && s.lines.some((line) => itemIds.has(line.itemId)));
  const lastUpdate = items.reduce<string | null>((latest, item) => (!latest || item.updatedAt > latest ? item.updatedAt : latest), null);
  const status = items.length === 0
    ? { label: 'Empty', tone: 'idle' as const }
    : low > 0
      ? { label: `${low} low on stock`, tone: 'alert' as const }
      : { label: 'Stocked', tone: 'ok' as const };
  return (
    <>
      <Header eyebrow={`Rack · Zone ${rack.zone} · ${site?.code ?? ''}`} title={rack.code} />
      <div className="inspector__body">
        <Status {...status} meta={`${rack.levels} levels`} />
        <Section title="Stored here">
          {items.length ? (
            <ul className="stock">
              {items.map((item) => (
                <li key={item.id} data-low={isLowStock(item) || undefined}>
                  <span className="stock__level mono">L{item.level}</span>
                  <span className="stock__name">
                    {item.name}
                    <span className="mono muted">{item.sku}</span>
                  </span>
                  <span className="stock__qty mono">
                    {item.quantity}
                    <span className="muted"> / {item.reorderPoint}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No stock recorded on this rack.</Empty>
          )}
        </Section>
        <Section title="Current shipment">
          {linked.length ? (
            <ul className="list">
              {linked.map((s) => (
                <li key={s.id}>
                  <span className="ref">{s.reference}</span>
                  <span className="tag">{s.direction}</span>
                  <span className="muted">{SHIPMENT_STATUS[s.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No active shipment moves stock from this rack.</Empty>
          )}
        </Section>
      </div>
      <LiveStamp updatedAt={lastUpdate} />
    </>
  );
}

/** Live status of the selected object. Re-renders on each update; the 3D scene does not. */
export function Inspector() {
  const selection = useWarehouse((s) => s.selection);
  const data = useWarehouse((s) => s.data);
  const clearSelection = useWarehouse((s) => s.clearSelection);

  useEffect(() => {
    if (!selection) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && clearSelection();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, clearSelection]);

  if (!selection) return null;
  return (
    <aside className="inspector" aria-label="Inspector" key={`${selection.kind}:${selection.id}`}>
      {selection.kind === 'truck' && <TruckPanel data={data} id={selection.id} />}
      {selection.kind === 'forklift' && <ForkliftPanel data={data} id={selection.id} />}
      {selection.kind === 'dock' && <DockPanel data={data} id={selection.id} />}
      {selection.kind === 'rack' && <RackPanel data={data} id={selection.id} />}
    </aside>
  );
}
