import http from 'node:http';
import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { DiskCleaner, UserError, describeError, pickFolder } from './cleaner.mjs';

async function readBody(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new UserError('Yêu cầu phải dùng JSON.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new UserError('Yêu cầu quá lớn.', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new UserError('JSON không hợp lệ.'); }
}

export async function startServer(cleaner = new DiskCleaner()) {
  await cleaner.initialize();
  const session = randomBytes(32).toString('hex');
  const clients = new Map();
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([route, name, type]) => [route, { data: await fs.readFile(new URL(`../web/${name}`, import.meta.url)), type }])));
  let origin;
  let cookieName;
  const send = (response, status, value) => {
    if (response.destroyed || response.writableEnded) return;
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (request.headers.host !== new URL(origin).host || (request.headers.origin && request.headers.origin !== origin)) throw new UserError('Nguồn truy cập không được phép.', 403);
      if (request.headers['sec-fetch-site'] === 'cross-site') throw new UserError('Chỉ mở công cụ trực tiếp từ địa chỉ local.', 403);
      const url = new URL(request.url, origin);
      const authenticated = request.headers.cookie?.split(';').some((cookie) => cookie.trim() === `${cookieName}=${session}`);
      if (request.method === 'GET' && assets.has(url.pathname)) {
        if (url.pathname === '/') response.setHeader('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        else if (!authenticated) throw new UserError('Mở lại trang chính để bắt đầu phiên.', 401);
        const asset = assets.get(url.pathname);
        response.writeHead(200, { 'Content-Type': asset.type });
        response.end(asset.data);
        return;
      }
      if (!authenticated) throw new UserError('Phiên không hợp lệ. Hãy tải lại trang chính.', 401);
      if (request.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 12) throw new UserError('Đã mở nhiều cửa sổ. Đóng bớt tab rồi tải lại.', 429);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
        response.write(`event: state\ndata: ${JSON.stringify(cleaner.state())}\n\n`);
        clients.set(response, { revision: cleaner.revision, sentAt: Date.now() });
        response.on('close', () => clients.delete(response));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') return send(response, 200, cleaner.state());
      if (request.method === 'GET' && url.pathname === '/api/items') {
        const view = url.searchParams.get('view') || 'suggestions';
        const sort = url.searchParams.get('sort') || 'size-desc';
        const page = Number(url.searchParams.get('page') || 1);
        const query = url.searchParams.get('q') || '';
        if (!['size-desc', 'size-asc', 'name', 'modified'].includes(sort) || !Number.isSafeInteger(page) || page < 1 || query.length > 300) throw new UserError('Bộ lọc không hợp lệ.');
        return send(response, 200, await cleaner.list({ view, rootId: url.searchParams.get('rootId') || cleaner.defaultRootId, directoryId: url.searchParams.get('directoryId') || url.searchParams.get('rootId') || cleaner.defaultRootId, query, sort, page }));
      }
      if (request.method === 'GET' && /^\/api\/items\/i\d+$/.test(url.pathname)) return send(response, 200, cleaner.publicItem(cleaner.item(url.pathname.split('/').at(-1))));
      if (request.method !== 'POST') throw new UserError('Không tìm thấy yêu cầu.', 404);
      if (request.headers.origin !== origin || request.headers['x-disk-cleaner'] !== '1') throw new UserError('Thiếu xác thực nguồn thao tác.', 403);
      const body = await readBody(request);
      if (url.pathname === '/api/scans') return send(response, 202, cleaner.startScan(body.rootIds, body.mode, body.force === true));
      if (url.pathname === '/api/scans/cancel') return send(response, 200, await cleaner.cancelScan());
      if (url.pathname === '/api/pick-folder') {
        const target = await pickFolder(cleaner.home);
        return send(response, 200, target ? { root: await cleaner.registerRoot(target) } : { root: null });
      }
      if (url.pathname === '/api/trash/preview') return send(response, 200, await cleaner.previewTrash(body.ids, body.versions));
      if (url.pathname === '/api/trash') return send(response, 200, await cleaner.executeTrash(body.confirmationId, body.acknowledgeRisk));
      if (url.pathname === '/api/reveal') { await cleaner.reveal(body.id); return send(response, 200, { ok: true }); }
      if (url.pathname === '/api/permissions') {
        await cleaner.command('/usr/bin/open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
        return send(response, 200, { ok: true });
      }
      throw new UserError('Không tìm thấy yêu cầu.', 404);
    } catch (error) { send(response, error.status || 500, { error: describeError(error) }); }
  });
  server.requestTimeout = 310000;
  server.headersTimeout = 15000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  cookieName = `disk_cleaner_${server.address().port}`;
  const updates = setInterval(() => {
    const now = Date.now();
    for (const [response, previous] of clients) {
      if (previous.revision === cleaner.revision || now - previous.sentAt < 250) continue;
      if (response.writableLength > 65536) { response.destroy(); continue; }
      response.write(`event: state\ndata: ${JSON.stringify(cleaner.state())}\n\n`);
      clients.set(response, { revision: cleaner.revision, sentAt: now });
    }
  }, 250);
  const heartbeat = setInterval(() => { for (const response of clients.keys()) response.write(': keepalive\n\n'); }, 15000);
  server.on('close', () => { clearInterval(updates); clearInterval(heartbeat); });
  return { server, origin, cleaner };
}
