#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const home = os.homedir();
const bytesInGiB = 1024 ** 3;
const minLargeFileBytes = 100 * 1024 ** 2;
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const color = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

const protectedPaths = new Set([
  '/',
  '/System',
  '/Library',
  '/Applications',
  home,
  path.join(home, 'Library'),
  path.join(home, 'Desktop'),
  path.join(home, 'Downloads'),
  path.join(home, 'Documents'),
]);

const suggestions = [
  { label: 'npm cache', target: '~/.npm/_cacache', reason: 'Rebuildable npm package cache.' },
  { label: 'pnpm cache', target: '~/Library/Caches/pnpm', reason: 'Rebuildable pnpm package cache.' },
  { label: 'Yarn cache', target: '~/Library/Caches/Yarn', reason: 'Rebuildable Yarn package cache.' },
  { label: 'Gradle cache', target: '~/.gradle/caches', reason: 'Rebuildable Android/Gradle cache.' },
  { label: 'Dart analysis cache', target: '~/.dartServer', reason: 'Rebuildable Dart analyzer cache.' },
  { label: 'Codex runtime cache', target: '~/.cache/codex-runtimes', reason: 'Rebuildable tool runtime cache.' },
  { label: 'Homebrew downloads', target: '~/Library/Caches/Homebrew/downloads', reason: 'Re-downloadable Homebrew bottles/installers.' },
  { label: 'VS Code updater cache', target: '~/Library/Caches/com.microsoft.VSCode.ShipIt', reason: 'Old VS Code updates.' },
  { label: 'Telegram updater cache', target: '~/Library/Caches/ru.keepcoder.Telegram', reason: 'Old Telegram update zips.' },
  { label: 'Stremio cache', target: '~/Library/Application Support/stremio-server/stremio-cache', reason: 'Rebuildable Stremio streaming cache.' },
  { label: 'Chrome on-device AI model', target: '~/Library/Application Support/Google/Chrome/OptGuideOnDeviceModel', reason: 'Re-downloadable Chrome on-device AI model.' },
  { label: 'Chrome on-device classifier model', target: '~/Library/Application Support/Google/Chrome/OptGuideOnDeviceClassifierModel', reason: 'Re-downloadable Chrome on-device classifier model.' },
  { label: 'Google updater CRX cache', target: '~/Library/Application Support/Google/GoogleUpdater/crx_cache', reason: 'Re-downloadable Google updater component cache.' },
  { label: 'Cypress cache', target: '~/Library/Caches/Cypress', reason: 'Re-downloadable Cypress binaries.' },
  { label: 'CocoaPods cache', target: '~/Library/Caches/CocoaPods', reason: 'Rebuildable iOS dependency cache.' },
  { label: 'CocoaPods repos', target: '~/.cocoapods/repos', reason: 'Re-downloadable CocoaPods specs/repos.' },
  { label: 'SwiftPM cache', target: '~/Library/Caches/org.swift.swiftpm', reason: 'Rebuildable Swift package cache.' },
  { label: 'Rustup toolchains', target: '~/.rustup/toolchains', reason: 'Reinstallable Rust toolchains; skip if you need offline builds.' },
  { label: 'Cargo registry cache', target: '~/.cargo/registry', reason: 'Rebuildable Rust package registry cache.' },
  { label: 'Android build cache', target: '~/.android/build-cache', reason: 'Rebuildable Android build cache.' },
  { label: 'Go build cache', target: '~/Library/Caches/go-build', reason: 'Rebuildable Go build cache.' },
  { label: 'Xcode iOS DeviceSupport', target: '~/Library/Developer/Xcode/iOS DeviceSupport', reason: 'Recreated when debugging real devices.' },
  { label: 'CoreSimulator devices', target: '~/Library/Developer/CoreSimulator/Devices', reason: 'Simulator data; skip if you need simulator state.' },
];

const fullDiskAccessCheckPaths = [
  '~/Library/Messages',
  '~/Library/Mail',
  '~/Library/Safari',
  '~/Library/Application Support/MobileSync',
  '~/Pictures/Photos Library.photoslibrary',
].map(expandPath);

const roots = [
  '~',
  '~/Library',
  '~/Desktop',
  '~/Downloads',
  '~/Library/Caches',
  '~/Library/Application Support',
  '~/Library/Containers',
  '~/Library/Group Containers',
  '~/Library/Developer',
  '~/.cache',
  '~/.npm',
  '~/.gradle',
  '~/.pub-cache',
  '~/fvm',
].map(expandPath);

const fileScanRoots = [
  '~/Desktop',
  '~/Downloads',
  '~/Library/Caches',
  '~/Library/Application Support',
  '~/Library/Developer',
  '~/.npm',
  '~/.gradle',
  '~/.pub-cache',
  '~/fvm',
].map(expandPath);

const installerScanRoots = [
  '~/Downloads',
  '~/Library/Caches/Homebrew/downloads',
  '~/Library/Caches/sideloadly',
  '~/Library/Caches/ru.keepcoder.Telegram',
].map(expandPath);

