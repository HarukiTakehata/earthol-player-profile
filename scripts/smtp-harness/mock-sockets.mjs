/**
 * Scripted SMTP server used to exercise the real SmtpMailer dialogue.
 *
 * Faithful to RFC 3207: after the client sends STARTTLS and the TLS handshake
 * completes, the server does NOT send another 220 greeting. It waits for the
 * client's next EHLO. The `startTls()` socket therefore starts with an EMPTY
 * inbound buffer — any client that waits for a second 220 will hang.
 */
const enc = new TextEncoder();

function wire({ greeting }) {
  let ctrl;
  const readable = new ReadableStream({
    start(c) {
      ctrl = c;
    },
  });
  const out = (s) => ctrl.enqueue(enc.encode(s));
  if (greeting) out(greeting);
  return { readable, out, ctrl };
}

class SmtpServer {
  constructor(socket, log = [], opts = {}) {
    this.socket = socket;
    this.log = log;
    this.opts = opts;
    this.secure = false;
    this.data = false;
    this.buf = '';
    this.mailFrom = null;
    this.rcpt = null;
    this.body = '';
  }

  /** Feeds raw bytes the client wrote. Emits reply lines via this.socket.out. */
  feed(text) {
    this.buf += text;
    for (;;) {
      if (this.data) {
        // Data mode: the terminator arrives as ".\r\n" ... or a bare "." chunk.
        const idx = this.buf.indexOf('\r\n.\r\n');
        if (idx >= 0) {
          this.body = this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + 5);
          this.data = false;
          this.socket.out('250 2.0.0 Ok: queued as MOCK123\r\n');
          continue;
        }
        if (this.buf === '\r\n.\r\n' || this.buf.endsWith('\r\n.')) {
          if (this.buf.endsWith('\r\n.')) {
            this.body += this.buf;
            this.buf = '';
            this.data = false;
            this.socket.out('250 2.0.0 Ok: queued as MOCK123\r\n');
          }
          continue;
        }
        return; // still receiving the body
      }
      const idx = this.buf.indexOf('\r\n');
      if (idx < 0) return;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      this.command(line);
    }
  }

  command(line) {
    this.log.push(line);
    const [verb, ...rest] = line.split(' ');
    const arg = rest.join(' ');
    switch (verb.toUpperCase()) {
      case 'EHLO':
        if (!this.secure) {
          const line = '250-mock.smtp.test\r\n';
          const tls = this.opts.advertiseStartTls === false ? '' : '250-STARTTLS\r\n';
          this.socket.out(`${line}${tls}250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n`);
        } else {
          this.socket.out('250-mock.smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        }
        return;
      case 'HELO':
        this.socket.out('250 mock.smtp.test\r\n');
        return;
      case 'STARTTLS':
        if (this.secure) {
          this.socket.out('503 already secured\r\n');
          return;
        }
        this.socket.out('220 2.0.0 Ready to start TLS\r\n');
        this.upgradeRequested = true;
        return;
      case 'AUTH': {
        const mech = (rest[0] || '').toUpperCase();
        if (mech === 'PLAIN') {
          this.socket.out('235 2.7.0 Authentication successful\r\n');
        } else if (mech === 'LOGIN') {
          this.socket.out('334 VXNlcm5hbWU6\r\n');
          this.authStage = 'user';
        } else {
          this.socket.out('504 unrecognized\r\n');
        }
        return;
      }
      default:
        break;
    }
    if (this.authStage) {
      // base64 of user then password
      if (this.authStage === 'user') {
        this.authStage = 'pass';
        this.socket.out('334 UGFzc3dvcmQ6\r\n');
      } else {
        this.authStage = null;
        this.socket.out('235 2.7.0 Authentication successful\r\n');
      }
      return;
    }
    switch (verb.toUpperCase()) {
      case 'MAIL':
        this.mailFrom = arg;
        this.socket.out('250 2.1.0 Ok\r\n');
        return;
      case 'RCPT':
        this.rcpt = arg;
        this.socket.out('250 2.1.5 Ok\r\n');
        return;
      case 'DATA':
        this.data = true;
        this.body = '';
        this.socket.out('354 End data with <CR><LF>.<CR><LF>\r\n');
        return;
      case 'QUIT':
        this.socket.out('221 2.0.0 Bye\r\n');
        return;
      case 'RSET':
        this.socket.out('250 2.0.0 Ok\r\n');
        return;
      default:
        this.socket.out('500 5.5.1 unrecognized command\r\n');
    }
  }
}

/**
 * Builds a mock `Socket`. `secureTransport: 'starttls'` mirrors the documented
 * Workers behaviour: startTls() returns a NEW socket with fresh streams and the
 * original socket becomes unusable. The upgraded stream carries NO greeting.
 */
export function makeConnect(record, opts = {}) {
  return function connect(address, options = {}) {
    const mode = options.secureTransport || 'off';
    const handshake = wire({ greeting: '220 mock.smtp.test ESMTP\r\n' });
    const server = new SmtpServer(handshake, record, opts);
    record.push({ event: 'connect', address, secureTransport: mode });

    const socket = {
      readable: handshake.readable,
      writable: new WritableStream({
        write(chunk) {
          server.feed(new TextDecoder().decode(chunk));
        },
      }),
      opened: Promise.resolve({ remoteAddress: '203.0.113.9', localAddress: '10.0.0.1' }),
      closed: Promise.resolve(),
      upgraded: false,
      secureTransport: mode,
      close: async () => {},
      startTls: (tlsOptions) => {
        if (mode !== 'starttls') throw new Error('startTls() requires secureTransport "starttls"');
        record.push({ event: 'startTls', expectedServerHostname: tlsOptions?.expectedServerHostname });
        if (!server.upgradeRequested) record.push({ event: 'startTls-without-STARTTLS' });
        // Fresh streams. NO greeting: a compliant server never re-greets.
        const upgraded = wire({ greeting: '' });
        const secureServer = new SmtpServer(upgraded, record);
        secureServer.secure = true;
        record.push({ event: 'upgraded-stream-has-no-greeting' });
        return {
          readable: upgraded.readable,
          writable: new WritableStream({
            write(chunk) {
              secureServer.feed(new TextDecoder().decode(chunk));
            },
          }),
          opened: Promise.resolve({ remoteAddress: '203.0.113.9', localAddress: '10.0.0.1' }),
          closed: Promise.resolve(),
          upgraded: true,
          secureTransport: 'on',
          close: async () => {},
          startTls: () => {
            throw new Error('startTls() must only be called once');
          },
        };
      },
    };
    return socket;
  };
}
