"""Read only the freshly extracted private recovery copy, never activate its login."""
import json
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

profile = Path(sys.argv[1]) / "orca-manager"
for name in ("auth.json", "config.yaml", "memory-api.key", "memory-bridge.key", "state.db"):
    path = profile / name
    if not path.is_file() or path.is_symlink() or path.stat().st_size == 0:
        raise ValueError("Required private recovery component is missing")
with (profile / "auth.json").open() as source:
    if not isinstance(json.load(source), dict):
        raise ValueError("Recovered authentication document is invalid")
with sqlite3.connect(f"file:{quote(str(profile / 'state.db'))}?mode=ro", uri=True) as connection:
    if connection.execute("PRAGMA integrity_check").fetchone() != ("ok",):
        raise ValueError("Recovered session database failed integrity check")
    sessions = connection.execute("SELECT count(*) FROM sessions").fetchone()[0]
    if sessions < 1:
        raise ValueError("Expected native Hermes sessions are absent")
print(f"HERMES_PROFILE_RECOVERY_OK: {sessions} sessions; login was not activated")