const installerExtensions = new Set(['.dmg', '.pkg', '.zip', '.ipa']);
const minInstallerBytes = 50 * 1024 ** 2;
const installerReason = 'Downloaded installer/archive; safe to remove if already installed or no longer needed.';

let screen = 'home';
let cursor = 0;
let rows = [];
let status = 'Đang tải...';
let busy = false;
let scanToken = 0;
let scanStartedAt = 0;
let spinnerIndex = 0;
let spinnerTimer = null;
let currentAbortController = null;
let folderRoot = null;
let returnStack = [];
let pendingTrashPath = null;
let pendingDeleteMode = 'trash';
let scanPreviewRows = [];
let scanResultRows = [];
let scanProgress = { root: '', checked: 0, found: 0, doneRoots: 0, totalRoots: 0 };
let scanState = 'idle';
let activeScanKey = null;
let selectedScanKey = null;
const screenCache = new Map();

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
if (process.stdout.isTTY) process.stdout.write('\x1b[?1049h\x1b[?25l');
process.stdin.on('keypress', async (input, key) => {
  const keyValue = (key?.name || key?.sequence || input || '').toLowerCase();
  const isDeleteKey = keyValue === 'd' || key?.name === 'delete' || key?.name === 'backspace' || key?.sequence === '\x7f';
  if (key?.ctrl && key.name === 'c') quit();
  if (pendingTrashPath) {
    if (keyValue === 'y') {
      const target = pendingTrashPath;
      const mode = pendingDeleteMode;
      pendingTrashPath = null;
      await trashPath(target, { confirmed: true, mode });
    } else if (keyValue === 'n' || keyValue === 'q' || key.name === 'escape' || key.name === 'return') {
      pendingTrashPath = null;
      status = 'Đã huỷ';
    }
    render();
    return;
  }
  if (screen === 'permission') {
    if (key.name === 'up') cursor = Math.max(0, cursor - 1);
    else if (key.name === 'down') cursor = Math.min(rows.length - 1, cursor + 1);
    else if (key.name === 'return') await activate();
    else if (keyValue === 'o') await openFullDiskAccessSettings();
    else if (keyValue === 'r') await boot();
    else if (key.name === 'escape') quit();
    render();
    return;
  }
  if (busy && (keyValue === 'p' || key?.sequence === ' ')) {
    pauseScan('Đã tạm dừng quét');
    status = 'Đã tạm dừng quét';
    render();
    return;
  }
  if (busy && key.name === 'up') {
    cursor = Math.max(0, cursor - 1);
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'down') {
    cursor = Math.min(Math.max(0, scanResultRows.length - 1), cursor + 1);
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'pageup') {
    cursor = Math.max(0, cursor - pageSize());
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'pagedown') {
    cursor = Math.min(Math.max(0, scanResultRows.length - 1), cursor + pageSize());
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'home') {
    cursor = 0;
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'end') {
    cursor = Math.max(0, scanResultRows.length - 1);
    selectedScanKey = rowKey(getBusyItemAtCursor());
    render();
    return;
  }
  if (busy && key.name === 'return') {
    pauseScan('Đã tạm dừng quét');
    await activate(getActiveItem());
    return;
  }
  if (busy && keyValue === 'q') {
    await backScreen();
    render();
    return;
  }
  if (busy && key.name === 'escape') {
    quit();
    return;
  }
  if (busy && isDeleteKey) {
    status = 'Đợi quét xong rồi nhấn d để xoá.';
    render();
    return;
  }
  if (busy) return;
  if (key.name === 'up') cursor = Math.max(0, cursor - 1);
  else if (key.name === 'down') cursor = Math.min(rows.length - 1, cursor + 1);
  else if (key.name === 'pageup') cursor = Math.max(0, cursor - pageSize());
  else if (key.name === 'pagedown') cursor = Math.min(rows.length - 1, cursor + pageSize());
  else if (key.name === 'home') cursor = 0;
  else if (key.name === 'end') cursor = Math.max(0, rows.length - 1);
  else if (key.name === 'return') await activate();
  else if (isDeleteKey) await deleteSelected();
  else if (keyValue === 'r') await loadScreen(screen, { force: true });
  else if (keyValue === 'q') await backScreen();
  else if (key.name === 'escape') quit();
  render();
});

await boot();
render();

async function boot() {
  if (!(await hasFullDiskAccess())) {
    screen = 'permission';
    busy = false;
    status = 'Thiếu Full Disk Access. Không quét để tránh thiếu dữ liệu.';
    rows = [
      row('Cần cấp Full Disk Access', 'Nhấn Enter/o để mở Settings, cấp quyền cho Terminal/iTerm/VS Code/Codex đang chạy tool này.', { action: 'open-settings' }),
      row('Sau khi cấp quyền', 'Thoát/mở lại terminal rồi chạy npm start. Hoặc nhấn Enter/r để kiểm tra lại.', { action: 'recheck' }),
      row('Thoát', 'Nhấn q', { action: 'quit' }),
    ];
    return;
  }
  await loadScreen('home');
}

