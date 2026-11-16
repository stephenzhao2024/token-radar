// The radar's model. Reads the sealed DefiLlama snapshot and asks one question: if a protocol's
// record stood still, what would a token be worth, and is farming it worth the gas?
//
// The price line is fitted to the protocols whose token already trades — a power law over TVL —
// and the fit is tested blind, one token held out at a time, against a flat multiple. Every row's
// value then carries a range from that measured miss, and a net verdict after gas and the cost of
// the capital.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface Model {
  version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  adj_floor: number;
  adj_ceiling: number;
  rows: number;
  ticket_usd: number;
  airdrop_share: number;
  capital_rate: number;
  hold_months: number;
}

export const MODEL: Model = {
  version: 'radar-3',
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_halflife_days: 500,
  unknown_age_days: 365,
  adj_floor: 0.3,
  adj_ceiling: 3.5,
  rows: 192,
  ticket_usd: 1000,
  airdrop_share: 0.05,
  capital_rate: 0.04,
  hold_months: 3,
};

/** Categories the house's shape rule already keeps out of the watchlist: they are not launches. */
const NOT_A_LAUNCH = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const DAY = 86_400_000;

export interface Step { text: string; cost: string; time: string }
export interface Fit { a: number; b: number; r2: number; n: number }
export interface TestRow { name: string; miss: number; within3: number; n: number }
export interface Econ {
  slice_usd: number; gas_usd: number; capital_usd: number;
  net_usd: number; hours: number; per_hour: number; verdict: 'farm' | 'thin' | 'skip';
}

export interface Row {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; watchlist: boolean; band: string; strategy: string;
  implied_value_usd: number; low_usd: number; high_usd: number;
  curve_usd: number; adj_multiple: number; growth_multiple: number; maturity_multiple: number;
  token_status: string; econ: Econ; farm_steps: string[];
}

export interface Sector { category: string; adj: number; peers: number; basis: string; examples: { name: string; mcap_usd: number; tvl_usd: number; ratio: number }[] }
export interface Live { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; mcap_usd: number; change_7d: number | null; ratio: number }

export interface Radar {
  as_of: string; source: string; floor_usd: number; model: Model;
  fit: Fit;
  variant: string;
  sigma: number;
  blind_n: number;
  counts: {
    protocols: number; launchable: number; watchlist: number; rows: number; live: number;
    watchlist_tvl: number; below_floor: number; farm: number; thin: number; skip: number;
    categories: number;
    best_name: string; best_per_hour: number;
  };
  tests: TestRow[];
  factors: { flow: Record<string, number>; age: Record<string, number>; weights: Weights };
  sectors: Sector[];
  farm_next: { name: string; per_hour: number; net: number; rank: number }[];
  rows: {
    rank: number; slug: string; name: string; category: string | null; chains: string[];
    tvl: number; chg: number | null; mcap: number | null; listed: string | null; age: number | null;
    watch: boolean; band: string; strategy: string;
    implied: number; low: number; high: number; curve: number; adj: number; growth: number; maturity: number;
    flowf: number; agef: number;
    sectorBasis: string; why: string; total: { capital: string; gas: string; time: string };
    econ: Econ; steps: Step[];
  }[];
  live: Live[];
}

/* ── small maths ─────────────────────────────────────────────────── */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return s.length % 2 ? s[Math.floor(mid)]! : (s[Math.floor(mid)]! + s[Math.ceil(mid)]!) / 2;
}

function clamp(n: number, lo: number, hi: number): number { return n < lo ? lo : n > hi ? hi : n; }
function round(n: number, p: number): number { const f = 10 ** p; return Math.round(n * f) / f; }

/** Least squares of log10(cap) against log10(TVL): the market's own size curve. */
export function fitCurve(points: { tvl: number; mcap: number }[]): Fit {
  const xs = points.map((p) => Math.log10(p.tvl));
  const ys = points.map((p) => Math.log10(p.mcap));
  const n = xs.length;
  if (n < 3) return { a: 1, b: 1, r2: 0, n };
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - b * mx;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + b * xs[i]!;
    ssr += (ys[i]! - pred) ** 2;
    sst += (ys[i]! - my) ** 2;
  }
  return { a: round(10 ** intercept, 4), b: round(b, 4), r2: sst === 0 ? 0 : round(1 - ssr / sst, 3), n };
}

function curveValue(fit: Fit, tvl: number): number {
  return (fit.a * Math.pow(Math.max(tvl, 1), fit.b));
}

/** The multiplicative miss a blind test found, as a symmetric ratio. */
function missOf(actual: number, predicted: number): number {
  const r = actual / Math.max(predicted, 1e-9);
  return r >= 1 ? r : 1 / r;
}

