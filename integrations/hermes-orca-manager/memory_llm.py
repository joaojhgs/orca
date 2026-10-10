"""One bounded memory call at a time, using Hermes-owned provider/auth resolution."""
from __future__ import annotations

import hmac
import json
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from .memory_tool_format import complete_memory_tools
from .private_secret import read_private_secret

MAX_BODY = 256 * 1024
MAX_TOKENS = 4096


def complete_memory_request(ctx, payload, model_alias):
    allowed = {"model", "messages", "max_tokens", "max_completion_tokens", "temperature",
               "response_format", "stream", "tools", "tool_choice", "parallel_tool_calls"}
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise ValueError("Unsupported memory completion fields")
    if payload.get("model") != model_alias or payload.get("stream", False) is not False:
        raise ValueError("Only the configured model alias and non-streaming calls are supported")
    messages = payload.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 100:
        raise ValueError("A bounded message list is required")
    for message in [] if "tools" in payload else messages:
        if (not isinstance(message, dict) or set(message) - {"role", "content"}
                or message.get("role") not in {"system", "user", "assistant"}
                or not isinstance(message.get("content"), str)):
            raise ValueError("Only text messages without tool calls are supported")
    requested_tokens = payload.get("max_completion_tokens", payload.get("max_tokens", MAX_TOKENS))
    if isinstance(requested_tokens, bool) or not isinstance(requested_tokens, int) or requested_tokens < 1:
        raise ValueError("Invalid output-token budget")
    options = {
        "max_tokens": min(requested_tokens, MAX_TOKENS),
        "timeout": 90,
        "purpose": "orca-manager.memory-retain-recall-reflect",
    }
    temperature = payload.get("temperature")
    if temperature is not None:
        if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not 0 <= temperature <= 2:
            raise ValueError("Invalid temperature")
        options["temperature"] = temperature
    response_format = payload.get("response_format", {"type": "text"})
    message, finish_reason = None, "stop"
    if "tools" in payload:
        if "response_format" in payload:
            raise ValueError("Memory function selection and response format cannot be combined")
        result, message, finish_reason = complete_memory_tools(ctx, payload, options)
        content = None
    elif "tool_choice" in payload or "parallel_tool_calls" in payload:
        raise ValueError("Memory selection requires declared function schemas")
    elif isinstance(response_format, dict) and response_format.get("type") in {"json_object", "json_schema"}:
        schema = None
        if response_format.get("type") == "json_schema":
            specification = response_format.get("json_schema")
            if (set(response_format) != {"type", "json_schema"} or not isinstance(specification, dict)
                    or set(specification) - {"name", "schema", "strict"}
                    or not isinstance(specification.get("schema"), dict)):
                raise ValueError("Invalid JSON schema format")
            schema = specification["schema"]
        elif response_format != {"type": "json_object"}:
            raise ValueError("Invalid JSON object format")
        result = ctx.llm.complete_structured(
            instructions="Follow the supplied conversation's instructions. Return only the requested JSON object.",
            input=[{"type": "text", "text": json.dumps(messages, ensure_ascii=False)}],
            json_mode=True,
            json_schema=schema,
            **options,
        )
        content = json.dumps(result.parsed if result.parsed is not None else json.loads(result.text),
                             ensure_ascii=False)
    elif response_format == {"type": "text"}:
        result = ctx.llm.complete(messages=messages, **options)
        content = result.text
    else:
        raise ValueError("Unsupported response format")
    # No provider, account, profile, credential or model overrides reach ctx.llm.
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_alias,
        "choices": [{"index": 0, "message": message or {"role": "assistant", "content": content},
                     "finish_reason": finish_reason}],
        "usage": {"prompt_tokens": result.usage.input_tokens or 0,
                  "completion_tokens": result.usage.output_tokens or 0,
                  "total_tokens": result.usage.total_tokens or 0},
    }


def memory_handler(ctx, secret, model_alias):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, format, *args):
            # Memory inputs, shared secrets and model errors never enter access logs.
            return

        def reply(self, status, value):
            body = json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            self.reply(200 if self.path == "/healthz" else 404,
                       {"status": "ready", "scope": "loopback-memory-only"})

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.reply(404, {"error": "Unsupported endpoint"})
                return
            if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {secret}"):
                self.reply(401, {"error": "Authentication required"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                    raise ValueError("Invalid body size or encoding")
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError("Incomplete request body")
                payload = json.loads(body)
                response = complete_memory_request(ctx, payload, model_alias)
            except (ValueError, TypeError):
                self.reply(400, {"error": "Invalid or unsupported memory request"})
                return
            except Exception:
                self.reply(502, {"error": "Hermes memory completion unavailable; no fallback credential used"})
                return
            self.reply(200, response)
    return Handler


def serve_memory_llm(ctx):
    secret = read_private_secret(ctx.get_config("memory_secret_file", default=""))
    port = ctx.get_config("memory_port", default=8789)
    if isinstance(port, bool) or not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("Memory bridge port must be an unprivileged port")
    model_alias = ctx.get_config("memory_model_alias", default="hermes-memory")
    if not isinstance(model_alias, str) or not 1 <= len(model_alias) <= 200:
        raise ValueError("Invalid memory model alias")
    # Serial HTTPServer keeps calls in the CLI-bound profile context and caps concurrency at one.
    with HTTPServer(("127.0.0.1", port), memory_handler(ctx, secret, model_alias)) as server:
        server.serve_forever()
