// Launch-value model for the token radar: one DefiLlama snapshot in, one ranked board out.
//
// The question the board answers is narrow: if a protocol that records no token issued one today,
// what might that token be worth, and what should a reader do about it before it happens? Every
// number on the board is derived from the snapshot's own figures by the formulas below. No protocol
// is ever named in the model: the same code scores a $5M lending market and a $5B staking pool,
// and a fresh snapshot tomorrow re-ranks itself with no edits here.
//
// The board's universe is every protocol in the snapshot that records no token (no market cap, no
// CoinGecko id, no symbol), minus the ones that cannot launch a token of their own in any useful
// sense: centralised exchanges, versioned pools of a parent protocol (a name ending in V2, 2.0 and
// the like) and products whose name marks them as a wrapped or staked form of an asset that already
// trades. One more line, drawn where the watchlist draws its own: at or above the watchlist's
// floor, a protocol in a product category (a bridge, a liquid staking pool, a restaked asset, a
// stablecoin wrapper) is a form of an asset that already trades — WBTC is Bitcoin on Ethereum,
// not a launch — so it is set aside whatever its name says. Below the floor those same categories
// are ranked: at that size no traded parent is established, and surfacing them early is the
// radar's whole job. The snapshot's watchlist is a floor, not the universe: every watchlist slug
// is ranked, and so is every other protocol in the universe, most of them far below the floor.

/** One protocol record, exactly the ten fields the sealed snapshot carries. */
export interface ProtocolRecord {
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

/** The snapshot document the program reads. */
export interface SnapshotData {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** Why a snapshot cannot be scored. */
export class SnapshotShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotShapeError';
  }
}