/* ── parsing and the launchable set ──────────────────────────────── */

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const protocols = raw.protocols;
  const watchlist = raw.watchlist;
  if (!Array.isArray(protocols) || protocols.length === 0) throw new Error('snapshot: protocols is not a non-empty array');
  if (!Array.isArray(watchlist) || watchlist.length === 0) throw new Error('snapshot: watchlist is not a non-empty array');
  const seen = new Set<string>();
  for (const p of protocols as Record<string, unknown>[]) {
    const slug = p.slug;
    if (typeof slug !== 'string' || slug.length === 0) throw new Error('snapshot: a protocol has no slug');
    if (seen.has(slug)) throw new Error(`snapshot: slug ${slug} appears twice`);
    seen.add(slug);
    if (num(p.tvl_usd) === null) throw new Error(`snapshot: ${slug} has no tvl_usd`);
  }
  return {
    as_of: String(raw.as_of ?? ''),
    source: String(raw.source ?? ''),
    floor_usd: num(raw.floor_usd) ?? 0,
    protocols: protocols as SnapshotProtocol[],
    watchlist: (watchlist as string[]).filter((s) => seen.has(s)),
  };
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / DAY));
}

export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function launchable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

export function band(age: number | null): string {
  if (age === null) return 'unrecorded';
  if (age < 180) return 'new';
  if (age < 540) return 'forming';
  if (age < 1100) return 'seasoned';
  return 'long-standing';
}

export function growthMultiple(change: number | null): number {
  if (change === null) return 1;
  return round(1 + MODEL.growth_weight * (clamp(change, MODEL.growth_floor, MODEL.growth_cap) / 100), 4);
}

export function maturityMultiple(age: number | null): number {
  const days = age === null ? MODEL.unknown_age_days : age;
  return round(MODEL.maturity_floor + (1 - MODEL.maturity_floor) * (1 - Math.exp(-days / MODEL.maturity_halflife_days)), 4);
}

/* ── the fitted state: a size curve, a multi-feature fit, and sector residuals ─ */

export interface Weights { a: number; b: number; c: number; d: number }

export interface Fitted {
  curve: Fit;
  weights: Weights;
  flat: number;
  adj: Map<string, { adj: number; peers: number }>;
  shrunk: Map<string, { adj: number; peers: number }>;
  flow: Map<string, number>;
  age: Map<string, number>;
}

interface Feat { tvl: number; change: number; age: number; category: string; mcap: number }

export const VARIANTS = [
  { id: 'flat', name: 'One flat cap/TVL multiple' },
  { id: 'curve', name: 'Size curve' },
  { id: 'curveSector', name: 'Size curve \u00d7 sector' },
  { id: 'curveSectorShrunk', name: 'Size curve \u00d7 sector, shrunk' },
  { id: 'full', name: 'Curve \u00d7 flow \u00d7 record, one regression' },
  { id: 'bucketed', name: 'Curve \u00d7 sector \u00d7 flow \u00d7 record, bucketed' },
] as const;

const FLOW_BUCKETS = ['shrinking', 'flat', 'growing', 'surging'];
const AGE_BUCKETS = ['new', 'forming', 'seasoned', 'long-standing'];

function flowBucket(change: number): string {
  return change < -10 ? FLOW_BUCKETS[0]! : change < 0 ? FLOW_BUCKETS[1]! : change < 10 ? FLOW_BUCKETS[2]! : FLOW_BUCKETS[3]!;
}

function ageBucket(age: number): string {
  return age < 180 ? AGE_BUCKETS[0]! : age < 540 ? AGE_BUCKETS[1]! : age < 1100 ? AGE_BUCKETS[2]! : AGE_BUCKETS[3]!;
}

/** The median residual of one bucket, shrunk toward 1 by twenty pseudo-observations. */
function shrink(logs: number[], prior = 20): number {
  const sum = logs.reduce((s, v) => s + v, 0);
  return round(clamp(Math.exp(sum / (logs.length + prior)), 0.35, 3), 4);
}

/** Solve a small linear system by Gaussian elimination. */
function solve(m: number[][], v: number[]): number[] {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]![col]!;
    if (Math.abs(p) < 1e-12) continue;
    for (let k = col; k <= n; k++) a[col]![k] = a[col]![k]! / p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) a[r]![k] = a[r]![k]! - f * a[col]![k]!;
    }
  }
  return a.map((row) => row[n]!);
}

