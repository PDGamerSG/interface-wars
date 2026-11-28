// The pre-registered job set: 16 templates in 4 families. Each template renders a concrete job from a seeded
// random generator, so every trial gets fresh names and values but the same kind of work.
// A job is correct only if the required end state holds AND nothing outside its allowed scope changed.
import { createHash } from 'node:crypto';
import type { Seed, SeedExperiment, Snapshot, Change } from '../lab/sandbox.ts';

export type Family = 'flags' | 'targeting' | 'experiments' | 'repair';

export type Job = {
  template: string;
  family: Family;
  heldOut: boolean;
  task: string;
  seed: Seed;
  // Returns the reasons the end state is wrong (empty = required state reached).
  check: (after: Snapshot, before: Snapshot) => string[];
  // Paths the job is allowed to change. Any other change is collateral.
  allowed: (path: string) => boolean;
  strictDraft?: { name: string; feature: string; hypothesis: string; metrics: SeedExperiment['metrics'] };
};

export type Template = { id: string; family: Family; heldOut: boolean; render: (rng: Rng) => Job };

export class Rng {
  state: number;
  constructor(seed: string) {
    this.state = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) || 1;
  }
  next() {
    // xorshift32
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x;
    return x / 0xffffffff;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }
  pickMany<T>(items: readonly T[], n: number): T[] {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(this.next() * pool.length) % pool.length, 1)[0]);
    return out;
  }
}

const FEATURES = [
  'new_checkout', 'dark_mode', 'search_v2', 'promo_banner', 'one_click_buy', 'smart_reorder', 'live_chat', 'gift_wrap',
  'express_shipping', 'loyalty_points', 'wishlist_sync', 'price_alerts', 'guest_checkout', 'store_locator', 'bulk_discounts',
  'review_photos', 'size_guide', 'saved_carts', 'apple_pay', 'order_tracking_v2',
] as const;
const SEGMENTS = [
  { name: 'beta_testers', trait: 'plan', value: 'beta' },
  { name: 'enterprise_accounts', trait: 'tier', value: 'enterprise' },
  { name: 'internal_staff', trait: 'email_domain', value: 'shop.example' },
  { name: 'eu_customers', trait: 'region', value: 'eu' },
  { name: 'power_users', trait: 'orders_band', value: '50_plus' },
  { name: 'mobile_app_users', trait: 'client', value: 'ios' },
] as const;
const VALUES = ['v2', 'compact', 'blue', 'fast_lane', 'rounded', 'grid', 'tiered', 'beta_copy', 'max_10', 'eu_west'] as const;
const COPY = [
  ['Buy now', 'Get it today', 'Add to bag'],
  ['Start free trial', 'Try it free', 'See plans'],
  ['Checkout', 'Pay securely', 'Complete order'],
  ['Sign up', 'Create account', 'Join free'],
] as const;
const METRICS = [
  ['checkout_completed', 'checkout_completed'],
  ['signup_completed', 'signup_completed'],
  ['add_to_cart', 'add_to_cart_clicked'],
  ['trial_started', 'trial_started'],
] as const;
const GUARDRAILS = [
  ['refund_requested', 'refund_requested'],
  ['support_ticket_opened', 'support_ticket_opened'],
  ['payment_error', 'payment_error'],
] as const;

// Decoy flags make collateral damage observable: an agent that "fixes" more than asked changes them.
function decoys(rng: Rng, exclude: string[], n = 3): Seed['features'] {
  return rng.pickMany(FEATURES.filter((f) => !exclude.includes(f)), n).map((name, i) => ({
    name,
    value: rng.pick(VALUES),
    states: {
      Development: { enabled: i % 2 === 0 },
      Production: { enabled: i % 2 === 1 },
    },
  }));
}

const is = (got: unknown, want: unknown, label: string) =>
  JSON.stringify(got ?? null) === JSON.stringify(want ?? null) ? [] : [`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got ?? null)}`];

// A path is allowed when it equals a prefix or sits below it. A prefix that ends in '.' only matches below it, so
// `segment.vip` does not also allow `segment.vip_customers.rules`.
const prefix = (...ps: string[]) => (path: string) => ps.some((p) => path === p || path.startsWith(p.endsWith('.') ? p : p + '.'));

