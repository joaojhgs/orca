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

    def complete_decision(self, identifier, result, session_id):
        with self.db:
            changed = self.db.execute("UPDATE decisions SET status='completed',result_json=?,session_id=? WHERE id=? AND status='pending'",
                                      (json.dumps(result), session_id, identifier)).rowcount
            if not changed:
                raise ValueError("Decision is missing or already completed")

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


def open_manager_state():
    from plugins.plugin_storage import plugin_db
    return ManagerState(plugin_db("orca-manager"))
