"""Audit historical code coverage against captured exchange references."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from html.parser import HTMLParser


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def captures(folder):
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8-sig'))
    result = {}
    for entry in manifest['entries']:
        if not entry.get('file'):
            continue
        path = folder / entry['file']
        if sha256(path) != entry['sha256']:
            raise ValueError('Evidence hash mismatch: ' + path.name)
        result[entry['id']] = json.loads(path.read_text(encoding='utf-8-sig'))
    return result


def sz_delist(pages):
    tabs = [next(tab for tab in value if tab['metadata']['tabkey'] == 'tab2') for key, value in pages.items() if key.startswith('szse-delisted')]
    if not tabs:
        raise ValueError('Missing SZSE reference')
    expected_pages = int(tabs[0]['metadata']['pagecount'])
    expected_rows = int(tabs[0]['metadata']['recordcount'])
    if any(int(tab['metadata']['pagecount']) != expected_pages or int(tab['metadata']['recordcount']) != expected_rows for tab in tabs):
        raise ValueError('SZSE metadata changed during pagination')
    if sorted(int(tab['metadata']['pageno']) for tab in tabs) != list(range(1, expected_pages + 1)):
        raise ValueError('Incomplete or repeated SZSE pages')
    rows = [row for tab in tabs for row in tab['data']]
    if len(rows) != expected_rows or len({row['zqdm'] for row in rows}) != len(rows):
        raise ValueError('SZSE count or key mismatch')
    return [{'code': row['zqdm'] + '.SZ', 'name': row['zqjc'], 'listed': row['ssrq'], 'delisted': row['zzrq']} for row in rows if row['zqdm'].startswith(('0', '3'))]


def date_iso(value):
    return datetime.strptime(value, '%Y%m%d').date().isoformat()


class MappingTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        elif tag in ['td', 'th'] and self.row is not None:
            self.cell = []

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ['td', 'th'] and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None


def parse_mapping(text):
    parser = MappingTable()
    parser.feed(text)
    rows = []
    for row in parser.rows:
        if len(row) == 5 and row[0].isdigit() and len(row[3]) == 6 and row[3].isdigit() and len(row[4]) == 6 and row[4].isdigit():
            rows.append({'name': row[1], 'listed': datetime.strptime(row[2], '%Y/%m/%d').date().isoformat(), 'old': row[3] + '.BJ', 'new': row[4] + '.BJ'})
    if not rows or len({row['old'] for row in rows}) != len(rows) or len({row['new'] for row in rows}) != len(rows):
        raise ValueError('Empty or ambiguous BSE mapping')
    return rows


def main(dump_folder, universe_folder, reference_folder, output, bse_folder=None):
    import duckdb
    manifest = json.loads((dump_folder / 'manifest.json').read_text())
    daily = dump_folder / 'daily-k.parquet'
    expected = next(entry['sha256'] for entry in manifest['files'] if entry['kind'] == 'daily-k')
    if sha256(daily) != expected:
        raise ValueError('Full dump hash mismatch')
    universe = captures(universe_folder)
    refs = captures(reference_folder)
    catalog_pages = sorted((page for key, page in universe.items() if key.startswith('tickers-')), key=lambda page: page['params']['offset'])
    offset = 0
    for page in catalog_pages:
        if not page['ok'] or page['params']['offset'] != offset or not isinstance(page['data']['item'], list):
            raise ValueError('Invalid catalog pages')
        offset += page['params']['limit']
    if not catalog_pages or len(catalog_pages[-1]['data']['item']) >= catalog_pages[-1]['params']['limit']:
        raise ValueError('Missing terminal catalog page')
    tickers = [item for key, page in universe.items() if key.startswith('tickers-') for item in page['data']['item']]
    catalog = {item['thscode']: item for item in tickers}
    if len(catalog) != len(tickers):
        raise ValueError('Duplicate catalog code')
    connection = duckdb.connect()
    connection.read_parquet(str(daily)).create_view('daily')
    rows = connection.execute("select thscode,count(*),strftime(to_timestamp(min(date_ms)/1000.0)+interval '8 hours','%Y-%m-%d'),strftime(to_timestamp(max(date_ms)/1000.0)+interval '8 hours','%Y-%m-%d') from daily group by thscode order by thscode").fetchall()
    histories = {row[0]: {'rows': row[1], 'first': row[2], 'last': row[3]} for row in rows}
    start = min(row['first'] for row in histories.values())
    end = max(row['last'] for row in histories.values())
    sz = sz_delist(refs)
    sh_raw = refs['sse-delisted']
    if len(sh_raw['result']) != int(sh_raw['pageHelp']['total']):
        raise ValueError('Incomplete SSE reference')
    sh = [{'code': row['A_STOCK_CODE'] + '.SH', 'name': row['COMPANY_ABBR'], 'listed': date_iso(row['LIST_DATE']), 'delisted': date_iso(row['DELIST_DATE'])} for row in sh_raw['result']]
    overlapping = [row for row in sz + sh if row['delisted'] >= start and row['listed'] <= end]
    checks = [{**row, 'inCurrentCatalog': row['code'] in catalog, 'dump': histories.get(row['code'])} for row in overlapping]
    aliases = []
    for old, new in [('833819.BJ', '920819.BJ'), ('835185.BJ', '920185.BJ'), ('830799.BJ', '920799.BJ')]:
        aliases.append({'old': old, 'new': new, 'mappingStatus': 'candidate-awaiting-official-effective-date', 'oldHistory': histories.get(old), 'newHistory': histories.get(new),
                        'oldSearch': universe[f'search-{old}']['data'], 'newSearch': universe[f'search-{new}']['data'],
                        'transitionWindow': connection.execute("select date_ms,open_price,high_price,low_price,close_price,volume,turnover from daily where thscode=? and date_ms between epoch_ms(timestamp '2025-09-25 00:00:00')-28800000 and epoch_ms(timestamp '2025-10-15 00:00:00')-28800000 order by date_ms", [new]).fetchall()})
    report = {'status': 'research-only', 'eligibleAsTradeGate': False, 'generatedAt': datetime.now(timezone.utc).isoformat(), 'dumpSha256': expected,
              'window': [start, end], 'dumpCodes': len(histories), 'catalogCodes': len(catalog),
              'catalogWithoutHistory': [catalog[code] for code in sorted(catalog.keys() - histories.keys())],
              'historyWithoutCurrentCatalog': sorted(histories.keys() - catalog.keys()),
              'exchangeReferences': {'szAshareRows': len(sz), 'sseAshareRows': len(sh)},
              'delistedOverlappingWindow': checks,
              'delistedSummary': {exchange: {'overlapping': sum(row['code'].endswith(exchange) for row in checks), 'absentOldCode': sum(row['code'].endswith(exchange) and row['dump'] is None for row in checks)} for exchange in ['SZ', 'SH']},
              'bjPrefixCounts': connection.execute("select substr(thscode,1,3),count(distinct thscode),min(date_ms),max(date_ms) from daily where thscode like '%.BJ' group by 1 order by 1").fetchall(),
              'aliasCandidates': aliases,
              'notes': ['Absence is tested by exchange code; mergers/relistings/aliases require separate identity reconciliation.', 'Current code history is not proof of historical universe eligibility.']}
    if bse_folder:
        bse_manifest = json.loads((bse_folder / 'manifest.json').read_text(encoding='utf-8-sig'))
        html = {}
        for entry in bse_manifest['entries']:
            if not entry.get('captured'):
                raise ValueError('BSE reference unavailable')
            path = bse_folder / entry['file']
            if sha256(path) != entry['sha256']:
                raise ValueError('BSE reference hash mismatch')
            html[entry['id']] = path.read_text(encoding='utf-8')
        mapping = parse_mapping(html['bse-mapping'])
        by_new = {row['new']: row for row in mapping}
        for alias in aliases:
            if by_new.get(alias['new'], {}).get('old') != alias['old']:
                raise ValueError('Candidate does not match official mapping')
            alias['mappingStatus'] = 'official-mapping-confirmed'
            alias['mapping'] = by_new[alias['new']]
        report['bseMapping'] = {'source': 'https://www.bse.cn/service/code_mapping.html', 'effectiveDate': '2025-10-09',
                                'effectiveDateSource': 'https://www.bse.cn/important_news/200026735.html', 'rows': len(mapping),
                                'missingNewCodes': [row for row in mapping if row['new'] not in histories],
                                'presentOldCodes': [row for row in mapping if row['old'] in histories],
                                'mappedHistoryChecks': [{**row, 'dump': histories.get(row['new'])} for row in mapping]}
    with output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    if bse_folder:
        samples = []
        for alias in aliases:
            bars = []
            for row in alias['transitionWindow']:
                date = datetime.fromtimestamp((row[0] + 28800000) / 1000, timezone.utc).date().isoformat()
                bars.append(dict(zip(['date', 'open', 'high', 'low', 'close', 'volume', 'amount'], [date, *row[1:]])))
            samples.append({'code': alias['new'], 'group': 'BSE-code-transition', 'bars': bars})
        plan = {'status': 'research-only', 'eligibleAsTradeGate': False, 'dumpSha256': expected,
                'window': ['2025-09-25', '2025-10-15'], 'dates': sorted({bar['date'] for sample in samples for bar in sample['bars']}),
                'selection': 'Three official old/new mappings; date coverage is cross-source agreement, not independent calendar proof.',
                'tolerances': {'price': 0.011, 'volumeShares': 50, 'amountCurrency': 1}, 'samples': samples}
        with output.with_suffix('.peer-plan.json').open('x', encoding='utf-8') as stream:
            json.dump(plan, stream, ensure_ascii=False, indent=2)
    print(json.dumps({key: value for key, value in report.items() if key not in ['delistedOverlappingWindow', 'aliasCandidates', 'bseMapping']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('dump', type=Path)
    parser.add_argument('universe', type=Path)
    parser.add_argument('references', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--bse', type=Path)
    args = parser.parse_args()
    main(args.dump.resolve(), args.universe.resolve(), args.references.resolve(), args.output.resolve(), args.bse.resolve() if args.bse else None)