async function loadScreen(next, options = {}) {
  if (!options.skipSave) saveCurrentCacheCursor();
  const key = cacheKey(next);
  const cached = screenCache.get(key);
  const token = ++scanToken;
  screen = next;
  if (cached && next !== 'home' && !options.force) {
    if (!isCacheValid(next, cached.rows)) {
      screenCache.delete(key);
    } else {
      rows = cached.rows;
      cursor = Math.min(cached.cursor, Math.max(0, rows.length - 1));
      busy = false;
      scanState = 'idle';
      status = cached.status;
      scanPreviewRows = [];
      currentAbortController = null;
      activeScanKey = null;
      stopSpinner();
      render();
      return;
    }
  }
  cursor = cached && options.force ? Math.min(cached.cursor, Math.max(0, cached.rows.length - 1)) : 0;
  busy = true;
  scanState = 'scanning';
  status = '';
  activeScanKey = key;
  scanStartedAt = Date.now();
  currentAbortController = new AbortController();
  rows = [row('Đang quét dữ liệu...', 'p/Space tạm dừng · q quay lại · Esc thoát', {})];
  scanPreviewRows = [];
  scanResultRows = [];
  scanProgress = { root: '', checked: 0, found: 0, doneRoots: 0, totalRoots: 0 };
  startSpinner();
  render();
  try {
    if (screen === 'home') rows = await homeRows();
    if (screen === 'suggestions') rows = await suggestionRows();
    if (screen === 'folders') rows = await topFolderRows();
    if (screen === 'files') rows = await largeFileRows();
    if (screen === 'disk') rows = await diskRows();
    if (token !== scanToken) return;
    status = '';
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
    scanState = 'idle';
    screenCache.set(key, { rows, cursor, status });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    rows = [];
    status = `Lỗi: ${error.message}`;
  } finally {
    if (token !== scanToken) return;
    busy = false;
    stopSpinner();
    currentAbortController = null;
    activeScanKey = null;
    render();
  }
}

async function activate(item = getActiveItem()) {
  if (!item) return;
  if (item.action === 'open-settings') return openFullDiskAccessSettings();
  if (item.action === 'recheck') return boot();
  if (item.action === 'screen') {
    returnStack.push({ screen, folderRoot });
    if (item.screen === 'folders') {
      folderRoot = null;
    }
    return loadScreen(item.screen, { force: true });
  }
  if (item.action === 'quit') quit();
  if (item.path && await isDirectory(item.path)) {
    saveCurrentView();
    returnStack.push({ screen, folderRoot });
    folderRoot = item.path;
    return loadScreen('folders', { skipSave: true, force: true });
  }
  if (item.path) return openInFinder(item.path);
}

async function deleteSelected() {
  const item = getActiveItem();
  if (!item?.path) {
    status = 'Mục này không xoá được.';
    return;
  }
  await trashPath(item.path);
}

function getActiveItem() {
  if (busy && scanResultRows.length) return scanResultRows[cursor];
  if (busy && scanPreviewRows.length) return scanPreviewRows[cursor];
  return rows[cursor];
}

async function backScreen() {
  const wasBusy = busy;
  const wasPaused = scanState === 'paused';
  if (wasBusy) abortScanForBack();
  if (wasPaused) screenCache.delete(cacheKey());
  if (screen === 'home' && !isCacheValid('home', rows)) {
    await loadScreen('home', { skipSave: true, force: true });
    return;
  }
  if (returnStack.length) {
    if (!wasBusy && !wasPaused) saveCurrentCacheCursor();
    const previous = returnStack.pop();
    folderRoot = previous.folderRoot;
    await loadScreen(previous.screen, { skipSave: true, force: previous.screen === 'home' });
    return;
  }
  if (screen !== 'home') {
    folderRoot = null;
    await loadScreen('home', { skipSave: true, force: true });
    return;
  }
  status = 'Đang ở màn hình chính. Nhấn Esc để thoát.';
}

function homeRows() {
  return [
    row('Gợi ý dọn dẹp', 'Cache/artifact dev có thể tạo lại', { action: 'screen', screen: 'suggestions' }),
    row('Thư mục lớn', 'Các thư mục lớn ở những vị trí hay tốn dung lượng', { action: 'screen', screen: 'folders' }),
    row('File lớn', 'File trên 100MB trong home', { action: 'screen', screen: 'files' }),
    row('Dung lượng ổ đĩa', 'Thông tin filesystem hiện tại', { action: 'screen', screen: 'disk' }),
    row('Thoát', '', { action: 'quit' }),
  ];
}

