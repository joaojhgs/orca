<!-- host-capability: artifact-publishing -->

# Artifact commands

The publish gate, explicit-intent rule, and denial recovery are in the guide body.

```text
ORCA artifacts share <file> --json
ORCA artifacts update <file> --json
ORCA artifacts unshare <file> --json
ORCA artifacts list [--cursor <cursor>] --json
ORCA artifacts delete <id> --json
```

- `share`, `update`, and `unshare` accept `.html`, `.htm`, `.md`, and `.markdown` files.
  Updated local artifact servers also accept `.pdf` files; Cloud hosting does not.
- With server-local hosting, links and content stay on the Orca server and no Cloud login
  is required. The user's publishing approval is still required. Listing and revocation
  work within the active local profile, including while publishing is disabled.
- PDF content is transported as base64 and served as `application/pdf`, never as HTML.
  CLI requests retain the 800 KiB envelope cap (about 600 KiB of PDF bytes); larger files
  can be shared from the editor up to its encoded-content limit of 10 MiB.
- `share` saves the returned edit token in the active Orca profile and never includes it
  in CLI output. `update` and `unshare` look up that record by the resolved local file
  path, so use the same path and Orca profile that originally shared the file.
- `list` returns one page of artifacts owned by the signed-in account. If JSON output has
  `nextCursor`, pass it back with `--cursor <cursor>`. `delete <id>` deletes an account-owned
  artifact by the id returned from `list`; it does not need the original local file or its
  edit-token record.
- Relative HTML assets are not uploaded. Share a self-contained HTML file or use absolute
  asset URLs.
- If an upload exceeds the CLI transport limit, use the browser upload page as directed
  by the error.
- For local or staging development, `--api-url <url>` overrides the artifact service;
  `ORCA_ARTIFACTS_API_URL` provides the same override for the session.
- `ORCA_CLOUD_AUTH_TOKEN` is a development-only authentication override. Prefer the active
  Orca profile's normal PropelAuth session and never expose the token in logs or agent output.

<!-- /host-capability -->
