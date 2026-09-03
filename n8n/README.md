# n8n reconcile workflows

Both files here are importable n8n workflow exports. They exist so the reconcile schedule is **in version control** — the last time it lived only inside n8n, a manual edit killed `viva-reconcile` for 17 days and nobody noticed (23 Jun – 10 Jul 2026, found during the WEC-532 investigation).

| File | n8n workflow | Target |
| --- | --- | --- |
| `Fitpal DEV — Reconcile (every 15 min).json` | id `QZ52tBjmt9q8kP5u`, **active** | `dev--fitpal-order.netlify.app` |
| `Fitpal PROD — Reconcile (every 15 min).json` | to be imported, ships **inactive** | `orders.fitpal.gr` |

## Why n8n runs alongside Netlify's own cron

Not a workaround any more — a deliberate second trigger.

`viva-reconcile` and `airtable-reconcile` both declare `schedule: '*/5 * * * *'` in their own `config` export, and both **are** registered on the production deploy (verified via the Netlify API, 2026-09-03).

But Netlify's scheduler on this site skips. Measured against `reconcile_runs` over 48h, `provider='viva'`:

| | |
| --- | --- |
| Intervals | 494 |
| Normal (250–350s) | 418 |
| Gaps > 6.5 min | **70** |
| Worst gap | **25.1 min** |

~85% reliable. This is the third gate of payment reconciliation — the mechanism that rescues a customer who paid but whose order still reads `pending`. 85% is not enough on its own, and the earlier total failure (WEC-485, scheduler stopped firing around 23 June) was never root-caused, so it can't be ruled out.

**Double-firing is safe.** `markPaid` is a guarded `UPDATE … WHERE payment_status = 'pending'`, so two triggers hitting the same order produce exactly one row change. The only cost is extra rows in `reconcile_runs`.

## Importing the PROD workflow

1. n8n → **Workflows → Import from File** → pick `Fitpal PROD — Reconcile (every 15 min).json`
2. It arrives **inactive**. Hit **Execute Workflow** once and confirm both HTTP nodes return 200.
3. Flip the **Active** toggle.
4. Verify it is actually running:

```sql
select provider, count(*) as runs_20min, max(run_at) as latest, now() - max(run_at) as age
from reconcile_runs
where run_at > now() - interval '20 minutes'
group by provider;
```

Both providers should appear, and you should see roughly 4 viva runs per 20 minutes from Netlify's `*/5` plus 1 from n8n's 15-minute trigger.

### Why the export has no `id` or `versionId`

Deliberate. n8n uses the top-level `id` to decide between *create* and *overwrite*. The DEV export still carries `QZ52tBjmt9q8kP5u`, so importing **that** file overwrites the live dev workflow. The PROD export has both fields stripped, so it can only ever create a new workflow — it cannot clobber the dev one.

### What was dropped from the dev original

The dev workflow carries four **disabled** leftover nodes (`Trigger reconcile`, `Trigger reconcile1`, `Every 15 minutes`, `Every 15 minutes1`) — all four pointing at `airtable-reconcile`, none connected to anything live. They're kept in the dev file for fidelity but left out of the PROD one. Four dead nodes next to three live ones is exactly the sort of confusion that produced the 17-day outage.

The PROD workflow is three nodes plus a sticky note: one 15-minute trigger fanning out to two HTTP calls.

### Difference from the dev nodes

The PROD HTTP nodes add `retryOnFail: true`, `maxTries: 2`, `waitBetweenTries: 5000`. Reconcile is idempotent, so retrying a transient 502 costs nothing and removes a class of silent miss.

## Still missing: nothing alerts if BOTH stop

**WEC-646** «Reconcile scheduler idle on dev since 2026-07-29 — add liveness alerting before go-live».

Two triggers is redundancy, not monitoring. If both die the safety net is gone and the only symptom is customers ringing up about orders that say unpaid. The check is one query — *no `reconcile_runs` row in the last 20 minutes → shout* — and it has already been needed twice.

Related: **WEC-534** «Go-live: reconcile scheduler cutover», **WEC-485** (Netlify scheduler failure, never root-caused), **WEC-532** (the 17-day outage investigation).