async function suggestionRows() {
  const localToken = scanToken;
  const localSignal = currentAbortController?.signal;
  const found = [];
  let lastPreviewAt = 0;
  const isLive = () => localToken === scanToken && !localSignal?.aborted;
  scanProgress.totalRoots = suggestions.length + installerScanRoots.length;

  const updatePreview = () => {
    if (!isLive()) return;
    const now = Date.now();
    if (now - lastPreviewAt < 120) return;
    lastPreviewAt = now;
    const sorted = found.sort((a, b) => b.size - a.size);
    scanResultRows = sorted;
    const top = sorted.slice(0, pageSize());
    scanPreviewRows = top.length ? top : [row('Chưa có kết quả', `Đang tính dung lượng: ${scanProgress.root || 'đang chạy'}`, {})];
    syncBusySelection();
    render();
  };

  for (const item of suggestions) {
    if (!isLive()) return found;
    const target = expandPath(item.target);
    scanProgress.root = displayPath(target);
    lastPreviewAt = 0;
    updatePreview();
    const size = await du(target);
    if (size > 0) {
      scanProgress.found += 1;
      found.push(row(item.label, `${formatBytes(size)}  ${displayPath(target)}  ${item.reason}`, { path: target, size }));
    }
    scanProgress.doneRoots += 1;
    updatePreview();
  }

  for (const root of installerScanRoots) {
    if (!isLive()) return found;
    if (!(await exists(root))) {
      scanProgress.doneRoots += 1;
      continue;
    }
    scanProgress.root = displayPath(root);
    lastPreviewAt = 0;
    updatePreview();
    const files = await installerFilesInRoot(root, isLive);
    for (const file of files) {
      if (!isLive()) return found;
      const size = await du(file);
      if (size < minInstallerBytes) continue;
      scanProgress.found += 1;
      found.push(row(path.basename(file) || file, `${formatBytes(size)}  ${displayPath(file)}  ${installerReason}`, { path: file, size }));
      updatePreview();
    }
    scanProgress.doneRoots += 1;
  }
  return found.sort((a, b) => b.size - a.size);
}

async function topFolderRows() {
  const localToken = scanToken;
  const localSignal = currentAbortController?.signal;
  const found = [];
  let lastPreviewAt = 0;
  const isLive = () => localToken === scanToken && !localSignal?.aborted;
  const existingRoots = [];
  for (const root of folderRoot ? [folderRoot] : roots) {
    if (await exists(root)) existingRoots.push(root);
  }
  scanProgress.totalRoots = existingRoots.length;

  const updatePreview = () => {
    if (!isLive()) return;
    const now = Date.now();
    if (now - lastPreviewAt < 120) return;
    lastPreviewAt = now;
    const sorted = found.sort((a, b) => b.size - a.size);
    scanResultRows = sorted;
    const top = sorted.slice(0, pageSize());
    scanPreviewRows = top.length ? top : [row('Chưa có kết quả', `Đang tính dung lượng: ${scanProgress.root || 'đang chạy'}`, {})];
    syncBusySelection();
    render();
  };

  for (const root of existingRoots) {
    if (!isLive()) return found;
    scanProgress.root = displayPath(root);
    lastPreviewAt = 0;
    updatePreview();
    const items = await childEntries(root);
    for (const entry of items) {
      if (!isLive()) return found;
      scanProgress.checked += 1;
      scanProgress.root = displayPath(entry);
      const size = await du(entry);
      if (size > 0) {
        scanProgress.found += 1;
        found.push(row(path.basename(entry) || entry, `${formatBytes(size)}  ${displayPath(entry)}`, { path: entry, size }));
      }
      updatePreview();
    }
    scanProgress.doneRoots += 1;
  }
  return found.sort((a, b) => b.size - a.size).slice(0, 80);
}