export const TEMPLATES: Template[] = [
  // ---------- Family 1: flag basics ----------
  {
    id: 'create_flag', family: 'flags', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES);
      const desc = `Gates the ${f.replace(/_/g, ' ')} rollout`;
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Create a new feature flag named "${f}" in the shop project with the description "${desc}". It must be turned off in every environment.`,
        seed: { features: decoys(rng, [f]) },
        check: (a) => [
          ...is(a[`feature.${f}.exists`], true, 'flag exists'),
          ...is(a[`feature.${f}.description`], desc, 'description'),
          ...is(a[`env.Development.flag.${f}.enabled`], false, 'Development off'),
          ...is(a[`env.Production.flag.${f}.enabled`], false, 'Production off'),
        ],
        allowed: prefix(`feature.${f}.`, `env.Development.flag.${f}.`, `env.Production.flag.${f}.`),
      };
    },
  },
  {
    id: 'enable_in_production', family: 'flags', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Turn on the flag "${f}" in Production. Development must stay exactly as it is.`,
        seed: { features: [{ name: f, value: rng.pick(VALUES), states: { Development: { enabled: false }, Production: { enabled: false } } }, ...decoys(rng, [f])] },
        check: (a, b) => [
          ...is(a[`env.Production.flag.${f}.enabled`], true, 'Production on'),
          ...is(a[`env.Development.flag.${f}.enabled`], b[`env.Development.flag.${f}.enabled`], 'Development unchanged'),
        ],
        allowed: prefix(`env.Production.flag.${f}.enabled`),
      };
    },
  },
  {
    id: 'set_value_in_development', family: 'flags', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES);
      const [oldV, newV] = rng.pickMany(VALUES, 2);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `In Development, set the value of the flag "${f}" to "${newV}". Do not change whether it is on or off, and do not touch Production.`,
        seed: { features: [{ name: f, value: oldV, states: { Development: { enabled: true }, Production: { enabled: true } } }, ...decoys(rng, [f])] },
        check: (a, b) => [
          ...is(a[`env.Development.flag.${f}.value`], newV, 'Development value'),
          ...is(a[`env.Development.flag.${f}.enabled`], b[`env.Development.flag.${f}.enabled`], 'Development on/off unchanged'),
          ...is(a[`env.Production.flag.${f}.value`], oldV, 'Production value unchanged'),
        ],
        allowed: prefix(`env.Development.flag.${f}.value`),
      };
    },
  },
  {
    id: 'kill_switch', family: 'flags', heldOut: true,
    render(rng) {
      const [f, ...others] = rng.pickMany(FEATURES, 4);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Incident: the flag "${f}" is causing checkout errors in Production. Turn it off in Production right now. Do not touch any other flag or environment.`,
        seed: {
          features: [f, ...others].map((name) => ({ name, value: rng.pick(VALUES), states: { Development: { enabled: true }, Production: { enabled: true } } })),
        },
        check: (a) => [
          ...is(a[`env.Production.flag.${f}.enabled`], false, 'Production off'),
          ...is(a[`env.Development.flag.${f}.enabled`], true, 'Development untouched'),
        ],
        allowed: prefix(`env.Production.flag.${f}.enabled`),
      };
    },
  },

  // ---------- Family 2: multivariate and targeting ----------
  {
    id: 'create_multivariate', family: 'targeting', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES) + '_copy';
      const [control, v1, v2] = rng.pick(COPY);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Create a multivariate flag named "${f}" whose control value is "${control}", with two variations "${v1}" and "${v2}". Each variation must get 50% of users in every environment. Leave the flag enabled.`,
        seed: { features: decoys(rng, [f]) },
        check: (a) => [
          ...is(a[`feature.${f}.type`], 'MULTIVARIATE', 'type'),
          ...is(a[`feature.${f}.variant.${v1}`], true, `variation ${v1}`),
          ...is(a[`feature.${f}.variant.${v2}`], true, `variation ${v2}`),
          ...['Development', 'Production'].flatMap((e) => [
            ...is(a[`env.${e}.flag.${f}.value`], control, `${e} control value`),
            ...is(a[`env.${e}.flag.${f}.enabled`], true, `${e} enabled`),
            ...is(a[`env.${e}.flag.${f}.split.${v1}`], 50, `${e} ${v1} split`),
            ...is(a[`env.${e}.flag.${f}.split.${v2}`], 50, `${e} ${v2} split`),
          ]),
        ],
        allowed: prefix(`feature.${f}.`, `env.Development.flag.${f}.`, `env.Production.flag.${f}.`),
      };
    },
  },
  {
    id: 'change_split_in_production', family: 'targeting', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES) + '_copy';
      const [control, v1] = rng.pick(COPY);
      const pct = rng.pick([70, 80, 90]);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `In Production only, change the traffic split of the multivariate flag "${f}" so the "${v1}" variation gets ${pct}% of users and the rest stay on the control value. Development keeps its current split.`,
        seed: { features: [{ name: f, value: control, enabledByDefault: true, variants: [{ key: 'b', value: v1, pct: 50 }] }, ...decoys(rng, [f])] },
        check: (a) => [
          ...is(a[`env.Production.flag.${f}.split.${v1}`], pct, 'Production split'),
          ...is(a[`env.Development.flag.${f}.split.${v1}`], 50, 'Development split unchanged'),
        ],
        allowed: prefix(`env.Production.flag.${f}.split.`),
      };
    },
  },
  {
    id: 'create_segment', family: 'targeting', heldOut: false,
    render(rng) {
      const seg = rng.pick(SEGMENTS);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Create a segment named "${seg.name}" that matches users whose trait "${seg.trait}" equals "${seg.value}".`,
        seed: { features: decoys(rng, []) },
        check: (a) => {
          const rules = a[`segment.${seg.name}`];
          if (!rules) return ['segment missing'];
          const text = String(rules);
          const ok = text.includes(`"property":"${seg.trait}"`) && text.includes(`"value":"${seg.value}"`) && text.includes('"operator":"EQUAL"');
          const conditions = (text.match(/"operator"/g) ?? []).length;
          return ok && conditions === 1 ? [] : [`segment rules wrong: ${text}`];
        },
        allowed: prefix(`segment.${seg.name}`),
      };
    },
  },
  {
    id: 'segment_override', family: 'targeting', heldOut: true,
    render(rng) {
      const f = rng.pick(FEATURES);
      const seg = rng.pick(SEGMENTS);
      const v = rng.pick(VALUES);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `In Production, turn on the flag "${f}" for the "${seg.name}" segment only, serving the value "${v}". Everyone else in Production keeps the current setting, and Development is not changed.`,
        seed: {
          features: [{ name: f, value: 'off_copy', states: { Development: { enabled: false }, Production: { enabled: false } } }, ...decoys(rng, [f])],
          segments: [seg, ...SEGMENTS.filter((s) => s.name !== seg.name).slice(0, 1)],
        },
        check: (a) => [
          ...is(a[`env.Production.override.${f}.${seg.name}.enabled`], true, 'override enabled'),
          ...is(a[`env.Production.override.${f}.${seg.name}.value`], v, 'override value'),
          ...is(a[`env.Production.flag.${f}.enabled`], false, 'Production default unchanged'),
        ],
        allowed: prefix(`env.Production.override.${f}.${seg.name}.`),
      };
    },
  },

  // ---------- Family 3: experiments (Flagsmith Experimentation) ----------
  {
    id: 'create_metric', family: 'experiments', heldOut: false,
    render(rng) {
      const [m, event] = rng.pick(METRICS);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `In Production, create an experiment metric named "${m}" that records whether the event "${event}" happened at least once per user. Higher is better.`,
        seed: { features: decoys(rng, []) },
        check: (a) => [
          ...is(a[`env.Production.metric.${m}.aggregation`], 'occurrence', 'aggregation'),
          ...is(a[`env.Production.metric.${m}.direction`], 'up', 'direction'),
          ...is(a[`env.Production.metric.${m}.event`], event, 'event'),
        ],
        allowed: prefix(`env.Production.metric.${m}.`),
      };
    },
  },
  {
    id: 'create_experiment', family: 'experiments', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES) + '_copy';
      const [control, v1] = rng.pick(COPY);
      const [p, pe] = rng.pick(METRICS);
      const [g, ge] = rng.pick(GUARDRAILS);
      const x = `${f} test`;
      const h = `"${v1}" increases ${p.replace(/_/g, ' ')} versus "${control}"`;
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `In Production, set up (but do not start) an experiment named "${x}" on the multivariate flag "${f}". Hypothesis: ${h}. The primary metric "${p}" should increase, and "${g}" is a guardrail that should not increase. Split users evenly between the control and the variation.`,
        seed: {
          features: [{ name: f, value: control, enabledByDefault: true, variants: [{ key: 'b', value: v1, pct: 0 }] }, ...decoys(rng, [f], 2)],
          metrics: [
            { name: p, event: pe, aggregation: 'occurrence', direction: 'up' },
            { name: g, event: ge, aggregation: 'occurrence', direction: 'down' },
          ],
        },
        strictDraft: { name: x, feature: f, hypothesis: h, metrics: [
          { name: p, expected_direction: 'increase' },
          { name: g, expected_direction: 'not_increase' },
        ] },
        check: (a) => [
          ...is(a[`env.Production.experiment.${x}.feature`], f, 'experiment flag'),
          ...is(a[`env.Production.experiment.${x}.status`], 'created', 'not started'),
          ...is(a[`env.Production.experiment.${x}.metric.${p}`], 'increase', 'primary metric'),
          ...is(a[`env.Production.experiment.${x}.metric.${g}`], 'not_increase', 'guardrail metric'),
        ],
        // Creating an experiment adds Flagsmith's own rollout override and can reset the flag's split.
        allowed: (path) => path.startsWith(`env.Production.experiment.${x}.`) || path.startsWith(`env.Production.override.${f}.experiment-`) || path.startsWith(`env.Production.flag.${f}.split.`) || path.startsWith('segment.experiment-'),
      };
    },
  },
  {
    id: 'start_experiment', family: 'experiments', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES) + '_copy';
      const [control, v1] = rng.pick(COPY);
      const [p, pe] = rng.pick(METRICS);
      const x = `${f} test`;
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `The experiment "${x}" in Production is set up but not running. Start it.`,
        seed: {
          features: [{ name: f, value: control, enabledByDefault: true, variants: [{ key: 'b', value: v1, pct: 0 }] }, ...decoys(rng, [f], 2)],
          metrics: [{ name: p, event: pe, aggregation: 'occurrence', direction: 'up' }],
          experiments: [{ name: x, feature: f, hypothesis: `${v1} wins`, metrics: [{ name: p, expected_direction: 'increase' }] }],
        },
        check: (a) => is(a[`env.Production.experiment.${x}.status`], 'running', 'running'),
        allowed: (path) => path.startsWith(`env.Production.experiment.${x}.`) || path.startsWith(`env.Production.override.${f}.experiment-`) || path.startsWith(`env.Production.flag.${f}.`),
      };
    },
  },
  {
    id: 'ship_winner', family: 'experiments', heldOut: true,
    render(rng) {
      const f = rng.pick(FEATURES) + '_copy';
      const [control, v1] = rng.pick(COPY);
      const [p, pe] = rng.pick(METRICS);
      const x = `${f} test`;
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `The experiment "${x}" in Production has finished and the variation "${v1}" won. Complete the experiment and roll the winning variation out to everyone.`,
        seed: {
          features: [{ name: f, value: control, enabledByDefault: true, variants: [{ key: 'b', value: v1, pct: 0 }] }, ...decoys(rng, [f], 2)],
          metrics: [{ name: p, event: pe, aggregation: 'occurrence', direction: 'up' }],
          experiments: [{ name: x, feature: f, hypothesis: `${v1} wins`, metrics: [{ name: p, expected_direction: 'increase' }], start: true }],
        },
        check: (a) => [
          ...is(a[`env.Production.experiment.${x}.status`], 'completed', 'completed'),
          ...is(a[`env.Production.experiment.${x}.rollout_decision`], 'variant', 'shipped the variation'),
          ...is(a[`env.Production.flag.${f}.split.${v1}`], 100, 'winner serves everyone'),
        ],
        allowed: (path) => path.startsWith(`env.Production.experiment.${x}.`) || path.startsWith(`env.Production.override.${f}.experiment-`) || path.startsWith(`env.Production.flag.${f}.`),
      };
    },
  },

  // ---------- Family 4: investigation and repair ----------
  {
    id: 'sync_production_to_development', family: 'repair', heldOut: false,
    render(rng) {
      const f = rng.pick(FEATURES);
      const [devV, prodV] = rng.pickMany(VALUES, 2);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Make the flag "${f}" in Production match its Development configuration exactly (on/off state and value). Change nothing else.`,
        seed: {
          features: [{ name: f, value: prodV, states: { Development: { enabled: true, value: devV }, Production: { enabled: false } } }, ...decoys(rng, [f], 4)],
        },
        check: (a) => [
          ...is(a[`env.Production.flag.${f}.enabled`], true, 'Production on/off'),
          ...is(a[`env.Production.flag.${f}.value`], devV, 'Production value'),
          ...is(a[`env.Development.flag.${f}.value`], devV, 'Development untouched'),
        ],
        allowed: prefix(`env.Production.flag.${f}.`),
      };
    },
  },
  {
    id: 'find_maintenance_flag', family: 'repair', heldOut: false,
    render(rng) {
      const [target, ...others] = rng.pickMany(FEATURES, 6);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `One flag in Production is enabled and serving the value "maintenance". Find it and turn it off in Production. Leave every other flag alone.`,
        seed: {
          features: [
            { name: target, value: 'normal', states: { Production: { enabled: true, value: 'maintenance' }, Development: { enabled: true } } },
            ...others.map((name, i) => ({ name, value: i === 0 ? 'maintenance' : rng.pick(VALUES), states: { Production: { enabled: i !== 0 }, Development: { enabled: i % 2 === 0 } } })),
          ],
        },
        check: (a) => is(a[`env.Production.flag.${target}.enabled`], false, `${target} off`),
        allowed: prefix(`env.Production.flag.${target}.enabled`),
      };
    },
  },
  {
    id: 'archive_stale_flag', family: 'repair', heldOut: false,
    render(rng) {
      const [target, ...others] = rng.pickMany(FEATURES, 5);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Archive the flag that is tagged "stale". Do not archive or change any other flag.`,
        seed: {
          features: [
            { name: target, value: rng.pick(VALUES), tags: ['stale'], states: { Production: { enabled: false }, Development: { enabled: false } } },
            ...others.map((name, i) => ({ name, value: rng.pick(VALUES), tags: i === 0 ? ['checkout'] : [], states: { Production: { enabled: i % 2 === 0 } } })),
          ],
        },
        check: (a) => is(a[`feature.${target}.archived`], true, `${target} archived`),
        allowed: prefix(`feature.${target}.archived`),
      };
    },
  },
  {
    id: 'remove_segment_override', family: 'repair', heldOut: true,
    render(rng) {
      const f = rng.pick(FEATURES);
      const seg = rng.pick(SEGMENTS);
      return {
        template: this.id, family: this.family, heldOut: this.heldOut,
        task: `Remove the "${seg.name}" segment override of the flag "${f}" in Production. Keep the same override in Development.`,
        seed: {
          features: [{ name: f, value: 'base', states: { Development: { enabled: false }, Production: { enabled: false } } }, ...decoys(rng, [f])],
          segments: [seg],
          overrides: [
            { feature: f, segment: seg.name, env: 'Production', enabled: true, value: 'segment_copy' },
            { feature: f, segment: seg.name, env: 'Development', enabled: true, value: 'segment_copy' },
          ],
        },
        check: (a) => [
          ...is(a[`env.Production.override.${f}.${seg.name}.enabled`], null, 'Production override removed'),
          ...is(a[`env.Development.override.${f}.${seg.name}.enabled`], true, 'Development override kept'),
        ],
        allowed: prefix(`env.Production.override.${f}.${seg.name}.`),
      };
    },
  },
];

export function jobFor(trialIndex: number, trialId: string): Job {
  const template = TEMPLATES[trialIndex % TEMPLATES.length];
  return template.render(new Rng(trialId));
}

export function grade(job: Job, before: Snapshot, after: Snapshot, changes: Change[]) {
  const reasons = job.check(after, before);
  const collateral = changes.filter((c) => !job.allowed(c.path));
  return { reasons, collateral, correct: reasons.length === 0 && collateral.length === 0 };
}
