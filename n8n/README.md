# n8n reconcile workflows

These live in git so the reconcile schedule isn't only inside n8n. Last time it was, a manual edit killed `viva-reconcile` for **17 days** and nobody noticed — 23 Jun – 10 Jul 2026, found during the WEC-532 investigation.

| File | Purpose |
| --- | --- |
| **`Fitpal — Reconcile PROD + DEV (every 15 min).json`** | **The one to import.** Single workflow, one trigger, all four endpoints. |
| `Fitpal DEV — Reconcile (every 15 min).json` | The existing live dev workflow, id `QZ52tBjmt9q8kP5u`. Kept for reference / rollback. |

## The combined workflow

One 15-minute schedule trigger fanning out to four HTTP calls:

| Node | Endpoint |
| --- | --- |
| PROD · Viva reconcile | `https://orders.fitpal.gr/.netlify/functions/viva-reconcile` |
| PROD · Airtable reconcile | `https://orders.fitpal.gr/.netlify/functions/airtable-reconcile` |
| DEV · Viva reconcile | `https://dev--fitpal-order.netlify.app/.netlify/functions/viva-reconcile` |
| DEV · Airtable reconcile | `https://dev--fitpal-order.netlify.app/.netlify/functions/airtable-reconcile` |

### Error handling is asymmetric on purpose

With `executionOrder: v1`, a failing node halts the execution — so in a combined workflow a dev outage would silently stop the prod calls. That is unacceptable for the payment safety net, so:

- **DEV nodes** → `onError: continueRegularOutput`. A dev branch-deploy being down never blocks prod.
- **PROD nodes** → n8n default. A real prod failure turns the execution **red** and shows up in Executions.

All four also carry `retryOnFail`, `maxTries: 2`, `waitBetweenTries: 5000`. Reconcile is idempotent, so a retry on a transient 502 costs nothing and removes a class of silent miss.

### Once imported, retire the old dev workflow

The combined workflow already calls both dev endpoints. Leaving `QZ52tBjmt9q8kP5u` active as well just doubles the dev calls — harmless but noisy in `reconcile_runs`. **Deactivate it after confirming the new one runs.** Don't delete it until you've seen a few green executions.

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

## Importing

1. n8n → **Workflows → Import from File** → `Fitpal — Reconcile PROD + DEV (every 15 min).json`
2. It arrives **inactive**. Hit **Execute Workflow** once and confirm all four nodes return 200.
3. Flip **Active**.
4. Deactivate the old dev-only workflow.
5. Verify:

```sql
select provider, count(*) as runs_20min, max(run_at) as latest, now() - max(run_at) as age
from reconcile_runs
where run_at > now() - interval '20 minutes'
group by provider;
```

Both providers should appear. Expect roughly 4 viva runs per 20 min from Netlify's `*/5` plus 1 from this workflow.

### Why the export has no `id` or `versionId`

Deliberate. n8n uses the top-level `id` to decide between *create* and *overwrite*. The DEV export still carries `QZ52tBjmt9q8kP5u`, so importing **that** file overwrites the live dev workflow. The combined export has both fields stripped, so it can only ever create a new workflow — it cannot clobber anything.

### What was dropped from the dev original

The dev workflow carries four **disabled** leftover nodes (`Trigger reconcile`, `Trigger reconcile1`, `Every 15 minutes`, `Every 15 minutes1`) — all four pointing at `airtable-reconcile`, none connected to anything live. Kept in the dev file for fidelity, left out of the combined one. Four dead nodes next to the live ones is exactly the sort of confusion that produced the 17-day outage.

## Still missing: nothing alerts if this AND Netlify both stop

**WEC-646** «Reconcile scheduler idle on dev since 2026-07-29 — add liveness alerting before go-live».

Two triggers is redundancy, not monitoring. If both die the safety net is gone and the only symptom is customers ringing up about orders that say unpaid. The check is one query — *no `reconcile_runs` row in the last 20 minutes → shout* — and it has already been needed twice.

Related: **WEC-534** «Go-live: reconcile scheduler cutover» · **WEC-485** (Netlify scheduler failure, never root-caused) · **WEC-532** (the 17-day outage investigation).
