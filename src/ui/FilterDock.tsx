import { useShallow } from 'zustand/react/shallow';
import type { TruckStatus } from '../data/index.ts';
import { NO_FILTERS, truckMatches } from '../domain/kpis.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import { TRUCK_STATUS } from './format.ts';

const STATUS_ORDER: TruckStatus[] = ['in_transit', 'waiting', 'unloading', 'loading', 'idle'];

/** Bottom-left command bar: narrows which trucks the map shows. */
export function FilterDock() {
  const filters = useWarehouse((s) => s.filters);
  const setFilters = useWarehouse((s) => s.setFilters);
  const counts = useWarehouse(
    useShallow((s) => {
      const trucks = s.data.trucks.filter((t) => t.siteId === s.siteId);
      const count = (status: TruckStatus) => trucks.filter((t) => t.status === status).length;
      return {
        all: trucks.length,
        delayed: trucks.filter((t) => truckMatches(s.data, t, { ...NO_FILTERS, delayedOnly: true })).length,
        in_transit: count('in_transit'),
        waiting: count('waiting'),
        unloading: count('unloading'),
        loading: count('loading'),
        idle: count('idle'),
      };
    }),
  );
  const filtered = filters.delayedOnly || filters.status !== 'all';

  return (
    <div className="dock hud-panel" role="group" aria-label="Truck filters">
      {/* First, outside the scrolling area and always present: in reach, and the chips never shift. */}
      <button type="button" className="dock__clear" disabled={!filtered} onClick={() => setFilters(NO_FILTERS)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
        Clear filters
      </button>

      <span className="dock__divider" aria-hidden="true" />

      <div className="dock__scroll">
        <label className="toggle" data-tone="alert">
          <input type="checkbox" checked={filters.delayedOnly} onChange={(e) => setFilters({ delayedOnly: e.target.checked })} />
          <span className="chip-face">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.8V8l2.2 1.6" />
            </svg>
            Delayed only
            <span className="count">{counts.delayed}</span>
          </span>
        </label>

        <span className="dock__divider" aria-hidden="true" />

        <fieldset className="segmented">
          <legend className="sr-only">Truck status</legend>
          {(['all', ...STATUS_ORDER] as const).map((status) => (
            <label key={status} className="segment" data-tone={status === 'all' ? undefined : TRUCK_STATUS[status].tone}>
              <input
                type="radio"
                name="truck-status"
                value={status}
                checked={filters.status === status}
                onChange={() => setFilters({ status })}
              />
              <span className="chip-face">
                {status !== 'all' && <span className="segment__dot" aria-hidden="true" />}
                {status === 'all' ? 'All trucks' : TRUCK_STATUS[status].label}
                <span className="count">{counts[status]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
