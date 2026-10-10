import importlib
import json
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import Mock, patch

package = types.ModuleType("orca_manager_tools_tests")
package.__path__ = [str(Path(__file__).parent)]
sys.modules[package.__name__] = package
tools = importlib.import_module(package.__name__ + ".manager_tools")
state_module = importlib.import_module(package.__name__ + ".manager_state")


class ToolTests(unittest.TestCase):
    def test_concurrent_mutations_use_distinct_ordered_durable_steps(self):
        with tempfile.TemporaryDirectory() as directory:
            database = str(Path(directory) / "state.db")
            def open_state():
                return state_module.ManagerState(sqlite3.connect(database))
            state = open_state()
            state.set("active_decision", {"id": "decision", "lease": {"generation": 1}, "step": 0})
            state.db.close()
            steps = []
            def act(*args, **kwargs):
                steps.append(kwargs["step"])
                time.sleep(0.03)
                return {"accepted": True}
            client = Mock()
            client.act.side_effect = act
            ready = threading.Barrier(2)
            def invoke(index):
                ready.wait(timeout=2)
                return json.loads(tools.handle(None, {"operation": "task-create",
                    "arguments": {"run": "owned", "spec": f"Task {index}"}}, True))
            with patch.object(tools, "open_manager_state", open_state), \
                 patch.object(tools, "client_from_context", return_value=client), \
                 ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(invoke, [1, 2]))
            self.assertTrue(all(result["ok"] for result in results))
            self.assertEqual(steps, [0, 1])
            state = open_state()
            self.assertEqual(state.get("active_decision")["step"], 2)
            self.assertEqual(state.db.execute("SELECT count(*) FROM decision_steps").fetchone()[0], 2)
            state.db.close()


if __name__ == "__main__":
    unittest.main()
