#!/usr/bin/env python3
"""
Upload Google Drive dish images to Supabase Storage and update dishes.image_url.

Reusable for pilot + bulk imports. Idempotent: skips dishes whose image_url is
already a Supabase URL (i.e. already uploaded). Per-dish error handling so a
single bad URL doesn't kill the run.

Usage:
  # All dishes still pointing at drive.google.com:
  python3 scripts/upload-dish-images.py

  # Specific dishes only:
  python3 scripts/upload-dish-images.py --dish-ids 1,2,39,40,68

  # Dry run (download + report, no upload, no DB update):
  python3 scripts/upload-dish-images.py --dish-ids 1 --dry-run

Env: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local at the
project root (or override via env vars).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

# ─── Config ──────────────────────────────────────────────────────────────────

BUCKET = 'dish-images'
DRIVE_DOWNLOAD_PREFIX = 'https://drive.google.com/uc?export=download&id='
DRIVE_FILE_RE = re.compile(r'/file/d/([^/]+)/')


def load_env(env_path: Path) -> dict[str, str]:
    """Tiny .env parser. No quoting magic — just KEY=VALUE."""
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            k, v = line.split('=', 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def drive_to_download(url: str) -> str | None:
    """https://drive.google.com/file/d/<id>/view?usp=sharing → uc?export=download&id=<id>"""
    m = DRIVE_FILE_RE.search(url)
    if not m:
        return None
    return DRIVE_DOWNLOAD_PREFIX + m.group(1)


def http_get(url: str, timeout: int = 60) -> tuple[bytes, str]:
    """Fetch URL, return (body, content_type)."""
    req = urllib.request.Request(url, headers={'User-Agent': 'fitpal-image-uploader/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        # Drive sometimes returns an HTML interstitial for big files; for the
        # photo sizes we have, direct download works. If that changes, parse
        # the form action out of the HTML and re-request.
        ct = resp.headers.get('Content-Type', 'application/octet-stream').split(';')[0]
        return resp.read(), ct


def supabase_upload(supabase_url: str, service_key: str, bucket: str, path: str,
                    body: bytes, content_type: str, *, upsert: bool = True) -> dict:
    url = f"{supabase_url}/storage/v1/object/{bucket}/{urllib.parse.quote(path)}"
    headers = {
        'Authorization': f'Bearer {service_key}',
        'Content-Type': content_type,
        'x-upsert': 'true' if upsert else 'false',
        'Cache-Control': 'public, max-age=31536000',
    }
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode('utf-8'))


def supabase_public_url(supabase_url: str, bucket: str, path: str) -> str:
    return f"{supabase_url}/storage/v1/object/public/{bucket}/{urllib.parse.quote(path)}"


def supabase_query(supabase_url: str, service_key: str, sql: str) -> list[dict]:
    """Execute SQL via the SQL endpoint (used for both SELECT and UPDATE)."""
    # Supabase's PostgREST RPC is the standard path; for raw SQL we use the
    # /rest/v1/rpc/exec_sql or hit /pg endpoint. Simpler: use the `?query=` on
    # the standard /rest/v1 with a custom function, but that requires a
    # function to exist. Easiest reliable way: use psql via DATABASE_URL — but
    # that needs port 5432 access from this script's environment.
    #
    # Workaround chosen: call PostgREST endpoints directly.
    raise NotImplementedError('Use --emit-update-sql to print SQL; apply via MCP.')


# ─── Main ────────────────────────────────────────────────────────────────────

def ext_from_content_type(ct: str) -> str:
    return {
        'image/jpeg': 'jpg', 'image/jpg': 'jpg',
        'image/png': 'png', 'image/webp': 'webp',
        'image/gif': 'gif', 'image/heic': 'heic',
    }.get(ct, 'jpg')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dish-ids', help='Comma-separated dish IDs to process (default: all)')
    ap.add_argument('--dry-run', action='store_true', help='Download only, no upload, no DB update')
    ap.add_argument('--env', default='.env.local', help='Path to .env file')
    ap.add_argument('--input', help='JSON file: [{"dish_id": "...", "image_url": "..."}]. '
                                     'If absent, reads from CSV via --csv')
    ap.add_argument('--csv', help='Source CSV; reads dish_id + image_url from it')
    ap.add_argument('--emit-update-sql', action='store_true',
                    help='After uploads, print SQL to update dishes.image_url')
    args = ap.parse_args()

    project_root = Path(__file__).resolve().parent.parent
    env = load_env(project_root / args.env) | dict(os.environ)
    supabase_url = env.get('VITE_SUPABASE_URL') or env.get('SUPABASE_URL')
    service_key = env.get('SUPABASE_SERVICE_ROLE_KEY')
    if not supabase_url or not service_key:
        sys.exit('ERR: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')

    # Build the work list
    work: list[dict] = []
    if args.input:
        work = json.load(open(args.input))
    elif args.csv:
        import csv as _csv
        seen: dict[str, str] = {}
        with open(args.csv, newline='', encoding='utf-8') as f:
            for row in _csv.DictReader(f):
                code = row['Κωδικός'].strip()
                if not code:
                    continue
                dish_id = code.split('-', 1)[0]
                if dish_id in seen:
                    continue  # one image per dish
                seen[dish_id] = row['Image'].strip()
        work = [{'dish_id': k, 'image_url': v} for k, v in seen.items()]
    else:
        sys.exit('ERR: pass --input or --csv')

    # Filter by --dish-ids if provided
    if args.dish_ids:
        wanted = set(s.strip() for s in args.dish_ids.split(','))
        work = [w for w in work if w['dish_id'] in wanted]

    print(f'Processing {len(work)} dishes', file=sys.stderr)

    update_rows: list[tuple[str, str]] = []  # (dish_id, public_url)
    for idx, item in enumerate(work, 1):
        did = item['dish_id']
        url = item['image_url']
        dl = drive_to_download(url)
        if not dl:
            print(f'[{idx}/{len(work)}] dish={did} SKIP: not a drive URL ({url})', file=sys.stderr)
            continue

        try:
            t0 = time.time()
            body, ct = http_get(dl)
            ext = ext_from_content_type(ct)
            path = f'{did}.{ext}'
            if args.dry_run:
                print(f'[{idx}/{len(work)}] dish={did} downloaded {len(body)}B ({ct}) → would upload as {path}',
                      file=sys.stderr)
            else:
                supabase_upload(supabase_url, service_key, BUCKET, path, body, ct)
                public = supabase_public_url(supabase_url, BUCKET, path)
                update_rows.append((did, public))
                print(f'[{idx}/{len(work)}] dish={did} {len(body)}B → {path}  '
                      f'({(time.time()-t0):.1f}s)', file=sys.stderr)
        except Exception as e:
            print(f'[{idx}/{len(work)}] dish={did} ERR: {e}', file=sys.stderr)

    # Emit SQL to update dishes.image_url
    if update_rows and args.emit_update_sql and not args.dry_run:
        print('-- Generated by scripts/upload-dish-images.py')
        print('BEGIN;')
        for did, pub in update_rows:
            d_esc = did.replace("'", "''")
            p_esc = pub.replace("'", "''")
            print(f"UPDATE public.dishes SET image_url = '{p_esc}' WHERE id = '{d_esc}';")
        print('COMMIT;')


if __name__ == '__main__':
    main()
