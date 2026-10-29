"""Match archived weekly summaries to stable IDs, without guessing ambiguous identities.

Outputs are private files outside the public build. This does not modify sources or
write to Supabase. Historical duplicates use the maximum weekly count, matching the
existing retention builder; they are never summed.
"""
import argparse
import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


def norm(value):
    value = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub('[^a-z0-9]+', ' ', value).strip()


def phone(value):
    digits = re.sub('[^0-9]', '', str(value or ''))
    return digits[-9:] if len(digits) >= 9 else None


def integer(value):
    text = str(value).strip()
    if not re.fullmatch(r'\d+(?:\.0+)?', text):
        raise ValueError('Historical count is blank or invalid; never replace it with zero')
    return int(float(text))


def prepare(workspace, attendance_path):
    with attendance_path.open(encoding='utf-8-sig', newline='') as handle:
        current = list(csv.DictReader(handle))
    names = defaultdict(set)
    phones = defaultdict(set)
    for row in current:
        cid = row['Contact ID'].strip()
        if not cid:
            raise ValueError('Current export has a missing Contact ID')
        names[norm(row['First Name'] + ' ' + row['Last Name'])].add(cid)
        if phone(row.get('Phone Number')):
            phones[cid].add(phone(row['Phone Number']))

    def match(name, historical_phone):
        ids = names.get(norm(name), set())
        if len(ids) != 1:
            return None, 'ambiguous_name' if ids else 'not_in_current_roster'
        cid = next(iter(ids))
        hp = phone(historical_phone)
        if hp and phones[cid] and hp not in phones[cid]:
            return None, 'phone_conflict'
        return 'clubworx:' + cid, 'name_and_phone' if hp and phones[cid] else 'unique_name_only'

    datasets = {}
    categories = {}
    for source in sorted(workspace.glob('attendance_data_*.json')):
        data = json.loads(source.read_text(encoding='utf-8'))
        day = source.stem.removeprefix('attendance_data_')
        sheets = data.get('sheets', data)
        raw = sheets.get('raw', [])
        if isinstance(raw, dict) and 'values' not in raw:
            for old_day, rows in raw.items():
                if re.fullmatch(r'\d{4}-\d{2}-\d{2}', old_day):
                    datasets[old_day] = (source, rows)
        else:
            datasets[day] = (source, raw.get('values', []) if isinstance(raw, dict) else raw)
        groups = data.get('categories', {}) or {k: sheets[k] for k in ['zero', 'one', 'two', 'three', 'four'] if k in sheets}
        context = {}
        for group in groups.values():
            rows = group.get('values', []) if isinstance(group, dict) else group
            for row in rows[3:]:
                if len(row) < 10 or not row[0] or norm(row[0]) == 'total':
                    continue
                name = str(row[1] or '') + ' ' + str(row[0] or '').rstrip('.')
                cid, evidence = match(name, row[2])
                if cid:
                    value = {'engagement': str(row[6] or '').strip(), 'context_membership': str(row[3] or '').strip()}
                    if cid in context and context[cid] != value:
                        context[cid] = None
                    else:
                        context[cid] = value
        categories[day] = context

    baselines, audit = [], []
    for day, (source, rows) in sorted(datasets.items()):
        if date.fromisoformat(day).weekday() != 0:
            raise ValueError('Archived summary must have its original Monday date')
        if not rows or rows[0][:4] != ['First Name', 'Last Name', 'Phone Number', 'Attendances (Last 7 days)']:
            raise ValueError(f'Unexpected historical header in {source.name}, {day}')
        matched = {}
        stats = Counter()
        skipped = []
        for row in rows[1:]:
            if not row or not str(row[0] or '').strip():
                continue
            name = str(row[0] or '') + ' ' + str(row[1] or '')
            cid, evidence = match(name, row[2])
            if not cid:
                stats[evidence] += 1
                skipped.append({'name': name, 'reason': evidence})
                continue
            try:
                s7, s30 = integer(row[3]), integer(row[5])
                if s7 > s30:
                    raise ValueError('7-day count exceeds 30-day count')
            except (ValueError, IndexError):
                stats['invalid_counts'] += 1
                skipped.append({'name': name, 'reason': 'invalid_counts'})
                continue
            item = {'member_id': cid, 's7': s7, 's30': s30, 'membership': str(row[6] or ''), 'identity_evidence': evidence}
            context = categories.get(day, {}).get(cid)
            if context:
                item.update(context)
            if cid in matched:
                stats['repeated_member_rows'] += 1
                if (matched[cid]['s7'], matched[cid]['s30']) != (s7, s30):
                    stats['conflicting_duplicate_counts'] += 1
                if (s7, s30) <= (matched[cid]['s7'], matched[cid]['s30']):
                    continue
            matched[cid] = item
        evidence = Counter(item['identity_evidence'] for item in matched.values())
        stats.update({'matched_people': len(matched), 'with_engagement': sum(bool(i.get('engagement')) for i in matched.values()), **evidence})
        if not matched:
            raise ValueError(f'No safe historical matches for {day}')
        baselines.append({'as_of': day, 'source_label': f'Archived Urban weekly attendance summary {day}', 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'snapshot': list(matched.values()), 'metadata': {'source_file': source.name, 'kind': 'archived-weekly-summary', 'duplicate_rule': 'maximum weekly count, never sum', 'matching': dict(stats)}})
        audit.append({'as_of': day, 'counts': dict(stats), 'skipped': skipped})
    return baselines, audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--attendance', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--audit', type=Path, required=True)
    args = parser.parse_args()
    if not all(p.name.endswith('.private.json') for p in [args.output, args.audit]):
        parser.error('Both output filenames must end .private.json')
    baselines, audit = prepare(args.workspace, args.attendance)
    args.output.write_text(json.dumps(baselines, indent=2), encoding='utf-8')
    args.audit.write_text(json.dumps(audit, indent=2), encoding='utf-8')
    print(json.dumps({'weeks': len(baselines), 'range': [baselines[0]['as_of'], baselines[-1]['as_of']], 'records': sum(len(b['snapshot']) for b in baselines), 'weekly_checks': [{k: v for k, v in a.items() if k != 'skipped'} for a in audit]}))
