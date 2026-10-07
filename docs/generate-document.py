"""Backward-compatible entry point for the current technical PDF.

The previous v4 PDF/DOCX authoring model is retired. The current Markdown,
lockfile and release facts are rendered by scripts/build-technical-description.py.
"""
from pathlib import Path
import runpy
import sys

script = Path(__file__).resolve().parents[1] / 'scripts' / 'build-technical-description.py'
sys.argv[0] = str(script)
runpy.run_path(str(script), run_name='__main__')
