# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub Security Advisories:
<https://github.com/Swih/mistral-mcp/security/advisories/new>

Do **not** open a public issue for security problems.

Include:

- A clear description and impact assessment
- Reproduction steps or proof of concept
- Affected version(s)

## Scope

In scope:

- `mistral-mcp` source code (`src/`, `test/`)
- The published npm package
- Build artifacts in releases

Out of scope:

- The Mistral API itself — report to Mistral directly
- Vulnerabilities in third-party dependencies — track via `npm audit`; we
  upgrade on patch
- Issues in MCP clients (Claude Code, Cursor, Zed, …) — report to the client

## Handling secrets

- The only secret read by the server is `MISTRAL_API_KEY`, taken from
  `process.env` at startup
- API keys are never logged. Error logs do not include user payloads
- For Streamable HTTP transport, an optional bearer token is read from env;
  it is compared in constant time and never logged

If you believe a key is leaking through any code path, treat it as in scope
and report it.

## Response

- Initial acknowledgement: within 7 days of report
- Coordinated disclosure: a fix is shipped before any public advisory
- Credit is given in the advisory unless the reporter requests otherwise

## Supported versions

Only the latest minor receives security patches.

| Version | Status                |
| ------- | --------------------- |
| 0.4.x   | Supported             |
| < 0.4   | Not supported         |
