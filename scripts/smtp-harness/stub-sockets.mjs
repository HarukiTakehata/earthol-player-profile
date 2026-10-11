/**
 * Stand-in for `cloudflare:sockets` so the real src/lib/email.ts can run under
 * plain Node. The Workers runtime cannot reach localhost/private IPs, so the
 * mailer cannot be integration-tested against a real local SMTP server —
 * this scripted server is the only faithful way to exercise the dialogue.
 *
 * Behaviour knobs come from `globalThis.__SMTP_OPTS` (set by the runner).
 */
import { makeConnect } from './mock-sockets.mjs';

const record = (globalThis.__SMTP_RECORD ||= []);
const opts = (globalThis.__SMTP_OPTS ||= {});
export const connect = makeConnect(record, opts);
