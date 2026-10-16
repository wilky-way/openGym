#!/usr/bin/env python3
"""Remove each K08 index forward independently; restore bytes in every case.

Run from any cwd: python3 packages/core/test/k08-mutate.py
Results/logs: .gate/K08-r1. Checks real output first, then executed-call forwarding.
Never run concurrently with another reader/test process on this worktree.
"""
import json
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[3]
core = root / 'packages/core'
evidence = root / '.gate/K08-r1'
evidence.mkdir(parents=True, exist_ok=True)
rows = json.loads((core / 'test/k08-index-calls.json').read_text())
originals = {row['file']: (core / 'src' / row['file']).read_bytes() for row in rows}


def run(label, output_only=False):
    report = evidence / (label + '.json')
    report.unlink(missing_ok=True)
    env = dict(os.environ, TZ='America/Chicago', K08_OUTPUT_ONLY='1' if output_only else '0')
    process = subprocess.run(['bun', 'run', 'test', 'test/progression-index.test.ts', '--reporter=json', '--outputFile=' + str(report)], cwd=core, env=env, capture_output=True, text=True, timeout=60)
    (evidence / (label + '.log')).write_text(process.stdout + process.stderr)
    data = json.loads(report.read_text())
    assert data['numTotalTests'] == 39, (label, data)
    failed = [test['fullName'] for suite in data['testResults'] for test in suite['assertionResults'] if test['status'] == 'failed']
    return process.returncode, failed


assert run('baseline')[0] == 0
assert run('baseline-output', True)[0] == 0
results = []
try:
    for n, row in enumerate(rows):
        path = core / 'src' / row['file']
        code = originals[row['file']].decode()
        assert code[row['start']:row['end']] == row['text'], row['site']
        assert row['text'] != row['mutant'], row['site']
        try:
            path.write_text(code[:row['start']] + row['mutant'] + code[row['end']:])
            output_status, output_failed = run(f'{n:02d}-output', True)
            status, failed = run(f'{n:02d}-forwarding')
            own_failed = any(row['site'] in name for name in failed)
            result = {**row, 'caught': status != 0 and own_failed, 'output_caught': output_status != 0, 'failed_tests': failed, 'output_failed_tests': output_failed}
            results.append(result)
            (evidence / 'mutation-results.json').write_text(json.dumps(results, indent=2) + '\n')
            print(f"{n + 1}/34 {row['site']}: {'CAUGHT' if result['caught'] else 'SURVIVED'} ({'output' if result['output_caught'] else 'executed-argument assertion'})", flush=True)
        finally:
            path.write_bytes(originals[row['file']])
finally:
    for file, data in originals.items():
        (core / 'src' / file).write_bytes(data)
assert run('restored-baseline')[0] == 0
assert len(results) == 34 and all(row['caught'] for row in results)
print('34/34 deleted-index mutations caught; original source bytes restored.', flush=True)
