# Electron server runtime data

Custom Electron server releases replace backend chunks while preserving their
architecture-specific runtime dependencies. Deferred `createRequire` calls also
need their data files; copying only `out/main` and `out/web` omits them.

Before creating a server release archive, run from the source checkout:

```sh
node integrations/electron-server-deployment/stage-runtime-data.mjs /path/to/staging
```

To package a backend/web overlay together with this data, put the release's
`DEPLOYMENT.json` in an absolute metadata staging directory and run:

```sh
bash integrations/electron-server-deployment/package-overlay.sh /path/to/metadata /path/to/release.tar.gz
```

The wrapper includes `node_modules/emojibase-data` in the archive.
The helper checks the installed package against the release's exact dependency
version and verifies resolution from `out/main/chunks`, as the backend does.
It copies only the English shortcode catalog and package metadata, avoiding the
full dataset and any architecture-specific native dependencies.

When staging from a hard-linked previous release, unlink the new release's
`node_modules/emojibase-data` directory before extracting its replacement. Preserve
the previous release's files. Preflight this same require using the destination's
Node and Electron runtimes before switching the app symlink.

The standard Electron builder and standalone orcad builder already ship this
catalog; this step is for the custom Electron server deployment overlay.
