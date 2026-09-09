"""Offline Parquet audit. Install duckdb in an isolated research tool directory."""
import sys
import json
import hashlib
import csv
from pathlib import Path
from datetime import datetime, timezone, timedelta
import duckdb

folder = Path(sys.argv[1]).resolve()
connection = duckdb.connect()
manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
integrity = []
daily_kind = 'daily-k' if any(item['kind'] == 'daily-k' for item in manifest['files']) else 'daily-k-10d'
kinds = [daily_kind, 'adjustment-factors']
if daily_kind == 'daily-k':
    kinds.append('daily-k-10d')
for kind in kinds:
    entry = next(item for item in manifest['files'] if item['kind'] == kind)
    path = folder / (kind + '.parquet')
    with path.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != entry['sha256'] or path.stat().st_size != entry['bytes']:
        raise ValueError('Manifest integrity mismatch: ' + kind)
    integrity.append({'kind': kind, 'sha256': digest, 'verified': True})
daily = str(folder / (daily_kind + '.parquet'))
actions = str(folder / 'adjustment-factors.parquet')
connection.read_parquet(daily).create_view('daily')
connection.read_parquet(actions).create_view('actions')

schemas = {}
for table, required in {
    'daily': 'thscode currency interval adjusted date_ms open_price high_price low_price close_price volume turnover',
    'actions': 'thscode ticker ex_date_ms dividend_per_share per_share_bonus allotment_ratio allotment_price currency',
}.items():
    schemas[table] = {row[0]: row[1] for row in connection.execute('describe ' + table).fetchall()}
    missing = set(required.split()) - schemas[table].keys()
    if missing:
        raise ValueError(f'Missing {table} columns: {sorted(missing)}')
def scalar(sql):
    return connection.execute(sql).fetchone()[0]

