// The radar's model: reads the sealed DefiLlama snapshot, works out what a token-less
// protocol would be worth if its record stood still, plans how to farm it, and writes the
// board the gate reads. Every number comes from the snapshot's own figures: the sector
// multiples are the medians of the protocols in the same category that already trade.

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
  multiple_floor: number;
  multiple_ceiling: number;
  unknown_age_days: number;
  rows: number;
}

export const MODEL: Model = {
  version: 'radar-2.1',
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_halflife_days: 500,
  multiple_floor: 0.03,
  multiple_ceiling: 1.5,
  unknown_age_days: 365,
  rows: 180,
};

/** Categories the house's shape rule already keeps out of the watchlist: they are not launches. */
const NOT_A_LAUNCH = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export interface Step { text: string; cost: string; time: string }

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  band: string;
  implied_value_usd: number;
  sector_multiple: number;
  sector_source: string;
  growth_multiple: number;
  maturity_multiple: number;
  token_status: string;
  farm_steps: string[];
}

export interface Sector {
  category: string;
  multiple: number;
  peers: number;
  basis: string;
  examples: { name: string; mcap_usd: number; tvl_usd: number; ratio: number }[];
}

export interface Live {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Model;
  counts: {
    protocols: number;
    launchable: number;
    watchlist: number;
    above_floor: number;
    rows: number;
    live: number;
    categories: number;
    watchlist_tvl: number;
    below_floor: number;
  };
  sectors: Sector[];
  rows: {
    rank: number; slug: string; name: string; category: string | null; chains: string[];
    tvl: number; chg: number | null; mcap: number | null; listed: string | null; age: number | null;
    watch: boolean; band: string; implied: number; sector: number; sectorBasis: string;
    growth: number; maturity: number; steps: Step[];
    why: string; total: { capital: string; gas: string; time: string };
  }[];
  live: Live[];
}

const DAY = 86_400_000;

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const mid = (s.length - 1) / 2;
  return s.length % 2 ? s[Math.floor(mid)]! : (s[Math.floor(mid)]! + s[Math.ceil(mid)]!) / 2;
}

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

/** How many days the protocol had been tracked at the snapshot's own date, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((a - b) / DAY));
}

/** True when the protocol records no token: both gecko_id and symbol are absent. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** The house's shape rule, minus its size floor: a protocol that could still launch a token. */
export function launchable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && NOT_A_LAUNCH.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  if (EXCHANGES.some((x) => p.name.startsWith(x))) return false;
  return true;
}

