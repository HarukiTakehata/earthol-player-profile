# SMTP dialogue harness

Reproduces the STARTTLS delivery failure and verifies the fix, without a live
mail server.

## Why this exists

`src/lib/email.ts` talks to SMTP over `cloudflare:sockets`. Two constraints make
the usual approaches unusable:

- The Workers runtime **refuses outbound sockets to `localhost` / private IPs**,
  so the mailer can never be integration-tested against a local SMTP server
  inside `workerd`.
- The repo has no test runner configured (`AGENTS.md`: `npm run typecheck` is
  the only automated check).

So this harness bundles the **real** `src/lib/email.ts` with esbuild, aliasing
`cloudflare:sockets` to a scripted in-process SMTP server, and drives it under
plain Node. The module under test is unmodified — only its socket import is
redirected.

## Usage

```sh
npm install                              # esbuild is a devDependency
sh scripts/smtp-harness/run.sh origin/main   # fails: the pre-fix code
sh scripts/smtp-harness/run.sh               # passes on the fixed tree
```

## What it asserts

| Case | Expectation |
| --- | --- |
| `587` + `SMTP_SECURE=starttls` | `EHLO → STARTTLS → EHLO → AUTH → MAIL → RCPT → DATA → QUIT` |
| `587` auto (no `SMTP_SECURE`) | same as above (auto mode picks STARTTLS) |
| `465` implicit TLS | no `startTls()`, single EHLO |
| `465` auto | implicit TLS |
| `SMTP_SECURE=none` | plaintext, single EHLO |
| server does not advertise `STARTTLS` | fails fast with a capability error, no timeout |

The decisive assertion is that the client re-issues **EHLO immediately** after
the TLS upgrade. The scripted server deliberately sends **no** greeting on the
upgraded stream (RFC 3207: a server never re-greets after STARTTLS), so a client
that waits for a second `220` blocks until its 12 s read timeout — exactly the
reported failure.
