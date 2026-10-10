"""Delivery/decision receipts only. Orca remains the authoritative task/Run store."""
from __future__ import annotations

import json
import sqlite3


class ManagerState:
    def __init__(self, connection):
        self.db = connection
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS adapter_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS decisions (
                id TEXT PRIMARY KEY, input_json TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'completed')),
                result_json TEXT, session_id TEXT);
            CREATE TABLE IF NOT EXISTS objective_inbox (
                id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, objective TEXT NOT NULL,
                decision_id TEXT REFERENCES decisions(id));
            CREATE TABLE IF NOT EXISTS decision_steps (
                decision_id TEXT NOT NULL, step INTEGER NOT NULL, input_json TEXT NOT NULL,
                PRIMARY KEY(decision_id, step));
            CREATE TABLE IF NOT EXISTS objective_sessions (
                run_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, completed_decisions INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS decision_step_results (
                decision_id TEXT NOT NULL, step INTEGER NOT NULL, result_json TEXT NOT NULL,
                PRIMARY KEY(decision_id, step));
        """)

    def get(self, key, default=None):
        row = self.db.execute("SELECT value FROM adapter_state WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self.db:
            self.db.execute("INSERT INTO adapter_state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                            (key, json.dumps(value)))

    def begin_decision(self, identifier, payload):
        encoded = json.dumps(payload, sort_keys=True)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO decisions(id,input_json,status) VALUES (?,?,'pending')", (identifier, encoded))
            row = self.db.execute("SELECT input_json,status,result_json,session_id FROM decisions WHERE id=?", (identifier,)).fetchone()
            if row[0] != encoded:
                raise ValueError("Decision ID input mismatch")
        return {"payload": json.loads(row[0]), "completed": row[1] == "completed",
                "result": json.loads(row[2]) if row[2] else None, "session_id": row[3]}

    def complete_decision(self, identifier, result, session_id, run_id):
        with self.db:
            row = self.db.execute("SELECT input_json FROM decisions WHERE id=?", (identifier,)).fetchone()
            if not row or json.loads(row[0]).get("runId") != run_id:
                raise ValueError("Decision has another objective context")
            changed = self.db.execute("UPDATE decisions SET status='completed',result_json=?,session_id=? WHERE id=? AND status='pending'",
                                      (json.dumps(result), session_id, identifier)).rowcount
            if not changed:
                raise ValueError("Decision is missing or already completed")
            self.db.execute("""INSERT INTO objective_sessions VALUES (?,?,1)
                ON CONFLICT(run_id) DO UPDATE SET session_id=excluded.session_id,
                completed_decisions=CASE WHEN objective_sessions.session_id=excluded.session_id
                    THEN objective_sessions.completed_decisions+1 ELSE 1 END""", (run_id, session_id))

    def session_for_run(self, run_id, max_decisions=12):
        row = self.db.execute("SELECT session_id,completed_decisions FROM objective_sessions WHERE run_id=?", (run_id,)).fetchone()
        return row[0] if row and row[1] < max_decisions else None

    def enqueue_objective(self, identifier, workspace_id, objective):
        with self.db:
            row = self.db.execute("SELECT workspace_id,objective FROM objective_inbox WHERE id=?", (identifier,)).fetchone()
            if row and tuple(row) != (workspace_id, objective):
                raise ValueError("Objective ID input mismatch")
            self.db.execute("INSERT OR IGNORE INTO objective_inbox(id,workspace_id,objective) VALUES (?,?,?)", (identifier, workspace_id, objective))

    def pending_objectives(self):
        return [{"id": row[0], "workspaceId": row[1], "objective": row[2]}
                for row in self.db.execute("SELECT id,workspace_id,objective FROM objective_inbox WHERE decision_id IS NULL ORDER BY rowid LIMIT 20")]

    def mark_objectives_delivered(self, identifiers, decision_id):
        with self.db:
            for identifier in identifiers:
                self.db.execute("UPDATE objective_inbox SET decision_id=? WHERE id=? AND decision_id IS NULL", (decision_id, identifier))

    def admit_step(self, decision_id, step, operation, values):
        encoded = json.dumps([operation, values], sort_keys=True)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO decision_steps VALUES (?,?,?)", (decision_id, step, encoded))
            previous = self.db.execute("SELECT input_json FROM decision_steps WHERE decision_id=? AND step=?", (decision_id, step)).fetchone()[0]
            if previous != encoded:
                raise ValueError("Restarted decision changed an already-admitted action; reconcile and request human review")

    def step_result(self, decision_id, step):
        row = self.db.execute("SELECT result_json FROM decision_step_results WHERE decision_id=? AND step=?",
                              (decision_id, step)).fetchone()
        return {"result": json.loads(row[0])} if row else None

    def finish_step(self, active, step, result):
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO decision_step_results VALUES (?,?,?)",
                            (active["id"], step, json.dumps(result)))
            current = self.get("active_decision") or {}
            if (current.get("invocationId") != active["invocationId"] or
                    current.get("id") != active["id"] or current.get("runId") != active["runId"] or
                    current.get("step", 0) != step):
                return False
            self.db.execute("UPDATE adapter_state SET value=? WHERE key='active_decision'",
                            (json.dumps({**current, "step": step + 1}),))
        return True


def open_manager_state():
    from plugins.plugin_storage import plugin_db
    return ManagerState(plugin_db("orca-manager"))
