"""Standard agent CLI access, separate from the event-reader service identity."""
import json
import os
import re
import subprocess


def enabled(ctx):
    return ctx.get_config('use_standard_cli', default=False) is True


READ_COMMANDS = {('terminal', 'list'), ('terminal', 'show'), ('terminal', 'read'),
                 ('worktree', 'ps'), ('repo', 'list'), ('account', 'usage'),
                 *{('orchestration', name) for name in ('run-list', 'run-show', 'task-list',
                     'worker-list', 'worker-show', 'worker-read', 'inbox', 'receipt')}}


def selected_value(value, path):
    if not path:
        return value
    key, *remaining = path.split('.')
    many = key.endswith('[]')
    key = key[:-2] if many else key
    if not isinstance(value, dict) or key not in value:
        return None
    child = value[key]
    if many:
        if not isinstance(child, list):
            return None
        return [selected_value(item, '.'.join(remaining)) for item in child]
    return selected_value(child, '.'.join(remaining))


def execute(ctx, argv, runner=subprocess.run, select=None):
    executable = ctx.get_config('orca_public_executable', default='')
    if not enabled(ctx) or not os.path.isabs(executable):
        raise ValueError('Standard Orca CLI is not configured for this profile')
    if (not isinstance(argv, list) or not 1 <= len(argv) <= 128
            or any(not isinstance(v, str) or not v or len(v) > 32768 or '\0' in v for v in argv)):
        raise ValueError('Pass Orca arguments as argv, without a shell or executable')
    if select is not None:
        if (tuple(argv[:2]) not in READ_COMMANDS or not isinstance(select, list)
                or not 1 <= len(select) <= 24 or any(not isinstance(path, str)
                    or len(path) > 180 or not re.fullmatch(r'[A-Za-z_][\w]*(?:\[\])?(?:\.[A-Za-z_][\w]*(?:\[\])?)*', path)
                    for path in select)):
            raise ValueError('Select needs bounded dotted field paths on a read-only command')
    environment = os.environ.copy()
    environment.pop('ORCA_MANAGER_TOKEN', None)
    environment.pop('ORCA_MANAGER_CREDENTIAL_FILE', None)
    result = runner([executable, *argv, *([] if '--json' in argv else ['--json'])],
                    env=environment, capture_output=True, text=True, timeout=130,
                    check=False, shell=False)
    if len(result.stdout.encode()) > 2 * 1024 * 1024:
        raise ValueError('Response exceeds transport budget; use pagination or a smaller limit')
    try:
        response = json.loads(result.stdout)
    except ValueError:
        if len(result.stdout.encode()) > 256 * 1024:
            raise ValueError('Response exceeds read budget; use pagination or a smaller limit')
        response = {'ok': result.returncode == 0, 'output': result.stdout[:24000]}
    ok = result.returncode == 0 and isinstance(response, dict) and response.get('ok') is not False
    if select is not None and ok:
        response = {'ok': True, 'result': {path: selected_value(response, path) for path in select},
                    '_meta': response.get('_meta')}
    if len(json.dumps(response).encode()) > 256 * 1024:
        raise ValueError('Response exceeds read budget; use select fields, pagination or a smaller limit')
    value = {'ok': ok, 'success': ok, 'exitCode': result.returncode, 'response': response}
    if not ok:
        value['error'] = 'Orca rejected or could not confirm the operation; inspect the response receipt'
    return value


def legacy_read(ctx, operation, values):
    if not enabled(ctx):
        return None
    commands = {
        'run-list': ['orchestration', 'run-list', '--limit', str(values.get('limit', 100))],
        'run-show': ['orchestration', 'run-show', '--id', values.get('run', '')],
        'task-list': ['orchestration', 'task-list', '--run', values.get('run', '')],
        'worker-show': ['orchestration', 'worker-show', '--dispatch', values.get('dispatch', '')],
        'worker-read': ['orchestration', 'worker-read', '--dispatch', values.get('dispatch', ''),
                        '--limit', str(values.get('limit', 100))],
    }
    argv = commands.get(operation)
    if argv is None:
        return None
    if values.get('offset', 0):
        raise ValueError('Use orca_cli with the normal CLI cursor for pagination')
    if operation == 'worker-read' and 'cursor' in values:
        argv += ['--cursor', str(values['cursor'])]
    return execute(ctx, argv)


def register_public_cli(ctx):
    def handle(args, **kwargs):
        try:
            return json.dumps(execute(ctx, args.get('argv'), select=args.get('select')), ensure_ascii=False)
        except subprocess.TimeoutExpired:
            return json.dumps({'ok': False, 'unconfirmed': True,
                               'error': 'Timed out; reconcile receipts before retrying a mutation'})
        except (ValueError, OSError) as error:
            return json.dumps({'ok': False, 'error': str(error)})
    ctx.register_tool(name='orca_cli', toolset='orca_dispatch', check_fn=lambda: enabled(ctx),
                      schema={'name': 'orca_cli', 'description':
                              'Use the normal Orca CLI like every other agent. Manage existing '
                              'and new sessions, Runs, tasks and workers, regardless of who '
                              'started them. Read --help and skills get orca-cli for commands. '
                              'Large reads can select dotted paths: result.workers[].projection, '
                              'result.page or result.terminal.tail. Selection is read-only; '
                              'use it instead of shell parsing scripts. '
                              'Pass arguments only; no shell, executable or manager lease. '
                              'Preserve user objectives, project/account boundaries and native '
                              'Orca receipt/incarnation checks. Act within the user\'s authorized objectives. '
                              'network routes and network forward expose approved cross-host TCP routes.',
                              'parameters': {'type': 'object', 'additionalProperties': False,
                                             'properties': {'argv': {'type': 'array', 'minItems': 1,
                                                                     'maxItems': 128,
                                                                     'items': {'type': 'string'}},
                                                            'select': {'type': 'array', 'minItems': 1,
                                                                       'maxItems': 24, 'items': {'type': 'string'}}},
                                             'required': ['argv']}}, handler=handle)
