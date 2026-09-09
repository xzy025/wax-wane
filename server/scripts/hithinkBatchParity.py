"""Predeclare a diagnostic sample, then compare immutable independent captures."""
import argparse
import csv
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def spread(values, count):
    if len(values) < count:
        raise ValueError('Insufficient sampling universe')
    return [values[round(i * (len(values) - 1) / (count - 1))] for i in range(count)]


def write_new(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)


def prepare(folder, output):
    import duckdb
    audit = json.loads((folder / 'verification-v3.json').read_text(encoding='utf-8'))
    daily = folder / 'daily-k.parquet'
    expected = next(item['sha256'] for item in audit['integrity'] if item['kind'] == 'daily-k')
    if digest(daily) != expected:
        raise ValueError('Full dump hash mismatch')
    csv_path = folder / audit['anomalyEvidence']['file']
    if digest(csv_path) != audit['anomalyEvidence']['sha256']:
        raise ValueError('Diagnostic CSV hash mismatch')
    with csv_path.open(encoding='utf-8') as stream:
        anomalies = list(csv.DictReader(stream))
    flagged = sorted({row['thscode'] for row in anomalies if row['date'] in ['2025-11-27', '2025-12-01'] and row['thscode'].endswith('.SZ')})
    connection = duckdb.connect()
    connection.read_parquet(str(daily)).create_view('daily')
    rows = connection.execute("select thscode,strftime(to_timestamp(date_ms/1000.0)+interval '8 hours','%Y-%m-%d') as date,open_price,high_price,low_price,close_price,volume,turnover from daily where date_ms between 1764172800000 and 1764518400000 order by thscode,date_ms").fetchall()
    grouped = {}
    for row in rows:
        grouped.setdefault(row[0], []).append(dict(zip(['date', 'open', 'high', 'low', 'close', 'volume', 'amount'], row[1:])))
    unflagged = sorted(code for code, bars in grouped.items() if code.endswith('.SZ') and code not in flagged and len(bars) == 3)
    selections = [(code, 'flagged-SZ') for code in spread(flagged, 8)]
    selections += [(code, 'unflagged-SZ-control') for code in spread(unflagged, 4)]
    selections += [('600519.SH', 'SH-control'), ('601398.SH', 'SH-control')]
    plan = {'status': 'research-only', 'eligibleAsTradeGate': False, 'generatedAt': datetime.now(timezone.utc).isoformat(),
            'dumpSha256': expected, 'diagnosticCsvSha256': audit['anomalyEvidence']['sha256'],
            'selection': 'Sorted-code evenly spaced deterministic sample; purposive diagnostics, not random population inference.',
            'flaggedUniverse': len(flagged), 'unflaggedUniverse': len(unflagged),
            'window': ['2025-11-27', '2025-12-01'], 'dates': ['2025-11-27', '2025-11-28', '2025-12-01'],
            'tolerances': {'price': 0.011, 'volumeShares': 50, 'amountCurrency': 1},
            'peerUnits': {'volume': 'lots-of-100-shares', 'amount': 'CNY'},
            'samples': [{'code': code, 'group': group, 'bars': grouped[code]} for code, group in selections]}
    write_new(output, plan)
    print(json.dumps({'plan': str(output), 'samples': [(x['code'], x['group']) for x in plan['samples']]}))


def parse_peer(body, expected_code):
    data = body.get('data')
    if body.get('rc') != 0 or not isinstance(data, dict) or data.get('code') != expected_code[:6]:
        raise ValueError('Missing data or wrong symbol')
    if not isinstance(data.get('klines'), list) or not data['klines']:
        raise ValueError('Empty kline response')
    bars = {}
    for raw in data['klines']:
        parts = raw.split(',')
        if len(parts) != 7 or parts[0] in bars:
            raise ValueError('Malformed or duplicate bar')
        values = [float(value) for value in parts[1:]]
        if not all(math.isfinite(value) for value in values):
            raise ValueError('Nonfinite bar')
        op, close, high, low, lots, amount = values
        if low <= 0 or high < max(op, close, low) or low > min(op, close, high) or lots < 0 or amount < 0:
            raise ValueError('Invalid peer values')
        bars[parts[0]] = {'open': op, 'close': close, 'high': high, 'low': low, 'volume': lots * 100, 'amount': amount}
    return bars


def compare_bar(left, right, tolerances):
    errors = {key: left[key] - right[key] for key in right}
    mismatches = [key for key, error in errors.items() if abs(error) > (tolerances['volumeShares'] if key == 'volume' else tolerances['amountCurrency'] if key == 'amount' else tolerances['price'])]
    ratios = {key: right[key] / left[key] if left[key] else None for key in ['volume', 'amount']}
    return {'mismatches': mismatches, 'errors': errors, 'peerOverHithink': ratios}


def compare(plan_path, folder):
    plan = json.loads(plan_path.read_text(encoding='utf-8'))
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8-sig'))
    if manifest['planSha256'] != digest(plan_path):
        raise ValueError('Sample plan hash mismatch')
    records, unavailable = [], []
    for sample in plan['samples']:
        entry = next((item for item in manifest['entries'] if item['code'] == sample['code']), None)
        if not entry or not entry['captured']:
            unavailable.append({'code': sample['code'], 'reason': 'capture-unavailable'})
            continue
        path = folder / entry['file']
        if digest(path) != entry['sha256']:
            raise ValueError('Capture hash mismatch: ' + sample['code'])
        try:
            peer = parse_peer(json.loads(path.read_text(encoding='utf-8-sig')), sample['code'])
        except (ValueError, TypeError, KeyError) as error:
            unavailable.append({'code': sample['code'], 'reason': str(error)})
            continue
        own = {bar['date']: bar for bar in sample['bars']}
        for date in plan['dates']:
            if date not in own or date not in peer:
                unavailable.append({'code': sample['code'], 'date': date, 'reason': 'missing-date'})
                continue
            result = compare_bar(own[date], peer[date], plan['tolerances'])
            records.append({'code': sample['code'], 'group': sample['group'], 'date': date, 'hithink': own[date], 'peer': peer[date], **result})
    summaries = []
    for group in sorted({row['group'] for row in records}):
        for date in plan['dates']:
            subset = [row for row in records if row['group'] == group and row['date'] == date]
            summaries.append({'group': group, 'date': date, 'compared': len(subset), 'mismatches': {key: sum(key in row['mismatches'] for row in subset) for key in ['open', 'high', 'low', 'close', 'volume', 'amount']}})
    report = {'status': 'research-only', 'eligibleAsTradeGate': False, 'planSha256': digest(plan_path), 'tolerances': plan['tolerances'],
              'notes': ['Purposive diagnostic sample, not a statistical error-rate estimate.', 'Ratios are descriptions, never automatic correction factors.'],
              'compared': len(records), 'unavailable': unavailable, 'summaries': summaries, 'records': records}
    write_new(folder / 'parity.json', report)
    print(json.dumps({key: value for key, value in report.items() if key != 'records'}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'compare'])
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    (prepare if args.mode == 'prepare' else compare)(args.input.resolve(), args.output.resolve())