async function largeFileRows() {
  const localToken = scanToken;
  const localSignal = currentAbortController?.signal;
  const matches = [];
  const preview = [];
  let lastPreviewAt = 0;
  let activeStats = 0;
  let doneReading = false;
  const statQueue = [];
  let resolveStatsDone;
  const statsDone = new Promise((resolve) => {
    resolveStatsDone = resolve;
  });
  const isLive = () => localToken === scanToken && !localSignal?.aborted;
  const existingRoots = [];
  for (const root of fileScanRoots) {
    if (await exists(root)) existingRoots.push(root);
  }
  scanProgress.totalRoots = existingRoots.length;

  const updatePreview = () => {
    if (!isLive()) return;
    const now = Date.now();
    if (now - lastPreviewAt < 120) return;
    lastPreviewAt = now;
    const sorted = matches.sort((a, b) => b.size - a.size);
    scanResultRows = sorted;
    const top = sorted.slice(0, pageSize());
    scanPreviewRows = top.length
      ? top
      : preview.length
        ? preview.slice(0, 5).map((entry) => row(entry.title, entry.detail, entry))
        : [row('Chưa quét được file nào', `Đang đọc: ${scanProgress.root || 'đang chạy'}`, {})];
    syncBusySelection();
    render();
  };
  const maybeFinishStats = () => {
    if (doneReading && activeStats === 0 && statQueue.length === 0) resolveStatsDone();
  };
  const pumpStats = () => {
    while (activeStats < 16 && statQueue.length > 0 && isLive()) {
      const file = statQueue.shift();
      activeStats += 1;
      fs.stat(file)
        .then((stat) => {
          const allocatedSize = stat.blocks ? stat.blocks * 512 : stat.size;
          if (!isLive() || allocatedSize < minLargeFileBytes) return;
          scanProgress.found += 1;
          const logical = stat.size > allocatedSize * 2 ? ` · ${formatBytes(stat.size)} logical` : '';
          const matched = row(path.basename(file) || file, `${formatBytes(allocatedSize)} used${logical}  ${displayPath(file)}`, {
            path: file,
            size: allocatedSize,
            logicalSize: stat.size,
          });
          matches.push(matched);
          lastPreviewAt = 0;
          updatePreview();
        })
        .catch(() => null)
        .finally(() => {
          activeStats -= 1;
          pumpStats();
          maybeFinishStats();
        });
    }
    maybeFinishStats();
  };

  for (const root of existingRoots) {
    scanProgress.root = displayPath(root);
    lastPreviewAt = 0;
    updatePreview();
    await new Promise((resolve, reject) => {
      const command = spawn(
        'find',
        [root, '-xdev', '-type', 'f', '-print0'],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          signal: localSignal,
        },
      );

      command.stderr.on('data', () => {});
      command.on('error', reject);
      command.on('close', () => resolve());

      let buffer = '';
      command.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\0');
      while (index !== -1) {
        const file = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\0');
        if (!file) continue;

        scanProgress.checked += 1;
        scanProgress.root = scanRootLabel(file);
        const entry = row(path.basename(file) || file, displayPath(file), { path: file });
        preview.unshift(entry);
        if (preview.length > 12) preview.length = 12;

        statQueue.push(file);
        pumpStats();
        updatePreview();
      }
    });
    });
    scanProgress.doneRoots += 1;
  }

  doneReading = true;
  pumpStats();
  await statsDone;
  return matches
    .filter(Boolean)
    .sort((a, b) => b.size - a.size)
    .slice(0, 80);
}

async function diskRows() {
  const output = await run('df', ['-h', '/System/Volumes/Data', '/']);
  const tableRows = output.trim().split('\n').slice(1).map((line) => {
    const [filesystem, size, used, avail, capacity, iused, ifree, percentIused, ...mountedParts] = line.trim().split(/\s+/);
    return [filesystem, size, used, avail, capacity, `${iused}/${ifree} (${percentIused})`, mountedParts.join(' ')];
  });
  return [row('Bảng dung lượng ổ đĩa', { type: 'table', rows: tableRows }, {})];
}

async function trashPath(target, options = {}) {
  const real = await fs.realpath(target).catch(() => target);
  if (protectedPaths.has(real)) {
    status = `Path được bảo vệ: ${displayPath(real)}`;
    return;
  }
  const mode = options.mode || (isInTrash(real) ? 'delete' : 'trash');
  if (!options.confirmed) {
    pendingTrashPath = real;
    pendingDeleteMode = mode;
    return;
  }
  busy = true;
  render();
  try {
    if (mode === 'delete') await fs.rm(real, { recursive: true, force: true });
    else if (await hasCommand('trash')) await run('trash', [real]);
    else await moveToUserTrash(real);
    syncDeletedPath(real);
    if (mode === 'trash') screenCache.delete(`folders:${path.join(home, '.Trash')}`);
    status = mode === 'delete' ? `Đã xoá vĩnh viễn: ${displayPath(real)}` : `Đã chuyển vào Thùng rác: ${displayPath(real)}`;
  } catch (error) {
    status = `${mode === 'delete' ? 'Xoá' : 'Chuyển vào Thùng rác'} thất bại: ${error.message}`;
  } finally {
    busy = false;
    render();
  }
}

async function moveToUserTrash(target) {
  const trashDir = path.join(home, '.Trash');
  const parsed = path.parse(target);
  let dest = path.join(trashDir, parsed.base);
  for (let index = 1; await exists(dest); index += 1) {
    dest = path.join(trashDir, `${parsed.name} ${index}${parsed.ext}`);
  }
  await fs.rename(target, dest);
}

function isInTrash(target) {
  return target === path.join(home, '.Trash') || target.startsWith(`${path.join(home, '.Trash')}${path.sep}`);
}

async function childDirs(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter((dir) => !protectedPaths.has(dir));
  } catch {
    return [];
  }
}

async function childEntries(root) {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() || entry.isFile())
      .map((entry) => path.join(root, entry.name))
      .filter((entryPath) => !protectedPaths.has(entryPath));
  } catch {
    return [];
  }
}

async function installerFilesInRoot(root, isLive) {
  return new Promise((resolve, reject) => {
    const files = [];
    const command = spawn('find', [root, '-type', 'f', '-size', '+50M', '-print0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: currentAbortController?.signal,
    });

    command.stderr.on('data', () => {});
    command.on('error', reject);
    command.on('close', () => resolve(files));

    let buffer = '';
    command.stdout.on('data', (chunk) => {
      if (!isLive()) return;
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\0');
      while (index !== -1) {
        const file = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\0');
        if (installerExtensions.has(path.extname(file).toLowerCase())) files.push(file);
      }
    });
  });
}