/** The snapshot's JSON text, checked field by field and normalised into the shapes above. */
export function parseSnapshot(text: string): SnapshotData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotShapeError('snapshot is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotShapeError('snapshot is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotShapeError('snapshot carries no as_of date');
  }
  if (typeof doc.source !== 'string' || doc.source.length === 0) {
    throw new SnapshotShapeError('snapshot carries no source line');
  }
  if (typeof doc.floor_usd !== 'number' || !Number.isFinite(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapshotShapeError('snapshot carries no usable floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapshotShapeError('snapshot carries no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotShapeError('snapshot carries no watchlist of slugs');
  }
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotShapeError(`protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') {
      throw new SnapshotShapeError(`protocol ${i} lacks a slug or a name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotShapeError(`protocol ${i} lacks a TVL`);
    }
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return {
    as_of: doc.as_of,
    source: doc.source,
    floor_usd: doc.floor_usd,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

// ---------------------------------------------------------------------------
// Classification: what may be ranked, and what is set aside, and why.
// ---------------------------------------------------------------------------

/** A protocol records a token when any of the three token fields is present. */
export function recordsToken(p: ProtocolRecord): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** DefiLlama's version marker: a name ending in a release is a pool of a parent protocol. */
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Names that mark a wrapped or staked form of an asset that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a protocol may begin with; an exchange's own launch is not this radar's subject. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** True when the protocol is a centralised exchange by category or by name. */
export function isExchange(p: ProtocolRecord): boolean {
  if (p.category === 'CEX') return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** True when the protocol cannot usefully launch a token of its own, so the board sets it aside. */
export function isSetAside(p: ProtocolRecord): boolean {
  return isExchange(p) || VERSIONED_NAME.test(p.name) || WRAPPED_WORD.test(p.name);
}

/** The board's universe: records no token, and is not set aside. */
export function isRankable(p: ProtocolRecord): boolean {
  return !recordsToken(p) && !isSetAside(p);
}

/**
 * The categories the watchlist itself treats as products of an asset that already trades. At or
 * above the watchlist floor a protocol in one of these is set aside as such a product; below the
 * floor it is ranked as an early candidate.
 */
export const PRODUCT_CATEGORIES: ReadonlySet<string> = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
]);

/** True when a protocol is a large product of a traded asset rather than a launch candidate. */
export function isProductAboveFloor(p: ProtocolRecord, floorUsd: number): boolean {
  return p.tvl_usd >= floorUsd && p.category !== null && PRODUCT_CATEGORIES.has(p.category);
}

// ---------------------------------------------------------------------------
// The value model. Stated here in full, and repeated on the dashboard.
// ---------------------------------------------------------------------------

/** The model's own label, shown on the dashboard's methodology panel. */
export const MODEL_VERSION = 'accrued-launch-value/1';

/**
 * What a launched token in each category has historically been worth against the TVL behind it,
 * as one multiple. A chain's token is the network's own asset, so it carries the richest multiple;
 * a canonical bridge is infrastructure a chain runs, so it carries the thinnest. Any category the
 * table does not name takes DEFAULT_CATEGORY_MULTIPLE.
 */
export const CATEGORY_MULTIPLES: Record<string, number> = {
  Chain: 0.4,
  Lending: 0.35,
  CDP: 0.32,
  'CDP Manager': 0.3,
  Dexs: 0.3,
  Launchpad: 0.3,
  Derivatives: 0.28,
  'Uncollateralized Lending': 0.26,
  Restaking: 0.26,
  'Prediction Market': 0.26,
  'AI Agents': 0.26,
  'Decentralized AI': 0.26,
  'Risk Curators': 0.24,
  'Onchain Capital Allocator': 0.24,
  Options: 0.24,
  Synthetics: 0.24,
  Privacy: 0.24,
  'Liquid Restaking': 0.22,
  'Options Vault': 0.22,
  Yield: 0.22,
  'Yield Aggregator': 0.22,
  'Collateral Markets': 0.22,
  Bridge: 0.2,
  'Cross Chain Bridge': 0.2,
  'Leveraged Farming': 0.2,
  'Liquidity Manager': 0.2,
  'Collateral Management': 0.2,
  Payments: 0.2,
  'NFT Marketplace': 0.2,
  'Dual-Token Stablecoin': 0.2,
  'Stablecoin Issuer': 0.2,
  'Liquid Staking': 0.18,
  'Staking Pool': 0.18,
  Farm: 0.18,
  'Basis Trading': 0.18,
  Indexes: 0.18,
  Insurance: 0.18,
  CeDeFi: 0.18,
  'Crypto Card Issuer': 0.18,
  'OTC Marketplace': 0.18,
  RWA: 0.16,
  'Token Locker': 0.16,
  'Governance Incentives': 0.16,
  'Decentralized BTC': 0.16,
  'Reserve Currency': 0.16,
  DOR: 0.16,
  'Restaked BTC': 0.14,
  'Canonical Bridge': 0.12,
  'Anchor BTC': 0.12,
  'Stablecoin Wrapper': 0.1,
};
export const DEFAULT_CATEGORY_MULTIPLE = 0.2;

/** Seven-day TVL change is clamped to this band before it moves the value. */
export const MOMENTUM_FLOOR_PCT = -50;
export const MOMENTUM_CAP_PCT = 100;
/** How much of the clamped weekly change becomes value: a +100% week lifts value by 60%. */
export const MOMENTUM_WEIGHT = 0.6;
/** Tokenless tenure is credited up to this many days; past it the credit stops growing. */
export const TENURE_FULL_DAYS = 1460;
/** Tenure moves value between these two multipliers. */
export const TENURE_LOW = 0.75;
export const TENURE_HIGH = 1.25;
/** When DefiLlama reports no listing date, the model assumes this many tokenless days. */
export const UNKNOWN_AGE_DAYS = 548;
/** Each extra chain a protocol runs on adds this much reach, up to REACH_MAX_EXTRA chains. */
export const REACH_PER_CHAIN = 0.04;
export const REACH_MAX_EXTRA = 10;

const DAY_MS = 86_400_000;

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot's day. */
export function tokenlessDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The four figures one protocol's implied value is built from. */
export interface ValueBreakdown {
  category_multiple: number;
  momentum_multiplier: number;
  tenure_multiplier: number;
  reach_multiplier: number;
  change_7d_clamped: number | null;
  age_days: number | null;
  age_assumed: boolean;
}

/** One protocol's implied value and the breakdown behind it, under the stated model. */
export function impliedValueOf(p: ProtocolRecord, asOf: string): { implied: number; breakdown: ValueBreakdown } {
  const categoryMultiple = CATEGORY_MULTIPLES[p.category ?? ''] ?? DEFAULT_CATEGORY_MULTIPLE;
  const clamped =
    p.change_7d === null ? null : Math.min(MOMENTUM_CAP_PCT, Math.max(MOMENTUM_FLOOR_PCT, p.change_7d));
  const momentumMult = clamped === null ? 1 : 1 + (clamped / 100) * MOMENTUM_WEIGHT;
  const age = tokenlessDays(asOf, p.listed_at);
  const ageAssumed = age === null;
  const ageUsed = age ?? UNKNOWN_AGE_DAYS;
  const tenureMult =
    TENURE_LOW + (Math.min(ageUsed, TENURE_FULL_DAYS) / TENURE_FULL_DAYS) * (TENURE_HIGH - TENURE_LOW);
  const reachMult = 1 + REACH_PER_CHAIN * Math.min(Math.max(p.chains.length - 1, 0), REACH_MAX_EXTRA);
  const implied = Math.max(1, Math.round(p.tvl_usd * categoryMultiple * momentumMult * tenureMult * reachMult));
  return {
    implied,
    breakdown: {
      category_multiple: categoryMultiple,
      momentum_multiplier: round4(momentumMult),
      tenure_multiplier: round4(tenureMult),
      reach_multiplier: round4(reachMult),
      change_7d_clamped: clamped,
      age_days: age,
      age_assumed: ageAssumed,
    },
  };
}

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

// ---------------------------------------------------------------------------
// The signal score: how hot a protocol runs, ignoring its size.
// ---------------------------------------------------------------------------

/** A percentile ranker over one figure: 0 for the lowest value, 100 for the highest, ties averaged. */
export function percentileRanker(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number): number => {
    if (sorted.length === 0) return 50;
    let below = 0;
    let equal = 0;
    for (const s of sorted) {
      if (s < v) below++;
      else if (s === v) equal++;
    }
    return ((below + equal / 2) / sorted.length) * 100;
  };
}

// ---------------------------------------------------------------------------
// Farm plans, generated from the protocol's own record.
// ---------------------------------------------------------------------------

/** The gas asset a chain settles in, for the funding step. */
const GAS_ASSET: Record<string, string> = {
  Ethereum: 'ETH',
  Arbitrum: 'ETH',
  Optimism: 'ETH',
  Base: 'ETH',
  Linea: 'ETH',
  Scroll: 'ETH',
  zkSync: 'ETH',
  Mantle: 'MNT',
  Binance: 'BNB',
  'BNB Chain': 'BNB',
  Solana: 'SOL',
  Avalanche: 'AVAX',
  Polygon: 'POL',
  Bitcoin: 'BTC',
  Tron: 'TRX',
  Sui: 'SUI',
  Aptos: 'APT',
  Near: 'NEAR',
  Cosmos: 'ATOM',
  'Hyperliquid L1': 'HYPE',
  Monad: 'MON',
  Plasma: 'XPL',
};

/** A rough one-way fee for one transaction on a chain, in dollars, for the plan's cost lines. */
function feeFor(chain: string): number {
  if (chain === 'Ethereum') return 6;
  if (chain === 'Bitcoin') return 2;
  if (chain === 'Tron') return 1;
  return 0.5;
}

/** The chain a plan is written around: the first the protocol names, or a neutral phrase. */
function homeChain(p: ProtocolRecord): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** The capital one farm position carries, from the protocol's own TVL band. */
export function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  if (tvl >= 10_000_000) return 60;
  return 40;
}

