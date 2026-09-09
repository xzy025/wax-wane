"""Regression checks for the offline audit; run with the research DuckDB venv."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import duckdb


class DumpAuditTests(unittest.TestCase):
    def test_empty_files_and_integrity_rejection(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            connection = duckdb.connect()
            schemas = {
                'daily-k-10d': 'thscode varchar, currency varchar, interval varchar, adjusted varchar, date_ms bigint, open_price double, high_price double, low_price double, close_price double, volume double, turnover double',
                'adjustment-factors': 'thscode varchar, ticker varchar, ex_date_ms bigint, dividend_per_share double, per_share_bonus double, allotment_ratio double, allotment_price double, currency varchar',
            }
            files = []
            for index, (kind, schema) in enumerate(schemas.items()):
                connection.execute(f'create table fixture{index} ({schema})')
                path = folder / (kind + '.parquet')
                connection.table(f'fixture{index}').write_parquet(str(path))
                files.append({'kind': kind, 'bytes': path.stat().st_size,
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            manifest = folder / 'manifest.json'
            manifest.write_text(json.dumps({'files': files}), encoding='utf-8')
            command = [sys.executable, str(Path(__file__).with_name('verifyHithinkDumps.py')), str(folder)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((folder / 'verification.json').read_text(encoding='utf-8'))
            self.assertEqual(report['daily']['dateRange'], [None, None])
            self.assertEqual(report['daily']['rows'], 0)
            self.assertFalse(report['eligibleAsTradeGate'])
            connection.execute("insert into fixture0 values ('000001.SZ','CNY','1d','none',1764172800000,10,11,9,10,100,1000), ('000001.SZ','CNY','1d','none',1764518400000,10,11,9,10,100,1000)")
            connection.table('fixture0').write_parquet(str(folder / 'daily-k-10d.parquet'))
            connection.execute('create table full_fixture as select * from fixture0 limit 0')
            connection.execute("insert into full_fixture values ('000001.SZ','CNY','1d','none',1764172800000,10,11,9,10,100,100), ('000001.SZ','CNY','1d','none',1764259200000,10,11,9,10,100,1000)")
            connection.table('full_fixture').write_parquet(str(folder / 'daily-k.parquet'))
            files = []
            for kind in ['daily-k', 'daily-k-10d', 'adjustment-factors']:
                path = folder / (kind + '.parquet')
                files.append({'kind': kind, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            manifest.write_text(json.dumps({'files': files}), encoding='utf-8')
            result = subprocess.run(command + [str(folder / 'full.json')], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((folder / 'full.json').read_text(encoding='utf-8'))
            self.assertEqual(report['dailyKind'], 'daily-k')
            self.assertEqual(report['daily']['unitOrDataAnomalies'], 1)
            self.assertEqual(report['incrementalOverlap']['missingInFull'], 1)
            self.assertEqual(report['incrementalOverlap']['missingInIncrementalWindow'], 1)
            self.assertEqual(report['incrementalOverlap']['changedRows'], 1)
            files[0]['sha256'] = '0' * 64
            manifest.write_text(json.dumps({'files': files}), encoding='utf-8')
            result = subprocess.run(command + [str(folder / 'tampered.json')], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Manifest integrity mismatch', result.stderr)
            self.assertFalse((folder / 'tampered.json').exists())
            connection.close()


if __name__ == '__main__':
    unittest.main()
