#!/usr/bin/env python3
"""WEC-860 (seed costing data from the kitchen Excel) — step 2: chunk.

Turns the parse_excel.py JSON into compact payload chunks (each < ~28 KB) for
costing_seed.load(kind, md5, payload) on the target database. Every chunk
carries the md5 of its payload; load() refuses a chunk whose text was altered
in transit.

    python3 -I scripts/costing-seed/make_chunks.py <excel.json> <out_dir>

Writes <out_dir>/NN_<kind>.sql — each file is one self-contained statement.
"""
import collections
import hashlib
import json
import os
import sys

LIMIT = 28000


def dump(x):
    return json.dumps(x, ensure_ascii=False, separators=(',', ':'))


def main(src, out_dir):
    d = json.load(open(src, encoding='utf-8'))
    os.makedirs(out_dir, exist_ok=True)

    payloads = []  # (kind, list_of_rows)
    payloads.append(('costs', [[r['row'], r['category'], r['name'], r['price_kg'], r['err']] for r in d['src_costs']]))
    payloads.append(('packaging', [[r['row'], r['name'], r['pcs'], r['price_pack'], r['price_pc'], r['note'], r['err']]
                                   for r in d['src_packaging']]))
    payloads.append(('index', [[r['row'], r['raw'], r['name'], r['cost100_raw'], r['cooked_g'], r['cost100_cooked'], r['err']]
                               for r in d['index']]))
    payloads.append(('groups', [[r['row'], r['name'], r['cost100_raw'], r['cooked_g'], r['cost100_cooked'], r['err']]
                                for r in d['groups']]))

    dishes = collections.OrderedDict()
    for r in d['dish_rows']:
        dishes.setdefault((r['sheet'], r['dish_no']), []).append(r)
    packsets = []
    dish_rows = []
    for (sheet, no), rows in dishes.items():
        names = []
        for r in rows:
            for n, _g in r['lines']:
                if n not in names:
                    names.append(n)
        pk = rows[0]['packaging'] or ''
        if pk not in packsets:
            packsets.append(pk)
        grams = [[dict(r['lines']).get(n) for n in names] for r in rows]
        dish_rows.append([sheet[0], no, rows[0]['title'], names, grams,
                          [r['prod_cost'] for r in rows], [r['pack_cost'] for r in rows],
                          packsets.index(pk), [r['row'] for r in rows]])
    payloads.append(('packsets', [[i, s] for i, s in enumerate(packsets)]))
    payloads.append(('dishes', dish_rows))

    n = 0
    for kind, rows in payloads:
        chunk = []
        for row in rows:
            chunk.append(row)
            if len(dump(chunk)) > LIMIT:
                chunk.pop()
                n = write(out_dir, n, kind, chunk)
                chunk = [row]
        if chunk:
            n = write(out_dir, n, kind, chunk)
    print(f'{n} chunks written to {out_dir}')


def write(out_dir, n, kind, rows):
    payload = dump(rows)
    md5 = hashlib.md5(payload.encode('utf-8')).hexdigest()
    assert '$p$' not in payload
    sql = f"select costing_seed.load('{kind}', '{md5}', $p${payload}$p$);\n"
    with open(os.path.join(out_dir, f'{n:02d}_{kind}.sql'), 'w', encoding='utf-8') as f:
        f.write(sql)
    return n + 1


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
