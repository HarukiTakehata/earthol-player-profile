/**
 * Regression matrix for the SMTP client (src/lib/email.ts) over the scripted
 * server. Covers every transport branch the issue asked to re-verify:
 *   587/STARTTLS, 465 implicit TLS, plain, and a server with no STARTTLS
 *   capability. The key assertion for case 1 is that the client re-issues EHLO
 *   immediately after the upgrade instead of waiting for a second 220.
 */
const record = (globalThis.__SMTP_RECORD = []);
const opts = (globalThis.__SMTP_OPTS = {});

// Loaded after the globals exist so the sockets stub picks them up.
const bundle = process.env.MAILER_BUNDLE || './mailer-bundle.mjs';
const { getMailer } = await import(bundle);

const cases = [
  { name: 'starttls @587 (advertised)', port: '587', secure: 'starttls', server: {}, expect: 'ok' },
  { name: 'tls @465 (implicit)', port: '465', secure: 'tls', server: {}, expect: 'ok' },
  { name: 'none @2525 (plain)', port: '2525', secure: 'none', server: {}, expect: 'ok' },
  { name: 'auto @465 -> implicit tls', port: '465', secure: '', server: {}, expect: 'ok' },
  { name: 'auto @587 -> starttls', port: '587', secure: '', server: {}, expect: 'ok' },
  { name: 'starttls but server lacks capability', port: '587', secure: 'starttls', server: { advertiseStartTls: false }, expect: 'no-capability' },
];

let failures = 0;
for (const tc of cases) {
  record.length = 0;
  for (const k of Object.keys(opts)) delete opts[k];
  Object.assign(opts, tc.server);

  const cfg = {
    driver: 'smtp',
    host: 'mock.smtp.test',
    port: tc.port,
    secure: tc.secure,
    user: 'user@mock.smtp.test',
    password: 'hunter2',
    from: 'EarthOL <no-reply@mock.smtp.test>',
  };

  const mailer = getMailer(cfg);
  const t0 = Date.now();
  let error = null;
  try {
    await mailer.send({ to: 'p@example.com', subject: 's', html: '<p>h</p>', text: 'h' });
  } catch (err) {
    error = err.message;
  }
  const ms = Date.now() - t0;

  const cmds = record.filter((c) => typeof c === 'string');
  const connectEv = record.find((e) => e && e.event === 'connect');
  const startTlsEv = record.filter((e) => e && e.event === 'startTls');
  const ehloCount = cmds.filter((c) => /^EHLO/.test(c)).length;
  const afterStartTls = cmds.slice(cmds.findIndex((c) => c === 'STARTTLS') + 1);

  const checks = [];
  if (tc.expect === 'ok') {
    checks.push(['send ok', error === null]);
    checks.push(['fast (<5s, no read timeout)', ms < 5000]);
    checks.push(['DATA delivered', cmds.includes('DATA')]);
    checks.push(['AUTH used', cmds.some((c) => /^AUTH PLAIN/.test(c))]);
    if (connectEv.secureTransport === 'starttls') {
      checks.push(['startTls() called once', startTlsEv.length === 1]);
      checks.push(['2 EHLO (re-issued after upgrade)', ehloCount === 2]);
      checks.push(['first cmd after STARTTLS is EHLO', afterStartTls[0] === 'EHLO mock.smtp.test']);
    } else {
      checks.push(['no startTls() for non-starttls transport', startTlsEv.length === 0]);
      checks.push(['1 EHLO', ehloCount === 1]);
    }
  } else {
    checks.push(['fails with a clear capability error', !!error && /does not advertise STARTTLS/.test(error)]);
    checks.push(['fails fast (<5s), not a timeout', ms < 5000]);
  }

  const bad = checks.filter(([, r]) => !r);
  if (bad.length) failures += 1;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${tc.name}  [${connectEv.secureTransport}] ${error ? `err=${error}` : 'ok'} ${ms}ms`);
  console.log(`      cmds: ${cmds.map((c) => c.split(' ')[0]).join(' -> ')}`);
  for (const [n, r] of checks) if (!r) console.log(`      [FAIL] ${n}`);
}

console.log(failures === 0 ? '\nALL CASES PASS' : `\n${failures} CASE(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
