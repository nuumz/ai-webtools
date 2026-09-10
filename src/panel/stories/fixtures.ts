/**
 * Representative data for the Storybook stories.
 *
 * Built with the same factories the extension uses (`newStory`, `newProfile`,
 * `newField`, `toExchangeMeta`) so a change to those shapes breaks the stories
 * instead of leaving them quietly wrong, and the API payloads mirror the
 * endpoints in `tests/e2e/harness.mjs` — what a real recording looks like.
 */
import type { CapturedExchange, ExchangeMeta } from '../../shared/capture';
import { toExchangeMeta } from '../../shared/capture';
import { newField, newProfile, type FormCase, type FormProfile } from '../../shared/form';
import type { ScreenOutcome } from '../../inject/run';
import { newStory, type StoryMeta } from '../../shared/story';
import type { NetworkLogState } from '../hooks/useNetworkLog';
import { DEFAULT_SETTINGS, type MutationRule, type Settings } from '../../shared/types';

const ORIGIN = 'https://shop.internal';
const T0 = Date.UTC(2026, 2, 17, 9, 30, 0);

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

/** The payloads the e2e harness serves, so fixtures match a real capture. */
export const payloads = {
  users: { status: 'PENDING', user: { name: 'real', role: 'USER' } },
  items: {
    status: 'PENDING',
    data: {
      items: [
        { sku: 'a', price: 100, inStock: true },
        { sku: 'b', price: 200, inStock: true },
      ],
      total: 300,
    },
  },
  error: { message: 'boom' },
  slow: { slow: true, waited: 1200 },
};

export const settings: Settings = {
  ...DEFAULT_SETTINGS,
  captureEnabled: true,
  lastProfileByOrigin: { [ORIGIN]: 'pf_signup' },
  syncEnabled: true,
};

export const rules: MutationRule[] = [
  {
    id: 'r_items',
    isActive: true,
    type: 'MUTATE_RESPONSE',
    urlPattern: '/api/items',
    method: 'ANY',
    payload: { status: 'APPROVED' },
    ops: [
      { op: 'set', path: 'data.items[0].price', value: 0 },
      { op: 'set', path: 'data.items[*].inStock', value: false },
    ],
    label: 'Everything free and out of stock',
  },
  {
    id: 'r_slow',
    isActive: true,
    type: 'STUB',
    urlPattern: `${ORIGIN}/api/slow?ms=1200`,
    method: 'GET',
    payload: payloads.slow,
    status: 200,
    delayMs: 1200,
    jitterMs: 300,
  },
  {
    id: 'r_checkout',
    isActive: true,
    type: 'MUTATE_REQUEST',
    urlPattern: '/api/checkout',
    method: 'POST',
    payload: { user: { role: 'ADMIN' } },
    fault: { kind: 'status', status: 503, body: payloads.error },
    priority: 10,
  },
  {
    id: 'r_offline',
    isActive: false,
    type: 'MUTATE_RESPONSE',
    urlPattern: '/api/session',
    method: 'GET',
    payload: {},
    fault: { kind: 'network-error' },
    scope: { origins: [ORIGIN] },
  },
];

export const stories: StoryMeta[] = [
  { ...newStory('Checkout — happy path'), id: 'st_checkout', isActive: true, replayTiming: true, entryCount: 12, createdAt: T0 },
  { ...newStory('Empty cart', 'path'), id: 'st_empty', strict: true, entryCount: 5, createdAt: T0 },
  { ...newStory('Order polling — PENDING → DONE'), id: 'st_poll', isActive: true, entryCount: 3, createdAt: T0 },
];

