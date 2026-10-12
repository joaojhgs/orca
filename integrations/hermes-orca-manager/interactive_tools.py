"""Scoped delegation from normal Hermes sessions, using Orca's durable receipts."""
import json
import re
import uuid
from pathlib import Path
from threading import Event, Lock, Thread
from .manager_tools import schema, client_from_context
from .orca_client import OrcaClient, READ_OPERATIONS, WRITE_OPERATIONS, CONTROL_OPERATIONS, validated_arguments
from .orca_failure import OrcaOperationError

LOCK = Lock()


def maintain_lease(client, lease, stopped, failed):
    while not stopped.wait(15):
        try:
            result = client.call('renew', {'lease': lease, 'duration-ms': 60000}, CONTROL_OPERATIONS, timeout=15)
            if not isinstance(result, dict) or result.get('renewed') is not True:
                raise RuntimeError('Lease renewal was not confirmed')
        except Exception:
            failed.set()
            return


def profile_client(ctx, name):
    if name is None:
        return client_from_context(ctx)
    if ctx.get_config('enable_cross_profile_delegation', default=False) is not True:
        raise ValueError('This profile may not borrow another profile delegation identity')
    from hermes_constants import get_hermes_home
    home = Path(get_hermes_home()).resolve()
    if home.name != 'coordinator' or home.parent.name != 'profiles' or name not in {'personal', 'coding', 'work', 'coordinator'}:
        raise ValueError('Only Coordinator can explicitly select an approved profile identity')
    return OrcaClient(ctx.get_config('orca_executable', default=''), str(home.parent / name / 'orca-manager.credential'))


def enforce_company_route(ctx, client, operation, values):
    if operation in {'session-read', 'session-guide'}:
        sessions, offset = [], 0
        while True:
            page = client.inspect('session-list', {'offset': offset, 'limit': 200})
            sessions.extend(page.get('sessions', []))
            next_offset = page.get('nextOffset')
            if next_offset is None:
                if page.get('truncated'):
                    raise ValueError('Session inventory incomplete; reconcile before guidance')
                break
            if next_offset <= offset or next_offset > 10000:
                raise ValueError('Session inventory pagination is unverifiable')
            offset = next_offset
        matches = [s for s in sessions if s.get('terminal') == values['terminal'] and s.get('incarnationId') == values['incarnation-id']]
        if len(matches) != 1:
            raise ValueError('Re-list sessions: addressed incarnation is not uniquely current')
        session = matches[0]
        scope = session['scope']
        company = scope.get('projectId') in ctx.get_config('work_project_ids', default=[])
        company_host = scope.get('executionHostId') == 'ssh:ssh-sem-notebook-work'
        if company != company_host:
            raise ValueError('Company session/project execution boundary does not match')
        if company and operation == 'session-read':
            raise ValueError('Company raw output stays with company Claude; use scoped session/event metadata')
        if company and session.get('agent') != 'claude':
            raise ValueError('Company guidance is only allowed to the company Claude session')
        if session.get('agent') == 'hermes':
            raise ValueError('Use explicit cross-profile conversation tools for Hermes, not self-guidance')
        return
    if operation != 'worker-start':
        return
    owned = client.inspect('run-show', {'run': values['run']})
    project = owned['scope'].get('projectId')
    company = ctx.get_config('work_project_ids', default=[])
    locations = client.inspect('placements', {'limit': 200})['items']
    location = next((x for x in locations if x['workspaceId'] == values['workspace-id']), None)
    if not project or not location or location.get('scope', {}).get('projectId') != project:
        raise ValueError('Worker placement must match the Run canonical project exactly')
    if project not in company and location['executionHostId'] == 'ssh:ssh-sem-notebook-work':
        raise ValueError('Personal/university work must never use the company Work host')
    if project in company:
        if values['agent'] != 'claude':
            raise ValueError('Company work must use the company Claude runtime')
        if not location or location['executionHostId'] != 'ssh:ssh-sem-notebook-work':
            raise ValueError('Company execution must stay on notebook Work')


