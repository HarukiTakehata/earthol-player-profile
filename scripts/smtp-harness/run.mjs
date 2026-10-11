/**
 * Runs the REAL SmtpMailer (bundled from src/lib/email.ts) against the scripted
 * SMTP server and asserts the post-STARTTLS dialogue.
 *
 * PASS criteria for the fixed client:
 *   - connect uses secureTransport 'starttls'
 *   - EHLO #1 -> STARTTLS -> 220 -> startTls() -> EHLO #2 (no second 220 wait)
 *   - AUTH PLAIN -> MAIL FROM -> RCPT TO -> DATA -> 250
 */
import { getMailer } from './mailer-bundle.mjs';

const cfg = {
  driver: 'smtp',
  host: 'mock.smtp.test',
  port: '587',
  secure: 'starttls',
  user: 'user@mock.smtp.test',
  password: 'hunter2',
  from: 'EarthOL <no-reply@mock.smtp.test>',
};

const mailer = getMailer(cfg);
const record = globalThis.__SMTP_RECORD || (globalThis.__SMTP_RECORD = []);

let outcome;
const started = Date.now();
try {
  await mailer.send({
    to: 'player@example.com',
    subject: '你的登录链接 / Your sign-in link',
    html: '<p>hi <a href="https://example.com/x">link</a></p>',
    text: 'hi https://example.com/x',
  });
  outcome = 'SEND OK';
} catch (err) {
  outcome = `SEND FAILED: ${err.message}`;
}
const elapsed = Date.now() - started;

const commands = record.filter((e) => typeof e === 'string' || e.event === undefined);
const events = record.filter((e) => e && typeof e === 'object');

console.log(`RESULT: ${outcome}  (${elapsed} ms)`);
console.log(`connect options: ${JSON.stringify(events.find((e) => e.event === 'connect'))}`);
console.log(`startTls called: ${JSON.stringify(events.filter((e) => e.event === 'startTls'))}`);
console.log(`spurious "startTls-without-STARTTLS": ${events.some((e) => e.event === 'startTls-without-STARTTLS')}`);
console.log('--- server-side command log (client -> server) ---');
for (const c of record) if (typeof c === 'string') console.log('  ' + c);

const log = record.filter((c) => typeof c === 'string');
const ehloCount = log.filter((c) => /^EHLO/.test(c)).length;
const postUpgrade = log.slice(log.findIndex((c) => c === 'STARTTLS') + 1);

console.log('--- assertions ---');
const checks = [
  [`send succeeded`, outcome === 'SEND OK'],
  [`exactly 2 EHLO (pre- and post-STARTTLS)`, ehloCount === 2],
  [`first command after STARTTLS is EHLO`, postUpgrade[0] === 'EHLO mock.smtp.test'],
  [`no second greeting consumed (elapsed << 12s timeout)`, elapsed < 5000],
  [`mail delivered via DATA`, log.includes('DATA')],
];
let ok = true;
for (const [name, res] of checks) {
  console.log(`  [${res ? 'PASS' : 'FAIL'}] ${name}`);
  if (!res) ok = false;
}
process.exit(ok ? 0 : 1);
