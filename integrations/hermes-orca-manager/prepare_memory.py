"""Explicit operator-only preparation; uses Hermes's supported atomic config writer."""
from .memory_llm import read_private_secret


def prepare_memory():
    from hermes_constants import get_hermes_home
    from utils import atomic_json_write, read_json_or_empty

    profile = get_hermes_home()
    destination = profile / "hindsight" / "config.json"
    secret = read_private_secret(str(profile / "memory-api.key"))
    existing = read_json_or_empty(destination)
    if existing and existing.get("mode") != "local_external":
        raise ValueError("Existing non-local memory settings require operator review")
    destination.parent.mkdir(parents=True, exist_ok=True)
    atomic_json_write(destination, {
        **existing,
        "mode": "local_external",
        "api_url": "http://127.0.0.1:8788",
        "apiKey": secret,
        "timeout": 180,
        "bank_id": "orca-manager",
        "budget": "high",
        "banks": {"hermes": {"bankId": "orca-manager", "budget": "high", "enabled": True}},
    }, mode=0o600, fsync_dir=True)
    print("Local Hindsight settings prepared; activate memory.provider only after validation")
