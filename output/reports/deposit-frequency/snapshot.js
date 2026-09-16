/**
 * snapshot.js — the figures the test suites assert against.
 *
 * These come from RUNNING THE AGGREGATE SQL IN REDASH, not from the page.
 * That is the whole point: if the suites took their expectations from the
 * page's own output they would pass no matter what the page computed.
 *
 * They are a point-in-time snapshot, not invariants. The deposit data moves
 * every day, and a day's deposits only enter once its FX rate is published,
 * so the totals step up a day late. When the export is refreshed and the
 * suites fail on these numbers, re-run the era aggregate and update this
 * file — do not loosen the assertions.
 *
 * The date-independent guarantees — partitions summing to their whole,
 * new + old == all, distinct never summing, columns matching rows — are
 * asserted directly in the suites and must hold on any snapshot.
 *
 * Last refreshed: 2026-08-25, anchor 2026-08-24.
 */
const SNAPSHOT = {
  date: "2026-08-25",
  anchor: "2026-08-24",

  // era|whale -> [players, deposits, EUR]
  eras: {
    "new|ex":  [47141,  644261,  188445307.79],
    "new|inc": [47142,  645996,  258173218.28],
    "old|ex":  [58636,  897233,  168078120.70],
    "old|inc": [58637,  897323,  168582173.46],
    "all|ex":  [102313, 1541494, 356523428.49],
    "all|inc": [102314, 1543319, 426755391.75]
  },

  // players carrying a GGR record (post-migration scope) and their total
  ggrPlayers: 47142,
  ggrTotal: 80881777.69,
  // adjusted GGR runs ABOVE raw — adjustments add to it. Never derive one
  // from the other; they are computed upstream over different scopes.
  adjTotal: 89016498.36,
  adjMinusGgr: 8134720.67,

  // last-deposit year, all history, whale included
  churnYears: {
    2018: 8385, 2019: 14201, 2020: 10997, 2021: 13841, 2022: 13746,
    2023: 12467, 2024: 7487, 2025: 11414, 2026: 9776
  },

  // recency bands, all history, whale included
  bands: { "0-30": 2788, "31-90": 3190, "91-180": 2766, "181-360": 5073, "360+": 88497 },

  // ---------------------------------------------------------------------
  // DERIVED, not pinned. Reason and country counts shift by a handful every
  // time the export runs, and hand-pinning them was pure churn: the numbers
  // went stale within the hour and the failures said nothing about the page.
  //
  // These are read straight from the payload the builder wrote, so what the
  // suites actually assert about them is RELATIONSHIPS — reasons partition
  // the base, a group equals the sum of its members, Yes + No == everyone.
  // Those hold on any snapshot. The era totals above stay pinned, because
  // those are checked against Redash and are the ones worth catching drift in.
  // ---------------------------------------------------------------------
  _derived: (function(){
    try {
      const d = require("./deposit-frequency-data.json");
      const rc = d.meta.reasonCounts, rs = d.meta.reasons;
      const groupTotal = name => {
        const g = d.meta.reasonGroups.find(x => x[0] === name);
        return g ? g[1].reduce((a, i) => a + (rc[rs[i]] || 0), 0) : 0;
      };
      let sum = 0; for (const k in rc) sum += rc[k];
      return {
        reasons: rc,
        notBlocked: d.meta.players - sum,
        responsibleGambling: groupTotal("Responsible gambling"),
        fraudAbuse: groupTotal("Fraud & abuse"),
        churnYears: d.meta.churnYears,
        bands: d.meta.bands,
        anchor: d.meta.anchor
      };
    } catch (e) { return null; }
  })(),


  // GGR bands, post-migration, whale included — order matches GGR_BANDS
  ggrBands: [136, 1488, 4976, 3939, 660, 23410, 7221, 1831, 2432, 444, 471, 134],

  // the page's opening view: all history, verified email+phone, fraud excluded
  defaultPlayers: 62905
};

/* Fold the derived block up so callers just read SNAPSHOT.reasons etc. */
if (SNAPSHOT._derived) {
  SNAPSHOT.reasons = SNAPSHOT._derived.reasons;
  SNAPSHOT.notBlocked = SNAPSHOT._derived.notBlocked;
  SNAPSHOT.responsibleGambling = SNAPSHOT._derived.responsibleGambling;
  SNAPSHOT.fraudAbuse = SNAPSHOT._derived.fraudAbuse;
  SNAPSHOT.churnYears = SNAPSHOT._derived.churnYears;
  SNAPSHOT.bands = SNAPSHOT._derived.bands;
  SNAPSHOT.anchor = SNAPSHOT._derived.anchor;
}

if (typeof module !== "undefined") module.exports = SNAPSHOT;
