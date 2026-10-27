import csv
import json
import tempfile
import unittest
from pathlib import Path
from prepare_attendance_baselines import prepare


class MatchingTests(unittest.TestCase):
    def test_exact_identity_phone_checks_and_duplicate_maximum(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contacts = root / 'contacts.csv'
            with contacts.open('w', encoding='utf-8', newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(['Contact ID','First Name','Last Name','Phone Number'])
                writer.writerows([['1','Fictional','One','0400000001'],['2','Shared','Name','0400000002'],['3','Shared','Name','0400000003'],['4','Changed','Phone','0400000004']])
            raw = [['First Name','Last Name','Phone Number','Attendances (Last 7 days)','Attendance Last Marked','Attendances (Last 30 days)','Membership Name'],['Fictional','One','61400000001','1','','4','Unlimited'],['Fictional','One','0400000001','2','','5','Unlimited'],['Shared','Name','0400000002','1','','3','Unlimited'],['Changed','Phone','0400999999','2','','4','Unlimited'],['Missing','Contact','','0','','0','Unlimited']]
            (root/'attendance_data_2026-10-19.json').write_text(json.dumps({'raw':raw}),encoding='utf-8')
            baselines,audit=prepare(root,contacts)
            self.assertEqual(baselines[0]['snapshot'][0]['member_id'],'clubworx:1')
            self.assertEqual(baselines[0]['snapshot'][0]['s7'],2)
            self.assertEqual(len(baselines[0]['snapshot']),1)
            self.assertEqual(audit[0]['counts']['ambiguous_name'],1)
            self.assertEqual(audit[0]['counts']['phone_conflict'],1)
            self.assertEqual(audit[0]['counts']['conflicting_duplicate_counts'],1)


if __name__ == '__main__':
    unittest.main()
