"""Isolated wakeups retain receipts without touching a human conversation."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest

ROOT = Path(__file__).parent
PACKAGE = 'supervision_fixture'
module = ModuleType(PACKAGE)
module.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = module
spec = importlib.util.spec_from_file_location(PACKAGE + '.native_supervision', ROOT / 'native_supervision.py')
ns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ns)


class State:
    def __init__(self, directory):
        self.data_dir, self.data = Path(directory), {}

    def get(self, key, default=None):
        return json.loads(json.dumps(self.data.get(key, default)))

    def set(self, key, value):
        self.data[key] = json.loads(json.dumps(value))


class Context:
    def __init__(self, directory):
        self.state, self.injections = State(directory), []
        self.settings = {'enable_native_supervision': True, 'native_isolated_events': True}

    def get_config(self, key, default=None):
        return self.settings.get(key, default)

    def inject_message(self, *args, **kwargs):
        self.injections.append((args, kwargs))
        return True


def page(kind='turn-complete', sequence=7):
    return {'cursor': {'journalId': 'journal', 'sequence': sequence}, 'gap': None,
            'events': [{'kind': kind, 'scope': {'actor': 'worker', 'projectId': 'aurora'},
                        'summary': 'untrusted evidence'}]}


class IsolatedTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ctx = Context(self.directory.name)

    def test_idle_preflight_does_not_wake_model(self):
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 1000)), {'wakeAgent': False})

    def test_owner_review_is_idempotent_and_cannot_overwrite_a_real_batch(self):
        self.ctx.state.set(ns.KEY, {'cursor': page()['cursor']})
        result = json.loads(ns.queue_review(self.ctx, 'owner-review-20261013'))
        self.assertTrue(result['ok'])
        self.assertTrue(json.loads(ns.queue_review(self.ctx, 'owner-review-20261013'))['duplicate'])
        self.assertFalse(json.loads(ns.queue_review(self.ctx, 'other-review-20261013'))['ok'])
        self.assertIn('ALL running sessions', ns.isolated_prompt(self.ctx, 1000))

    def test_isolated_admission_never_injects_human_chat(self):
        ns.process_page(self.ctx, page(), [])
        self.assertFalse(ns.admit_pending(self.ctx, {'profile': 'coding'}))
        self.assertEqual(self.ctx.injections, [])

    def test_receipt_retry_is_bounded_and_ack_is_exact(self):
        batch = ns.process_page(self.ctx, page(), [])
        self.assertIn(batch['id'], ns.isolated_prompt(self.ctx, 1000))
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 1001)), {'wakeAgent': False})
        self.assertIn(batch['id'], ns.isolated_prompt(self.ctx, 1900))
        self.assertFalse(json.loads(ns.control(self.ctx, {'action': 'ack', 'batch_id': 'wrong'}))['ok'])
        ack = {'action': 'ack', 'batch_id': batch['id']}
        self.assertTrue(json.loads(ns.control(self.ctx, ack))['ok'])
        self.assertTrue(json.loads(ns.control(self.ctx, ack))['ok'])
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 2000)), {'wakeAgent': False})

    def test_pending_receipt_cannot_be_overwritten(self):
        first = ns.process_page(self.ctx, page(), [])
        self.assertEqual(ns.process_page(self.ctx, page(sequence=8), [])['id'], first['id'])

    def test_contact_flapping_is_silent_but_real_results_wake(self):
        for kind in ('contact-lost', 'contact-restored'):
            self.assertIsNone(ns.process_page(self.ctx, page(kind), []))
        self.assertIsNotNone(ns.process_page(self.ctx, page('dispatch-settled'), []))

    def test_gap_not_hidden_by_contact_filter(self):
        value = page('contact-lost'); value['gap'] = 'journal-replaced'
        self.assertIsNotNone(ns.process_page(self.ctx, value, []))

    def test_large_page_never_acknowledges_events_omitted_from_prompt(self):
        value = page(sequence=80)
        value['events'] = [{**value['events'][0], 'sequence': n} for n in range(1,81)]
        batch = ns.process_page(self.ctx, value, [])
        self.assertEqual(len(batch['payload']['events']), 40)
        self.assertEqual(batch['payload']['cursor']['sequence'], 40)

    def test_legacy_accepted_turn_is_not_immediately_duplicated(self):
        ns.process_page(self.ctx, page(), [])
        state = self.ctx.state.get(ns.KEY)
        state['pending'].update(admission='accepted', accepted_at=950)
        self.ctx.state.set(ns.KEY, state)
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 1000)), {'wakeAgent': False})
        self.assertIn(state['pending']['id'], ns.isolated_prompt(self.ctx, 1850))

    def test_contact_only_notifies_after_five_minutes_then_recovery_once(self):
        session = {'terminalId': 'root', 'state': 'working', 'executionContact': 'disconnected',
                   'scope': {'projectId': 'aurora'}}
        signals, previous = ns.monitoring_signals([session], [], {}, 1000, [])
        self.assertEqual(signals, [])
        signals, previous = ns.monitoring_signals([session], [], previous, 1299, [])
        self.assertEqual(signals, [])
        signals, previous = ns.monitoring_signals([session], [], previous, 1300, [])
        self.assertEqual(signals[0]['verdict'], 'unverifiable')
        self.assertEqual(ns.monitoring_signals([session], [], previous, 1400, [])[0], [])
        session['executionContact'] = 'connected'
        signals, previous = ns.monitoring_signals([session], [], previous, 1401, [])
        self.assertEqual(signals[0]['kind'], 'contact-recovered')
        self.assertEqual(ns.monitoring_signals([session], [], previous, 1402, [])[0], [])

    def test_finished_session_does_not_generate_contact_notifications(self):
        session={'terminalId':'finished','state':'idle','executionContact':'unverifiable',
                 'scope':{'projectId':'aurora'}}
        self.assertEqual(ns.monitoring_signals([session], [], {'contacts': {
            json.dumps([None,'finished']):{'first_lost_at':0}}}, 1000, [])[0], [])

    def test_excluded_project_never_emits_contact_or_result_wakeup(self):
        self.assertIsNone(ns.process_page(self.ctx, page(), ['aurora']))
        self.assertEqual(ns.monitoring_signals([{'terminalId':'x','executionContact':'disconnected',
            'scope':{'projectId':'aurora'}}], [], {}, 1000, ['aurora'])[0], [])


if __name__ == '__main__':
    unittest.main()
