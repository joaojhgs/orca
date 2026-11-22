"""Explicit, read-only federation over existing profile banks and builtin notes."""
import json
from pathlib import Path
import urllib.error
import urllib.request

PROFILES = ('personal', 'coding', 'work', 'coordinator', 'orca-manager')
LIMIT = 131072


def recall_profile(root, name, query):
    home = root / name
    notes = []
    for filename in ('MEMORY.md', 'USER.md'):
        path = home / 'memories' / filename
        if path.is_file() and not path.is_symlink():
            content = path.read_text()[:12000]
            notes.append({'source': f'{name}/memories/{filename}', 'text': content})
    config_path = home / 'hindsight' / 'config.json'
    if not config_path.is_file():
        return {'profile': name, 'provider': 'builtin', 'notes': notes, 'results': []}
    config = json.loads(config_path.read_text())
    # Never accept arbitrary URLs, bank paths or caller-supplied auth material.
    if config.get('api_url', '').rstrip('/') != 'http://127.0.0.1:8788':
        raise ValueError('Memory service must be the approved loopback endpoint')
    bank = config.get('bank_id')
    allowed_banks = {'orca-manager'} if name == 'orca-manager' else {'hermes-' + name}
    if bank not in allowed_banks:
        raise ValueError('Profile bank identity does not match its configured scope')
    request = urllib.request.Request(
        f'http://127.0.0.1:8788/v1/default/banks/{bank}/memories/recall',
        data=json.dumps({'query': query, 'budget': 'low', 'max_tokens': 1200}).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config['apiKey']},
        method='POST')
    try:
        # Populated banks include CPU cross-encoder reranking, unlike empty-bank probes.
        with urllib.request.urlopen(request, timeout=90) as response:
            raw = response.read(LIMIT + 1)
        if len(raw) > LIMIT:
            raise ValueError('Memory response exceeded its budget')
        result = json.loads(raw)
        facts = [{'text': item.get('text', '')[:8000], 'id': item.get('id'),
                  'type': item.get('type')} for item in result.get('results', [])[:20]]
        return {'profile': name, 'provider': 'hindsight', 'bank': bank, 'notes': notes, 'results': facts}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {'profile': name, 'provider': 'hindsight', 'notes': notes, 'results': [], 'status': 'bank-empty-or-absent'}
        raise


def handle(ctx, args, root=None):
    try:
        if ctx.get_config('enable_federated_memory', default=False) is not True:
            raise ValueError('Cross-profile recall is not authorized for this profile')
        if not isinstance(args, dict) or set(args) != {'profiles', 'query'}:
            raise ValueError('Specify profiles and query only')
        names, query = args['profiles'], args['query']
        if not isinstance(names, list) or not 1 <= len(names) <= len(PROFILES) or any(name not in PROFILES for name in names):
            raise ValueError('Unknown or excessive profile selection')
        if not isinstance(query, str) or not 1 <= len(query.strip()) <= 4000:
            raise ValueError('Recall query exceeds its budget')
        if root is None:
            from hermes_constants import get_hermes_home
            current = Path(get_hermes_home()).resolve()
            if current.name != 'coordinator' or current.parent.name != 'profiles':
                raise ValueError('Only the Coordinator profile is authorized to federate memory')
            root = current.parent
        results = []
        for name in dict.fromkeys(names):
            try:
                results.append(recall_profile(root, name, query))
            except Exception:
                results.append({'profile': name, 'status': 'unavailable', 'results': []})
        return json.dumps({'ok': True, 'readOnly': True, 'profiles': results}, ensure_ascii=False)
    except ValueError as error:
        return json.dumps({'ok': False, 'error': str(error)})


def register_profile_memory(ctx):
    ctx.register_tool(name='profile_memory_recall', toolset='profile_memory', schema={
        'name': 'profile_memory_recall',
        'description': 'Coordinator-only explicit read-only recall from selected profiles, including each Hindsight bank and builtin notes. Banks remain separate; this never retains, merges or reflects another profile.',
        'parameters': {'type': 'object', 'additionalProperties': False,
                       'properties': {'profiles': {'type': 'array', 'items': {'type': 'string', 'enum': list(PROFILES)}, 'minItems': 1, 'maxItems': len(PROFILES)},
                                      'query': {'type': 'string', 'minLength': 1, 'maxLength': 4000}},
                       'required': ['profiles', 'query']}},
        handler=lambda args, **kwargs: handle(ctx, args),
        check_fn=lambda: ctx.get_config('enable_federated_memory', default=False) is True)
