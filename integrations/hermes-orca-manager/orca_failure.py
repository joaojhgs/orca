"""Finite failure hints only; never expose transport text or arbitrary RPC details."""
import json

CAPACITY_REASONS = {
    'Selected execution-host resources are unverifiable': 'resources_unverifiable',
    'Execution-host sample is stale, invalid or CPU capacity is contended': 'resources_unavailable',
    'Dispatch account is missing or ambiguous; choose an exact known provider/model and reconcile usage': 'account_ambiguous',
    'Dispatch quota is exhausted, stale or unverifiable; wait for a confirmed collector update': 'quota_unavailable',
    'Manager active-worker capacity reached; reconcile before launching': 'manager_worker_limit',
    'Workspace has a current or unverifiable agent session; inspect it before dispatching another writer': 'workspace_occupied',
    'Workspace capacity is occupied or unverifiable; reconcile before starting another worker': 'workspace_occupied',
    'Host/account editing-build capacity is reserved or insufficient; reconcile before dispatch': 'host_account_capacity',
    'Worker reservation is unverifiable; reconcile it before dispatch': 'reservation_unverifiable',
    'Worker placement is unverifiable; its capacity remains reserved': 'placement_unverifiable',
    'Worker inventory exceeds its bounded capacity check': 'inventory_unavailable',
}
FAILURE_CATEGORIES = {
    'manager_unauthorized': 'authority_unavailable',
    'manager_forbidden': 'authority_refused',
    'manager_consumer_fenced': 'consumer_fenced',
    'manager_consumer_busy': 'consumer_busy',
    'forbidden': 'authority_refused',
    'incompatible_runtime': 'runtime_incompatible',
    'runtime_unavailable': 'transport_unavailable',
    'runtime_access_denied': 'authority_unavailable',
    'request_mismatch': 'request_mismatch',
    'operation_unknown': 'outcome_unknown',
    'invalid_argument': 'invalid_arguments',
    'invalid_params': 'invalid_arguments',
}


class OrcaOperationError(RuntimeError):
    def __init__(self, code, category, reason=None):
        self.diagnostic = {'code': code, 'category': category}
        if reason:
            self.diagnostic['reason'] = reason
        advice = ('wait for the recorded capacity recovery, then recheck the original Task'
                  if category == 'capacity_wait' else 'reconcile before retrying')
        super().__init__(f'Orca manager operation unavailable ({category}); {advice}')


def classified_failure(raw, operation, maximum_bytes):
    if not isinstance(raw, str) or len(raw.encode('utf-8')) > maximum_bytes:
        return None
    try:
        response = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(response, dict) or response.get('ok') is not False:
        return None
    error = response.get('error')
    if not isinstance(error, dict) or not isinstance(error.get('code'), str):
        return None
    code = error['code']
    category = FAILURE_CATEGORIES.get(code)
    if not category:
        return None
    message = error.get('message')
    reason = CAPACITY_REASONS.get(message) if isinstance(message, str) else None
    if operation == 'worker-start' and code == 'manager_forbidden' and reason:
        return OrcaOperationError(code, 'capacity_wait', reason)
    return OrcaOperationError(code, category)
