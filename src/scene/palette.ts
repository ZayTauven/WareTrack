/** Scene colours, tuned against the concept art (light floor, dark void, amber accents). */
export const palette = {
  void: '#111317',
  ground: '#181b20',
  slab: '#6e4532',
  floor: '#dcd8d0',
  gridCell: '#c4bfb5',
  gridSection: '#aaa398',
  wall: '#c3beb7',
  amber: '#f0a53a',
  asphalt: '#363b43',
  road: '#2a2e35',
  roadLine: '#cfc9bb',
  steel: '#4a4f58',
  steelDark: '#2b2e34',
  deck: '#8e9096',
  door: '#a3a7ad',
  glass: '#1d2730',
  tire: '#18191c',
  forklift: '#e2702e',
  lampOk: '#4ade80',
  lampOff: '#ef4444',
  boxes: ['#c9a27a', '#b5875c', '#dabd93', '#a5704d', '#d1916b', '#8fa2a6', '#c9c1ab', '#97785a', '#7f8f6e'],
} as const;

interface Livery {
  cab: string;
  body: string;
}

const LIVERIES: Record<string, Livery> = {
  'Yellow Trans Express': { cab: '#f2a93b', body: '#f2a93b' },
  'Logistix Inc.': { cab: '#3a3f47', body: '#e9e7e2' },
  'Pacific Freightways': { cab: '#2f5d7c', body: '#e9e7e2' },
  'Lone Star Freight': { cab: '#9b2f2f', body: '#e9e7e2' },
  'Texas Roadline': { cab: '#3a3f47', body: '#c9c4ba' },
  'Coastal Box Lines': { cab: '#2c7a7b', body: '#e9e7e2' },
  'Suncoast Haulage': { cab: '#e2702e', body: '#e9e7e2' },
};

const FALLBACK_LIVERY: Livery = { cab: '#5b616b', body: '#e9e7e2' };

export const liveryFor = (carrier: string): Livery => LIVERIES[carrier] ?? FALLBACK_LIVERY;
