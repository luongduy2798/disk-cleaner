import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { DiskCleaner, LARGE_FILE_BYTES, allocatedBytes, classify, inside, normalizeRoots, scanProgress, storageCategory } from '../lib/cleaner.mjs';
import { startServer } from '../lib/server.mjs';

// Chỉ tạo dữ liệu tạm trong repository. Mọi thao tác Thùng rác và lệnh macOS đều được giả lập.
const temporary = await fs.mkdtemp(path.join(process.cwd(), '.disk-cleaner-self-check-'));
let application;
try {
  const fixture = await fs.realpath(temporary);
  const home = path.join(fixture, 'home');
  for (const relative of ['.npm/_cacache', '.hidden/deep', 'Downloads', 'linked', 'denied', 'mounted', 'project/node_modules', 'project/.next', 'Library/Application Support/Code/Cache', 'Library/Application Support/Code/CachedData', 'Desktop/workspace/app/node_modules']) {
    await fs.mkdir(path.join(home, relative), { recursive: true });
  }
  await fs.mkdir(path.join(fixture, 'outside'));
  const oddName = 'Tiếng Việt <script> & "\t\n$(touch NEVER).bin';
  const oddPath = path.join(home, oddName);
  const failedPath = path.join(home, 'cannot-move.bin');
  const largePath = path.join(home, 'large.bin');
  const cachedLargePath = path.join(home, 'Library/Application Support/Code/Cache/cached.bin');
  const deniedCachePath = path.join(home, 'Library/Application Support/Code/CachedData');
  await fs.writeFile(oddPath, 'Dữ liệu thử nghiệm');
  await fs.writeFile(failedPath, 'Giữ lại nếu giả lập thất bại');
  await fs.writeFile(largePath, 'Dung lượng được giả lập bằng metadata');
  await fs.writeFile(cachedLargePath, 'Cache có dung lượng giả lập');
  await fs.writeFile(path.join(home, 'linked/a'), 'Một inode, hai đường dẫn');
  await fs.link(path.join(home, 'linked/a'), path.join(home, 'linked/b'));
  await fs.writeFile(path.join(home, '.npm/_cacache/data'), 'cache');
  await fs.writeFile(path.join(home, '.hidden/deep/data'), 'file ẩn');
  await fs.writeFile(path.join(home, 'denied/secret'), 'Không được đọc');
  await fs.writeFile(path.join(home, 'mounted/external'), 'Filesystem khác');
  await fs.writeFile(path.join(home, 'project/package.json'), '{}');
  await fs.writeFile(path.join(home, 'project/node_modules/dependency'), 'dependency');
  await fs.writeFile(path.join(home, 'Desktop/workspace/app/package.json'), '{}');
  await fs.writeFile(path.join(home, 'Desktop/workspace/app/node_modules/dependency'), 'dependency');
  await fs.symlink(path.join(fixture, 'outside'), path.join(home, 'outside-link'));
  const sparsePath = path.join(home, 'sparse.bin');
  const sparse = await fs.open(sparsePath, 'w');
  try { await sparse.truncate(LARGE_FILE_BYTES * 2); }
  finally { await sparse.close(); }

  assert.equal(allocatedBytes({ blocks: 0, size: LARGE_FILE_BYTES * 2 }), 0, 'Sparse file không dùng dung lượng logic làm dung lượng cấp phát.');
  const progressFixture = { mode: 'quick', stage: 'measure', status: 'running', measuredSuggestions: 1, totalSuggestions: 4 };
  assert.equal(scanProgress(progressFixture).percent, 25);
  assert.equal(scanProgress({ ...progressFixture, stage: 'spotlight' }).percent, null, 'Chưa biết tổng số mục thì không tạo phần trăm giả.');
  assert.equal(scanProgress({ ...progressFixture, measuredSuggestions: 4 }).percent, 99, 'Không báo 100% khi lượt quét còn chạy.');
  assert.equal(scanProgress({ ...progressFixture, status: 'cancelled' }).percent, 25, 'Huỷ giữ tiến độ hiện có, không báo hoàn tất.');
  assert.equal(scanProgress({ ...progressFixture, status: 'partial' }).percent, 100, '100% là lượt quét đã kết thúc, không khẳng định kết quả đầy đủ.');
  assert.equal(scanProgress({ mode: 'deep', status: 'running', completedBranches: 1, totalBranches: 4 }).estimated, true);
  assert.deepEqual(normalizeRoots([home, path.join(home, '.hidden'), home]), [home]);
  assert.equal(inside(`${home}-other`, home), false, 'So khớp theo thành phần đường dẫn.');
  assert.equal(classify(oddPath, home).risk, 'unknown');
  assert.equal(classify(path.join(home, 'somewhere/cache'), home).risk, 'unknown', 'Tên cache đơn lẻ không chứng minh có thể dọn.');
  assert.equal(classify(path.join(home, 'Library/Developer/CoreSimulator/Devices'), home).risk, 'high');
  assert.equal(classify(path.join(home, '.rustup/toolchains'), home).risk, 'high');
  assert.equal(classify(path.join(home, 'Downloads/only-copy.zip'), home).risk, 'high');
  assert.equal(classify(path.join(home, 'Library/Application Support/Code/Cache'), home).candidate, true);
  assert.equal(classify(path.join(home, 'Library/Application Support/Code/User/History'), home).candidate, false, 'Lịch sử chỉnh sửa không phải cache.');
  assert.equal(classify(path.join(home, 'Library/Application Support/Code'), home).risk, 'high');
  assert.equal(classify(path.join(home, 'Library/Caches/Google/AndroidStudio2024.2/caches'), home).candidate, true);
  assert.equal(classify(path.join(home, 'Library/Caches/Google/AndroidStudio2024.2/LocalHistory'), home).risk, 'high');
  assert.equal(classify(path.join(home, 'Library/Caches/Google'), home).candidate, false, 'Không gợi ý thư mục cha chứa cả LocalHistory.');
  assert.equal(classify(path.join(home, 'Library/Caches/com.tinyapp.TablePlus'), home).candidate, false, 'Chỉ gợi ý cache trình cập nhật đã nhận diện.');
  assert.equal(classify(path.join(home, '.cache/avatar-studio'), home).candidate, false, 'Tên cache không chứng minh có thể tạo lại mã nguồn và mô hình.');
  assert.equal(classify(path.join(home, 'Library/Android/sdk'), home).candidate, false);
  assert.equal(storageCategory('/Applications/Example.app/Contents/program', home), 'applications');
  assert.equal(storageCategory(path.join(home, '.npm/_cacache/package'), home), 'developer');
  assert.equal(storageCategory(path.join(home, '.Trash/old-package'), home), 'trash');
  assert.equal(storageCategory('/Library/Logs/service.log', home), 'system');
  assert.equal(storageCategory(path.join(home, 'Documents/photo.jpg'), home), 'documents');

  const statCalls = new Map();
  let activeStats = 0;
  let maximumStats = 0;
  let cancelAt;
  let cleaner;
  const io = {
    ...fs,
    async lstat(target) {
      statCalls.set(target, (statCalls.get(target) || 0) + 1);
      activeStats += 1;
      maximumStats = Math.max(maximumStats, activeStats);
      try {
        if (target === cancelAt) cleaner.scan.controller.abort();
        const stat = await fs.lstat(target);
        if (target === path.join(home, 'mounted')) stat.dev += 1;
        if (target === largePath || target === cachedLargePath) stat.blocks = LARGE_FILE_BYTES * 2 / 512;
        return stat;
      } finally { activeStats -= 1; }
    },
    async opendir(target, options) {
      if (target === path.join(home, 'denied') || target === deniedCachePath) throw Object.assign(new Error('Denied fixture'), { code: 'EACCES' });
      return fs.opendir(target, options);
    },
  };
  const moved = [];
  const options = {
    home, io,
    command: async () => 'Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 10000 4000 6000 40% /fixture\n',
    spotlight: async function* () { throw new Error('Spotlight fixture unavailable'); },
    trash: async (target) => {
      if (target === failedPath) throw Object.assign(new Error('Fixture permission denied'), { code: 'EACCES' });
      moved.push(target);
      await fs.rename(target, path.join(fixture, `mock-trash-${moved.length}`));
    },
  };
  cleaner = new DiskCleaner(options);
  await cleaner.initialize();
  const hidden = await cleaner.inspect(path.join(home, '.hidden'));
  statCalls.clear();
  cleaner.startScan([cleaner.homeId, hidden.id], 'deep');
  assert.throws(() => cleaner.startScan([cleaner.homeId], 'deep'), /dừng/);
  await cleaner.scanTask;
  assert.deepEqual(cleaner.scan.paths, [home]);
  assert.equal(cleaner.scan.status, 'partial');
  assert.ok(cleaner.scan.totalBranches > 0);
  assert.equal(cleaner.scan.completedBranches, cleaner.scan.totalBranches, 'Theo dõi tiến độ ngay trong lượt duyệt, kể cả nhánh không đọc đủ.');
  assert.equal(cleaner.state().scan.progress.percent, 100);
  assert.equal('branchTotals' in cleaner.state().scan, false);
  assert.equal(cleaner.scan.permissionErrors, 2, 'Chỉ EPERM/EACCES được tính là thiếu quyền.');
  assert.equal(cleaner.scan.linksSkipped, 1, 'Symlink được đếm riêng, không báo là thiếu quyền.');
  assert.equal(cleaner.scan.issues[0].kind, 'permission');
  assert.equal(cleaner.scan.issues.some((issue) => issue.path === path.join(home, 'outside-link')), false, 'Không lấp danh sách lỗi bằng từng symlink.');
  assert.ok(maximumStats <= 16, 'Không vượt 16 lstat đồng thời.');
  assert.ok([...statCalls.values()].every((count) => count === 1), 'Mỗi mục chỉ lstat một lần trong lượt quét sâu.');
  assert.equal(statCalls.has(path.join(home, 'denied/secret')), false);
  assert.equal(statCalls.has(path.join(home, 'mounted/external')), false);
  assert.equal([...statCalls.keys()].some((target) => target.startsWith(path.join(home, 'outside-link/'))), false);
  const denied = cleaner.item(cleaner.byPath.get(path.join(home, 'denied')));
  assert.equal(denied.allocatedBytes, null, 'Thư mục thiếu quyền không được hiển thị là 0 byte.');
  assert.equal(denied.sizeState, 'partial');
  assert.ok(cleaner.protection(cleaner.item(cleaner.byPath.get(path.join(home, 'mounted')))), 'Điểm gắn filesystem khác được bảo vệ.');
  const linkedDirectory = cleaner.item(cleaner.byPath.get(path.join(home, 'linked')));
  const linkedStat = await fs.lstat(path.join(home, 'linked'));
  const fileStat = await fs.lstat(path.join(home, 'linked/a'));
  assert.equal(linkedDirectory.allocatedBytes, allocatedBytes(linkedStat) + allocatedBytes(fileStat), 'Hard link chỉ được cộng một lần.');
  assert.ok(cleaner.item(cleaner.homeId).logicalBytes >= LARGE_FILE_BYTES * 2);
  const largeFiles = await cleaner.list({ view: 'files' });
  assert.ok(largeFiles.items.some((item) => item.path === largePath));
  assert.equal(largeFiles.items.some((item) => item.path === sparsePath), false);
  const suggestions = await cleaner.list({ view: 'suggestions' });
  assert.ok(suggestions.items.some((item) => item.path === path.join(home, '.npm/_cacache')));
  assert.ok(suggestions.items.some((item) => item.path === path.join(home, 'project/node_modules')));
  const diagnostics = { errors: 0, permissionErrors: 0, skipped: 0, issues: [] };
  for (let index = 0; index < 25; index += 1) cleaner.recordIssue(diagnostics, path.join(home, `skipped-${index}`), 'Filesystem khác.', false);
  for (let index = 0; index < 25; index += 1) cleaner.recordIssue(diagnostics, path.join(home, `changed-${index}`), 'Không còn tồn tại.', { code: 'ENOENT' });
  cleaner.recordIssue(diagnostics, path.join(home, 'denied'), 'Không có quyền đọc.', { code: 'EACCES' });
  assert.equal(diagnostics.issues.length, 20);
  assert.equal(diagnostics.issues[0].code, 'EACCES', 'Lỗi quyền xuất hiện sau nhiều mục bỏ qua vẫn được hiển thị trước.');
  assert.equal(diagnostics.permissionErrors, 1);
  assert.equal(diagnostics.errors, 26);
  assert.equal(diagnostics.skipped, 25);

  await cleaner.list({ view: 'folders' });
  const odd = cleaner.item(cleaner.byPath.get(oddPath));
  assert.equal(odd.name, oddName, 'Giữ nguyên tên Unicode, tab, newline và ký tự HTML/shell.');
  const failed = cleaner.item(cleaner.byPath.get(failedPath));
  const versions = (...items) => Object.fromEntries(items.map((item) => [item.id, item.version]));
  const link = cleaner.item(cleaner.byPath.get(path.join(home, 'outside-link')));
  const protectedPreview = await cleaner.previewTrash([cleaner.homeId, link.id], versions(cleaner.item(cleaner.homeId), link));
  assert.equal(protectedPreview.items.length, 0);
  assert.equal(protectedPreview.errors.length, 2);
  const outside = cleaner.upsert(path.join(fixture, 'outside'), await fs.lstat(path.join(fixture, 'outside')));
  assert.ok(cleaner.protection(outside));
  const systemGuard = new DiskCleaner(options);
  systemGuard.roots.add(systemGuard.upsert('/', await fs.lstat(home)).id);
  assert.match(systemGuard.protection({ path: '/System/test', kind: 'directory' }), /hệ thống/);

  const disposable = path.join(home, 'disposable');
  await fs.mkdir(disposable);
  await fs.writeFile(path.join(disposable, 'child'), 'test');
  const parent = await cleaner.inspect(disposable);
  const child = await cleaner.inspect(path.join(disposable, 'child'));
  const collapsed = await cleaner.previewTrash([parent.id, child.id], versions(parent, child));
  assert.equal(collapsed.items.length, 1);
  assert.equal(collapsed.collapsed, 1);

  const switchPath = path.join(home, 'switch');
  await fs.mkdir(switchPath);
  await fs.writeFile(path.join(switchPath, 'data'), 'Bản gốc');
  await fs.writeFile(path.join(fixture, 'outside/data'), 'Dữ liệu bên ngoài');
  const switched = await cleaner.inspect(path.join(switchPath, 'data'));
  const switchPreview = await cleaner.previewTrash([switched.id], versions(switched));
  await fs.rename(switchPath, `${switchPath}-original`);
  await fs.symlink(path.join(fixture, 'outside'), switchPath);
  const switchOutcome = await cleaner.executeTrash(switchPreview.confirmationId, true);
  assert.equal(switchOutcome.results[0].ok, false);
  assert.equal(moved.length, 0, 'Không chuyển dữ liệu khi thư mục cha bị thay bằng symlink.');
  await fs.unlink(switchPath);
  await fs.rename(`${switchPath}-original`, switchPath);

  const changedAfterPreview = await cleaner.previewTrash([odd.id], versions(odd));
  await fs.appendFile(oddPath, 'Thay đổi sau xác nhận xem trước');
  const changedOutcome = await cleaner.executeTrash(changedAfterPreview.confirmationId, true);
  assert.equal(changedOutcome.results[0].ok, false, 'Kiểm tra lại metadata ngay trước khi chuyển Thùng rác.');
  assert.equal(moved.length, 0);

  const originalVersion = odd.version;
  await fs.appendFile(oddPath, 'Thay đổi sau lúc chọn');
  const staleOnDisk = await cleaner.previewTrash([odd.id], { [odd.id]: originalVersion });
  assert.equal(staleOnDisk.items.length, 0);
  await cleaner.inspect(oddPath);
  const staleSelection = await cleaner.previewTrash([odd.id], { [odd.id]: originalVersion });
  assert.equal(staleSelection.items.length, 0, 'Không dùng phiên bản mới để âm thầm thay đổi lựa chọn cũ.');

  cancelAt = path.join(home, 'linked');
  cleaner.startScan([cleaner.homeId], 'deep', true);
  await cleaner.scanTask;
  assert.equal(cleaner.scan.status, 'cancelled');
  assert.equal(cleaner.activeIO, 0);
  assert.equal(cleaner.ioWaiters.length, 0);
  cancelAt = undefined;
  cleaner.startScan([linkedDirectory.id], 'deep', true);
  await cleaner.scanTask;
  assert.equal(cleaner.scan.status, 'complete', 'Quét thư mục riêng không phụ thuộc phần bị thiếu quyền trong Home.');
  cleaner.startScan([cleaner.homeId], 'quick', true);
  await cleaner.scanTask;
  assert.equal(cleaner.scan.status, 'partial');
  assert.ok(cleaner.scan.issues.some((issue) => issue.message.includes('Spotlight')), 'Spotlight thất bại phải được báo, không kết luận không có file.');
  cleaner.spotlight = async function* () { yield largePath; yield cachedLargePath; yield oddPath; };
  cleaner.startScan([cleaner.homeId], 'quick', true);
  await cleaner.scanTask;
  assert.equal(cleaner.scan.status, 'partial', 'Spotlight thành công vẫn không phải một lượt quét đầy đủ.');
  assert.equal(cleaner.scan.large, 2, 'File được Spotlight tìm thấy rồi đo trong cache không bị đếm hai lần.');

  const quickCleaner = new DiskCleaner({ ...options, spotlight: cleaner.spotlight });
  await quickCleaner.initialize();
  quickCleaner.startScan([quickCleaner.homeId], 'quick');
  await quickCleaner.scanTask;
  const quickSuggestions = await quickCleaner.list({ view: 'suggestions' });
  for (const relative of ['Library/Application Support/Code/Cache', 'Desktop/workspace/app/node_modules']) {
    const suggestion = quickSuggestions.items.find((item) => item.path === path.join(home, relative));
    assert.ok(suggestion, 'Tự khám phá cache ứng dụng và dependency dự án khi chưa quét sâu.');
    assert.equal(suggestion.sizeState, 'complete', 'Gợi ý được tự tính dung lượng trong lượt quét nhanh.');
    assert.ok(suggestion.allocatedBytes > 0);
    assert.ok(suggestion.measuredAt);
  }
  const deniedQuickCache = quickSuggestions.items.find((item) => item.path === deniedCachePath);
  assert.equal(deniedQuickCache.allocatedBytes, null, 'Cache thiếu quyền không được coi là rỗng.');
  assert.equal(deniedQuickCache.sizeState, 'partial');
  assert.ok(deniedQuickCache.accessError);
  assert.equal(quickCleaner.scan.measuredSuggestions, quickCleaner.scan.totalSuggestions);
  assert.ok(quickCleaner.scan.totalSuggestions > 0);
  assert.equal(quickCleaner.scan.large, 2);

  await cleaner.inspect(oddPath);
  const secondPreview = await cleaner.previewTrash([odd.id, failed.id], versions(odd, failed));
  assert.equal(secondPreview.requiresAcknowledgement, true);
  await assert.rejects(cleaner.executeTrash(secondPreview.confirmationId, false), /xác nhận/);
  const outcome = await cleaner.executeTrash(secondPreview.confirmationId, true);
  assert.equal(outcome.results.filter((item) => item.ok).length, 1);
  assert.equal(outcome.results.filter((item) => !item.ok).length, 1);
  assert.deepEqual(moved, [oddPath]);
  assert.equal(cleaner.items.has(odd.id), false);
  assert.equal(await fs.readFile(failedPath, 'utf8'), 'Giữ lại nếu giả lập thất bại');
  assert.equal(cleaner.cache.size, 0);
  assert.equal(cleaner.scan.usageStale, true);
  assert.deepEqual(cleaner.scan.usage, {});
  assert.equal(cleaner.item(cleaner.homeId).sizeState, 'stale');
  await assert.rejects(cleaner.executeTrash(secondPreview.confirmationId, true), /hết hạn/);

  const startup = path.join(fixture, 'startup');
  const startupHome = path.join(startup, 'Users/owner');
  const startupFiles = ['System/Library/kernel.bin', 'Applications/Example.app/Contents/program', 'Users/owner/Documents/report', 'Users/owner/.npm/_cacache/a', 'Users/owner/.Trash/old', 'Library/global', 'private/data', 'opt/tool', 'System/Volumes/Data/physical-alias', 'Volumes/External/file', 'Users/owner/mounted/file'];
  for (const relative of startupFiles) {
    const target = path.join(startup, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'metadata fixture');
  }
  await fs.link(path.join(startupHome, '.npm/_cacache/a'), path.join(startupHome, '.npm/_cacache/b'));
  const startupStats = new Map();
  const startupIO = {
    ...fs,
    async lstat(target) {
      startupStats.set(target, (startupStats.get(target) || 0) + 1);
      const stat = await fs.lstat(target);
      const relative = path.relative(startup, target);
      stat.dev = /^(?:Applications|Users|Library|private|opt)(?:\/|$)/.test(relative) || relative.startsWith('System/Volumes/Data') ? 20 : 10;
      if (inside(target, path.join(startup, 'Volumes/External')) || inside(target, path.join(startupHome, 'mounted'))) stat.dev = 30;
      stat.blocks = stat.isFile() ? 8 : 0;
      return stat;
    },
  };
  const startupCleaner = new DiskCleaner({
    home: startupHome, startupRoot: startup, io: startupIO,
    spotlight: async function* () {},
    command: async (command, args, settings) => {
      if (command === '/bin/df') {
        const mounted = args.at(-1) === startup ? startup : inside(args.at(-1), path.join(startup, 'Volumes/External')) ? path.join(startup, 'Volumes/External') : path.join(startup, 'System/Volumes/Data');
        return `Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 10000 4000 6000 40% ${mounted}\n`;
      }
      if (command === '/usr/bin/plutil') return settings.input;
      assert.equal(command, '/usr/sbin/diskutil', 'Tổng APFS không cần cộng df từ nhiều volume.');
      assert.ok([startup, path.join(startup, 'System/Volumes/Data'), path.join(startup, 'Volumes/External')].includes(args.at(-1)), 'diskutil nhận mountpoint từ df, không nhận thư mục Home.');
      return JSON.stringify({ APFSContainerSize: 245107195904, APFSContainerFree: 2000000000, APFSContainerReference: args.at(-1) === path.join(startup, 'Volumes/External') ? 'external-container' : 'fixture-container', CapacityInUse: args.at(-1) === startup ? 13000000000 : 200000000000, VolumeName: args.at(-1) === startup ? 'Macintosh HD' : 'Data', MountPoint: args.at(-1) });
    },
    trash: async () => { throw new Error('Không dọn fixture toàn ổ.'); },
  });
  await startupCleaner.initialize();
  assert.equal(startupCleaner.item(startupCleaner.defaultRootId).path, startup);
  assert.notEqual(startupCleaner.defaultRootId, startupCleaner.homeId);
  const startupDisk = startupCleaner.state().roots.find((root) => root.id === startupCleaner.defaultRootId).disk;
  assert.equal(startupDisk.total, 245107195904);
  assert.equal(startupDisk.used, 243107195904, 'Đã dùng bằng tổng container trừ chỗ trống, gồm các volume phụ.');
  assert.equal(startupDisk.systemBytes, 13000000000);
  assert.deepEqual(startupDisk.devices, [10, 20]);
  assert.equal(startupCleaner.state().roots.find((root) => root.id === startupCleaner.homeId).disk.name, 'Macintosh HD');
  startupStats.clear();
  startupCleaner.startScan([startupCleaner.defaultRootId, startupCleaner.homeId], 'deep');
  await startupCleaner.scanTask;
  assert.deepEqual(startupCleaner.scan.paths, [startup]);
  assert.equal(startupCleaner.scan.wholeStartup, true);
  assert.equal(startupCleaner.scan.errors, 0);
  for (const relative of ['Applications/Example.app/Contents/program', 'Users/owner/Documents/report', 'Library/global', 'private/data', 'opt/tool', 'System/Library/kernel.bin']) assert.ok(startupStats.has(path.join(startup, relative)), 'Quét cả dữ liệu ngoài Home và volume macOS.');
  for (const relative of ['System/Volumes/Data/physical-alias', 'Volumes/External/file', 'Users/owner/mounted/file']) assert.equal(startupStats.has(path.join(startup, relative)), false, 'Không quét lại bản ánh xạ Data hoặc đi vào ổ ngoài.');
  assert.ok([...startupStats.values()].every((count) => count === 1));
  assert.equal(startupCleaner.scan.usage[20].applications, 4096);
  assert.equal(startupCleaner.scan.usage[20].developer, 4096, 'Phân nhóm cũng chỉ cộng một lần cho hard link.');
  assert.equal(startupCleaner.scan.usage[20].trash, 4096);
  assert.ok(startupCleaner.protection(startupCleaner.item(startupCleaner.byPath.get(path.join(startup, 'Applications')))));
  const mountedResult = await startupCleaner.list({ view: 'folders', directoryId: startupCleaner.byPath.get(path.join(startupHome, 'mounted')) });
  assert.match(mountedResult.accessError, /Filesystem khác/);
  assert.equal(mountedResult.items.length, 0);
  startupCleaner.startScan([startupCleaner.defaultRootId], 'quick', true);
  await startupCleaner.scanTask;
  assert.equal(startupCleaner.scan.usage[20].applications, 4096, 'Quét nhanh toàn ổ vẫn đo được Ứng dụng trên volume Data.');
  assert.equal(startupCleaner.scan.usage[20].developer, 4096);
  assert.equal(startupCleaner.scan.usage[20].trash, 4096);
  const external = await startupCleaner.registerRoot(path.join(startup, 'Volumes/External'));
  startupCleaner.startScan([startupCleaner.defaultRootId, external.id], 'deep', true);
  await startupCleaner.scanTask;
  assert.deepEqual(startupCleaner.scan.paths, [startup, external.path], 'Ổ ngoài được chọn rõ ràng phải có lượt quét riêng dù đường dẫn nằm dưới /Volumes.');
  assert.ok(startupStats.has(path.join(external.path, 'file')));
  assert.equal(startupCleaner.scan.usage[30].documents, 4096);

  application = await startServer(new DiskCleaner(options));
  const { origin } = application;
  assert.equal((await fetch(`${origin}/api/state`)).status, 401);
  const document = await fetch(origin);
  assert.equal(document.status, 200);
  assert.match(document.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(document.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const cookie = document.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } })).status, 200);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const request = http.get(`${origin}/api/state`, { headers: { Cookie: cookie, Host: 'attacker.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on('error', reject);
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await fetch(`${origin}/api/scans`, { method: 'POST', headers: { Cookie: cookie, Origin: 'http://attacker.example', 'Content-Type': 'application/json', 'X-Disk-Cleaner': '1' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${origin}/api/scans`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Disk-Cleaner': '1' }, body: '{invalid' })).status, 400);
  console.log('Self-check hoàn tất: quét, metadata, huỷ, phân loại, bảo vệ dữ liệu, Thùng rác giả lập và HTTP local.');
} finally {
  if (application) {
    await application.cleaner.cancelScan();
    await new Promise((resolve) => { application.server.close(resolve); application.server.closeAllConnections(); });
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
