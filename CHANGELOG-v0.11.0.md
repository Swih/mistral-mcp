### Known limitations

- Live OCR validation remains blocked for the CI account: an isolated one-page
  request returns HTTP 429 with an effective limit of zero requests per minute.
  Document extraction has not been revalidated against the provider for this
  release. Other account access depends on Mistral's availability and quotas.
  Offline tests and Node 20/22/24 CI pass; this release does not claim a green
  complete live suite. No paid plan is required by the server itself, but free
  provider access is not guaranteed.

### Fixed

- Document cache keys include page limits, models and endpoint; cached payloads
  are schema-validated and checked against the current quality floor. Old cache
  entries are invalidated. Missing or partial OCR confidence returns a tool error
  instead of a fabricated score of 1.
- Function-calling history preserves assistant calls and maps tool result IDs
  to the SDK. Conversation and library text fallbacks include usable results;
  conversations preserve JSON content blocks and file/source references.
- Live tests explicitly report missing account resources as skipped; workflow
  discovery no longer hides unexpected API failures. CI retains a JSON report.
- README coverage claims and profile counts match the implemented surface.
- Stdio protocol checks no longer load `.env` and trigger inference implicitly.
  Real stdio calls run in the live suite and respect the configured chat model.
- Live document fixtures verify OCR readability after upload, with three bounded
  retries only for `422 invalid_file / 1901 / Could not get file.` responses.
  Persistent errors still fail; this adds one OCR page per fixture.

### Added

- Read-only `agents_list` and `agents_get` for modern agents, available in `admin`.
  The legacy completion tool is retained and marked as deprecated in its description.
- `--doctor` prints local configuration without API requests or entitlement claims.
- Current reasoning effort values for chat, streaming chat and function calling.
- Release checks install the packed npm artifact in a temporary directory, verify
  its contents and catalogs, and exercise inference against a local stub.
- Local-file upload example and three explicit live example routes. No billing
  configuration changes or automatic provider probes are performed.
- Manual isolated OCR diagnostic in GitHub Actions, without retries.
