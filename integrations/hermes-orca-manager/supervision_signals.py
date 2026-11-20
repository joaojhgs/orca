"""Bounded metadata checks complement events; signals never authorize an action."""
import hashlib
import json
import re

RETRYABLE = re.compile(
    r'currently\s+(?:out of|at)\s+capacity|servers?\s+(?:are\s+)?(?:currently\s+)?overloaded|'
    r'temporar(?:ily|y).{0,40}(?:unavailable|capacity)|model.{0,35}(?:overloaded|at capacity)|'
    r'rate[ -]?limit|usage limit|quota.{0,20}(?:exhaust|reset)|try again (?:later|in)', re.I)


def session_checks(sessions, previous, now, excluded):
    tracked, signals = {}, []
    for session in sessions:
        scope = session.get('scope', {})
        if (scope.get('projectId') in excluded or session.get('agent') in (None, 'hermes')
                or session.get('statusEvidence') == 'unconfirmed'):
            continue
        identity = scope.get('sessionId') or session.get('terminalId') or session.get('terminal')
        if not identity:
            continue
        key = json.dumps([scope.get('executionHostId'), identity, scope.get('sessionGeneration')])
        old = previous.get('sessions', {}).get(key, {})
        state = session.get('state')
        summary = session.get('summary', '')[:1800]
        fingerprint = hashlib.sha256(json.dumps([state, summary]).encode()).hexdigest()
        record = dict(old, fingerprint=fingerprint, state=state, seen_at=now)
        connected = session.get('executionContact') == 'connected'
        retryable = bool(RETRYABLE.search(summary))
        changed = old.get('fingerprint') != fingerprint
        if connected and retryable:
            if changed:
                record.update(retry_at=now + 120, retry_count=0)
                signals.append({'kind': 'retryable-stop-observed', 'scope': scope,
                                'summary': summary, 'state': state})
            elif now >= old.get('retry_at', now):
                count = old.get('retry_count', 0) + 1
                record.update(retry_count=count, retry_at=now + min(1800, 120 * 2 ** min(count, 4)))
                signals.append({'kind': 'retryable-stop-recheck', 'scope': scope,
                                'summary': summary, 'state': state, 'attempt': count})
        elif not retryable:
            record.pop('retry_at', None)
            record.pop('retry_count', None)
        if connected and state in {'working', 'waiting', 'blocked'}:
            if now - old.get('review_at', 0) >= 900:
                signals.append({'kind': 'active-session-review', 'scope': scope,
                                'summary': summary, 'state': state,
                                'instruction': 'Check original objective, live terminal, monitor and '
                                'durable milestones. Never interrupt busy work or resume a '
                                'completed/cancelled objective.'})
                record['review_at'] = now
        elif connected and state == 'idle' and not old:
            signals.append({'kind': 'initial-idle-session-review', 'scope': scope,
                            'summary': summary, 'state': state,
                            'instruction': 'Read original objective and current terminal to distinguish '
                            'unfinished recoverable work from completed or owner-paused work. '
                            'An idle label alone neither authorizes a resume nor proves completion.'})
        elif connected and changed and old and state in {'done', 'idle'}:
            signals.append({'kind': 'session-stop-review', 'scope': scope, 'state': state,
                            'summary': summary})
        tracked[key] = record
    return signals, tracked