/** Least squares of log10(cap) on log10(TVL), the seven-day change and log10(1 + age). */
export function fitWeights(points: { tvl: number; change: number; age: number; mcap: number }[]): Weights {
  if (points.length < 6) return { a: 0, b: 1, c: 0, d: 0 };
  const rows = points.map((p) => [1, Math.log10(p.tvl), p.change / 100, Math.log10(1 + p.age)]);
  const ys = points.map((p) => Math.log10(p.mcap));
  const k = 4;
  const ata: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const aty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let r = 0; r < k; r++) {
      aty[r] = aty[r]! + rows[i]![r]! * ys[i]!;
      for (let c = 0; c < k; c++) ata[r]![c] = ata[r]![c]! + rows[i]![r]! * rows[i]![c]!;
    }
  }
  const w = solve(ata, aty);
  return { a: round(w[0]!, 4), b: round(w[1]!, 4), c: round(w[2]!, 4), d: round(w[3]!, 4) };
}

/** Sector residuals against the size curve, raw and shrunk toward 1 by 20 pseudo-observations. */
function sectorResiduals(points: Feat[], curve: Fit): { raw: Map<string, { adj: number; peers: number }>; shrunk: Map<string, { adj: number; peers: number }> } {
  const groups = new Map<string, number[]>();
  for (const p of points) {
    const list = groups.get(p.category) ?? [];
    list.push(Math.log(p.mcap / Math.max(curveValue(curve, p.tvl), 1e-9)));
    groups.set(p.category, list);
  }
  const raw = new Map<string, { adj: number; peers: number }>();
  const shrunk = new Map<string, { adj: number; peers: number }>();
  for (const [category, logs] of groups) {
    if (logs.length < 4) continue;
    const sum = logs.reduce((s, v) => s + v, 0);
    raw.set(category, { adj: round(clamp(Math.exp(sum / logs.length), MODEL.adj_floor, MODEL.adj_ceiling), 4), peers: logs.length });
    shrunk.set(category, { adj: round(clamp(Math.exp(sum / (logs.length + 20)), 0.5, MODEL.adj_ceiling), 4), peers: logs.length });
  }
  return { raw, shrunk };
}

export function fitAll(points: Feat[]): Fitted {
  const curve = fitCurve(points.map((p) => ({ tvl: p.tvl, mcap: p.mcap })));
  const { raw, shrunk } = sectorResiduals(points, curve);
  const weights = fitWeights(points);

  // flow and record factors, each measured on what the curve and the sector leave behind
  const flowLogs = new Map<string, number[]>();
  const ageLogs = new Map<string, number[]>();
  for (const p of points) {
    const afterSector = p.mcap / Math.max(curveValue(curve, p.tvl) * (shrunk.get(p.category)?.adj ?? 1), 1e-9);
    const fb = flowBucket(p.change);
    (flowLogs.get(fb) ?? flowLogs.set(fb, []).get(fb)!).push(Math.log(afterSector));
  }
  const flow = new Map<string, number>();
  for (const [k, logs] of flowLogs) flow.set(k, shrink(logs));
  for (const p of points) {
    const rest = p.mcap / Math.max(curveValue(curve, p.tvl) * (shrunk.get(p.category)?.adj ?? 1) * (flow.get(flowBucket(p.change)) ?? 1), 1e-9);
    const ab = ageBucket(p.age);
    (ageLogs.get(ab) ?? ageLogs.set(ab, []).get(ab)!).push(Math.log(rest));
  }
  const age = new Map<string, number>();
  for (const [k, logs] of ageLogs) age.set(k, shrink(logs));

  return {
    curve, weights, flat: median(points.map((p) => p.mcap / p.tvl)), adj: raw, shrunk,
    flow: ordered(flow, FLOW_BUCKETS), age: ordered(age, AGE_BUCKETS),
  };
}

/** Estimated freely, then sorted into the buckets' own order: a factor may only push one way. */
function ordered(factors: Map<string, number>, buckets: string[]): Map<string, number> {
  const present = buckets.filter((b) => factors.has(b));
  const values = present.map((b) => factors.get(b)!).sort((a, b) => a - b);
  const out = new Map<string, number>();
  present.forEach((b, i) => out.set(b, values[i]!));
  return out;
}

/** What a variant says a token would be worth, given its own fitted state. */
export function predict(f: Fitted, id: string, tvl: number, change: number, age: number, category: string): number {
  const size = Math.max(tvl, 1);
  const curve = curveValue(f.curve, size);
  const sector = f.shrunk.get(category)?.adj ?? 1;
  switch (id) {
    case 'flat': return f.flat * size;
    case 'curve': return curve;
    case 'curveSector': return curve * (f.adj.get(category)?.adj ?? 1);
    case 'curveSectorShrunk': return curve * sector;
    case 'full': return 10 ** (f.weights.a + f.weights.b * Math.log10(size) + f.weights.c * (change / 100) + f.weights.d * Math.log10(1 + age));
    case 'bucketed': return curve * sector * (f.flow.get(flowBucket(change)) ?? 1) * (f.age.get(ageBucket(age)) ?? 1);
    default: return curve;
  }
}

