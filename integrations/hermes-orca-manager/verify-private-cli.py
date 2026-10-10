"""Exercise the public CLI over real private IPC with a deliberately invalid service key."""
import json
import os
from pathlib import Path
import runpy
import subprocess
from tempfile import TemporaryDirectory

launcher = runpy.run_path('/usr/local/libexec/hermes-orca-cli')
with TemporaryDirectory(prefix='private-cli-validation-', dir='/var/lib/hermes-manager') as directory:
    root = Path(directory)
    metadata = root / 'orca-runtime.json'
    metadata.write_text(json.dumps(launcher['fresh_metadata']()))
    metadata.chmod(0o600)
    credential = root / 'invalid-service.credential'
    credential.write_text(json.dumps({'serviceToken': 'orcam_' + 'A' * 43}))
    credential.chmod(0o600)
    environment = {key: value for key, value in os.environ.items() if not key.startswith('ORCA_')}
    environment.update({'ORCA_USER_DATA_PATH': str(root),
                        'ORCA_MANAGER_CREDENTIAL_FILE': str(credential),
                        'ORCA_BACKGROUND_LAUNCH': '1'})
    result = subprocess.run([launcher['NODE'], launcher['CLI'], 'manager', 'read', '--json'],
                            capture_output=True, text=True, env=environment, timeout=45, check=False)
    if result.returncode != 1:
        raise RuntimeError('Invalid service authority was not refused')
    reply = json.loads(result.stdout)
    code = reply.get('error', {}).get('code', '')
    if reply.get('ok') is not False or code.lower() not in {'unauthorized', 'access_denied', 'permission_denied'}:
        message = reply.get('error', {}).get('message', '')
        raise RuntimeError(f'Unexpected private CLI refusal category: {code}; {message[:240]}')
    print('PUBLIC_CLI_PRIVATE_IPC_INVALID_SERVICE_DENIED_NO_OWNER_FALLBACK')
