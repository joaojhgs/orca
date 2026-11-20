"""Recovery timers, event backpressure and independent inventory monitoring."""
import json
import tempfile
import unittest
from unittest.mock import patch
from test_native_supervision import ns, Context, page


def session(state='working', summary='Building the authorized feature'):
    return {'agent': 'codex', 'state': state, 'summary': summary,
            'statusEvidence': 'current', 'executionContact': 'connected',
            'scope': {'projectId': 'aurora', 'executionHostId': 'ssh:worker',
                      'sessionId': 'original', 'sessionGeneration': 'original-generation'}}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.ctx = Context(self.directory.name)
        self.ctx.state.set(ns.KEY, {'cursor': {'journalId': 'journal', 'sequence': 0}})

    def ack(self, batch):
        return json.loads(ns.control(self.ctx, {'action': 'ack', 'batch_id': batch['id']}))

    def test_slow_triage_does_not_block_new_events_or_overwrite_receipts(self):
        first = ns.process_page(self.ctx, page(sequence=7), [])
        ns.process_page(self.ctx, page(sequence=8), [])
        state = self.ctx.state.get(ns.KEY)
        self.assertEqual(state['pending']['id'], first['id'])
        self.assertEqual(len(state['queued']), 1)
        self.assertEqual(state['cursor']['sequence'], 0)
        self.assertEqual(state['read_cursor']['sequence'], 8)
        self.assertTrue(self.ack(first)['ok'])
        second = self.ctx.state.get(ns.KEY)['pending']
        self.assertEqual(second['payload']['cursor']['sequence'], 8)
        self.assertTrue(self.ack(second)['ok'])
        self.assertEqual(self.ctx.state.get(ns.KEY)['cursor']['sequence'], 8)

    def test_full_queue_never_advances_past_unpersisted_events(self):
        for sequence in range(1, ns.MAX_QUEUED + 3):
            value = page(sequence=sequence * 40)
            value['events'] = [{**value['events'][0], 'sequence': (sequence - 1) * 40 + n}
                               for n in range(1, 41)]
            ns.process_page(self.ctx, value, [])
        state = self.ctx.state.get(ns.KEY)
        self.assertEqual(len(state['queued']), ns.MAX_QUEUED)
        self.assertEqual(state['read_cursor']['sequence'], (ns.MAX_QUEUED + 1) * 40)

    def test_event_burst_is_packed_without_changing_the_inflight_receipt(self):
        first = ns.process_page(self.ctx, page(sequence=1), [])
        for sequence in range(2, 15):
            ns.process_page(self.ctx, page(sequence=sequence), [])
        state = self.ctx.state.get(ns.KEY)
        self.assertEqual(state['pending']['id'], first['id'])
        self.assertEqual(len(state['queued']), 1)
        self.assertEqual(len(state['queued'][0]['payload']['events']), 13)
        self.assertEqual(state['read_cursor']['sequence'], 14)
        ns.process_page(self.ctx, page(sequence=8), [])
        self.assertEqual(self.ctx.state.get(ns.KEY)['read_cursor']['sequence'], 14)

    def test_repeated_metadata_reviews_cannot_starve_journal_events(self):
        first = ns.process_page(self.ctx, page(sequence=1), [])
        state = self.ctx.state.get(ns.KEY)
        for number in range(3):
            state.setdefault('queued', []).append({'id': str(number), 'advances_cursor': False,
                'payload': {'cursor': state['cursor'], 'gap': None, 'events': [], 'signals': [
                    {'kind': 'active-session-review', 'scope': session()['scope'],
                     'summary': str(number)}]}})
        self.assertTrue(ns.compact_metadata(state))
        self.assertEqual(state['pending']['id'], first['id'])
        self.assertEqual(len(state['queued']), 1)
        self.assertEqual(state['queued'][0]['payload']['signals'][0]['summary'], '2')
        self.ctx.state.set(ns.KEY, state)
        ns.process_page(self.ctx, page(sequence=2), [])
        self.assertEqual(self.ctx.state.get(ns.KEY)['read_cursor']['sequence'], 2)

    def test_replayed_page_does_not_duplicate_the_pending_batch(self):
        ns.process_page(self.ctx, page(), [])
        ns.process_page(self.ctx, page(), [])
        self.assertEqual(self.ctx.state.get(ns.KEY).get('queued', []), [])

    def test_quiet_poll_updates_contact_health_without_replaying_an_event(self):
        with patch.object(ns.time, 'time', return_value=1000):
            first = ns.process_page(self.ctx, page(), [])
        with patch.object(ns.time, 'time', return_value=1060):
            ns.process_page(self.ctx, page(), [])
        state = self.ctx.state.get(ns.KEY)
        self.assertEqual(state['last_read_at'], 1060)
        self.assertEqual(state['pending']['id'], first['id'])
        self.assertEqual(state.get('queued', []), [])

    def test_old_inflight_ack_during_hot_reload_cannot_strand_queued_events(self):
        ns.process_page(self.ctx, page(sequence=7), [])
        ns.process_page(self.ctx, page(sequence=8), [])
        state = self.ctx.state.get(ns.KEY)
        state['pending'] = None
        self.ctx.state.set(ns.KEY, state)
        prompt = ns.isolated_prompt(self.ctx, 1000)
        self.assertIn('Orca supervision wakeup', prompt)
        self.assertEqual(self.ctx.state.get(ns.KEY)['pending']['payload']['cursor']['sequence'], 8)

    def test_permission_and_capacity_recovery_progress_are_not_discarded(self):
        for kind in ('permission-wait', 'progress', 'failure', 'question'):
            self.assertIsNotNone(ns.batch_for(page(kind), []))

    def test_internal_no_reply_is_not_a_new_task_completion_event(self):
        event = page()
        event['events'][0]['summary'] = 'NO_REPLY'
        self.assertIsNone(ns.batch_for(event, []))

    def test_explicit_followup_survives_ack_and_wakes_without_new_events(self):
        first = ns.process_page(self.ctx, page(), [])
        args = {'action': 'defer', 'terminal': 'term_original', 'incarnation_id': 'inc-original',
                'reason': 'transient-provider', 'retry_after_seconds': 120}
        with patch.object(ns.time, 'time', return_value=1000):
            self.assertTrue(json.loads(ns.control(self.ctx, args))['ok'])
        self.ack(first)
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 1119)), {'wakeAgent': False})
        prompt = ns.isolated_prompt(self.ctx, 1120)
        self.assertIn('scheduled-session-recheck', prompt)
        self.assertIn('inc-original', prompt)
        pending = self.ctx.state.get(ns.KEY)['pending']
        self.ack(pending)
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 1121)), {'wakeAgent': False})
        cleared = dict(action='clear-followup', terminal='term_original', incarnation_id='inc-original')
        self.assertTrue(json.loads(ns.control(self.ctx, cleared))['cleared'])
        self.assertEqual(json.loads(ns.isolated_prompt(self.ctx, 9999)), {'wakeAgent': False})

    def test_transient_capacity_is_rechecked_with_backoff_and_recovers(self):
        item = session('waiting', 'The model is currently out of capacity. Try again later.')
        signals, prev = ns.monitoring_signals([item], [], {}, 1000, [])
        self.assertIn('retryable-stop-observed', [s['kind'] for s in signals])
        self.assertEqual(ns.monitoring_signals([item], [], prev, 1119, [])[0], [])
        signals, prev = ns.monitoring_signals([item], [], prev, 1120, [])
        self.assertEqual(signals[0]['kind'], 'retryable-stop-recheck')
        self.assertEqual(ns.monitoring_signals([item], [], prev, 1121, [])[0], [])
        signals, prev = ns.monitoring_signals([session()], [], prev, 1122, [])
        self.assertFalse(any('retry_at' in r for r in prev['sessions'].values()))

    def test_working_session_gets_bounded_progress_review_without_exit_event(self):
        signals, prev = ns.monitoring_signals([session()], [], {}, 1000, [])
        self.assertIn('active-session-review', [s['kind'] for s in signals])
        self.assertEqual(ns.monitoring_signals([session()], [], prev, 1001, [])[0], [])
        signals, _ = ns.monitoring_signals([session()], [], prev, 1900, [])
        self.assertIn('active-session-review', [s['kind'] for s in signals])

    def test_active_work_gets_a_three_hour_digest_check_without_turn_end(self):
        for state in ('working', 'waiting', 'blocked'):
            item = session(state)
            _, previous = ns.monitoring_signals([item], [], {}, 1000, [])
            signals, previous = ns.monitoring_signals([item], [], previous, 11799, [])
            self.assertNotIn('progress-digest-check', [s['kind'] for s in signals])
            signals, previous = ns.monitoring_signals([item], [], previous, 11800, [])
            digest = next(s for s in signals if s['kind'] == 'progress-digest-check')
            self.assertEqual(digest['intervalSeconds'], 10800)
            self.assertEqual(digest['projectIds'], ['aurora'])
            self.assertIn('successfully delivered', digest['instruction'])
            self.assertNotIn('progress-digest-check', [s['kind'] for s in
                             ns.monitoring_signals([item], [], previous, 11801, [])[0]])

    def test_progress_cadence_migrates_existing_daily_timer_and_can_be_configured(self):
        previous = {'last_daily_check_at': 1000}
        signals, previous = ns.monitoring_signals([session()], [], previous, 8200, [], 7200)
        self.assertIn('progress-digest-check', [s['kind'] for s in signals])
        self.assertEqual(previous['last_progress_check_at'], 8200)

    def test_no_progress_digest_for_finished_unconfirmed_hermes_or_excluded_work(self):
        for item, excluded in ((session('done'), []), (session('idle'), []),
                               (dict(session(), agent='hermes'), []),
                               (dict(session(), statusEvidence='unconfirmed'), []),
                               (session(), ['aurora'])):
            signals, _ = ns.monitoring_signals([item], [], {'last_progress_check_at': 0}, 50000, excluded)
            self.assertNotIn('progress-digest-check', [s['kind'] for s in signals])

    def test_existing_idle_agent_is_reviewed_once_without_authorizing_a_resume(self):
        item = session('idle', 'Existing objective needs reconciliation')
        signals, previous = ns.monitoring_signals([item], [], {}, 1000, [])
        review = next(s for s in signals if s['kind'] == 'initial-idle-session-review')
        self.assertIn('neither authorizes a resume nor proves completion', review['instruction'])
        self.assertEqual(ns.monitoring_signals([item], [], previous, 1001, [])[0], [])

    def test_event_policy_requires_action_verification_before_owner_escalation(self):
        prompt = ns.prompt_for(ns.batch_for(page(), []))
        self.assertIn('active-supervision-20261026-v1', prompt)
        self.assertIn('Choose and execute the next useful authorized action', prompt)
        self.assertIn('input_accepted/queued/acknowledged is NOT turn_started', prompt)
        self.assertIn('THREE HOURS', prompt)
        self.assertNotIn('24h', prompt)
        self.assertIn('NEVER resume', prompt)
        self.assertIn('Company implementation goes ONLY', prompt)

    def test_finished_or_unconfirmed_sessions_do_not_get_periodic_nudges(self):
        for item in (session('done'), dict(session(), statusEvidence='unconfirmed'),
                     dict(session(), agent='hermes')):
            self.assertEqual(ns.monitoring_signals([item], [], {}, 1000, [])[0], [])

    def test_usage_failure_does_not_silence_session_review(self):
        class Client:
            def call(self, operation, *args, **kwargs):
                if operation == 'usage':
                    raise RuntimeError('collector unavailable')
                return {'sessions': [session()], 'hasMore': False}
        with patch.object(ns.time, 'time', return_value=1000):
            ns.sample_monitoring(self.ctx, Client(), [])
        state = self.ctx.state.get(ns.KEY)
        self.assertEqual(state['pending']['payload']['signals'][0]['kind'], 'active-session-review')
        self.assertFalse(state['pending']['advances_cursor'])

    def test_session_read_names_actual_terminal_incarnations_not_hook_ids(self):
        with patch.object(ns, 'OrcaClient') as client:
            client.return_value.call.return_value = {'sessions': [
                {'terminal': 'term_original', 'incarnationId': 'pty-incarnation'}]}
            result = json.loads(ns.snapshot(self.ctx, {'limit': 10}))
        self.assertTrue(result['ok'])
        self.assertEqual(client.return_value.call.call_args.args[0], 'session-list')
        self.assertEqual(result['result']['sessions'][0]['incarnationId'], 'pty-incarnation')


if __name__ == '__main__':
    unittest.main()