/* ── the blind test: hold one trading token out, refit, ask its cap back ── */

export interface Blind { tests: TestRow[]; winner: string; sigma: number }

export function blindTest(points: Feat[]): Blind {
  const buckets = new Map<string, number[]>(VARIANTS.map((v) => [v.id, []]));
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const rest = points.filter((_, j) => j !== i);
    if (rest.length < 12) continue;
    const held = points[i]!;
    const f = fitAll(rest);
    VARIANTS.forEach((v) => {
      buckets.get(v.id)!.push(missOf(held.mcap, predict(f, v.id, held.tvl, held.change, held.age, held.category)));
    });
  }
  const tests: TestRow[] = VARIANTS.map((v) => {
    const misses = buckets.get(v.id)!;
    return {
      name: v.name,
      miss: round(median(misses), 2),
      within3: round(misses.filter((m) => m <= 3).length / Math.max(misses.length, 1), 3),
      n: misses.length,
    };
  });
  let best = 0;
  for (let i = 1; i < tests.length; i++) if (tests[i]!.miss < tests[best]!.miss - 1e-9) best = i;
  // A richer model earns its extra terms when its blind miss stays within a fifth of the least:
  // flow and record cost a little on today's cross-section, and are kept because the question is
  // what a token would be worth as the record moves, not what it is worth today.
  let chosen = best;
  for (let i = tests.length - 1; i > best; i--) {
    if (tests[i]!.miss <= tests[best]!.miss * 1.2) { chosen = i; break; }
  }
  return { tests, winner: VARIANTS[chosen]!.id, sigma: Math.log(Math.max(tests[chosen]!.miss, 1.05)) };
}

/* ── the economics of farming one protocol ───────────────────────── */

function primaryChain(p: SnapshotProtocol): string {
  const priority = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Binance', 'Polygon', 'Avalanche', 'Bitcoin'];
  for (const want of priority) if (p.chains.includes(want)) return want;
  return p.chains[0] ?? 'Ethereum';
}

/** What the plan's transactions cost, as a number, on the protocol's home chain. */
function gasUsd(chain: string, steps = 4): number {
  const each = chain === 'Ethereum' ? 4.2 : chain === 'Bitcoin' ? 2.2 : chain === 'Solana' ? 0.03
    : ['Tron', 'Binance', 'Avalanche', 'Tron'].includes(chain) ? 0.35 : 0.22;
  return round(each * steps, 2);
}

function economics(tvl: number, implied: number, chain: string, months: number, model: Model): Econ {
  const owned = Math.min(1, model.ticket_usd / Math.max(tvl, 1));
  const slice = implied * model.airdrop_share * owned;
  const gas = gasUsd(chain);
  const capital = model.ticket_usd * model.capital_rate * (months / 12);
  const net = slice - gas - capital;
  const hours = round(2 + months * 0.35, 1);
  const perHour = round(net / hours, 2);
  const verdict: Econ['verdict'] = net > 0 && perHour >= 0.25 ? 'farm' : net > 0 ? 'thin' : 'skip';
  return {
    slice_usd: round(slice, 2), gas_usd: gas, capital_usd: round(capital, 2),
    net_usd: round(net, 2), hours, per_hour: perHour, verdict,
  };
}

/** A short phrase naming what farming it actually is, then the chain. */
function strategyOf(p: SnapshotProtocol): string {
  const c = p.category ?? '';
  const noun =
    c === 'Risk Curators' ? 'curator vault' :
    c === 'Onchain Capital Allocator' ? 'allocator' :
    c === 'RWA' ? 'RWA asset' :
    c === 'Lending' ? 'lending' :
    c === 'Dexs' ? 'liquidity' :
    c === 'Basis Trading' ? 'basis' :
    c === 'CDP' ? 'CDP mint' :
    c === 'Insurance' ? 'cover' :
    c === 'Yield' ? 'yield vault' :
    c === 'Yield Aggregator' ? 'compounder' :
    c === 'Chain' ? 'bridge' :
    c === 'Payments' ? 'payments' :
    c === 'Collateral Markets' ? 'collateral' :
    c === 'Governance Incentives' ? 'governance' :
    c === 'Staking Pool' ? 'staking' :
    c === 'Prediction Market' ? 'prediction' :
    c === 'Derivatives' || c === 'Perp DEX' ? 'perps' :
    'pool';
  return `${noun} \u00b7 ${primaryChain(p)}`;
}

