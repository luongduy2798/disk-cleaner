#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { startServer } from '../lib/server.mjs';

if (process.platform !== 'darwin') {
  console.error('Disk Cleaner hiện hỗ trợ macOS.');
  process.exitCode = 1;
} else {
  try {
    const { server, origin, cleaner } = await startServer();
    console.log(`Disk Cleaner: ${origin}\nGiữ cửa sổ terminal này mở. Nhấn Ctrl+C để dừng.`);
    cleaner.startScan([cleaner.defaultRootId], 'quick');
    execFile('/usr/bin/open', [origin], (error) => {
      if (error) console.error('Không mở được trình duyệt. Mở địa chỉ local ở trên.');
    });
    const shutdown = async () => {
      server.close();
      server.closeAllConnections();
      await cleaner.cancelScan();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error('Không khởi động được Disk Cleaner. Kiểm tra quyền truy cập thư mục Home và Node.js >=20.');
    process.exitCode = 1;
  }
}