/** Each category's median market-cap-to-TVL multiple among the protocols whose token trades. */
export function sectorTable(protocols: SnapshotProtocol[]): Map<string, Sector> {
  const buckets = new Map<string, { ratio: number; name: string; mcap: number; tvl: number }[]>();
  const everything: number[] = [];
  for (const p of protocols) {
    const mcap = p.mcap_usd;
    if (mcap === null || mcap <= 0 || p.tvl_usd <= 0) continue;
    const ratio = mcap / p.tvl_usd;
    everything.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = buckets.get(key) ?? [];
    list.push({ ratio, name: p.name, mcap, tvl: p.tvl_usd });
    buckets.set(key, list);
  }
  const world = median(everything);
  const table = new Map<string, Sector>();
  for (const [category, list] of buckets) {
    if (list.length < 3) continue;
    const multiples = list.map((x) => x.ratio);
    const med = median(multiples);
    const examples = [...list].sort((a, b) => b.mcap - a.mcap).slice(0, 4)
      .map((x) => ({ name: x.name, mcap_usd: Math.round(x.mcap), tvl_usd: Math.round(x.tvl), ratio: round(x.ratio, 3) }));
    table.set(category, {
      category,
      multiple: clamp(med, MODEL.multiple_floor, MODEL.multiple_ceiling),
      peers: list.length,
      basis: `median of ${list.length} trading ${category} protocols`,
      examples,
    });
  }
  table.set('__world', {
    category: 'all categories',
    multiple: clamp(world, MODEL.multiple_floor, MODEL.multiple_ceiling),
    peers: everything.length,
    basis: `median of ${everything.length} trading protocols, every category`,
    examples: [],
  });
  return table;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The growth multiplier: a protocol adding TVL is worth more than one shedding it. */
export function growthMultiple(change: number | null): number {
  if (change === null) return 1;
  const clamped = clamp(change, MODEL.growth_floor, MODEL.growth_cap);
  return round(1 + MODEL.growth_weight * (clamped / 100), 4);
}

/** The maturity multiplier: a protocol that has run token-less for years is a proven one. */
export function maturityMultiple(age: number | null): number {
  const days = age === null ? MODEL.unknown_age_days : age;
  const risen = 1 - Math.exp(-days / MODEL.maturity_halflife_days);
  return round(MODEL.maturity_floor + (1 - MODEL.maturity_floor) * risen, 4);
}

/** The band a reader sorts by: how long the protocol has sat token-less. */
export function band(age: number | null): string {
  if (age === null) return 'unrecorded';
  if (age < 180) return 'new';
  if (age < 540) return 'forming';
  if (age < 1100) return 'seasoned';
  return 'long-standing';
}

function primaryChain(p: SnapshotProtocol): string {
  const priority = ['Ethereum', 'Solana', 'Base', 'Arbitrum', 'Optimism', 'Binance', 'Polygon', 'Avalanche', 'Bitcoin'];
  for (const want of priority) if (p.chains.includes(want)) return want;
  return p.chains[0] ?? 'Ethereum';
}

/** What a transaction on the protocol's home chain tends to cost. */
function gas(chain: string): { low: string; high: string } {
  if (chain === 'Ethereum') return { low: '$1.20', high: '$14' };
  if (chain === 'Bitcoin') return { low: '$0.40', high: '$3' };
  if (chain === 'Solana') return { low: '$0.01', high: '$0.05' };
  if (['Tron', 'Binance', 'Avalanche', 'Canto', 'Gnosis'].includes(chain)) return { low: '$0.05', high: '$0.80' };
  return { low: '$0.03', high: '$0.60' };
}

/** The venue a reader would actually use on each chain, so a step names something. */
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
  Monad: { swap: 'the chain\u2019s main DEX', lend: 'the chain\u2019s main money market', note: 'a young chain\u2019s liquidity is thin: check the pool depth before sizing up' },
  Ink: { swap: 'the chain\u2019s main DEX', lend: 'the chain\u2019s main money market', note: 'an L2 with thin liquidity rewards early deposits, so enter small and early' },
};

function venue(chain: string): { swap: string; lend: string; note: string } {
  return VENUES[chain] ?? {
    swap: 'the largest DEX on the chain',
    lend: 'its largest money market',
    note: 'a smaller chain\u2019s liquidity is thin, so check the pool before sizing up',
  };
}

/** A position size that is worth a snapshot's attention without being reckless. */
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** One sentence a reader can check against the numbers above it. */
export function whyLine(
  row: { rank: number; rows: number; name: string; category: string | null; tvl_usd: number; change_7d: number | null; age_days: number | null; watchlist: boolean; hasPeers: boolean; multiplier: number },
): string {
  const parts: string[] = [];
  parts.push(`${money(row.tvl_usd)} of TVL at the snapshot block`);
  parts.push(row.change_7d === null ? 'no seven-day figure on record' : `${row.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(row.change_7d).toFixed(1)}% on the week`);
  parts.push(row.age_days === null ? 'tracked for an unrecorded time' : `tracked ${row.age_days} days with no token`);
  const head = `${row.rank === 1 ? 'Top of the board' : `${ordinal(row.rank)} of ${row.rows}`}`;
  const where = row.watchlist ? 'on the house watchlist' : 'below the house floor but still launchable';
  const tail = row.hasPeers
    ? `its category gives a ×${row.multiplier.toFixed(3)} multiple from its own trading members`
    : `its category has no three trading peers, so the whole snapshot's ×${row.multiplier.toFixed(3)} applies`;
  return `${head}, ${where}: ${parts.join(', ')}; ${tail}.`;
}