/** How many weeks a position should be worked, from the protocol's tokenless age. */
export function campaignWeeks(ageDays: number | null): number {
  if (ageDays === null) return 6;
  if (ageDays < 365) return 8;
  if (ageDays < 1095) return 6;
  return 4;
}

interface Playbook {
  /** The core position, with the capital and chain filled in. */
  open: (name: string, capital: number, chain: string) => string;
  /** A second, different qualifying action on the same protocol. */
  deepen: (name: string, chain: string) => string;
  /** An alternative second action; each protocol's plan takes one of the variants, by its slug. */
  deepen2: (name: string, chain: string) => string;
  /** A third second action, for the playbooks the board leans on most. */
  deepen3?: (name: string, chain: string) => string;
  /** How the position is unwound when the farm ends. */
  unwind: (name: string) => string;
}

const PLAYBOOKS: { match: (category: string) => boolean; book: Playbook }[] = [
  {
    match: (c) => c.includes('lend') || c === 'CDP' || c.includes('cdp'),
    book: {
      open: (n, k, ch) => `Supply $${k} of USDC to ${n} on ${ch} so the wallet shows a live lending position, then borrow about a third of it back and re-supply the loan to build genuine two-sided activity`,
      deepen: (n, ch) => `Open a second, smaller supply position in a different ${n} market on ${ch} (a ETH or wrapped-BTC market, not only stablecoins), because multi-market use is what points programs usually count`,
      deepen2: (n, ch) => `Roll the borrow once on ${ch}: repay it in full, then borrow again against the same supply a week later, so the wallet shows a complete lending cycle rather than one static position`,
      deepen3: (n, ch) => `Move part of the supply between two of ${n}'s markets once on ${ch} — withdraw from one and supply into another a few days later — so the wallet shows portfolio behaviour, not a parked deposit`,
      unwind: (n) => `Repay any open borrow first, then withdraw the supplied balance in one transaction; ${n} has no lock-up on supplied funds, so the exit settles the same day`,
    },
  },
  {
    match: (c) => c.includes('dex') || c.includes('liquidity'),
    book: {
      open: (n, k, ch) => `Provide $${k} split evenly between USDC and the chain's main asset in ${n}'s busiest pool on ${ch}, and keep the LP position open rather than hopping between pools`,
      deepen: (n, ch) => `Route your ordinary swaps on ${ch} through ${n} itself instead of a rival aggregator, a few trades a week, so the wallet also carries trader history and not only liquidity`,
      deepen2: (n, ch) => `Claim whatever fees or points the pool credits to the position and put them straight back into the same ${n} pool on ${ch}, so the position compounds instead of sitting idle`,
      deepen3: (n, ch) => `Open a second, smaller LP position in a different ${n} pool on ${ch} — a different pair, not the same one twice — so the wallet farms the venue and not a single pool`,
      unwind: (n) => `Remove the liquidity in one visit and swap the proceeds back to USDC; watch the pool's exit fee on ${n} before you confirm, and leave nothing behind in old pool versions`,
    },
  },
  {
    match: (c) => c.includes('staking') || c.includes('restak'),
    book: {
      open: (n, k, ch) => `Stake $${k} of the chain's staking asset through ${n} on ${ch} and hold the liquid receipt token in the same wallet, unstaked and visible`,
      deepen: (n, ch) => `Put a small part of the receipt token to work in one ${n} partner market on ${ch} (a lending market or a liquidity pool), which is the behaviour restaking ecosystems reward most`,
      deepen2: (n, ch) => `Place a second, smaller stake with a different validator or vault inside ${n} on ${ch}, since a wallet staked in exactly one place is the first shape a sybil screen looks for`,
      deepen3: (n, ch) => `Re-stake the rewards ${n} pays out once, in the same wallet, so the position grows from its own yield at least once during the campaign instead of only from deposits`,
      unwind: (n) => `Start the unstake early: staking exits on ${n} queue behind an unbonding window, so request the withdrawal at least two weeks before you need the funds back`,
    },
  },
  {
    match: (c) => c.includes('bridge'),
    book: {
      open: (n, k, ch) => `Bridge $${k} of USDC from Ethereum to ${ch} through ${n}, then use the bridged funds inside one app on the far side instead of bridging straight back`,
      deepen: (n, ch) => `Make one return bridge of a smaller amount a fortnight later, so the wallet's history reads as a user moving funds with purpose, not a single farmed crossing`,
      deepen2: (n, ch) => `Bridge a second kind of asset across ${n} once — the chain's gas token rather than USDC — so the wallet's crossings are not all one asset moving in one direction`,
      unwind: (n) => `Bridge the remaining balance back to Ethereum through ${n} and keep the transaction hashes; bridged positions carry no lock-up once the crossing settles`,
    },
  },
  {
    match: (c) => c.includes('derivative') || c.includes('perpetual') || c.includes('option'),
    book: {
      open: (n, k, ch) => `Deposit $${k} of USDC as margin on ${n} and open one small, hedged position (long the asset you hold spot elsewhere), sized so a bad week cannot liquidate it`,
      deepen: (n, ch) => `Trade a second instrument on ${n} (a different expiry or market) once a week in small size; volume spread across markets is the metric derivatives venues publish`,
      deepen2: (n, ch) => `Post one small limit order on ${n} and let it rest unfilled for a day before cancelling; resting orders are the liquidity derivatives venues say they reward`,
      unwind: (n) => `Close every open position first, wait for funding to settle, then withdraw the margin; never leave a position open on ${n} while you withdraw`,
    },
  },
  {
    match: (c) => c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('manager'),
    book: {
      open: (n, k, ch) => `Deposit $${k} of USDC into the largest curated vault ${n} runs on ${ch} and keep the vault shares in the wallet that made the deposit`,
      deepen: (n, ch) => `Add a second deposit into a different ${n} vault with a different strategy, even a small one, so the wallet is a user of the platform and not of one vault only`,
      deepen2: (n, ch) => `When ${n} opens a new vault on ${ch}, move a small slice of the first deposit into it in its first week; early depositors in a fresh vault are the cohort a curator can identify`,
      deepen3: (n, ch) => `Shift a small slice from the first vault into a second ${n} vault mid-campaign and leave it there; a curator reads vault-to-vault movement as an allocator at work, not a parked balance`,
      unwind: (n) => `Redeem the vault shares from ${n} in one visit; most vaults settle at once, but check the vault's own withdrawal window before you plan around the funds`,
    },
  },
  {
    match: (c) => c.includes('rwa') || c.includes('stable') || c.includes('basis') || c.includes('index'),
    book: {
      open: (n, k, ch) => `Mint or buy $${k} of ${n}'s yield-bearing asset on ${ch} through its own app and hold it; for asset issuers the holder count and holding time are the whole game`,
      deepen: (n, ch) => `Use the minted asset once as collateral or liquidity in a partner market ${n} lists, then return it to the plain holding wallet for the rest of the campaign`,
      deepen2: (n, ch) => `If ${n} runs a holder vote or forum on ${ch}, take part once from the holding wallet; for an issuer, a holder who shows up is worth more than a balance that never moves`,
      unwind: (n) => `Redeem the asset through ${n}'s own redemption path rather than selling into a thin pool; redemptions can settle over days, so start before you need the money`,
    },
  },
  {
    match: (c) => c.includes('prediction'),
    book: {
      open: (n, k, ch) => `Fund ${n} with $${k} of USDC on ${ch} and take positions in two or three liquid markets you can actually follow, sized small enough to hold to settlement`,
      deepen: (n, ch) => `Add a limit order that rests in one market's book for a day or more; resting liquidity is scarcer than taker volume and venues notice it`,
      deepen2: (n, ch) => `Later in the week take the other side of one of your own markets in a second, smaller position, so the wallet trades both ways like a participant and not a tip sheet`,
      unwind: (n) => `Let open positions settle rather than selling out early, then withdraw the balance; settled markets pay in full, early exits pay the spread`,
    },
  },
];

