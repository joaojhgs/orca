"""Explicit operator smoke: never starts from plugin discovery or an idle timer."""
import json
import sys
from urllib.request import Request, urlopen
from private_secret import read_private_secret


def main():
    secret = read_private_secret(sys.argv[1])
    request = Request(
        "http://127.0.0.1:8789/v1/chat/completions",
        data=json.dumps({
            "model": "hermes-memory",
            "messages": [{"role": "user", "content": "Return only JSON with a single key verified and value true."}],
            "response_format": {"type": "json_object"},
            "max_tokens": 128,
        }).encode("utf-8"),
        headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=100) as response:
        result = json.load(response)
    content = json.loads(result["choices"][0]["message"]["content"])
    if content != {"verified": True}:
        raise RuntimeError("Memory LLM smoke did not return the expected structured value")
    print("HERMES_MEMORY_LLM_BRIDGE_OK")


if __name__ == "__main__":
    main()