dates = connection.execute('select min(date_ms), max(date_ms) from daily').fetchone()
report = {
    'status': 'research', 'eligibleAsTradeGate': False,
    'generatedAt': datetime.now(timezone.utc).isoformat(),
    'duckdbVersion': duckdb.__version__,
    'dailyKind': daily_kind,
    'integrity': integrity,
    'schemas': schemas,
    'daily': {
        'rows': scalar('select count(*) from daily'),
        'stocks': scalar('select count(distinct thscode) from daily'),
        'dateRange': [datetime.fromtimestamp(d / 1000, timezone(timedelta(hours=8))).date().isoformat() if d is not None else None for d in dates],
        'invalidMetadata': scalar("select count(*) from daily where currency is distinct from 'CNY' or interval is distinct from '1d' or adjusted is distinct from 'none'"),
        'invalidKeys': scalar("select count(*) from daily where thscode is null or not regexp_full_match(thscode, '[0-9]{6}\\.(SH|SZ|BJ)') or date_ms is null or (date_ms+28800000)%86400000<>0"),
        'negativeVolumeOrAmount': scalar('select count(*) from daily where volume<0 or turnover<0'),
        'coverageByDate': connection.execute('select date_ms,count(*),count(distinct thscode) from daily group by date_ms order by date_ms').fetchall(),
        'distinctDates': scalar('select count(distinct date_ms) from daily'),
        'duplicateKeys': scalar('select count(*) from (select thscode,date_ms from daily group by all having count(*)>1)'),
        'invalidPrices': scalar('select count(*) from daily where open_price is null or close_price is null or high_price is null or low_price is null or low_price<=0 or high_price<greatest(open_price,close_price,low_price) or low_price>least(open_price,close_price,high_price)'),
        'missingVolume': scalar('select count(*) from daily where volume is null'),
        'missingAmount': scalar('select count(*) from daily where turnover is null'),
        'unitOrDataAnomalies': scalar('select count(*) from daily where volume>0 and turnover>0 and (turnover/volume < low_price*0.99 or turnover/volume > high_price*1.01)'),
        'anomalyDefinition': 'Raw amount/volume outside daily low-high +/-1%; diagnostic, not automatic rejection.',
        'anomalySamples': connection.execute('select thscode,date_ms,low_price,high_price,volume,turnover,turnover/volume as implied_price from daily where volume>0 and turnover>0 and (turnover/volume<low_price*0.99 or turnover/volume>high_price*1.01) order by thscode,date_ms limit 20').fetchall(),
    },
    'actions': {
        'rows': scalar('select count(*) from actions'),
        'stocks': scalar('select count(distinct thscode) from actions'),
        'duplicateCodeDate': scalar('select count(*) from (select thscode,ex_date_ms from actions group by all having count(*)>1)'),
        'missingRightsRatio': scalar('select count(*) from actions where allotment_ratio is null'),
        'missingRightsPrice': scalar('select count(*) from actions where allotment_price is null'),
        'missingDividend': scalar('select count(*) from actions where dividend_per_share is null'),
        'missingBonus': scalar('select count(*) from actions where per_share_bonus is null'),
        'duplicateSamples': connection.execute('select * from actions where (thscode,ex_date_ms) in (select thscode,ex_date_ms from actions group by all having count(*)>1) order by thscode,ex_date_ms limit 30').fetchall(),
    },
    'notes': ['No publication/known-at series established. Corporate-action null fields must not silently become zero.'],
}
anomaly_condition = 'volume>0 and turnover>0 and (turnover/volume<low_price*0.99 or turnover/volume>high_price*1.01)'
report['daily']['anomaliesByYear'] = connection.execute(f"select year(to_timestamp(date_ms/1000.0)+interval '8 hours'),count(*),count(distinct thscode) from daily where {anomaly_condition} group by 1 order by 1").fetchall()
report['daily']['anomaliesByStockTop20'] = connection.execute(f'select thscode,count(*) from daily where {anomaly_condition} group by 1 order by 2 desc,1 limit 20').fetchall()
report['daily']['anomaliesByDateTop20'] = connection.execute(f"select strftime(to_timestamp(date_ms/1000.0)+interval '8 hours','%Y-%m-%d'),count(*),min(turnover/volume/close_price),max(turnover/volume/close_price) from daily where {anomaly_condition} group by 1 order by 2 desc,1 limit 20").fetchall()
report['daily']['anomaliesByExchange'] = connection.execute(f'select right(thscode,2),count(*),count(distinct thscode) from daily where {anomaly_condition} group by 1 order by 1').fetchall()
report['daily']['knownAnomalyWindow'] = connection.execute("select * from daily where thscode='000001.SZ' and date_ms between 1764172800000 and 1764518400000 order by date_ms").fetchall()
report['daily']['nonFiniteNumbers'] = scalar('select count(*) from daily where not isfinite(open_price) or not isfinite(high_price) or not isfinite(low_price) or not isfinite(close_price) or not isfinite(volume) or not isfinite(turnover)')
if daily_kind == 'daily-k':
    connection.read_parquet(str(folder / 'daily-k-10d.parquet')).create_view('incremental')
    # Compare by key and explicit fields, keeping missing keys distinct from changed values.
    report['incrementalOverlap'] = {
        'rows': scalar('select count(*) from incremental'),
        'missingInFull': scalar('select count(*) from incremental i anti join daily d using(thscode,date_ms)'),
        'missingInIncrementalWindow': scalar('select count(*) from daily d anti join incremental i using(thscode,date_ms) where d.date_ms between (select min(date_ms) from incremental) and (select max(date_ms) from incremental)'),
        'changedRows': scalar('select count(*) from incremental i join daily d using(thscode,date_ms) where ' + ' or '.join(f'i.{field} is distinct from d.{field}' for field in ['currency', 'interval', 'adjusted', 'open_price', 'high_price', 'low_price', 'close_price', 'volume', 'turnover'])),
        'duplicateIncrementalKeys': scalar('select count(*) from (select thscode,date_ms from incremental group by all having count(*)>1)'),
    }
output = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else folder / 'verification.json'
anomaly_output = output.with_suffix('.anomalies.csv')
if output.exists() or anomaly_output.exists():
    raise FileExistsError('Audit outputs must use new paths')
cursor = connection.execute(f"select thscode,strftime(to_timestamp(date_ms/1000.0)+interval '8 hours','%Y-%m-%d') as date,open_price,high_price,low_price,close_price,volume,turnover,turnover/volume as implied_price from daily where {anomaly_condition} order by thscode,date_ms")
with anomaly_output.open('x', encoding='utf-8', newline='') as stream:
    writer = csv.writer(stream)
    writer.writerow([column[0] for column in cursor.description])
    while batch := cursor.fetchmany(1000):
        writer.writerows(batch)
with anomaly_output.open('rb') as stream:
    report['anomalyEvidence'] = {'file': anomaly_output.name, 'sha256': hashlib.file_digest(stream, 'sha256').hexdigest(), 'status': 'diagnostic-only-not-confirmed-errors'}
with output.open('x', encoding='utf-8') as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
print(json.dumps({'output': str(output), 'dailyKind': daily_kind,
                  'daily': {key: value for key, value in report['daily'].items() if key not in ['coverageByDate', 'anomalySamples', 'knownAnomalyWindow']},
                  'incrementalOverlap': report.get('incrementalOverlap'), 'actions': report['actions']}, ensure_ascii=False, indent=2))
