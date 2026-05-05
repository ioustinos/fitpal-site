#!/usr/bin/env python3
"""
Trigger the `admin-import-dish-image` Netlify function for a batch of dishes.

The function does the actual download-from-Drive + upload-to-Supabase Storage
server-side (where outbound network is unrestricted). This script is just a
loop that calls it once per dish, with progress.

Reusable for:
  - The 10-dish pilot
  - The full 296-dish bulk import
  - Re-importing a single dish if its image gets updated upstream

Usage:
  export ADMIN_JWT='<your sb-...-auth-token JWT>'
  export NETLIFY_BASE='https://dev--fitpal-order.netlify.app'   # or http://localhost:8888

  # All dishes still pointing at drive.google.com (typical bulk run):
  python3 scripts/import-dish-images.py --csv data/menu.csv

  # Specific dishes only:
  python3 scripts/import-dish-images.py --csv data/menu.csv --dish-ids 1,2,39,68

  # Force re-import (overwrite existing Storage object):
  python3 scripts/import-dish-images.py --csv data/menu.csv --dish-ids 1 --force

Get your JWT: open the dev site logged in as admin → DevTools → Application →
Cookies (or LocalStorage) → find sb-<project>-auth-token → copy the
access_token value.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error


def call_function(base_url: str, jwt: str, dish_id: str, source_url: str,
                  force: bool, timeout: int = 60) -> dict:
    body = json.dumps({
        'dishId': dish_id,
        'sourceUrl': source_url,
        'force': force,
    }).encode('utf-8')
    req = urllib.request.Request(
        f'{base_url.rstrip("/")}/api/admin-import-dish-image',
        data=body,
        headers={
            'Authorization': f'Bearer {jwt}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode('utf-8'))
        except Exception:
            return {'ok': False, 'error': f'HTTP {e.code} (no JSON body)'}
    except Exception as e:
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True, help='Source CSV (read dish_id + image_url from it)')
    ap.add_argument('--dish-ids', help='Comma-separated dish IDs to process (default: all)')
    ap.add_argument('--force', action='store_true', help='Re-import even if already on Storage')
    ap.add_argument('--delay', type=float, default=0.0, help='Seconds between calls (default: 0)')
    args = ap.parse_args()

    jwt = os.environ.get('ADMIN_JWT')
    base = os.environ.get('NETLIFY_BASE', 'https://dev--fitpal-order.netlify.app')
    if not jwt:
        sys.exit('ERR: set ADMIN_JWT env var (admin user JWT). See script docstring.')

    # Build work list from CSV
    seen: dict[str, str] = {}
    with open(args.csv, newline='', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            code = row['Κωδικός'].strip()
            if not code:
                continue
            dish_id = code.split('-', 1)[0]
            if dish_id not in seen:
                seen[dish_id] = row['Image'].strip()

    work = [(k, v) for k, v in seen.items()]
    if args.dish_ids:
        wanted = set(s.strip() for s in args.dish_ids.split(','))
        work = [(k, v) for k, v in work if k in wanted]

    print(f'→ {base}', file=sys.stderr)
    print(f'→ {len(work)} dishes', file=sys.stderr)

    ok = skipped = failed = 0
    for idx, (did, src) in enumerate(work, 1):
        t0 = time.time()
        res = call_function(base, jwt, did, src, args.force)
        dur = time.time() - t0
        if res.get('ok'):
            if res.get('skipped'):
                skipped += 1
                tag = 'SKIP'
            else:
                ok += 1
                tag = ' OK '
            print(f'  [{idx}/{len(work)}] {tag} dish={did}  {res.get("size", "?"):>7}B '
                  f'{res.get("contentType", "?"):<10}  ({dur:.1f}s)  {res.get("publicUrl", "")}',
                  file=sys.stderr)
        else:
            failed += 1
            print(f'  [{idx}/{len(work)}] FAIL dish={did}  {res.get("error", "unknown")}',
                  file=sys.stderr)
        if args.delay > 0:
            time.sleep(args.delay)

    print(f'\n  ok={ok}  skipped={skipped}  failed={failed}', file=sys.stderr)
    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
