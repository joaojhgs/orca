import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import threading
import unittest
import sys
import types
from unittest.mock import Mock
from http.client import HTTPConnection
from http.server import HTTPServer

package = types.ModuleType("orca_memory_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
spec = importlib.util.spec_from_file_location("orca_memory_tests.memory_llm", Path(__file__).with_name("memory_llm.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MemoryBridgeTests(unittest.TestCase):
    def context(self, text="Remember the operational rule"):
        usage = SimpleNamespace(input_tokens=1, output_tokens=2, total_tokens=3)
        result = SimpleNamespace(text=text, usage=usage, parsed=None)
        return SimpleNamespace(llm=SimpleNamespace(
            complete=Mock(return_value=result), complete_structured=Mock(return_value=result)))

    def test_host_owned_bounded_completion_has_no_route_or_auth_overrides(self):
        ctx = self.context()
        result = module.complete_memory_request(ctx, {
            "model": "hermes-memory", "messages": [{"role": "user", "content": "Recall"}],
            "max_tokens": 20_000
        }, "hermes-memory")
        self.assertEqual(result["choices"][0]["message"]["content"], "Remember the operational rule")
        kwargs = ctx.llm.complete.call_args.kwargs
        self.assertEqual(kwargs["max_tokens"], 4096)
        self.assertEqual(kwargs["timeout"], 90)
        self.assertFalse(set(kwargs) & {"provider", "model", "profile", "agent_id", "api_key", "task"})

    def test_structured_memory_uses_the_supported_json_lane(self):
        ctx = self.context('{"facts": ["Preserve live workers"]}')
        result = module.complete_memory_request(ctx, {
            "model": "hermes-memory", "messages": [{"role": "system", "content": "Extract facts"}],
            "response_format": {"type": "json_object"}
        }, "hermes-memory")
        self.assertEqual(json.loads(result["choices"][0]["message"]["content"])["facts"],
                         ["Preserve live workers"])
        ctx.llm.complete.assert_not_called()
        self.assertTrue(ctx.llm.complete_structured.call_args.kwargs["json_mode"])

    def test_json_schema_is_passed_to_host_validation_without_selecting_another_model(self):
        ctx = self.context('{"facts": []}')
        schema = {"type": "object", "properties": {"facts": {"type": "array"}}}
        module.complete_memory_request(ctx, {
            "model": "hermes-memory", "messages": [{"role": "user", "content": "Extract"}],
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "facts", "schema": schema, "strict": True
            }}
        }, "hermes-memory")
        self.assertEqual(ctx.llm.complete_structured.call_args.kwargs["json_schema"], schema)

    def test_forced_memory_function_is_json_shaping_not_a_hermes_tool_execution(self):
        ctx = self.context('{"facts": ["Preserve live workers"]}')
        result = module.complete_memory_request(ctx, {
            "model": "hermes-memory", "messages": [{"role": "user", "content": "Extract facts"}],
            "tools": [{"type": "function", "function": {"name": "response", "parameters": {"type": "object", "properties": {"facts": {"type": "array"}}}}}],
            "tool_choice": "required"
        }, "hermes-memory")
        function = result["choices"][0]["message"]["tool_calls"][0]["function"]
        self.assertEqual(function["name"], "response")
        self.assertEqual(json.loads(function["arguments"])["facts"], ["Preserve live workers"])
        self.assertEqual(result["choices"][0]["finish_reason"], "tool_calls")
        ctx.llm.complete.assert_not_called()
        self.assertFalse(set(ctx.llm.complete_structured.call_args.kwargs) & {"tools", "provider", "model", "api_key"})

    def test_memory_reflection_accepts_memory_history_and_can_finish_without_another_call(self):
        ctx = self.context('{"calls": [], "text": "Preserve active workers"}')
        result = module.complete_memory_request(ctx, {
            "model": "hermes-memory", "messages": [{"role": "tool", "tool_call_id": "call1", "content": "Relevant memory"}],
            "tools": [{"type": "function", "function": {"name": "recall", "parameters": {"type": "object"}}}],
            "tool_choice": "auto"
        }, "hermes-memory")
        self.assertEqual(result["choices"][0]["message"]["content"], "Preserve active workers")
        self.assertNotIn("tool_calls", result["choices"][0]["message"])

    def test_arbitrary_function_names_parallel_selection_and_route_override_are_refused(self):
        ctx = self.context()
        base = {"model": "hermes-memory", "messages": [{"role": "user", "content": "Recall"}],
                "tools": [{"type": "function", "function": {"name": "recall", "parameters": {"type": "object"}}}]}
        for override in ({"tools": [{"type": "function", "function": {"name": "terminal", "parameters": {}}}]},
                         {"parallel_tool_calls": True}, {"tool_choice": {"type": "function", "function": {"name": "undeclared"}}},
                         {"account": "other"}, {"response_format": {"type": "json_object"}}):
            with self.assertRaises(ValueError):
                module.complete_memory_request(ctx, {**base, **override}, "hermes-memory")
        ctx.llm.complete_structured.assert_not_called()

    def test_route_tool_stream_and_oversized_message_shapes_are_refused_before_model_calls(self):
        ctx = self.context()
        base = {"model": "hermes-memory", "messages": [{"role": "user", "content": "Test"}]}
        for override in ({"provider": "paid"}, {"model": "other"}, {"tools": []},
                         {"stream": True}, {"messages": []}, {"messages": [{"role": "tool", "content": "x"}]},
                         {"max_tokens": True}, {"temperature": float("nan")}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                module.complete_memory_request(ctx, {**base, **override}, "hermes-memory")
        ctx.llm.complete.assert_not_called()
        ctx.llm.complete_structured.assert_not_called()

    def test_http_authentication_and_route_boundary_never_invokes_the_model_on_refusal(self):
        ctx = self.context()
        with HTTPServer(("127.0.0.1", 0), module.memory_handler(ctx, "x" * 48, "hermes-memory")) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
                body = json.dumps({"model": "hermes-memory", "messages": [{"role": "user", "content": "Recall"}]})
                for path, headers, status in (
                        ("/v1/chat/completions", {}, 401),
                        ("/v1/chat/completions", {"Authorization": "Bearer wrong"}, 401),
                        ("/v1/other", {"Authorization": "Bearer " + "x" * 48}, 404)):
                    connection.request("POST", path, body, headers)
                    response = connection.getresponse()
                    self.assertEqual(response.status, status)
                    response.read()
                ctx.llm.complete.assert_not_called()
                connection.request("POST", "/v1/chat/completions", body,
                                   {"Authorization": "Bearer " + "x" * 48})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())["choices"][0]["message"]["content"],
                                 "Remember the operational rule")
                connection.close()
            finally:
                server.shutdown()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())

    @unittest.skipIf(os.name == "nt", "POSIX permissions and symlinks")
    def test_private_secret_rejects_public_files_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "key"
            key.write_text("x" * 48)
            key.chmod(0o600)
            self.assertEqual(module.read_private_secret(key), "x" * 48)
            key.chmod(0o644)
            with self.assertRaises(ValueError):
                module.read_private_secret(key)
            key.chmod(0o600)
            link = Path(directory) / "link"
            link.symlink_to(key)
            with self.assertRaises(OSError):
                module.read_private_secret(link)


if __name__ == "__main__":
    unittest.main()