async function du(target) {
  if (!(await exists(target))) return 0;
  try {
    const output = await run('du', ['-sk', target]);
    return Number.parseInt(output, 10) * 1024 || 0;
  } catch {
    return 0;
  }
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function openInFinder(target) {
  try {
    await run('open', ['-R', target], { signal: null });
    status = `Đã mở trong Finder: ${displayPath(target)}`;
  } catch (error) {
    status = `Không mở được Finder: ${error.message}`;
  }
}

async function hasCommand(command) {
  try {
    await run('which', [command]);
    return true;
  } catch {
    return false;
  }
}

async function hasFullDiskAccess() {
  for (const target of fullDiskAccessCheckPaths) {
    try {
      await fs.readdir(target);
      return true;
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') return false;
    }
  }
  return true;
}

async function openFullDiskAccessSettings() {
  try {
    await run('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'], { signal: null });
    status = 'Đã mở Settings. Cấp quyền xong hãy restart terminal rồi chạy lại.';
  } catch (error) {
    status = `Không mở được Settings: ${error.message}`;
  }
}

function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: options.maxBuffer ?? 1024 * 1024,
    shell: options.shell ?? false,
    signal: options.signal ?? currentAbortController?.signal,
  }).then(({ stdout }) => stdout);
}

function row(title, detail, extra) {
  return { title, detail, ...extra };
}

function cacheKey(targetScreen = screen) {
  if (targetScreen === 'folders') return `folders:${folderRoot || 'root'}`;
  return targetScreen;
}

function saveCurrentCacheCursor() {
  if (busy || screen === 'permission') return;
  if (screen === 'home') return;
  if (!isCacheValid(screen, rows)) {
    screenCache.delete(cacheKey());
    return;
  }
  screenCache.set(cacheKey(), { rows, cursor, status });
}

function saveCurrentView() {
  if (screen === 'permission' || screen === 'home') return;
  if (!isCacheValid(screen, rows)) return;
  screenCache.set(cacheKey(), { rows, cursor, status });
}

function isCacheValid(targetScreen, targetRows) {
  if (!targetRows.length) return targetScreen !== 'home';
  if (targetScreen === 'home') return targetRows.every((item) => item.action && !item.path);
  return true;
}

function syncDeletedPath(target) {
  const deletedSize = findCachedSize(target) || 0;
  for (const [key, cached] of screenCache) {
    if (key.startsWith('folders:') && key !== 'folders:root' && isSameOrInside(key.slice('folders:'.length), target)) {
      screenCache.delete(key);
      continue;
    }
    const nextRows = cached.rows
      .filter((item) => !item.path || !isSameOrInside(item.path, target))
      .map((item) => {
        if (!deletedSize || !item.path || !item.size || !isSameOrInside(target, item.path)) return item;
        const nextSize = Math.max(0, item.size - deletedSize);
        return { ...item, size: nextSize, detail: replaceDetailSize(item.detail, nextSize) };
      });
    screenCache.set(key, {
      ...cached,
      rows: nextRows,
      cursor: Math.min(cached.cursor, Math.max(0, nextRows.length - 1)),
    });
  }
  const cached = screenCache.get(cacheKey());
  if (cached) {
    rows = cached.rows;
    cursor = cached.cursor;
  }
}

function findCachedSize(target) {
  for (const cached of screenCache.values()) {
    const item = cached.rows.find((rowItem) => rowItem.path && samePath(rowItem.path, target));
    if (item?.size) return item.size;
  }
  return 0;
}

function replaceDetailSize(detail, size) {
  if (typeof detail !== 'string') return detail;
  return detail.replace(/^\d+(?:\.\d+)?[GMK]/, formatBytes(size));
}