const signup: FormProfile = {
  ...newProfile('Signup — valid'),
  id: 'pf_signup',
  siteScope: `${ORIGIN}/*`,
  screen: { texts: ['Create your account', 'Billing address'] },
  fields: [
    { ...newField('email'), id: 'f_email', label: 'Email', selectors: [{ strategy: 'testid', value: 'email' }], source: { kind: 'template', value: "qa+{{seq('user')}}@dev.local" } },
    { ...newField('password'), id: 'f_pw', selectors: [{ strategy: 'id', value: 'password' }], source: { kind: 'literal', value: 'hunter2!' } },
    { ...newField('confirmPassword'), id: 'f_pw2', selectors: [{ strategy: 'name', value: 'confirmPassword' }], source: { kind: 'ref', value: 'password' } },
    { ...newField('qty'), id: 'f_qty', selectors: [{ strategy: 'id', value: 'qty' }], source: { kind: 'literal', value: '3' } },
    { ...newField('price'), id: 'f_price', selectors: [{ strategy: 'label', value: 'Unit price' }], source: { kind: 'literal', value: '149' } },
    { ...newField('total'), id: 'f_total', label: 'Total', selectors: [{ strategy: 'label', value: 'Total' }], source: { kind: 'expr', value: 'qty * price' } },
    { ...newField('country'), id: 'f_country', selectors: [{ strategy: 'id', value: 'country' }], source: { kind: 'literal', value: 'Thailand' }, after: { waitMs: 250, blur: true } },
    { ...newField('city'), id: 'f_city', enabled: false, selectors: [{ strategy: 'id', value: 'city' }], source: { kind: 'literal', value: 'Chiang Mai' } },
  ],
};

/** A profile whose formulas reference each other in a loop, to show the error path. */
const circular: FormProfile = {
  ...newProfile('Broken — circular'),
  id: 'pf_circular',
  fields: [
    { ...newField('a'), id: 'f_a', source: { kind: 'expr', value: 'b + 1' } },
    { ...newField('b'), id: 'f_b', source: { kind: 'expr', value: 'a + 1' } },
  ],
};

export const profiles: FormProfile[] = [signup, circular, { ...newProfile('Signup — bad card'), id: 'pf_invalid' }];

/** Two cases over one screen: the selectors are defined once, the data twice. */
export const formCases: FormCase[] = [
  { id: 'cs_thai', profileId: 'pf_signup', name: 'Thai customer', values: { country: 'Thailand', qty: '3' } },
  // `city` is deliberately blank — a case that drops it cannot put the form back as found.
  { id: 'cs_bulk', profileId: 'pf_signup', name: 'Bulk order — 250', values: { qty: '250', city: '' } },
];

/** Two signatures scored against a page showing the second one. */
export const screenOnStep: ScreenOutcome = {
  scores: [
    { id: 'pf_signup', matched: 2, total: 2 },
    { id: 'pf_circular', matched: 0, total: 0 },
  ],
  best: 'pf_signup',
  sample: ['Create your account', 'Billing address', 'Payment'],
};

export const screenElsewhere: ScreenOutcome = {
  scores: [
    { id: 'pf_circular', matched: 1, total: 1 },
    { id: 'pf_signup', matched: 1, total: 2 },
  ],
  best: 'pf_circular',
  sample: ['Confirm and pay', 'Order summary'],
};

interface ExchangeSeed {
  method: string;
  pathname: string;
  search?: string;
  status: number;
  servedBy: CapturedExchange['servedBy'];
  durationMs: number;
  resBytes: number;
  transport?: CapturedExchange['transport'];
  outcome?: CapturedExchange['outcome'];
}

const SEEDS: ExchangeSeed[] = [
  { method: 'GET', pathname: '/api/session', status: 200, servedBy: 'network', durationMs: 41, resBytes: 312 },
  { method: 'GET', pathname: '/api/items', status: 200, servedBy: 'mutated', durationMs: 55, resBytes: 1840 },
  { method: 'GET', pathname: '/api/slow', search: '?ms=1200', status: 200, servedBy: 'stub', durationMs: 1204, resBytes: 96 },
  { method: 'POST', pathname: '/api/checkout', status: 503, servedBy: 'stub', durationMs: 38, resBytes: 74, transport: 'xhr' },
  { method: 'GET', pathname: '/api/users/1', status: 200, servedBy: 'network', durationMs: 62, resBytes: 24310 },
  { method: 'GET', pathname: '/assets/logo.svg', status: 304, servedBy: 'network', durationMs: 8, resBytes: 0 },
  { method: 'POST', pathname: '/api/telemetry', status: 0, servedBy: 'network', durationMs: 3010, resBytes: 0, outcome: 'network-error' },
];