/* ── the farm plan ───────────────────────────────────────────────── */

function position(tvl: number): { text: string; low: number } {
  if (tvl >= 1e9) return { text: '$2,000 to $5,000', low: 2000 };
  if (tvl >= 3e8) return { text: '$1,000 to $2,500', low: 1000 };
  if (tvl >= 1e8) return { text: '$500 to $1,500', low: 500 };
  if (tvl >= 5e7) return { text: '$300 to $800', low: 300 };
  return { text: '$100 to $400', low: 100 };
}

function money(n: number): string {
  if (n >= 1e9) return `$${round(n / 1e9, 2)}B`;
  if (n >= 1e6) return `$${round(n / 1e6, 1)}M`;
  if (n >= 1e3) return `$${round(n / 1e3, 1)}K`;
  return `$${Math.round(n)}`;
}

const VENUES: Record<string, { swap: string; lend: string; note: string }> = {
  Ethereum: { swap: 'Uniswap v4', lend: 'Aave v3', note: 'a mainnet transaction costs real money, so batch the steps' },
  Base: { swap: 'Aerodrome', lend: 'Moonwell', note: 'Base fees are cents, so you can afford to rebalance' },
  Arbitrum: { swap: 'Camelot', lend: 'Radiant', note: 'Arbitrum keeps gas in cents while liquidity is deep' },
  Optimism: { swap: 'Velodrome', lend: 'Aave v3 on OP Mainnet', note: 'the Superchain bridge takes about 20 minutes each way' },
  Solana: { swap: 'Jupiter', lend: 'Kamino', note: 'fees are fractions of a cent, so size matters far more than count' },
  Binance: { swap: 'PancakeSwap', lend: 'Venus', note: 'BNB Chain fees are cents and finality is seconds' },
  Avalanche: { swap: 'Trader Joe', lend: 'Aave v3 on Avalanche', note: 'the C-Chain costs cents and settles in about two seconds' },
  Polygon: { swap: 'QuickSwap', lend: 'Aave v3 on Polygon', note: 'Polygon fees are fractions of a cent' },
  Tron: { swap: 'SunSwap', lend: 'JustLend', note: 'Tron needs bandwidth or a small TRX burn per transaction' },
  Bitcoin: { swap: 'the protocol\u2019s own mint and redeem', lend: 'the protocol\u2019s own vault', note: 'Bitcoin-side steps settle in ten-minute blocks, so plan one move per block' },
};

function venue(chain: string): { swap: string; lend: string; note: string } {
  return VENUES[chain] ?? {
    swap: 'the largest DEX on the chain',
    lend: 'its largest money market',
    note: 'a smaller chain\u2019s liquidity is thin, so check the pool before sizing up',
  };
}