/** What the plan asks of the reader, in one place. */
export function planTotal(p: SnapshotProtocol): { capital: string; gas: string; time: string } {
  const chain = primaryChain(p);
  const g = gas(chain);
  const size = position(p.tvl_usd);
  return {
    capital: `${size.text} of capital`,
    gas: `${g.low} to ${g.high} a move`,
    time: 'about 2 hours up front, then 5 minutes a week and 10 minutes a month',
  };
}

/** The deposit-shaped core of a farm plan, by what the protocol actually does. */
function coreStep(p: SnapshotProtocol, chain: string, size: number): string | null {
  const where = `${p.name} on ${chain}`;
  const c = p.category ?? '';
  const v = venue(chain);
  const open = `Deposit ${money(size)} of USDC`;
  switch (c) {
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
    case 'Perp DEX':
    case 'Derivatives':
      return `Trade ${money(size)} of notional on ${where} in several small round trips rather than one, keep the margin in the protocol, and stop before the fee line eats the volume you are farming.`;
    default:
      return `${open} into ${where}'s main pool for a blue-chip asset, confirm the withdrawal delay, and leave it untouched for at least two snapshot periods.`;
  }
}

/** Every row's plan: concrete steps, each with what it costs and how long it takes. */
export function farmSteps(p: SnapshotProtocol, age: number | null): Step[] {
  const chain = primaryChain(p);
  const g = gas(chain);
  const v = venue(chain);
  const size = position(p.tvl_usd);
  const core = coreStep(p, chain, size.low);
  const steps: Step[] = [];
  if (core !== null) {
    steps.push({ text: core, cost: `${size.text} of capital, plus ${g.low} to ${g.high} in gas`, time: '10 to 25 minutes, once' });
  }
  steps.push({
    text: `Fund the address from a wallet you will keep: send the capital to one ${chain} address in a single transfer, and use that same address for every later step so a snapshot's address list finds the whole position in one place. On ${chain}, ${v.note}.`,
    cost: `${g.low} to ${g.high} in gas`,
    time: '3 to 5 minutes',
  });
  const flow = p.change_7d === null
    ? 'no seven-day figure is on record for it, so treat the flow as flat and let size and time carry the position'
    : p.change_7d >= 0
      ? `its TVL is up ${p.change_7d.toFixed(1)}% on the week, so enter now rather than after the next print`
      : `its TVL is down ${Math.abs(p.change_7d).toFixed(1)}% on the week, so enter at half size and add only after two weekly prints above zero`;
  steps.push({
    text: `Time the entry: ${flow}. A protocol that has run ${age === null ? 'an unrecorded time' : `${age} days`} with no token is usually snapshotted monthly or quarterly, so plan to hold for at least ${age !== null && age > 1100 ? 'two quarters' : 'one quarter'} and do not rotate the capital between pools.`,
    cost: '$0 while held',
    time: '90 days or more',
  });
  steps.push({
    text: `Watch for the announcement: follow ${p.name}'s docs and its official account, and read the "token" or "points" page weekly; most programmes open registration one to three weeks before a token event, and a missed registration usually forfeits the season.`,
    cost: '$0',
    time: '5 minutes a week',
  });
  steps.push({
    text: `Keep the receipt: export the address and every transaction hash into one sheet, and screenshot the balance at each month end. A claim almost always needs the depositing address, and a snapshot dispute needs the transaction, not a memory.`,
    cost: '$0',
    time: '10 minutes a month',
  });
  steps.push({
    text: `Fix the exit before you enter: decide the TVL or price at which you withdraw, keep at least one withdrawal in reserve for gas (${g.low} to ${g.high}), and unwind in a single transaction so an illiquid week cannot trap the position.`,
    cost: `${g.low} to ${g.high} in gas`,
    time: '5 to 15 minutes, once',
  });
  return steps;
}

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