function isSameOrInside(value, parent) {
  return samePath(value, parent) || path.resolve(value).startsWith(`${path.resolve(parent)}${path.sep}`);
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function render() {
  if (!busy && screen === 'home' && !isCacheValid('home', rows)) {
    rows = homeRows();
    cursor = Math.min(cursor, rows.length - 1);
    folderRoot = null;
    status = '';
  }
  process.stdout.write('\x1b[2J\x1b[H');
  console.log(paint('disk-cleaner', color.bold, color.cyan));
  console.log(paint('============', color.dim));
  if (pendingTrashPath) {
    console.log(`\n${paint(pendingDeleteMode === 'delete' ? 'Xoá vĩnh viễn?' : 'Chuyển vào Thùng rác?', color.yellow, color.bold)}`);
    console.log(`${paint(displayPath(pendingTrashPath), color.cyan)}`);
    console.log(`\n${paint('y', color.green, color.bold)} ${paint('xoá', color.dim)}  ·  ${paint('n', color.red, color.bold)} ${paint('huỷ', color.dim)}`);
    return;
  }
  console.log(`${paint('Màn hình:', color.dim)} ${paint(screen, color.magenta)}`);
  console.log(busy ? paint(scanStatus(), color.yellow) : paint('Sẵn sàng', color.dim));
  console.log(busy ? scanHelpText() : helpText());
  if (screen === 'folders' && folderRoot) console.log(`${paint('Đường dẫn:', color.dim)} ${paint(displayPath(folderRoot), color.cyan)}`);
  const activeItem = getActiveItem();
  if (!busy && activeItem?.path) console.log(`${paint('Đang chọn:', color.dim)} ${paint(displayPath(activeItem.path), color.cyan)}`);
  console.log(paint('─'.repeat(Math.min(process.stdout.columns || 80, 96)), color.dim));
  if (status) console.log(`\n${paint(status, status.startsWith('Lỗi') || status.includes('thất bại') ? color.red : color.yellow)}`);
  console.log('');
  const allRows = busy ? (scanResultRows.length ? scanResultRows : scanPreviewRows) : rows;
  if (busy) syncBusySelection();
  const { visibleRows, offset } = visibleWindow(allRows);
  if (!allRows.length && !busy) console.log('Không có mục nào.');
  if (offset > 0) console.log(paint(`  ↑ ${offset} mục trên`, color.dim));
  visibleRows.forEach((item, index) => {
    const rowIndex = offset + index;
    const isActive = rowIndex === cursor;
    const active = isActive ? '›' : ' ';
    if (index > 0 || offset > 0) console.log('');
    const line = `${active} ${item.title}`;
    console.log(isActive ? `${paint('›', color.green, color.bold)} ${paint(item.title, color.cyan, color.bold)}` : line);
    if (item.detail?.type === 'table') renderTable(item.detail.rows);
    else if (item.detail) console.log(`    ${renderDetail(truncateLine(item.detail))}`);
  });
  const totalRows = busy && scanResultRows.length ? scanResultRows.length : allRows.length;
  const hiddenBelow = totalRows - offset - visibleRows.length;
  if (hiddenBelow > 0) console.log(`\n${paint(`  ↓ ${hiddenBelow} mục dưới`, color.dim)}`);
}

function visibleWindow(allRows) {
  const headerRows = 9 + (status ? 2 : 0) + (screen === 'folders' && folderRoot ? 1 : 0) + (!busy && getActiveItem()?.path ? 1 : 0);
  const maxRows = pageSize(headerRows);
  const offset = Math.min(Math.max(0, cursor - Math.floor(maxRows / 2)), Math.max(0, allRows.length - maxRows));
  return { visibleRows: allRows.slice(offset, offset + maxRows), offset };
}

function rowKey(item) {
  return item?.path || item?.title || '';
}

function getBusyItemAtCursor() {
  const rows = scanResultRows.length ? scanResultRows : scanPreviewRows;
  return rows[cursor];
}

function syncBusySelection() {
  const rows = scanResultRows.length ? scanResultRows : scanPreviewRows;
  if (!rows.length) return;
  if (selectedScanKey) {
    const index = rows.findIndex((item) => rowKey(item) === selectedScanKey);
    if (index >= 0) {
      cursor = index;
      return;
    }
  }
  cursor = Math.min(cursor, rows.length - 1);
  selectedScanKey = rowKey(rows[cursor]);
}

function pageSize(headerRows = 9 + (status ? 2 : 0)) {
  return Math.max(3, Math.floor(((process.stdout.rows || 24) - headerRows) / 3));
}

function truncateLine(value) {
  const max = Math.max(40, (process.stdout.columns || 100) - 6);
  const text = String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderDetail(detail) {
  const match = String(detail).match(/^(\d+(?:\.\d+)?[GMK])(\s+.*)?$/);
  if (!match) return paint(detail, color.dim);
  const [, size, rest = ''] = match;
  return `${paint(size, size.endsWith('G') ? color.yellow : color.green, color.bold)}${paint(rest, color.dim)}`;
}

function helpText() {
  if (screen === 'permission') {
    return [
      [paint('o', color.green, color.bold), 'mở Settings'],
      [paint('r', color.cyan, color.bold), 'kiểm tra lại'],
      [paint('Esc', color.cyan, color.bold), 'thoát'],
    ].map(([key, text]) => `${key} ${paint(text, color.dim)}`).join(paint('  ·  ', color.dim));
  }
  return [
    [paint('↑/↓', color.yellow, color.bold), 'di chuyển'],
    [paint('PgUp/PgDn', color.yellow, color.bold), 'nhảy'],
    [paint('Enter', color.green, color.bold), 'mở/vào'],
    [paint('d/⌫', color.red, color.bold), 'xoá'],
    [paint('r', color.cyan, color.bold), 'quét lại'],
    [paint('p/Space', color.yellow, color.bold), 'tạm dừng'],
    [paint('q', color.cyan, color.bold), 'quay lại'],
    [paint('Esc', color.cyan, color.bold), 'thoát'],
  ].map(([key, text]) => `${key} ${paint(text, color.dim)}`).join(paint('  ·  ', color.dim));
}

function scanStatus() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  const elapsed = formatElapsed(Date.now() - scanStartedAt);
  if (screen === 'files') {
    return `${frames[spinnerIndex % frames.length]} Đang quét... ${elapsed}  ·  ${scanProgress.doneRoots}/${scanProgress.totalRoots} mục  ·  ${scanProgress.checked} file  ·  ${scanProgress.found} lớn`;
  }
  if (screen === 'folders') {
    return `${frames[spinnerIndex % frames.length]} Đang quét... ${elapsed}  ·  ${scanProgress.doneRoots}/${scanProgress.totalRoots} mục  ·  ${scanProgress.checked} thư mục  ·  ${scanProgress.found} có dữ liệu`;
  }
  if (screen === 'suggestions') {
    return `${frames[spinnerIndex % frames.length]} Đang quét... ${elapsed}  ·  ${scanProgress.doneRoots}/${scanProgress.totalRoots} mục  ·  ${scanProgress.found} có dữ liệu`;
  }
  return `${frames[spinnerIndex % frames.length]} Đang quét... ${elapsed}`;
}

function scanHelpText() {
  return [
    [paint('p/Space', color.yellow, color.bold), 'tạm dừng'],
    [paint('q', color.cyan, color.bold), 'quay lại'],
    [paint('Esc', color.cyan, color.bold), 'thoát'],
  ].map(([key, text]) => `${key} ${paint(text, color.dim)}`).join(paint('  ·  ', color.dim));
}

function renderTable(dataRows) {
  const headers = ['Filesystem', 'Dung lượng', 'Đã dùng', 'Còn trống', 'Tỷ lệ', 'inode', 'Mount'];
  const rows = [headers, ...dataRows];
  const widths = headers.map((_, column) => Math.max(...rows.map((row) => String(row[column] ?? '').length)));
  const border = (left, middle, right) => `    ${left}${widths.map((width) => '─'.repeat(width + 2)).join(middle)}${right}`;
  console.log(paint(border('┌', '┬', '┐'), color.dim));
  rows.forEach((row, index) => {
    if (index === 1) console.log(paint(border('├', '┼', '┤'), color.dim));
    const cells = row.map((cell, column) => {
      const value = ` ${String(cell ?? '').padEnd(widths[column])} `;
      if (index === 0) return paint(value, color.cyan, color.bold);
      if (column === 0) return paint(value, color.cyan);
      if (column === 3) return paint(value, color.green);
      if (column === 4) return paint(value, Number.parseInt(cell, 10) >= 80 ? color.yellow : color.green);
      return value;
    }).join(paint('│', color.dim));
    console.log(`${paint('    │', color.dim)}${cells}${paint('│', color.dim)}`);
  });
  console.log(paint(border('└', '┴', '┘'), color.dim));
}

function paint(value, ...codes) {
  if (!useColor) return value;
  return `${codes.join('')}${value}${color.reset}`;
}

function startSpinner() {
  stopSpinner();
  spinnerTimer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % 10;
    if (busy) render();
  }, 120);
  if (typeof spinnerTimer.unref === 'function') spinnerTimer.unref();
}