function coreStep(p: SnapshotProtocol, chain: string, size: number): string {
  const where = `${p.name} on ${chain}`;
  const v = venue(chain);
  const open = `Deposit ${money(size)} of USDC`;
  switch (p.category ?? '') {
    case 'Risk Curators':
      return `${open} into ${where}: pick the curator's USDC or ETH vault with the longest live record, supply once, and hold it through the whole season. Curator vaults count TVL at the snapshot block, so size beats transaction count.`;
    case 'Onchain Capital Allocator':
      return `${open} into ${where}'s flagship diversified vault rather than one single strategy, because allocator snapshots usually weight the depositor's balance across every strategy the vault touched.`;
    case 'RWA':
      return `${open} into ${where}, or buy its yield-bearing receipt token on the secondary market if it has one, then hold past the record date: RWA snapshots weight the balance held, not the volume traded.`;
    case 'Lending':
      return `${open} as supply on ${where}, then borrow a stablecoin against it on ${v.lend} at no more than 50% loan-to-value and supply that too, so one lot of capital counts twice without a liquidation risk.`;
    case 'Dexs':
      return `Provide a two-sided LP position on ${where}: pair ${money(size)} of USDC against a blue-chip on ${chain} through ${v.swap}, use a narrow range only if you will rebalance it, and leave it in place to accrue fees and TVL share.`;
    case 'Basis Trading':
      return `${open} into ${where}'s basis vault: the vault holds spot long and perpetual short, so your exposure stays dollar-neutral while the vault's TVL grows with every deposit.`;
    case 'Yield':
      return `${open} into ${where}'s largest USDC vault, check the fee and the withdrawal delay first, and leave it for at least two full snapshot periods rather than moving it between vaults.`;
    case 'Yield Aggregator':
      return `${open} through ${where}'s auto-compounding vault for a stable pair, and let it compound: the balance at the snapshot block is what a points or season formula reads.`;
    case 'CDP':
      return `Open a collateralised debt position on ${where}: deposit ${money(size)} of a liquid asset, mint no more than 40% of its value in the protocol's stablecoin, and keep the position open across the season.`;
    case 'Insurance':
      return `Underwrite on ${where}: deposit ${money(size)} into a cover pool for a blue-chip protocol with a short cover period, and leave it staked so the capital stays at risk and counted.`;
    case 'Collateral Markets':
      return `${open} as collateral supply on ${where}, take a small borrow against it on ${v.lend} to prove the position is live, and leave both sides open through the snapshot.`;
    case 'Governance Incentives':
      return `${open} or delegate into ${where}'s incentive programme, then vote on at least one proposal so the address shows as an active participant, not a passive balance.`;
    case 'Chain':
      return `Bridge ${money(size)} onto ${where}, swap twice through ${v.swap}, and leave the balance there: a chain's snapshots weight the assets that stayed, and bridging in and holding is the cheapest way to hold them.`;
    case 'Payments':
      return `Route ${money(size)} of real payment volume through ${where} over several weeks rather than one transfer, and keep the receiving address active: payment networks count distinct settled transfers.`;
    case 'Staking Pool':
      return `Stake ${money(size)} through ${where}'s pool rather than solo, keep the receipt token in the same wallet, and do not unstake before the snapshot block.`;
    case 'Options':
      return `Write a small covered call or put position on ${where} with the shortest listed expiry, roll it monthly, and keep the collateral in the protocol so the notional stays counted.`;
    case 'Derivatives':
    case 'Perp DEX':
      return `Trade ${money(size)} of notional on ${where} in several small round trips rather than one, keep the margin in the protocol, and stop before the fee line eats the volume you are farming.`;
    default:
      return `${open} into ${where}'s main pool for a blue-chip asset, confirm the withdrawal delay, and leave it untouched for at least two snapshot periods.`;
  }
}

export function farmSteps(p: SnapshotProtocol, age: number | null): Step[] {
  const chain = primaryChain(p);
  const g = chain === 'Ethereum' ? { low: '$1.20', high: '$14' } : chain === 'Bitcoin' ? { low: '$0.40', high: '$3' }
    : chain === 'Solana' ? { low: '$0.01', high: '$0.05' } : { low: '$0.05', high: '$0.80' };
  const v = venue(chain);
  const size = position(p.tvl_usd);
  const steps: Step[] = [
    { text: coreStep(p, chain, size.low), cost: `${size.text} of capital, plus ${g.low} to ${g.high} in gas`, time: '10 to 25 minutes, once' },
    {
      text: `Fund the address from a wallet you will keep: send the capital to one ${chain} address in a single transfer, and use that same address for every later step so a snapshot's address list finds the whole position in one place. On ${chain}, ${v.note}.`,
      cost: `${g.low} to ${g.high} in gas`, time: '3 to 5 minutes',
    },
    {
      text: `Time the entry: ${p.change_7d === null
        ? 'no seven-day figure is on record for it, so treat the flow as flat and let size and time carry the position'
        : p.change_7d >= 0
          ? `its TVL is up ${p.change_7d.toFixed(1)}% on the week, so enter now rather than after the next print`
          : `its TVL is down ${Math.abs(p.change_7d).toFixed(1)}% on the week, so enter at half size and add only after two weekly prints above zero`}. A protocol tracked ${age === null ? 'for an unrecorded time' : `${age} days`} with no token is usually snapshotted monthly or quarterly, so plan to hold at least ${age !== null && age > 1100 ? 'two quarters' : 'one quarter'}.`,
      cost: '$0 while held', time: '90 days or more',
    },
    {
      text: `Watch for the announcement: follow ${p.name}'s docs and its official account, and read the "token" or "points" page weekly; most programmes open registration one to three weeks before a token event, and a missed registration usually forfeits the season.`,
      cost: '$0', time: '5 minutes a week',
    },
    {
      text: 'Keep the receipt: export the address and every transaction hash into one sheet, and screenshot the balance at each month end. A claim almost always needs the depositing address, and a snapshot dispute needs the transaction, not a memory.',
      cost: '$0', time: '10 minutes a month',
    },
    {
      text: `Fix the exit before you enter: decide the TVL or price at which you withdraw, keep at least one withdrawal in reserve for gas (${g.low} to ${g.high}), and unwind in a single transaction so an illiquid week cannot trap the position.`,
      cost: `${g.low} to ${g.high} in gas`, time: '5 to 15 minutes, once',
    },
  ];
  return steps;
}

