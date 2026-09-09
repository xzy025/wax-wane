import unittest
from auditHithinkUniverse import parse_mapping, sz_delist


class UniverseAuditTests(unittest.TestCase):
    def page(self, number, code):
        return [{'metadata': {'tabkey': 'tab1'}, 'data': []}, {'metadata': {'tabkey': 'tab2', 'pagecount': 2, 'recordcount': 2, 'pageno': number},
                'data': [{'zqdm': code, 'zqjc': 'fixture', 'ssrq': '2010-01-01', 'zzrq': '2020-01-01'}]}]

    def test_complete_reference_excludes_b_shares(self):
        result = sz_delist({'szse-delisted': self.page(1, '000005'), 'szse-delisted-2': self.page(2, '200001')})
        self.assertEqual([row['code'] for row in result], ['000005.SZ'])

    def test_missing_repeated_pages_and_duplicate_codes_fail(self):
        for pages in [{'szse-delisted': self.page(1, '000005')},
                      {'szse-delisted': self.page(1, '000005'), 'szse-delisted-2': self.page(1, '000006')},
                      {'szse-delisted': self.page(1, '000005'), 'szse-delisted-2': self.page(2, '000005')}]:
            with self.subTest(pages=pages), self.assertRaises(ValueError):
                sz_delist(pages)

    def test_mapping_preserves_codes_and_parses_nested_text(self):
        row = '<tr><td>1</td><td><span>fixture</span></td><td>2020/7/27</td><td>833819</td><td>920819</td></tr>'
        self.assertEqual(parse_mapping('<table>' + row + '</table>'), [{'name': 'fixture', 'listed': '2020-07-27', 'old': '833819.BJ', 'new': '920819.BJ'}])
        with self.assertRaises(ValueError):
            parse_mapping('<table>' + row * 2 + '</table>')
        with self.assertRaises(ValueError):
            parse_mapping('<html>Unavailable</html>')


if __name__ == '__main__':
    unittest.main()