def handle(ctx, args, mutate=False):
    lease = None
    client = None
    try:
        if ctx.get_config('enable_interactive_tools', default=False) is not True:
            raise ValueError('Interactive delegation is disabled for this profile')
        keys = {'operation', 'arguments', 'request-id'} if mutate else {'operation', 'arguments'}
        if not isinstance(args, dict) or not keys <= set(args) or set(args) - keys - {'profile'}:
            raise ValueError('Use typed operation/arguments and a stable request-id for mutations')
        operation, values = args['operation'], args['arguments']
        validated_arguments(operation, values, WRITE_OPERATIONS if mutate else READ_OPERATIONS)
        client = profile_client(ctx, args.get('profile'))
        if not mutate:
            enforce_company_route(ctx, client, operation, values)
            result = client.inspect(operation, values)
        else:
            request = args['request-id']
            if not isinstance(request, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{8,200}', request):
                raise ValueError('Preserve an 8–200 character request-id when retrying the same action')
            with LOCK:
                enforce_company_route(ctx, client, operation, values)
                response = client.call('claim', {'consumer': 'interactive:' + uuid.uuid4().hex, 'duration-ms': 60000}, CONTROL_OPERATIONS)
                lease = response['lease']
                stopped, failed = Event(), Event()
                renewal = Thread(target=maintain_lease, args=(client, lease, stopped, failed), daemon=True)
                renewal.start()
                try:
                    result = client.act(operation, values, lease=lease, decision_id='interactive:' + request)
                finally:
                    stopped.set()
                    renewal.join(timeout=16)
                    client.call('release', {'lease': lease}, CONTROL_OPERATIONS)
                    lease = None
        return json.dumps({'ok': True, 'actingProfile': args.get('profile', 'current'), 'result': result}, ensure_ascii=False)
    except OrcaOperationError as error:
        return json.dumps({'ok': False, 'error': str(error), **error.diagnostic})
    except ValueError as error:
        return json.dumps({'ok': False, 'error': str(error)})
    except Exception:
        return json.dumps({'ok': False, 'unconfirmed': True, 'error': 'Reconcile using read tools and the same request-id; do not launch a replacement or borrow owner credentials'})


def register_interactive_tools(ctx):
    def enabled():
        return ctx.get_config('enable_interactive_tools', default=False) is True
    for mutate, name, operations, description in [
        (False, 'orca_dispatch_read', READ_OPERATIONS,
         'Inspect ALL registered sessions in granted projects regardless of who started them: session-list and incarnation-fenced session-read. Also inspect placements, usage, resources and owned Runs/tasks/workers. Company raw output remains with company Claude; use session/event metadata. Keep returned identities/cursors; disconnection is not exit.'),
        (True, 'orca_dispatch_act', WRITE_OPERATIONS,
         'Supervise ALL existing approved coding sessions with session-guide using terminal and incarnation-id from session-list, including owner-started roots and monitors; no Run or Dispatch is required and ownership stays unchanged. Do not create a competing worker in an occupied workspace. Use owned Run/Task APIs for new delegation. Reuse request-id only for the exact same action. Company guidance/execution must stay on notebook Work Claude. No host/account administration, interrupts or worker stopping.'),
    ]:
        definition = schema(name, description, operations)
        definition['parameters']['properties']['profile'] = {'type': 'string', 'enum': ['personal', 'coding', 'work', 'coordinator'], 'description': 'Coordinator only: explicitly address another profile-owned Run. Omit to use the current profile.'}
        if mutate:
            definition['parameters']['properties']['request-id'] = {'type': 'string', 'minLength': 8, 'maxLength': 200}
            definition['parameters']['required'].append('request-id')
        ctx.register_tool(name=name, toolset='orca_dispatch', schema=definition,
                          handler=lambda args, mutate=mutate, **kwargs: handle(ctx, args, mutate), check_fn=enabled)