function stopSpinner() {
  if (spinnerTimer) clearInterval(spinnerTimer);
  spinnerTimer = null;
}

function pauseScan(message) {
  scanToken += 1;
  currentAbortController?.abort();
  currentAbortController = null;
  busy = false;
  scanState = 'paused';
  stopSpinner();
  if (scanResultRows.length) {
    rows = scanResultRows;
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
  } else if (scanPreviewRows.length) {
    rows = scanPreviewRows;
    cursor = Math.min(cursor, Math.max(0, rows.length - 1));
  }
  selectedScanKey = rowKey(getActiveItem());
  status = message;
}

function abortScanForBack() {
  scanToken += 1;
  if (activeScanKey) screenCache.delete(activeScanKey);
  screenCache.delete(cacheKey());
  currentAbortController?.abort();
  currentAbortController = null;
  activeScanKey = null;
  busy = false;
  scanState = 'cancelled';
  stopSpinner();
}

function scanRootLabel(file) {
  const match = fileScanRoots.find((root) => file.startsWith(root));
  return match ? displayPath(match) : displayPath(path.dirname(file));
}

function expandPath(value) {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return value;
}

function displayPath(value) {
  return value.startsWith(home) ? `~${value.slice(home.length)}` : value;
}

function formatBytes(bytes) {
  if (bytes >= bytesInGiB) return `${(bytes / bytesInGiB).toFixed(1)}G`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`;
  return `${Math.round(bytes / 1024)}K`;
}

function formatElapsed(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return min > 0 ? `${min}:${String(rem).padStart(2, '0')}` : `${rem}s`;
}

function quit() {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h\x1b[?1049l');
  process.stdout.write('\n');
  process.exit(0);
}
