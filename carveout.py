"""carveout.py -- the players every report carves out by default.

    import os, sys
    sys.path.insert(0, os.path.join(HERE, ".."))
    from carveout import CARVED, CARVE_NAMES, CARVE_LABEL

CARVED is a frozenset of player_id STRINGS. Keyed on player_id and never on
username: ids here have changed username mid-year, and a name-based rule stops
matching silently the day one does.

This exists because the list used to be a constant repeated in nine builders,
each with its own name for it, and one of them matching on username instead.
Nine copies of a rule is nine chances for one report to disagree with the rest,
and the disagreement is invisible -- every page still builds, they just quietly
count different people. The list lives in data-exclusions.json; this only reads
it.

Carving out is NOT removing. Nothing here is dropped from the caches, every
report builds both views, and the page carries a toggle. A player belongs here
when their numbers drown the business, not when they should not exist -- that
is the `players` list in the same file, which is a different thing.
"""

import json
import os

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data-exclusions.json")


def _load():
    try:
        with open(_FILE, "r", encoding="utf-8") as fh:
            return json.load(fh).get("carve_out", []) or []
    except Exception:
        # A missing config must not take the nightly build down. An empty list
        # means nothing is carved out, which is visible in the numbers on the
        # very first page anyone opens -- unlike a crash at 4am that nobody
        # sees until the morning.
        return []


_ENTRIES = _load()

CARVED = frozenset(str(p["player_id"]).strip() for p in _ENTRIES if p.get("player_id"))
CARVE_NAMES = {str(p["player_id"]).strip(): (p.get("username") or "").strip()
               for p in _ENTRIES if p.get("player_id")}

# What a page calls the toggle. One name reads as a name; several read as a
# list, and the page should say which players it is holding out rather than
# leaving "ex-whale" to mean something it no longer means.
_NAMES = [n for n in (CARVE_NAMES[i] for i in sorted(CARVE_NAMES)) if n]
CARVE_LABEL = " + ".join(_NAMES) if _NAMES else "nobody"

# The first entry, for the pages whose copy still speaks about one player.
CARVE_FIRST = (sorted(CARVE_NAMES)[0] if CARVE_NAMES else "")
CARVE_FIRST_NAME = CARVE_NAMES.get(CARVE_FIRST, "")


def carved(pid):
    """True when this player is held out of the default view."""
    return str(pid) in CARVED
