import unittest
import contextlib
import io
import json
import tempfile
from pathlib import Path
from hithinkBatchParity import compare, compare_bar, digest, parse_peer, spread, write_new


class BatchParityTests(unittest.TestCase):
    def test_units_and_rounding_are_not_large_scale_errors(self):
        peer = parse_peer({'rc': 0, 'data': {'code': '000001', 'klines': ['2025-11-27,10,10,11,9,100,100000']}}, '000001.SZ')['2025-11-27']
        own = {**peer, 'volume': 10045}
        tolerance = {'price': .011, 'volumeShares': 50, 'amountCurrency': 1}
        self.assertEqual(compare_bar(own, peer, tolerance)['mismatches'], [])
        own.update(volume=1000, amount=1000)
        self.assertEqual(set(compare_bar(own, peer, tolerance)['mismatches']), {'volume', 'amount'})

    def test_wrong_symbol_empty_duplicate_and_nonfinite_rejected(self):
        for data in [{'code': '000002', 'klines': ['2025-11-27,10,10,11,9,100,100000']},
                     {'code': '000001', 'klines': []},
                     {'code': '000001', 'klines': ['2025-11-27,10,10,11,9,nan,100000']},
                     {'code': '000001', 'klines': ['2025-11-27,10,10,11,9,100,100000'] * 2}]:
            with self.subTest(data=data), self.assertRaises(ValueError):
                parse_peer({'rc': 0, 'data': data}, '000001.SZ')

    def test_sample_is_deterministic_and_spans_codes(self):
        self.assertEqual(spread(list(range(15)), 8), list(range(0, 15, 2)))

    def test_missing_dates_and_capture_tampering_are_not_passes(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            plan_path = folder / 'plan.json'
            dates = ['2025-11-27', '2025-11-28', '2025-12-01']
            write_new(plan_path, {'dates': dates, 'tolerances': {'price': .011, 'volumeShares': 50, 'amountCurrency': 1},
                                 'samples': [{'code': '000001.SZ', 'group': 'test', 'bars': [{'date': date, 'open': 10, 'high': 11, 'low': 9, 'close': 10, 'volume': 10000, 'amount': 100000} for date in dates]}]})
            raw = folder / '000001.SZ.json'
            write_new(raw, {'rc': 0, 'data': {'code': '000001', 'klines': ['2025-11-27,10,10,11,9,100,100000']}})
            write_new(folder / 'manifest.json', {'planSha256': digest(plan_path), 'entries': [{'code': '000001.SZ', 'captured': True, 'file': raw.name, 'sha256': digest(raw)}]})
            with contextlib.redirect_stdout(io.StringIO()):
                compare(plan_path, folder)
            report = json.loads((folder / 'parity.json').read_text())
            self.assertEqual(report['compared'], 1)
            self.assertEqual(len(report['unavailable']), 2)
            self.assertFalse(report['eligibleAsTradeGate'])
            raw.write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'Capture hash mismatch'):
                compare(plan_path, folder)


if __name__ == '__main__':
    unittest.main()
