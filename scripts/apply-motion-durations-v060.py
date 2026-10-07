"""One-time authored CSS migration. Milestone's real 6500ms countdown stays unscaled."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1] / 'artifacts/fsp-signal/src'
for path in root.rglob('*.css'):
    original = path.read_text(encoding='utf-8')
    def scale(match):
        kind, body = match.group(1), match.group(2)
        if '--motion-time-scale' in body or 'milestone-time' in body:
            return match.group(0)
        duration_index = 0
        def duration(token):
            nonlocal duration_index
            duration_index += 1
            raw = token.group(0)
            value = float(token.group(1)) * (0.001 if token.group(2) == 'ms' else 1)
            calculated = f'calc({raw} * var(--motion-time-scale, 1))'
            if kind == 'transition':
                return f'max(80ms, {calculated})'
            if duration_index == 1 and value < 1:
                return f'max(120ms, {calculated})'
            return calculated
        body = re.sub(r'(?<![\w.-])(\d*\.?\d+)(ms|s)\b', duration, body)
        return f'{kind}:{body};'
    updated = re.sub(r'\b(animation|transition)\s*:\s*([^;{}]+);', scale, original)
    if updated != original:
        path.write_text(updated, encoding='utf-8', newline='')
