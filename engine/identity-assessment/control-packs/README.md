# Identity development control packs

These two version-pinned packs are CloudOps-owned synthetic development fixtures. They are **not CIS**, not a licensed benchmark implementation, and not a production identity baseline.

- `cloudops-identity-dev@1.0.0`: baseline fixture gives PASS / FAIL / MANUAL.
- `cloudops-identity-alternate-dev@1.0.0`: the same fixture gives PASS / PASS / MANUAL using different parameters and framework metadata, without another engine.

Both packs reference only approved static collector, evaluator and recommendation IDs. They contain no executable code, script paths, dynamic URLs, Graph queries or permission choices. The files and their normalized UTF-8 SHA-256 hashes are pinned in `../assessment-sdk.json`. Do not change released content in place: publish a new version and review its pin, source and scope together. Hashes normalize CRLF to LF and discard an optional BOM; other content edits invalidate the pin.

The public plugin remains disabled. The local test harness is deliberately separate from the production entrypoint and cannot be selected through API input. No fixture may be presented as a tenant assessment.

Do not add proprietary benchmark content by copying, scraping or downloading it. A future real pack requires an authorized source, verified usage rights, truthful framework/version attribution and review of each control's evidence, applicability, collector permissions, deterministic evaluator and recommendations. Adding a control pack does not itself authorize consent changes or enable production execution.

See [Identity Assessment](../../../docs/identity-assessment.md) and [Control Packs](../../../docs/control-packs.md) for the extension and validation workflow.