export const exchanges: ExchangeMeta[] = SEEDS.map((seed, index) => {
  // toExchangeMeta derives the row sizes from the body snapshots, so give it
  // bodies rather than setting reqBytes/resBytes by hand.
  const captured: CapturedExchange = {
    id: `ex${index}`,
    startedAt: T0 + index * 900,
    durationMs: seed.durationMs,
    transport: seed.transport ?? 'fetch',
    servedBy: seed.servedBy,
    outcome: seed.outcome ?? 'ok',
    method: seed.method,
    url: `${ORIGIN}${seed.pathname}${seed.search ?? ''}`,
    status: seed.status,
    statusText: seed.status === 200 ? 'OK' : '',
    contentType: 'application/json',
    requestBody: seed.method === 'POST' ? { text: '', bytes: 180, truncated: false, redacted: true } : undefined,
    responseBody: { text: '', bytes: seed.resBytes, truncated: false, redacted: false },
  };
  return toExchangeMeta(captured);
});

const snapshot = (text: string, extra: { truncated?: boolean; redacted?: boolean } = {}) => ({
  text,
  bytes: text.length,
  truncated: extra.truncated ?? false,
  redacted: extra.redacted ?? false,
});

/**
 * A response the signup profile can actually be built from: six of its eight
 * fields are in here under two different shapes of nesting, `city` is blank on
 * purpose, and `meta` carries three values no field wants.
 */
const customerPayload = {
  customer: { email: 'somchai@dev.local', country: 'Thailand', city: '' },
  order: { qty: 12, price: 149, total: 1788 },
  meta: { traceId: 'a7f3c1', region: 'apac', retries: 0 },
};

/** The wrong exchange: a status envelope that happens to carry one field name. */
const thinPayload = { status: 'OK', requestId: '9f21', ts: 1_735_000_000_000, qty: 1 };

export const bodies = {
  items: { found: true, response: snapshot(pretty(payloads.items)) },
  customer: { found: true, response: snapshot(pretty(customerPayload)) },
  thin: { found: true, response: snapshot(pretty(thinPayload)) },
  checkout: {
    found: true,
    request: snapshot(pretty({ coupon: 'SUMMER', password: '«redacted»' }), { redacted: true }),
    response: snapshot(pretty(payloads.error)),
  },
  truncated: {
    found: true,
    request: snapshot(pretty({ token: '«redacted»' }), { redacted: true }),
    response: snapshot(`${pretty(payloads.users).slice(0, 120)}…`, { truncated: true, redacted: true }),
  },
  missing: { found: false },
};

export const recordedFields = [
  { selectors: [{ strategy: 'testid' as const, value: 'email' }], value: 'tester@dev.local', label: 'Email' },
  { selectors: [{ strategy: 'id' as const, value: 'password' }], value: 'hunter2!', label: 'Password' },
  { selectors: [{ strategy: 'name' as const, value: 'cardNo' }], value: '4111 1111 1111 1111', label: 'Card number' },
  { selectors: [{ strategy: 'label' as const, value: 'Country' }], value: 'Thailand', label: 'Country' },
  { selectors: [{ strategy: 'css' as const, value: 'form > div:nth-child(5) input' }], value: '3', label: 'Quantity' },
];

export const tabUrl = `${ORIGIN}/checkout`;
export const usageBytes = 3_612_480;

/**
 * A `NetworkLogState` that behaves like the real hook without a port. The
 * handlers are created once per call and kept stable by the stories, because
 * `ExchangeDetail` re-runs its body-loading effect whenever `onLoadBody`
 * changes identity.
 */
export function makeLog(over: Partial<NetworkLogState> = {}): NetworkLogState {
  return {
    connected: true,
    tabId: 1,
    tabUrl,
    pinned: true,
    tabClosed: false,
    recording: true,
    setRecording: () => {},
    pageConnected: true,
    entries: exchanges,
    dropped: 0,
    bodies: { ex1: bodies.items, ex3: bodies.checkout },
    loadBody: () => {},
    fetchBody: () => Promise.resolve(bodies.items),
    clear: () => {},
    ...over,
  };
}