const FALLBACK_BOOK: Playbook = {
  open: (n, k, ch) => `Deposit $${k} of USDC into ${n} on ${ch} through its own app and keep the position open; a live, held position is the activity a launch snapshot can see`,
  deepen: (n, ch) => `Use one more of ${n}'s own features on ${ch} (a second market, a vote, or its points page if it runs one), so the wallet reads as a user and not a single deposit`,
  deepen2: (n, ch) => `Reach ${n} through a second doorway once — its partner front-end or mobile app on ${ch} if it has one — so the wallet's history is not a single repeated path`,
  unwind: (n) => `Withdraw through ${n}'s own exit path and keep the hashes; check for a withdrawal queue or notice period before you count on the funds`,
};

/** The playbook a category farms by. */
function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) if (entry.match(c)) return entry.book;
  return FALLBACK_BOOK;
}

/** A small stable hash of a slug, so plan wording varies by protocol and never by run. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** What one protocol's farm campaign costs, totalled from the plan's own figures. */
export interface FarmSummary {
  /** The position the plan opens, in dollars. */
  position_usd: number;
  /** Every fee the plan names, added up: setup gas, each visit's fee, the weekly work, the claim. */
  fees_usd: number;
  /** Position plus fees: what the campaign ties up, all in. */
  all_in_usd: number;
  /** How many weeks the campaign runs. */
  weeks: number;
  /** The weekly visit's length, in minutes. */
  minutes_per_week: number;
}

