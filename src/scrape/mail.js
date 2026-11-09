// Sends one HTML email over SMTP (implicit TLS on 465, or STARTTLS on 587). No packages needed.
import net from 'node:net';
import tls from 'node:tls';

function session(socket) {
  let buf = '';
  let waiting = null;
  const onData = (d) => {
    buf += d.toString('utf8');
    // A reply is complete when its last line has a space after the code: "250 OK".
    const lines = buf.split('\r\n');
    const done = lines.findIndex((l) => /^\d{3} /.test(l));
    if (done >= 0 && waiting) {
      const reply = lines.slice(0, done + 1).join('\n');
      buf = lines.slice(done + 1).join('\r\n');
      const w = waiting;
      waiting = null;
      w(reply);
    }
  };
  socket.on('data', onData);
  const read = () => new Promise((r) => {
    waiting = r;
    onData(Buffer.alloc(0));
  });
  const cmd = async (line, expect) => {
    if (line != null) socket.write(line + '\r\n');
    const reply = await read();
    if (expect && !reply.startsWith(String(expect))) throw new Error(`SMTP: ${line?.split(' ')[0] ?? 'greeting'} -> ${reply.slice(0, 200)}`);
    return reply;
  };
  return { cmd, detach: () => socket.off('data', onData) };
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = (s) => s.replace(/.{1,76}/g, '$&\r\n');

export function buildMessage({ from, to, subject, html, text }) {
  const boundary = `mml-${Date.now().toString(36)}`;
  return [
    `From: ${from}`,
    `To: ${[].concat(to).join(', ')}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(text)),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(html)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

export async function sendMail({ host, port = 465, secure, user, pass, from = user, to, subject, html, text }) {
  port = Number(port);
  // Port 465 speaks TLS from the start; other ports (587) upgrade with STARTTLS.
  secure ??= port === 465;
  const connect = () =>
    new Promise((resolve, reject) => {
      const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      s.once(secure ? 'secureConnect' : 'connect', () => resolve(s));
      s.once('error', reject);
      s.setTimeout(30000, () => s.destroy(new Error('SMTP timeout')));
    });
  let socket = await connect();
  let s = session(socket);
  try {
    await s.cmd(null, 220);
    await s.cmd('EHLO mathmyloan.com', 250);
    if (!secure) {
      await s.cmd('STARTTLS', 220);
      s.detach();
      socket = tls.connect({ socket, servername: host });
      await new Promise((r, j) => {
        socket.once('secureConnect', r);
        socket.once('error', j);
      });
      s = session(socket);
      await s.cmd('EHLO mathmyloan.com', 250);
    }
    await s.cmd('AUTH LOGIN', 334);
    await s.cmd(b64(user), 334);
    await s.cmd(b64(pass), 235);
    const addr = (a) => a.match(/<([^>]+)>/)?.[1] ?? a.trim();
    await s.cmd(`MAIL FROM:<${addr(from)}>`, 250);
    for (const r of [].concat(to)) await s.cmd(`RCPT TO:<${addr(r)}>`, 250);
    await s.cmd('DATA', 354);
    const body = buildMessage({ from, to, subject, html, text }).replace(/^\./gm, '..');
    await s.cmd(`${body}\r\n.`, 250);
    await s.cmd('QUIT');
  } finally {
    socket.end();
  }
}
