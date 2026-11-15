"""Runs every Python builder on its input.json and checks the result matches
output.jsonld (the JavaScript builder's output), so the two stay identical.

    python3 test/run_python.py
"""
import importlib.util
import json
from datetime import datetime
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def normalise(value):
    # 189.0 and 189 are the same number in JSON-LD.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [normalise(v) for v in value]
    if isinstance(value, dict):
        return {k: normalise(v) for k, v in value.items()}
    return value


failed = checked = 0
for meta_path in sorted(ROOT.glob("*/*/meta.json")):
    meta = json.loads(meta_path.read_text())
    if not meta.get("python"):
        continue
    folder = meta_path.parent
    checked += 1
    spec = importlib.util.spec_from_file_location(folder.name.replace("-", "_"), folder / meta["python"]["file"])
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        build = getattr(module, meta["python"]["fn"])
        # A builder that checks dates is run on the date meta.json records, so
        # its example does not expire.
        as_of = [datetime.fromisoformat(meta["asOf"].replace("Z", "+00:00"))] if meta.get("asOf") else []
        actual = normalise(build(json.loads((folder / "input.json").read_text()), *as_of))
    except Exception as error:  # noqa: BLE001
        failed += 1
        print(f"FAIL {folder.relative_to(ROOT)}\n  {type(error).__name__}: {error}")
        continue
    expected = normalise(json.loads((folder / "output.jsonld").read_text()))
    if json.dumps(actual, sort_keys=True) != json.dumps(expected, sort_keys=True):
        failed += 1
        print(f"FAIL {folder.relative_to(ROOT)}\n  Python output differs from output.jsonld")
    else:
        print(f"ok   {folder.relative_to(ROOT)}")

print(f"\n{checked - failed} of {checked} passed")
sys.exit(1 if failed else 0)