/* ── the board ───────────────────────────────────────────────────── */

export function boardIssue(rows: Row[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const ranks = new Set<number>();
  let previous = Infinity;
  const watch = new Set(snapshot.watchlist);
  const covered = new Set<string>();
  for (const row of rows) {
    if (!slugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `rank ${row.rank} is not a positive whole number`;
    if (ranks.has(row.rank)) return `rank ${row.rank} appears twice`;
    ranks.add(row.rank);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd < 1) return `${row.slug} has no implied value`;
    if (row.implied_value_usd > 1e14) return `${row.slug} implied value above the cap`;
    if (row.implied_value_usd > previous) return `${row.slug} breaks the descending order at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `${row.slug} has a farm step of ${t.length} characters`;
    }
    if (watch.has(row.slug)) covered.add(row.slug);
  }
  for (let r = 1; r <= rows.length; r++) if (!ranks.has(r)) return `rank ${r} is missing`;
  if (covered.size !== watch.size) return `watchlist coverage ${covered.size} of ${watch.size}`;
  return null;
}

export function buildBoard(snapshot: Snapshot, model: Model = MODEL): {
  rows: Row[]; sectors: Sector[]; fitted: Fitted; blind: Blind; counts: Radar['counts']; variant: string;
} {
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const feats: Feat[] = trading.map((p) => ({
    tvl: p.tvl_usd,
    change: p.change_7d ?? 0,
    age: ageDays(snapshot.as_of, p.listed_at) ?? model.unknown_age_days,
    category: p.category ?? 'Uncategorised',
    mcap: p.mcap_usd!,
  }));

  const fitted = fitAll(feats);
  const blind = blindTest(feats);
  const variantName = (VARIANTS.find((v) => v.id === blind.winner) ?? VARIANTS[1]!).name;

  const watch = new Set(snapshot.watchlist);
  const scored: Row[] = [];
  for (const p of snapshot.protocols) {
    if (!launchable(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const change = p.change_7d ?? 0;
    const category = p.category ?? 'Uncategorised';
    const value = predict(fitted, blind.winner, p.tvl_usd, change, age ?? model.unknown_age_days, category);
    const implied = Math.round(clamp(value, 1, 1e14));
    const chain = primaryChain(p);
    scored.push({
      rank: 0, slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
      age_days: age, watchlist: watch.has(p.slug), band: band(age), strategy: strategyOf(p),
      implied_value_usd: Math.min(implied, 1e14),
      low_usd: Math.round(implied * Math.exp(-1.2816 * blind.sigma)),
      high_usd: Math.round(implied * Math.exp(1.2816 * blind.sigma)),
      curve_usd: Math.round(curveValue(fitted.curve, p.tvl_usd)),
      adj_multiple: fitted.shrunk.get(category)?.adj ?? 1,
      growth_multiple: growthMultiple(p.change_7d),
      maturity_multiple: maturityMultiple(age),
      token_status: 'pre-token',
      econ: economics(p.tvl_usd, implied, chain, model.hold_months, model),
      farm_steps: farmSteps(p, age).map((s) => s.text),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const rows = scored.slice(0, model.rows).map((row, i) => ({ ...row, rank: i + 1 }));

  const sectors: Sector[] = [];
  for (const [category, info] of fitted.shrunk) {
    const peers = trading.filter((p) => (p.category ?? 'Uncategorised') === category);
    const examples = [...peers].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0)).slice(0, 4)
      .map((p) => ({ name: p.name, mcap_usd: Math.round(p.mcap_usd ?? 0), tvl_usd: Math.round(p.tvl_usd), ratio: round((p.mcap_usd ?? 0) / p.tvl_usd, 3) }));
    sectors.push({ category, adj: info.adj, peers: info.peers, basis: `residual of ${info.peers} trading ${category} protocols against the curve`, examples });
  }
  sectors.sort((a, b) => b.adj - a.adj);

  let watchTvl = 0;
  for (const p of snapshot.protocols) if (watch.has(p.slug)) watchTvl += p.tvl_usd;

  const farm = rows.filter((r) => r.econ.verdict === 'farm').length;
  const thin = rows.filter((r) => r.econ.verdict === 'thin').length;
  const skip = rows.filter((r) => r.econ.verdict === 'skip').length;
  const best = rows.reduce((a, b) => (b.econ.per_hour > a.econ.per_hour ? b : a), rows[0]!);

  return {
    rows, sectors, fitted, blind, variant: variantName,
    counts: {
      protocols: snapshot.protocols.length,
      launchable: scored.length,
      watchlist: snapshot.watchlist.length,
      rows: rows.length,
      live: trading.length,
      watchlist_tvl: watchTvl,
      below_floor: scored.filter((r) => !r.watchlist).length,
      farm, thin, skip,
      categories: sectors.length,
      best_name: best.name,
      best_per_hour: best.econ.per_hour,
    },
  };
}

export function liveRows(snapshot: Snapshot, limit = 40): Live[] {
  const out: Live[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    out.push({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd, change_7d: p.change_7d, ratio: round(p.mcap_usd / Math.max(p.tvl_usd, 1), 3),
    });
  }
  out.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  return out.slice(0, limit);
}

function whyEdit(row: Row, total: number, hasSector: boolean, fitted: Fitted, sigma: number): string {
  void fitted;
  void sigma;
  const head = row.rank === 1 ? 'Top of the board' : `${row.rank} of ${total}`;
  const where = row.watchlist ? 'on the house watchlist' : 'below the floor but still launchable';
  const flow = row.change_7d === null ? 'no seven-day figure on record'
    : `${row.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(row.change_7d).toFixed(1)}% on the week`;
  const age = row.age_days === null ? 'tracked for an unrecorded time' : `tracked ${row.age_days} days with no token`;
  const sector = hasSector ? `with ${row.adj_multiple.toFixed(2)}\u00d7 from its category` : 'on the size curve alone, as its category has no four trading peers';
  const net = row.econ.verdict === 'skip' ? 'does not pay' : row.econ.verdict === 'thin' ? 'barely pays' : 'pays';
  return `${head}, ${where}: ${money(row.tvl_usd)} of TVL, ${flow}, ${age}. Priced at ${money(row.implied_value_usd)}, anywhere from ${money(row.low_usd)} to ${money(row.high_usd)} on the blind miss, ${sector}. On a $1,000 ticket it ${net}: a ${row.econ.slice_usd.toFixed(2)} airdrop slice, less ${row.econ.gas_usd.toFixed(2)} of gas and ${row.econ.capital_usd.toFixed(2)} of the capital\u2019s own yield, leaves ${row.econ.net_usd.toFixed(2)}.`;
}

export function buildRadar(snapshot: Snapshot, model: Model = MODEL): { rows: Row[]; radar: Radar } {
  const { rows, sectors, fitted, blind, counts, variant } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const bySector = new Map(sectors.map((s) => [s.category, s]));
  const farmNext = rows.filter((r) => r.econ.verdict === 'farm')
    .sort((a, b) => b.econ.per_hour - a.econ.per_hour).slice(0, 6)
    .map((r) => ({ name: r.name, per_hour: r.econ.per_hour, net: r.econ.net_usd, rank: r.rank }));

  return {
    rows,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source.replace(/https?:\/\/\S+/g, 'DefiLlama'),
      floor_usd: snapshot.floor_usd,
      model,
      fit: fitted.curve,
      variant,
      sigma: round(blind.sigma, 4),
      blind_n: blind.tests[0]?.n ?? 0,
      counts,
      tests: blind.tests,
      factors: {
        flow: Object.fromEntries(fitted.flow),
        age: Object.fromEntries(fitted.age),
        weights: fitted.weights,
      },
      sectors,
      farm_next: farmNext,
      rows: rows.map((r) => ({
        rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
        tvl: r.tvl_usd, chg: r.change_7d, mcap: r.mcap_usd, listed: r.listed_at, age: r.age_days,
        watch: r.watchlist, band: r.band, strategy: r.strategy,
        implied: r.implied_value_usd, low: r.low_usd, high: r.high_usd,
          curve: r.curve_usd,
          adj: r.adj_multiple,
          growth: r.growth_multiple,
          maturity: r.maturity_multiple,
          flowf: fitted.flow.get(flowBucket(r.change_7d ?? 0)) ?? 1,
          agef: fitted.age.get(ageBucket(r.age_days ?? model.unknown_age_days)) ?? 1,
          sectorBasis: bySector.get(r.category ?? '')?.basis ?? 'the size curve alone',
          why: whyEdit(r, rows.length, bySector.has(r.category ?? ''), fitted, blind.sigma),
        total: {
          capital: `${position(r.tvl_usd).text} of capital`,
          gas: `$${gasUsd(primaryChain(snapshot.protocols.find((p) => p.slug === r.slug)!))} of gas at four moves`,
          time: `about ${round(2 + model.hold_months * 0.35, 1)} hours over ${model.hold_months} months`,
        },
        econ: r.econ,
        steps: farmSteps(snapshot.protocols.find((p) => p.slug === r.slug)!, r.age_days),
      })),
      live,
    },
  };
}

export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
