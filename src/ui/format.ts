import type { ForkliftStatus, ShipmentStatus, TruckStatus } from '../data/index.ts';
import type { DockOccupancy } from '../domain/selectors.ts';

/** Colour family of a state; maps 1:1 to CSS tokens. */
export type Tone = 'work' | 'ok' | 'transit' | 'idle' | 'alert';

export const TRUCK_STATUS: Record<TruckStatus, { label: string; tone: Tone }> = {
  in_transit: { label: 'In transit', tone: 'transit' },
  waiting: { label: 'In yard', tone: 'idle' },
  loading: { label: 'Loading', tone: 'work' },
  unloading: { label: 'Unloading', tone: 'work' },
  idle: { label: 'Parked', tone: 'idle' },
};

export const FORKLIFT_STATUS: Record<ForkliftStatus, { label: string; tone: Tone }> = {
  idle: { label: 'Idle', tone: 'idle' },
  moving: { label: 'Moving', tone: 'work' },
  lifting: { label: 'Lifting', tone: 'work' },
  charging: { label: 'Charging', tone: 'ok' },
  maintenance: { label: 'Maintenance', tone: 'alert' },
};

export const DOCK_STATUS: Record<DockOccupancy, { label: string; tone: Tone }> = {
  free: { label: 'Free', tone: 'ok' },
  occupied: { label: 'Occupied', tone: 'work' },
  maintenance: { label: 'Maintenance', tone: 'alert' },
};

export const SHIPMENT_STATUS: Record<ShipmentStatus, string> = {
  scheduled: 'Scheduled',
  in_transit: 'On the road',
  at_yard: 'In the yard',
  at_dock: 'At the dock',
  completed: 'Completed',
};

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const clockWithSeconds = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const formatClock = (iso: string) => clock.format(new Date(iso));
export const formatClockSeconds = (iso: string) => clockWithSeconds.format(new Date(iso));

export function formatAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;