/** A seven-day change as the plans quote it: a sign and one decimal. */
function pctText(change: number): string {
  return `${change > 0 ? '+' : ''}${Math.round(change * 10) / 10}%`;
}

/**
 * One protocol's farm plan: seven steps, or eight for a watchlist protocol or a large one, each a
 * single string carrying the action, what it costs and how long it takes, plus the campaign's
 * totals. Every figure in it comes from the protocol's own record: its category picks the
 * playbook, its first chain picks the funding route, its TVL band picks the capital, its
 * tokenless age picks the campaign's length, its chain count decides whether the plan works a
 * second chain, and its seven-day change adds a clause to the weekly step when the move is sharp
 * either way. The wording is varied on purpose — three openings for the wallet step, up to three
 * second actions per playbook, two forms each for the second deposit, the weekly work, the record
 * keeping and three for the mid-campaign review — chosen by a stable hash of the protocol's slug,
 * so no two plans read alike yet the same snapshot always writes the same plan. The summary is
 * totalled from the same figures the steps quote, so the plan and its price can never disagree.
 */
export function farmPlanFor(
  p: ProtocolRecord,
  ageDays: number | null,
  onWatchlist = false,
): { steps: string[]; summary: FarmSummary } {
  const chain = homeChain(p);
  const gas = GAS_ASSET[chain] ?? 'the chain gas token';
  const fee = feeFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const weeks = campaignWeeks(ageDays);
  const book = playbookFor(p.category);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const v = slugHash(p.slug);
  const gasBudget = fee * 3;
  const setups = [
    `Set up one fresh wallet for ${p.name} alone and fund it on ${chain} with about $${gasBudget} of ${gas} for gas, keeping the seed phrase offline. Budget about $${gasBudget} once; takes 10 minutes.`,
    `Create a dedicated wallet for ${p.name}, never your main one, back its seed phrase up on paper, and send about $${gasBudget} of ${gas} to it on ${chain} so every later step can pay its own gas. Budget about $${gasBudget} once; takes 10 minutes.`,
    `Start from a clean wallet used only for ${p.name}: generate it in an app you trust, store the recovery phrase offline, and load it with roughly $${gasBudget} of ${gas} on ${chain} for fees. Budget about $${gasBudget} once; takes 10 minutes.`,
  ];
  const deepenVariants = book.deepen3 ? [book.deepen, book.deepen2, book.deepen3] : [book.deepen, book.deepen2];
  const deepen = deepenVariants[v % deepenVariants.length]!;
  const weeklyForms = [
    `Work the position once a week for ${weeks} weeks: one deposit, borrow, swap or claim each visit, never a burst in a single day. Budget about $${fee} a week in fees; takes 10 minutes a week.`,
    `Come back once a week for ${weeks} weeks and do one real thing each visit — a small top-up, a claim, a rebalance — spaced out, because a steady history reads as a user and a single-day burst reads as a script. Budget about $${fee} a week in fees; takes 10 minutes a week.`,
  ];
  let weekly = weeklyForms[Math.floor(v / 2) % 2]!;
  if (p.change_7d !== null && p.change_7d >= 10) {
    weekly += ` Its TVL is up ${pctText(p.change_7d)} in the last seven days; hold the weekly size steady rather than chasing the move.`;
  } else if (p.change_7d !== null && p.change_7d <= -10) {
    weekly += ` Its TVL is down ${pctText(p.change_7d)} in the last seven days; halve the weekly amount until the slide steadies.`;
  }
  const logForms = [
    `Keep a farm log (wallet, dates, amounts, transaction hashes) and check ${p.name}'s own points or rewards page once a month from the link its app publishes. Budget nothing; never pay anyone to claim for you. Takes 5 minutes a month.`,
    `Write down each visit as it happens (date, action, amount, hash) and re-check ${p.name}'s official channels once a month for a points program or a launch announcement. Budget nothing; never pay anyone to claim for you. Takes 5 minutes a month.`,
  ];
  const topUps = [
    `Deepen the ${chain} position once: add about $${Math.floor(capital / 2)} more after the first week, which reads as conviction rather than a one-off test deposit. Budget about $${fee} in fees; takes 10 minutes.`,
    `After the first week, add a second deposit of about $${Math.floor(capital / 2)} to the same ${chain} position — two deposits a week apart read as a user settling in, not a test. Budget about $${fee} in fees; takes 10 minutes.`,
  ];
  const step4Fee = secondChain !== null ? feeFor(secondChain) : fee;
  const steps: string[] = [
    setups[v % 3]!,
    `${book.open(p.name, capital, chain)}. Budget the $${capital} position plus about $${fee} in fees; takes 20 minutes.`,
    `${deepen(p.name, chain)}. Budget about $${fee} in fees; takes 15 minutes.`,
    secondChain !== null
      ? `Repeat a small $${Math.max(25, Math.floor(capital / 3))} version of the same position on ${secondChain}, ${p.name}'s second chain, so the farm is not a one-chain footprint. Budget about $${step4Fee} in fees; takes 15 minutes.`
      : topUps[Math.floor(v / 24) % 2]!,
    weekly,
    logForms[Math.floor(v / 6) % 2]!,
  ];
  if (onWatchlist || p.tvl_usd >= 250_000_000) {
    const reviews = [
      `Halfway through the ${weeks} weeks, review the position against ${p.name}'s own numbers: if its TVL has fallen by a third or more since the campaign began, stop adding funds and let the weekly visits wind down. Budget nothing; takes 10 minutes once.`,
      `At the halfway mark of the ${weeks} weeks, re-read ${p.name}'s numbers as they then stand — TVL, chain count, and any points page it has added since you started. If the position no longer matches the plan you began with, cut the weekly size in half rather than quitting outright. Budget nothing; takes 10 minutes once.`,
      `Once, at the middle of the ${weeks} weeks, compare ${p.name} with the protocols ranked either side of it on this board: if a neighbour has clearly outgrown it on TVL and momentum, split the remaining weeks between the two instead of doubling down on one. Budget nothing; takes 15 minutes once.`,
    ];
    steps.push(reviews[Math.floor(v / 12) % 3]!);
  }
  steps.push(
    `${book.unwind(p.name)}. If a launch is announced, claim only from the link on ${p.name}'s official page and expect the claim itself to cost about $${fee} in fees. Takes 15 minutes.`,
  );
  const fees = Math.round(gasBudget + fee + fee + step4Fee + fee * weeks + fee);
  return {
    steps: steps.map(fitStep),
    summary: {
      position_usd: capital,
      fees_usd: fees,
      all_in_usd: capital + fees,
      weeks,
      minutes_per_week: 10,
    },
  };
}

