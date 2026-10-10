import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { SiteId } from '../data/index.ts';
import { siteKpis } from '../domain/kpis.ts';
import { useWarehouse } from '../store/warehouseStore.ts';
import { formatPercent, type Tone } from './format.ts';
import { Meter } from './Meter.tsx';
import './hud.css';

// ---------------------------------------------------------------------------
// Brand mark: three blades of an exploded hexagon, an isometric cube seen edge-on.
// ---------------------------------------------------------------------------

const MARK_OUTER = 44;
const MARK_INNER = 17;
const MARK_GAP = 3.5;

function bladePath(startDeg: number): string {
  const at = (radius: number, deg: number) => {
    const rad = (deg * Math.PI) / 180;
    const mid = ((startDeg + 60) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(rad) + MARK_GAP * Math.cos(mid)).toFixed(2)} ${(50 + radius * Math.sin(rad) + MARK_GAP * Math.sin(mid)).toFixed(2)}`;
  };
  const points = [
    at(MARK_OUTER, startDeg),
    at(MARK_OUTER, startDeg + 60),
    at(MARK_OUTER, startDeg + 120),
    at(MARK_INNER, startDeg + 120),
    at(MARK_INNER, startDeg + 60),
    at(MARK_INNER, startDeg),
  ];
  return `M${points.join('L')}Z`;
}

const BLADES = [
  { d: bladePath(-90), fill: '#ff7a24' },
  { d: bladePath(30), fill: '#e85d0c' },
  { d: bladePath(150), fill: '#ff9147' },
];

function Brand() {
  return (
    <div className="brand">
      <svg className="brand__mark" viewBox="0 0 100 100" aria-hidden="true">
        {BLADES.map((blade) => (
          <path key={blade.fill} d={blade.d} fill={blade.fill} stroke={blade.fill} strokeWidth={4} strokeLinejoin="round" />
        ))}
      </svg>
      <span className="brand__name">WareTrack</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site selector: button + listbox, keyboard operable.
// ---------------------------------------------------------------------------

function SiteSelector() {
  const sites = useWarehouse((s) => s.data.sites);
  const siteId = useWarehouse((s) => s.siteId);
  const selectSite = useWarehouse((s) => s.selectSite);
  const docksBySite = useWarehouse(
    useShallow((s) => s.data.sites.map((site) => {
      const k = siteKpis(s.data, site.id);
      return `${k.docksInUse}/${k.docksOperational}`;
    })),
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = sites.find((site) => site.id === siteId);

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, sites.findIndex((site) => site.id === siteId)));
    setOpen(true);
  };

  const choose = (id: SiteId) => {
    selectSite(id);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = sites.length - 1;
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(last, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Escape: () => {
        setOpen(false);
        buttonRef.current?.focus();
      },
      Enter: () => {
        const site = sites[active];
        if (site) choose(site.id);
      },
    };
    const move = moves[event.key === ' ' ? 'Enter' : event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  };

  return (
    <div className="site" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="site__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList();
          }
        }}
      >
        <span className="eyebrow">Site</span>
        <span className="site__current">
          <span className="site__code">{current?.code}</span>
          {current?.name}
        </span>
        <svg className="site__chevron" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5L6 8l3.5-3.5" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label="Sites"
          aria-activedescendant={`${listId}-${active}`}
          className="site__list hud-panel"
          onKeyDown={onListKey}
        >
          {sites.map((site, i) => (
            <li
              key={site.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={site.id === siteId}
              data-active={i === active || undefined}
              className="site__option"
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(site.id)}
            >
              <span className="site__code">{site.code}</span>
              <span className="site__option-name">
                {site.name}
                <span className="muted">{site.city}</span>
              </span>
              <span className="site__docks mono">
                {docksBySite[i]}
                <span className="muted"> docks</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles for the site in focus.
// ---------------------------------------------------------------------------

interface KpiProps {
  label: string;
  value: string;
  of?: string;
  note: string;
  ratio: number;
  tone: Tone;
  alert?: boolean;
}

function Kpi({ label, value, of, note, ratio, tone, alert }: KpiProps) {
  return (
    <div className="kpi" data-tone={tone} data-alert={alert || undefined}>
      <span className="eyebrow">{label}</span>
      <span className="kpi__value">
        {value}
        {of && <span className="kpi__of">/{of}</span>}
        <span className="kpi__note">{note}</span>
      </span>
      <Meter value={ratio} label={`${label}: ${note}`} tone={tone} segments={24} variant="ticks" />
    </div>
  );
}

function KpiStrip() {
  const kpis = useWarehouse(useShallow((s) => siteKpis(s.data, s.siteId)));
  const rate = kpis.onTimeRate;
  return (
    <div className="kpis" role="group" aria-label="Site performance">
      <Kpi
        label="On-time delivery"
        value={rate === null ? '—' : formatPercent(rate)}
        note={rate === null ? 'No delivery yet' : `${kpis.completed} delivered`}
        ratio={rate ?? 0}
        tone={rate === null || rate >= 0.95 ? 'ok' : rate >= 0.85 ? 'work' : 'alert'}
      />
      <Kpi
        label="Docks in use"
        value={String(kpis.docksInUse)}
        of={String(kpis.docksOperational)}
        note="operational docks"
        ratio={kpis.docksOperational ? kpis.docksInUse / kpis.docksOperational : 0}
        tone="work"
      />
      <Kpi
        label="Active trucks"
        value={String(kpis.activeTrucks)}
        of={String(kpis.trucks)}
        note={`${kpis.delayed} shipment${kpis.delayed === 1 ? '' : 's'} late`}
        ratio={kpis.trucks ? kpis.activeTrucks / kpis.trucks : 0}
        tone="transit"
      />
      <Kpi
        label="Low-stock alerts"
        value={String(kpis.lowStock)}
        note={`of ${kpis.items} SKUs`}
        ratio={kpis.items ? kpis.lowStock / kpis.items : 0}
        tone={kpis.lowStock > 0 ? 'alert' : 'ok'}
        alert={kpis.lowStock > 0}
      />
    </div>
  );
}

export function TopBar() {
  return (
    <header className="topbar hud-panel">
      <Brand />
      <SiteSelector />
      <KpiStrip />
    </header>
  );
}
