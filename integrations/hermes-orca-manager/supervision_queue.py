"""Bounded durable FIFO: a slow triage cannot hide newer events or lose its receipt."""
import hashlib
import json

MAX_QUEUED = 4


def ingestion_cursor(state):
    return state.get('read_cursor', state.get('cursor'))


def promote_pending(state):
    if not state.get('pending') and state.get('queued'):
        state['pending'] = state['queued'].pop(0)
        return True
    return False


def enqueue(state, batch):
    compact_metadata(state)
    promote_pending(state)
    existing = [b for b in [state.get('pending'), *state.get('queued', [])] if b]
    if any(b['id'] == batch['id'] for b in existing):
        return True
    if not state.get('pending'):
        state['pending'] = batch
    elif merge_queued_events(state.get('queued', []), batch):
        return True
    elif len(state.get('queued', [])) < MAX_QUEUED:
        state.setdefault('queued', []).append(batch)
    else:
        return False
    return True


def merge_queued_events(queue, batch):
    if not queue or not batch.get('advances_cursor', True):
        return False
    previous = queue[-1]
    left, right = previous['payload'], batch['payload']
    if (not previous.get('advances_cursor', True) or left.get('gap') or right.get('gap')
            or left.get('signals') or right.get('signals')
            or left['cursor']['journalId'] != right['cursor']['journalId']
            or len(left['events']) + len(right['events']) > 40):
        return False
    payload = dict(right, events=left['events'] + right['events'])
    identifier = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    queue[-1] = dict(batch, id=identifier, payload=payload)
    return True


def compact_metadata(state):
    queue = state.get('queued', [])
    changed, target = False, None
    kept = []
    for batch in queue:
        payload = batch['payload']
        if (batch.get('advances_cursor', True) or payload.get('events') or payload.get('gap')):
            kept.append(batch)
            continue
        if target is None or target['payload']['cursor']['journalId'] != payload['cursor']['journalId']:
            target = batch
            kept.append(batch)
            continue
        signals = {}
        for signal in target['payload'].get('signals', []) + payload.get('signals', []):
            key = json.dumps([signal.get(k) for k in ('kind', 'scope', 'terminal', 'incarnation_id',
                                                       'accountId', 'bucket', 'requestId', 'projectIds')], sort_keys=True)
            signals[key] = signal
        if len(signals) > 40:
            target = batch
            kept.append(batch)
            continue
        merged = dict(payload, signals=list(signals.values()))
        target.update(id=hashlib.sha256(json.dumps(merged, sort_keys=True).encode()).hexdigest(),
                      payload=merged)
        changed = True
    if changed:
        state['queued'] = kept
    return changed


def acknowledge(state, batch):
    if batch.get('advances_cursor', True):
        state['cursor'] = batch['payload']['cursor']
    queue = state.get('queued', [])
    state['pending'] = queue.pop(0) if queue else None
    state['queued'] = queue
    if not state['pending'] and state.get('read_cursor'):
        state['cursor'] = state['read_cursor']
