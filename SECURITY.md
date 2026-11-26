# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `0.1.x` | Yes |

## Security Design

CogTrace performs **static AST analysis only** — it never executes (`eval` / `Function` / subprocess) analyzed source code. Both the CLI and the browser Web X-Ray Studio operate entirely locally without transmitting source code to external servers.

All generated standalone HTML reports (`generateHtmlReport`) HTML-escape filenames and escape `<`, `>`, `&`, U+2028, and U+2029 inside embedded JSON script blocks to prevent XSS or premature `</script>` termination.

## Reporting a Vulnerability

If you discover a security vulnerability (such as XSS in generated HTML reports, path traversal in the CLI, or a parser denial-of-service / ReDoS issue):

1. **Please do not open a public GitHub issue** with exploit details.
2. Report it privately using [GitHub Security Advisories](https://github.com/xnezerxx/cogtrace/security/advisories/new).
3. Include a minimal reproduction input, expected behavior, and affected version.

You can expect an initial acknowledgement within 72 hours and coordinated disclosure once a fix is ready.
