import net from 'node:net';
import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// SMTP sink: captures test messages locally and never forwards them.
export async function startLocalSmtp(directory) {
  const server = net.createServer(socket => {
    socket.write('220 localhost validation SMTP\r\n');
    let buffer = '', message = '', receiving = false;
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n');
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (receiving) {
          if (line === '.') {
            receiving = false;
            writeFile(path.join(directory, `mail-${randomUUID()}.eml`), message, { mode: 0o600 }).then(() => socket.write('250 captured locally\r\n')).catch(() => socket.write('451 capture failed\r\n'));
            message = '';
          } else message += `${line}\r\n`;
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write('250 localhost\r\n');
        else if (/^AUTH/i.test(line)) socket.write('235 test credentials accepted\r\n');
        else if (/^DATA/i.test(line)) { receiving = true; socket.write('354 end with dot\r\n'); }
        else if (/^QUIT/i.test(line)) { socket.end('221 bye\r\n'); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}
