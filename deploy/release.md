# Release bundles

Run from a checkout with development dependencies installed:

```sh
npm run build
npm run build:bundles -- /path/to/new-output-directory
```

The output directory must not exist and its parent must exist. The builder uses
the existing `dist`, installs locked production dependencies in a temporary
directory with lifecycle scripts disabled, and exports the actual core catalog.
It checks the packaged doctor, runtime version, six tools, output schemas and
annotations without credentials or provider calls. Network access is required
for npm. No package or service is published.

Artifacts: `mistral-mcp-<version>.mcpb`,
`mistral-mcp-<version>-claude-plugin.zip`, versioned manifest and server-card JSON,
and `SHA256SUMS`. MCPB validation and packing use `@anthropic-ai/mcpb@2.1.2`.
The official validator requires PNG: temporary `sharp-cli@6.1.0` converts the
included `assets/icon.svg` to `assets/icon.png`. No runtime dependency is added.
The plugin ZIP contains only its manifest, MCP configuration, README and skills.
Windows uses PowerShell/.NET ZIP support; other platforms require `zip` on PATH.
Locked dependencies and the pinned packer make the build repeatable; archive
timestamps and host tooling mean byte-identical output is not guaranteed.

MCPB 0.3 does not support `enum` for user configuration. `profile` therefore uses
a string with default `core` and documented allowed values; the server validates
profile names. The only other settings are the required sensitive
`mistral_api_key` and optional `default_model` (empty means the server default).
