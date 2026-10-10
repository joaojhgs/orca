"""Ask Hermes PM to admit enabled plugins, retaining its full shipped feature set."""
from pathlib import Path

import pm
from hermes_constants import get_hermes_home

if get_hermes_home() != Path('/var/lib/hermes-manager/.hermes/profiles/orca-manager'):
    raise ValueError('Dependency admission is restricted to the prepared manager profile')
pm.sync_venv([], explicit=True)
print('Private plugin dependency union prepared through Hermes PM')
