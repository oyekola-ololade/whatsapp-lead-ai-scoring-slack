# Template Status & Verification

**Classification:** Configurable n8n template asset — not a verified production deployment.

The workflow export and documentation are inspectable template evidence. A configured live-run recording is not currently included, so this repo should not be presented as deployed or production-verified.

## Verification gate
1. Parse/import into a clean current n8n instance.
2. Inspect WhatsApp/webhook normalization, Claude/API request, structured score parsing, HOT/WARM/COLD routing, Slack alerting, fallback logic, expressions, and Code nodes.
3. Replace placeholder AI credentials, webhook URLs, Slack destination, model IDs, and resource references.
4. Confirm the configured model/API version is currently available.
5. Run HOT/WARM/COLD samples, malformed-model-output, AI-provider failure, Slack failure, and replay cases.
6. Verify HOT alerts fire only when intended and fallback behavior preserves the raw lead safely without duplicate side effects.
7. Record configured test date/result.

## Security
Never commit AI/provider tokens, Slack webhooks, lead PII, private messaging credentials, or production payloads. Use synthetic leads and test credentials.

## Change record
- **2026-09-03:** Added repository verification/security/status control. No workflow-logic change or configured runtime pass is implied.
