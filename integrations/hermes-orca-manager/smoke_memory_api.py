"""Operator-only local retain/semantic-recall/reflect check; never runs on discovery."""
import json
import urllib.error
import urllib.request
from .memory_llm import read_private_secret


def smoke_memory_api():
    from hermes_constants import get_hermes_home
    from hindsight_client import Hindsight

    url = "http://127.0.0.1:8788"
    # The installed local API must reject anonymous and incorrectly authenticated bank reads.
    for headers in ({}, {"Authorization": "Bearer wrong"}):
        try:
            urllib.request.urlopen(urllib.request.Request(url + "/v1/default/banks", headers=headers), timeout=5)
        except urllib.error.HTTPError as error:
            if error.code not in {401, 403}:
                raise RuntimeError("Unexpected memory API authentication refusal") from None
        else:
            raise RuntimeError("Memory API accepted an unauthenticated bank read")
    key = read_private_secret(str(get_hermes_home() / "memory-api.key"))
    client = Hindsight(base_url=url, api_key=key, timeout=180)
    bank = "orca-manager-validation"
    content = ("The Orca manager's persistent-memory validation marker is GLADE318. "
               "Its durable state is stored on the coding worker. "
               "The manager must preserve desktop Orca and active coding workers; "
               "loss of SSH contact is unverifiable rather than proof of process death.")
    try:
        retained = client.retain(bank_id=bank, content=content,
                                 context="Orca manager deployment validation",
                                 document_id="orca-manager-memory-validation-v1")
        print("HINDSIGHT_RETAIN_RETURNED", flush=True)
        recalled = client.recall(bank_id=bank, query="What identifier verifies the supervisor's durable memory?", budget="low")
        if "GLADE318" not in json.dumps(recalled.model_dump(), default=str):
            raise RuntimeError("Semantic memory recall did not recover the validation fact")
        print("HINDSIGHT_SEMANTIC_RECALL_OK", flush=True)
        reflected = client.reflect(bank_id=bank, query="What is the validation marker and what safety rule applies when SSH disconnects?", budget="low")
        text = json.dumps(reflected.model_dump(), default=str)
        if "GLADE318" not in text or "unverifiable" not in text.lower():
            raise RuntimeError("Memory reflection did not recover the operational rule")
        print("HINDSIGHT_LOCAL_RETAIN_RECALL_REFLECT_OK", flush=True)
    finally:
        client.close()