/** A step trimmed or padded into the gate's 20..600 character band, deterministically. */
function fitStep(step: string): string {
  let s = step.trim();
  if (s.length > 600) {
    const cut = s.slice(0, 596);
    const lastSpace = cut.lastIndexOf(' ');
    s = `${cut.slice(0, lastSpace > 400 ? lastSpace : 596)}...`;
  }
  if (s.length < 20) s = `${s} Keep the position open.`;
  return s;
}

// ---------------------------------------------------------------------------
// The board and the dashboard's data.
// ---------------------------------------------------------------------------

/** One ranked row of board.json, with the breakdown and farm plan the dashboard shows. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  signal_score: number;
  breakdown: ValueBreakdown;
  farm_steps: string[];
  farm_summary: FarmSummary;
}

/** A protocol whose token already trades: shown apart, at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders: the ranked board, the live set, the model it runs. */
export interface DashboardData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: {
    category_multiples: Record<string, number>;
    default_category_multiple: number;
    momentum_weight: number;
    momentum_floor_pct: number;
    momentum_cap_pct: number;
    tenure_low: number;
    tenure_high: number;
    tenure_full_days: number;
    reach_per_chain: number;
  };
  counts: { scanned: number; ranked: number; watchlist: number; watchlist_covered: number; live: number; set_aside: number };
  rows: BoardRow[];
  live: LiveRow[];
}