/** The board: every launchable protocol, ranked by what its token would be worth today. */
export function buildBoard(snapshot: Snapshot, model: Model = MODEL): { rows: Row[]; sectors: Sector[]; counts: Radar['counts'] } {
  const sectors = sectorTable(snapshot.protocols);
  const world = sectors.get('__world')!;
  const watch = new Set(snapshot.watchlist);
  const scored: Row[] = [];  for (const p of snapshot.protocols) {
    if (!launchable(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const sector = p.category !== null ? sectors.get(p.category) : undefined;
    const multiple = sector?.multiple ?? world.multiple;
    const growth = growthMultiple(p.change_7d);
    const maturity = maturityMultiple(age);
    const implied = Math.round(p.tvl_usd * multiple * growth * maturity);
    if (implied < 1) continue;
    scored.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      age_days: age,
      watchlist: watch.has(p.slug),
      band: band(age),
      implied_value_usd: Math.min(implied, 1e14),
      sector_multiple: multiple,
      sector_source: sector === undefined ? 'world' : p.category ?? 'world',
      growth_multiple: growth,
      maturity_multiple: maturity,
      token_status: 'pre-token',
      farm_steps: farmSteps(p, age).map((s) => s.text),
    });
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const rows = scored.slice(0, model.rows).map((row, i) => ({ ...row, rank: i + 1 }));
  const kept: Sector[] = [];
  for (const [, sector] of sectors) if (sector.category !== 'all categories') kept.push(sector);
  kept.sort((a, b) => b.multiple - a.multiple);
  kept.push(world);
  let watchTvl = 0;
  for (const p of snapshot.protocols) if (watch.has(p.slug)) watchTvl += p.tvl_usd;
  const belowFloor = scored.filter((r) => !r.watchlist).length;
  return {
    rows,
    sectors: kept,
    counts: {
      protocols: snapshot.protocols.length,
      launchable: scored.length,
      watchlist: snapshot.watchlist.length,
      above_floor: snapshot.watchlist.length,
      rows: rows.length,
      live: 0,
      categories: kept.length - 1,
      watchlist_tvl: watchTvl,
      below_floor: belowFloor,
    },
  };
}

/** The protocols whose token already trades: the other half of the picture, by market cap. */
export function liveRows(snapshot: Snapshot, limit = 40): Live[] {
  const out: Live[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: round(p.mcap_usd / Math.max(p.tvl_usd, 1), 3),
    });
  }
  out.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  return out.slice(0, limit);
}

/** Everything the page needs, in the shape it reads it. */
export function buildRadar(snapshot: Snapshot, model: Model = MODEL): { rows: Row[]; radar: Radar } {
  const { rows, sectors, counts } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const bySector = new Map(sectors.map((s) => [s.category, s]));
  const trading = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length;
  return {
    rows,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source.replace(/https?:\/\/\S+/g, 'DefiLlama'),
      floor_usd: snapshot.floor_usd,
      model,
      counts: { ...counts, live: trading },
      sectors,
      rows: rows.map((r) => ({
        rank: r.rank,
        slug: r.slug,
        name: r.name,
        category: r.category,
        chains: r.chains,
        tvl: r.tvl_usd,
        chg: r.change_7d,
        mcap: r.mcap_usd,
        listed: r.listed_at,
        age: r.age_days,
        watch: r.watchlist,
        band: r.band,
        implied: r.implied_value_usd,
        sector: r.sector_multiple,
        sectorBasis: bySector.get(r.sector_source)?.basis ?? 'the whole snapshot',
        growth: r.growth_multiple,
        maturity: r.maturity_multiple,
        why: whyLine({
          rank: r.rank,
          rows: rows.length,
          name: r.name,
          category: r.category,
          tvl_usd: r.tvl_usd,
          change_7d: r.change_7d,
          age_days: r.age_days,
          watchlist: r.watchlist,
          hasPeers: bySector.get(r.sector_source)?.basis.startsWith('median of') === true,
          multiplier: r.sector_multiple,
        }),
        total: planTotal(snapshot.protocols.find((p) => p.slug === r.slug)!),
        steps: farmSteps(
          snapshot.protocols.find((p) => p.slug === r.slug)!,
          r.age_days,
        ),
      })),
      live,
    },
  };
}

/** The page's data file: one assignment, no imports, no network. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
