"""Create a private staff import from the existing weekly retention builder.

The builder reruns its existing report generation and returns the exact same risk
population, preserving suspension exclusions and weekly risk rules.
"""
import argparse
import contextlib
import io
import json
import runpy
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--builder', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--identity-map', type=Path, help='JSON mapping normalized names to stable Clubworx contact IDs')
parser.add_argument('--include-phone', action='store_true', help='Include phone numbers for authenticated staff access')
args = parser.parse_args()
if not args.output.name.endswith('.private.json'):
    parser.error('Use an output filename ending .private.json to keep the import out of Git.')
with contextlib.redirect_stdout(io.StringIO()):
    report = runpy.run_path(str(args.builder.resolve()))
identity = json.loads(args.identity_map.read_text(encoding='utf-8')) if args.identity_map else {}
members = []
seen = set()
for risk in report['risks']:
    normalized = risk['key']
    if args.identity_map and normalized not in identity:
        raise ValueError('Identity map must cover every risk member; missing an entry')
    member_id = 'clubworx:' + str(identity[normalized]) if args.identity_map else 'name-v1:' + normalized
    if member_id in seen:
        raise ValueError('Duplicate member identity; review the Clubworx ID mapping')
    seen.add(member_id)
    item = dict(member_id=member_id, name=risk['name'], membership=risk['membership'],
                priority=risk['priority'], signal=risk['signal'], s7=risk['s7'],
                s30=risk['s30'], sequence=risk['seq'])
    if args.include_phone:
        item['phone'] = risk['phone']
    members.append(item)
payload = dict(version=1, week=report['REPORT'].strftime('%Y-%m-%d'),
               identity_mode='clubworx-contact-id' if args.identity_map else 'normalised-name',
               source_label='Urban Muaythai weekly Retention Intelligence', members=members)
args.output.resolve().parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding='utf-8')
print(f'Created private staff import: {len(members)} risk members for {payload["week"]}.')
if not args.identity_map:
    print('Identity review required: normalized names are provisional. Prefer a stable Clubworx contact ID map before live use.')