/** How many live-token protocols the dashboard's Already trading view carries. */
export const LIVE_VIEW_ROWS = 30;

/** The whole build: ranked board plus the dashboard's data, from one snapshot. */
export function buildRadar(snapshot: SnapshotData): { board: BoardRow[]; data: DashboardData } {
  const watch = new Set(snapshot.watchlist);
  const universe = snapshot.protocols.filter(
    (p) => isRankable(p) && (watch.has(p.slug) || !isProductAboveFloor(p, snapshot.floor_usd)),
  );

  const scored = universe.map((p) => {
    const { implied, breakdown } = impliedValueOf(p, snapshot.as_of);
    return { p, implied, breakdown };
  });

  // The signal score's percentiles run over the universe itself, so a fresh snapshot re-derives them.
  const momentumRank = percentileRanker(
    scored.map((s) => s.breakdown.change_7d_clamped ?? 0),
  );
  const tenureRank = percentileRanker(scored.map((s) => s.breakdown.age_days ?? UNKNOWN_AGE_DAYS));
  const reachRank = percentileRanker(scored.map((s) => s.p.chains.length));

  const withSignal = scored.map((s) => {
    const signal = Math.round(
      0.45 * momentumRank(s.breakdown.change_7d_clamped ?? 0) +
        0.3 * tenureRank(s.breakdown.age_days ?? UNKNOWN_AGE_DAYS) +
        0.25 * reachRank(s.p.chains.length),
    );
    return { ...s, signal };
  });

  withSignal.sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );

  const board: BoardRow[] = withSignal.map((s, i) => {
    const plan = farmPlanFor(s.p, s.breakdown.age_days, watch.has(s.p.slug));
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.breakdown.age_days,
      on_watchlist: watch.has(s.p.slug),
      implied_value_usd: s.implied,
      signal_score: s.signal,
      breakdown: s.breakdown,
      farm_steps: plan.steps,
      farm_summary: plan.summary,
    };
  });

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => recordsToken(p) && !isExchange(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_VIEW_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const data: DashboardData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      category_multiples: CATEGORY_MULTIPLES,
      default_category_multiple: DEFAULT_CATEGORY_MULTIPLE,
      momentum_weight: MOMENTUM_WEIGHT,
      momentum_floor_pct: MOMENTUM_FLOOR_PCT,
      momentum_cap_pct: MOMENTUM_CAP_PCT,
      tenure_low: TENURE_LOW,
      tenure_high: TENURE_HIGH,
      tenure_full_days: TENURE_FULL_DAYS,
      reach_per_chain: REACH_PER_CHAIN,
    },
    counts: {
      scanned: snapshot.protocols.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      watchlist_covered: board.filter((r) => watch.has(r.slug)).length,
      live: snapshot.protocols.filter(recordsToken).length,
      set_aside: snapshot.protocols.filter((p) => !recordsToken(p)).length - board.length,
    },
    rows: board,
    live,
  };
  return { board, data };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: SnapshotData): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const seen = new Set<string>();
  for (const r of board) {
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
  }
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  const ranks = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < ranks.length; i++) if (ranks[i]!.rank !== i + 1) return `rank ${i + 1} is missing or doubled`;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]!.implied_value_usd > ranks[i - 1]!.implied_value_usd) {
      return `rank ${ranks[i]!.rank} outvalues rank ${ranks[i - 1]!.rank}`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The dashboard's data file: one script that sets the page's dataset, no fetch, no network. */
export function dataScript(data: DashboardData): string {
  return `window.RADAR_DATA=${JSON.stringify(data)};\n`;
}
