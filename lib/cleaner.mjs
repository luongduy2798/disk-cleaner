import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const LARGE_FILE_BYTES = 100 * 1024 ** 2;
export const PAGE_SIZE = 100;
const systemPaths = ['/System', '/Library', '/Applications', '/bin', '/sbin', '/usr', '/opt', '/private', '/dev', '/cores', '/Network'];
const cacheImpact = 'Ứng dụng cần tạo hoặc tải lại dữ liệu; lần chạy sau có thể chậm hơn. Đóng ứng dụng trước khi dọn; tránh dọn nếu cần làm việc offline.';

// target, application, purpose, impact, recovery, risk
const rules = [
  ['.npm/_cacache', 'npm', 'Cache gói npm đã tải.', cacheImpact, 'npm tải lại khi cài dependency.', 'low'],
  ['.npm/_npx', 'npm / npx', 'Các gói đã tải để chạy bằng npx hoặc npm exec.', cacheImpact, 'npx tải lại gói khi chạy; cần mạng và đúng phiên bản.', 'medium'],
  ['.npm/_libvips', 'sharp / libvips', 'Binary libvips đã tải để xử lý ảnh.', cacheImpact, 'Cài lại dependency để tải đúng binary.', 'medium'],
  ['.npm/_prebuilds', 'npm', 'Binary native đã tải khi cài package.', cacheImpact, 'Trình cài package tải hoặc biên dịch lại.', 'medium'],
  ['.npm/_logs', 'npm', 'Log chẩn đoán các lần chạy npm.', 'Mất lịch sử log cần điều tra lỗi cài package; đóng tiến trình npm trước khi dọn.', 'npm tạo log mới; log cũ chỉ khôi phục từ Thùng rác hoặc bản sao lưu.', 'medium'],
  ['.bun/install/cache', 'Bun', 'Cache package Bun; có thể dùng hard link với dependency đã cài.', cacheImpact, 'Bun tải lại package. Các hard link còn tồn tại có thể khiến dung lượng chưa được thu hồi.', 'medium'],
  ['Library/Caches/pnpm', 'pnpm', 'Cache gói pnpm.', cacheImpact, 'pnpm tải lại khi cài dependency.', 'low'],
  ['Library/Caches/Yarn', 'Yarn', 'Cache gói Yarn.', cacheImpact, 'Yarn tải lại khi cài dependency.', 'low'],
  ['.gradle/caches', 'Gradle', 'Dependency và cache build Gradle.', cacheImpact, 'Gradle tải và build lại; cần mạng.', 'medium'],
  ['.gradle/wrapper/dists', 'Gradle Wrapper', 'Các bản Gradle được tải cho dự án.', cacheImpact, 'Gradle Wrapper tải lại đúng bản khi build.', 'medium'],
  ['.dartServer', 'Dart', 'Cache phân tích mã Dart.', cacheImpact, 'Dart analyzer phân tích lại.', 'low'],
  ['.cache/codex-runtimes', 'Codex', 'Runtime do công cụ tải về.', cacheImpact, 'Công cụ cần tải lại runtime.', 'medium'],
  ['Library/Caches/Homebrew/downloads', 'Homebrew', 'Các gói và bộ cài Homebrew đã tải.', cacheImpact, 'Homebrew tải lại khi cần.', 'low'],
  ['Library/Caches/com.microsoft.VSCode.ShipIt', 'VS Code', 'Cache trình cập nhật VS Code.', cacheImpact, 'Trình cập nhật tải lại.', 'low'],
  ['Library/Caches/ru.keepcoder.Telegram', 'Telegram', 'Cache và gói cập nhật Telegram.', cacheImpact, 'Telegram có thể tải lại; nội dung chỉ có local cần được giữ.', 'medium'],
  ['Library/Application Support/stremio-server/stremio-cache', 'Stremio', 'Cache video streaming.', cacheImpact, 'Tải lại nếu nguồn video còn truy cập được.', 'medium'],
  ['Library/Application Support/Google/Chrome/OptGuideOnDeviceModel', 'Chrome', 'Mô hình AI chạy trên máy của Chrome.', cacheImpact, 'Chrome cần tải lại mô hình.', 'medium'],
  ['Library/Application Support/Google/Chrome/OptGuideOnDeviceClassifierModel', 'Chrome', 'Mô hình phân loại nội dung của Chrome.', cacheImpact, 'Chrome cần tải lại mô hình.', 'medium'],
  ['Library/Application Support/Google/GoogleUpdater/crx_cache', 'Google Updater', 'Cache thành phần cập nhật Google.', cacheImpact, 'Trình cập nhật tải lại.', 'low'],
  ['Library/Caches/Cypress', 'Cypress', 'Binary Cypress đã tải.', cacheImpact, 'Chạy cài đặt Cypress để tải lại.', 'medium'],
  ['Library/Caches/CocoaPods', 'CocoaPods', 'Cache dependency iOS.', cacheImpact, 'CocoaPods tải lại khi cài dependency.', 'medium'],
  ['.cocoapods/repos', 'CocoaPods', 'Kho thông tin package CocoaPods.', cacheImpact, 'CocoaPods tải lại kho specs.', 'medium'],
  ['Library/Caches/org.swift.swiftpm', 'SwiftPM', 'Cache Swift Package Manager.', cacheImpact, 'SwiftPM tải và build lại.', 'medium'],
  ['.rustup/toolchains', 'Rustup', 'Các phiên bản compiler và công cụ Rust đã cài.', 'Build Rust và công cụ phụ thuộc có thể ngừng hoạt động cho tới khi cài lại đúng toolchain.', 'Cài lại bằng rustup; cần biết phiên bản và thường cần mạng.', 'high'],
  ['.cargo/registry', 'Cargo', 'Registry và mã nguồn package Rust đã tải.', cacheImpact, 'Cargo tải lại package; build offline có thể thất bại.', 'medium'],
  ['.pub-cache', 'Dart / Flutter', 'Package Dart và Flutter đã tải.', cacheImpact, 'pub tải lại package từ registry hoặc repository; cần mạng.', 'medium'],
  ['.android/build-cache', 'Android', 'Cache build Android.', cacheImpact, 'Build Android tạo lại.', 'medium'],
  ['Library/Caches/go-build', 'Go', 'Cache biên dịch Go.', cacheImpact, 'Go biên dịch lại.', 'low'],
  ['Library/Caches/pip', 'pip', 'Cache package Python đã tải.', cacheImpact, 'pip tải lại package từ nguồn cài đặt.', 'low'],
  ['Library/Caches/com.apple.python', 'Python', 'Cache bytecode Python tại vị trí cache của macOS.', cacheImpact, 'Python biên dịch lại bytecode từ mã nguồn còn tồn tại.', 'low'],
  ['Library/Caches/electron', 'Electron', 'Các bản Electron đã tải cho công cụ phát triển.', cacheImpact, 'Trình cài dependency tải lại Electron.', 'medium'],
  ['Library/Caches/electron-builder', 'electron-builder', 'Cache công cụ đóng gói ứng dụng Electron.', cacheImpact, 'electron-builder tải lại công cụ đóng gói.', 'medium'],
  ['Library/Caches/node-gyp', 'node-gyp', 'Header Node.js đã tải để biên dịch dependency native.', cacheImpact, 'node-gyp tải lại header đúng phiên bản.', 'medium'],
  ['.electron-gyp', 'Electron / node-gyp', 'Header Electron dùng để build module native.', cacheImpact, 'Công cụ build tải lại header phù hợp.', 'medium'],
  ['Library/Caches/ms-playwright', 'Playwright', 'Browser binary và công cụ media phục vụ tự động hoá trình duyệt.', 'Các tác vụ dùng Playwright có thể không chạy tới khi tải lại browser. Không dọn khi đang chạy tác vụ.', 'Cài lại browser tương ứng bằng Playwright; thường cần mạng.', 'medium'],
  ['Library/Caches/com.tinyapp.TablePlus/org.sparkle-project.Sparkle', 'TablePlus', 'Các gói cập nhật TablePlus do Sparkle tải về.', 'Trình cập nhật cần tải lại gói. Đóng TablePlus và đợi cập nhật hoàn tất trước khi dọn.', 'Trình cập nhật TablePlus tải lại; không phải vùng lưu kết nối hay cơ sở dữ liệu.', 'low'],
  ['Library/Caches/Google/Chrome', 'Chrome', 'Cache nội dung web của các profile Chrome.', cacheImpact, 'Chrome tải lại nội dung từ website nếu nguồn còn tồn tại.', 'medium'],
  ['Library/Caches/Google/Chrome-headless', 'Chrome Headless', 'Cache của các phiên Chromium chạy nền.', cacheImpact, 'Tác vụ trình duyệt tạo hoặc tải lại cache.', 'medium'],
  ['.cache/uv', 'uv', 'Cache package và công cụ Python.', cacheImpact, 'uv tải và tạo lại; môi trường offline có thể thiếu package.', 'medium'],
  ['Library/Caches/org.chromium.Chromium', 'Chromium', 'Cache trình duyệt Chromium.', cacheImpact, 'Trình duyệt tải lại từ mạng khi cần.', 'medium'],
  ['Library/Developer/Xcode/DerivedData', 'Xcode', 'Kết quả build, chỉ mục và cache dự án Xcode.', 'Build và lập chỉ mục lại sẽ chậm. Cần giữ dữ liệu thử nghiệm hoặc artifact duy nhất trước khi dọn.', 'Xcode tạo lại từ mã nguồn và cấu hình dự án.', 'medium'],
  ['Library/Developer/Xcode/Archives', 'Xcode', 'Các bản archive ứng dụng đã build, có thể gồm symbol để phân tích crash.', 'Có thể mất bản build dùng phân phối và symbol cần debug crash. Không coi archive là cache.', 'Cần bản sao lưu; build lại chưa chắc tạo đúng artifact và symbol cũ.', 'high'],
  ['Library/Developer/Xcode/iOS DeviceSupport', 'Xcode', 'Dữ liệu hỗ trợ debug thiết bị iOS.', 'Debug trên thiết bị có thể cần tải hoặc tạo lại dữ liệu hỗ trợ.', 'Kết nối lại thiết bị với Xcode; có thể cần tải lại thành phần.', 'medium'],
  ['Library/Developer/CoreSimulator/Devices', 'Xcode Simulator', 'Thiết bị giả lập, ứng dụng và dữ liệu bên trong simulator.', 'Có thể mất ứng dụng, dữ liệu thử nghiệm và trạng thái simulator. Đây không chỉ là cache.', 'Có thể tạo lại thiết bị; dữ liệu bên trong chỉ khôi phục từ bản sao lưu.', 'high'],
  ['Library/Developer/CoreSimulator/Caches', 'Xcode Simulator', 'Cache hỗ trợ chạy simulator.', cacheImpact, 'Xcode và simulator tạo lại cache khi cần.', 'medium'],
];

const appCacheRoots = [
  ['Code', 'VS Code'], ['Cursor', 'Cursor'], ['Antigravity', 'Antigravity'], ['Qoder', 'Qoder'], ['Trae', 'Trae'],
  ['Codex', 'Codex'], ['Postman', 'Postman'], ['bruno', 'Bruno'], ['Electron', 'Electron'], ['discord', 'Discord'],
  ['LCA Codex', 'LCA Codex'], ['Google/Chrome', 'Chrome'], ['Chromium', 'Chromium'], ['CocCoc/Browser', 'Cốc Cốc'],
  ['Figma/DesktopProfile', 'Figma'],
];
const appCacheNames = new Set(['Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'GPUPersistentCache', 'GraphiteDawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'CachedData', 'CachedExtensionVSIXs']);
const profileName = /^(?:Default|Profile \d+|v\d+)$/;

function applicationCache(relative) {
  for (const [appRoot, app] of appCacheRoots) {
    const prefix = `Library/Application Support/${appRoot}/`;
    if (!relative.startsWith(prefix)) continue;
    const parts = relative.slice(prefix.length).split(path.sep);
    const index = profileName.test(parts[0]) ? 1 : 0;
    if (!appCacheNames.has(parts[index]) && !(index === 0 && parts[index] === 'logs')) continue;
    return { relative: prefix + parts.slice(0, index + 1).join(path.sep), app, logs: parts[index] === 'logs' };
  }
  const studio = relative.match(/^(Library\/Caches\/Google\/AndroidStudio[^/]+)\/(caches|index|compile-server|compiler|global-model-cache|tmp|vcs-log|vcs-users)(?:\/|$)/);
  return studio ? { relative: `${studio[1]}/${studio[2]}`, app: 'Android Studio', logs: false } : null;
}

export function inside(target, parent) {
  const relative = path.relative(parent, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function normalizeRoots(values) {
  return [...new Set(values.map((value) => path.resolve(value)))].sort((a, b) => a.length - b.length)
    .filter((value, index, all) => !all.slice(0, index).some((parent) => inside(value, parent)));
}

export function allocatedBytes(stat) {
  return Number.isFinite(stat.blocks) ? stat.blocks * 512 : stat.size;
}

export function storageCategory(target, home) {
  // ponytail: phân nhóm theo vị trí; mở rộng bằng quy tắc ứng dụng đã xác minh khi cần khớp Storage hơn.
  const parts = target.split(path.sep);
  if (parts.some((part) => part === '.Trash' || part === '.Trashes')) return 'trash';
  if (inside(target, '/Applications') || parts.some((part) => part.endsWith('.app'))) return 'applications';
  const relative = path.relative(home, target);
  if (parts.some((part) => ['.git', 'node_modules', '.next', '.nuxt'].includes(part))
    || /^(?:\.npm|\.bun|\.gradle|\.rustup|\.cargo|\.pub-cache|\.dartServer|\.android|\.electron-gyp|\.cocoapods|fvm)(?:\/|$)/.test(relative)
    || /^(?:Library\/(?:Developer|Android)|Library\/Caches\/(?:CocoaPods|Cypress|go-build|pip|node-gyp|electron|electron-builder|ms-playwright|org\.swift\.swiftpm)|\.cache\/(?:uv|codex-runtimes))(?:\/|$)/.test(relative)
    || inside(target, '/Library/Developer') || inside(target, '/opt/homebrew') || inside(target, '/usr/local')) return 'developer';
  if (inside(target, path.join(home, 'Library')) || /^\/Users\/[^/]+\/Library(?:\/|$)/.test(target) || ['/Library', '/private', '/System', '/usr', '/opt'].some((root) => inside(target, root))) return 'system';
  return 'documents';
}

function identity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
}

export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function describeError(error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') return 'Không có quyền đọc hoặc thao tác. Có thể cần cấp Full Disk Access cho ứng dụng đang chạy Node/Terminal.';
  if (error.code === 'ENOENT') return 'Mục không còn tồn tại. Hãy quét lại.';
  return error instanceof UserError ? error.message : 'Thao tác không hoàn tất. Hãy kiểm tra quyền truy cập và thử lại.';
}

export function classify(target, home, projectRoots = new Set()) {
  const result = (category, app, purpose, evidence, impact, recovery, risk, confidence = 'medium', candidate = false) =>
    ({ category, app, purpose, evidence, impact, recovery, risk, confidence, candidate });
  const relativeTarget = path.relative(home, target);
  for (const [relative, app, purpose, impact, recovery, risk] of rules) {
    if (relativeTarget === relative || relativeTarget.startsWith(`${relative}${path.sep}`)) return result(risk === 'high' ? 'application' : 'cache', app, purpose,
      `Nằm trong vị trí đã nhận diện: ~/${relative}.`, impact, recovery, risk, 'high', relativeTarget === relative);
  }
  const appCache = applicationCache(relativeTarget);
  if (appCache) return result(appCache.logs ? 'logs' : 'cache', appCache.app,
    appCache.logs ? `Log chẩn đoán của ${appCache.app}.` : `Cache nội dung mạng, mã biên dịch hoặc đồ hoạ của ${appCache.app}.`,
    `Vị trí ứng dụng và thư mục cache cụ thể: ~/${appCache.relative}.`,
    appCache.logs ? 'Mất lịch sử phục vụ điều tra lỗi. Đóng ứng dụng và giữ lại log đang cần trước khi dọn.' : cacheImpact,
    appCache.logs ? 'Ứng dụng tạo log mới; log cũ không tự tạo lại.' : 'Ứng dụng tạo hoặc tải lại cache; cần mạng nếu dữ liệu không còn local.',
    'medium', 'high', relativeTarget === appCache.relative);
  if (/^Library\/Caches\/Google\/AndroidStudio[^/]+\/LocalHistory(?:\/|$)/.test(relativeTarget)) {
    return result('personal', 'Android Studio', 'Lịch sử thay đổi local của dự án trong IDE.', 'Đường dẫn LocalHistory bên trong vùng dữ liệu Android Studio.',
      'Mất khả năng phục hồi các thay đổi chưa commit bằng Local History.', 'Cần bản sao lưu; chỉ mục IDE không tạo lại được lịch sử này.', 'high', 'high');
  }
  if (inside(target, path.join(home, '.ssh')) || inside(target, path.join(home, '.gnupg')) || /^\.env(?:\.|$)/.test(path.basename(target))) {
    return result('personal', null, 'Có thể chứa khoá, thông tin đăng nhập hoặc cấu hình bí mật.', 'Vị trí khoá bảo mật hoặc tên cấu hình môi trường.',
      'Có thể mất quyền truy cập dịch vụ hoặc làm ứng dụng không khởi động.', 'Chỉ khôi phục bằng bản sao lưu hoặc cấp lại thông tin đăng nhập.', 'high');
  }
  if (target.split(path.sep).includes('.git')) return result('development', 'Git', 'Lịch sử và cấu hình Git của dự án.', 'Đường dẫn thuộc thư mục .git.',
    'Có thể mất commit chưa đẩy, nhánh local và cấu hình repository.', 'Remote không chứa toàn bộ dữ liệu local; cần bản sao lưu.', 'high', 'high');
  const parts = target.split(path.sep);
  for (let index = 0; index < parts.length; index += 1) {
    if (!['node_modules', '.next', '.nuxt'].includes(parts[index])) continue;
    const parent = parts.slice(0, index).join(path.sep) || path.sep;
    if (!projectRoots.has(parent)) continue;
    const dependency = parts[index] === 'node_modules';
    return result('development', dependency ? 'Node.js' : parts[index] === '.next' ? 'Next.js' : 'Nuxt',
      dependency ? 'Dependency đã cài cho dự án Node.js.' : 'Thư mục thường dùng cho kết quả build và cache framework.',
      `Có package.json tại ${parent} và thư mục ${parts[index]}. Chưa kiểm tra cấu hình build tuỳ chỉnh.`,
      'Dự án có thể ngừng chạy cho tới khi cài dependency hoặc build lại. Giữ lại nếu có chỉnh sửa trực tiếp hoặc cần làm việc offline.',
      'Cài dependency từ manifest/lockfile hoặc build lại; dữ liệu chỉnh sửa trực tiếp cần bản sao lưu.', 'medium', 'medium', target === path.join(parent, parts[index]));
  }
  if (parts.some((part) => part.endsWith('.photoslibrary')) || inside(target, path.join(home, 'Library/Application Support/MobileSync'))) {
    return result('personal', parts.some((part) => part.endsWith('.photoslibrary')) ? 'Photos' : 'Bản sao lưu iPhone/iPad',
      'Thư viện ảnh hoặc bản sao lưu thiết bị, có thể chứa dữ liệu duy nhất.', 'Đường dẫn thư viện Photos hoặc MobileSync.',
      'Có thể mất ảnh, video hoặc khả năng phục hồi thiết bị.', 'Cần bản sao lưu độc lập; không tự tạo lại được dữ liệu cá nhân.', 'high', 'high');
  }
  if (inside(target, path.join(home, 'Library/Mail')) || inside(target, path.join(home, 'Library/Messages'))) {
    return result('personal', inside(target, path.join(home, 'Library/Mail')) ? 'Mail' : 'Messages', 'Thư, tin nhắn hoặc tệp đính kèm cá nhân.',
      'Đường dẫn thuộc vùng dữ liệu Mail hoặc Messages.', 'Có thể mất nội dung chưa đồng bộ hoặc chỉ có trên máy này.', 'Cần sao lưu; không mặc định có thể tải lại từ tài khoản.', 'high', 'high');
  }
  if (inside(target, path.join(home, 'Library/Mobile Documents')) || inside(target, path.join(home, 'Library/CloudStorage'))) {
    return result('personal', 'Ứng dụng đồng bộ đám mây', 'Dữ liệu iCloud hoặc dịch vụ đồng bộ của ứng dụng.',
      'Đường dẫn thuộc Mobile Documents hoặc CloudStorage.', 'Xoá có thể đồng bộ lên đám mây và các thiết bị khác. Nên dùng chức năng bỏ bản tải về của ứng dụng nếu chỉ muốn giảm dung lượng local.',
      'Tuỳ chính sách Thùng rác và thời hạn khôi phục của dịch vụ; cần bản sao lưu độc lập.', 'high', 'high');
  }
  if (inside(target, path.join(home, 'Library/Containers/com.docker.docker')) || inside(target, path.join(home, '.docker'))) {
    return result('application', 'Docker', 'Dữ liệu, máy ảo hoặc cấu hình Docker.', 'Nằm trong vùng dữ liệu Docker.',
      'Có thể mất image, container, volume, cơ sở dữ liệu hoặc cấu hình kết nối. Nên dọn bằng Docker sau khi sao lưu volume.',
      'Image có thể tải lại; dữ liệu volume cần bản sao lưu.', 'high', 'high');
  }
  const extension = path.extname(target).toLowerCase();
  if (['.db', '.sqlite', '.sqlite3', '.vmdk', '.qcow2', '.pvm', '.vdi', '.sparsebundle', '.sparseimage', '.backupbundle'].includes(extension) || path.basename(target) === 'Docker.raw') {
    return result('application', null, 'Có thể là cơ sở dữ liệu hoặc đĩa máy ảo; chưa xác minh nội dung.',
      `Tên hoặc đuôi ${extension || path.basename(target)} thường được dùng cho dữ liệu ứng dụng.`, 'Có thể mất cơ sở dữ liệu, máy ảo và toàn bộ dữ liệu bên trong. Kiểm tra ứng dụng sở hữu trước khi dọn.',
      'Cần bản sao lưu dữ liệu; cài lại ứng dụng không phục hồi được nội dung.', 'high', 'low');
  }
  if (inside(target, path.join(home, 'Downloads')) && ['.dmg', '.pkg', '.zip', '.ipa'].includes(extension)) {
    const archive = extension === '.zip' || extension === '.ipa';
    return result('installer', null, archive ? 'Tệp nén hoặc gói ứng dụng đã tải; chưa biết nội dung.' : 'Có thể là bộ cài ứng dụng macOS.',
      `Đuôi ${extension} trong Downloads; chưa xác nhận đã cài đặt hay có bản sao khác.`,
      archive ? 'Có thể mất dữ liệu hoặc bản ứng dụng duy nhất trong tệp.' : 'Không còn bộ cài local; cần tải lại nếu cài đặt sau này.',
      'Chỉ tải lại được nếu nguồn còn tồn tại; dữ liệu riêng cần bản sao lưu.', archive ? 'high' : 'medium', 'medium', true);
  }
  const cacheRoot = path.join(home, 'Library/Caches');
  if (inside(target, cacheRoot) && target !== cacheRoot) return result('cache', path.relative(cacheRoot, target).split(path.sep)[0],
    'Dữ liệu tại vùng cache ứng dụng; chưa xác nhận từng nội dung bên trong.', 'Đường dẫn thuộc ~/Library/Caches, chưa có quy tắc riêng cho ứng dụng này.',
    cacheImpact, 'Thường do ứng dụng tạo lại; cần kiểm tra dữ liệu chỉ có local.', 'medium', 'medium', path.dirname(target) === cacheRoot
      && !['Google', 'JetBrains', 'Code', 'Codex', 'puccinialin'].includes(path.basename(target))
      && !rules.some(([known]) => known.startsWith(`${relativeTarget}/`)));
  const logRoot = path.join(home, 'Library/Logs');
  if (inside(target, logRoot) && target !== logRoot) return result('logs', path.relative(logRoot, target).split(path.sep)[0],
    'Log và báo cáo chẩn đoán của ứng dụng.', 'Đường dẫn thuộc ~/Library/Logs; không đọc nội dung log.',
    'Mất lịch sử chẩn đoán, crash hoặc build. Đóng ứng dụng và giữ lại log cần điều tra trước khi dọn.',
    'Ứng dụng tạo log mới; log cũ chỉ khôi phục từ Thùng rác hoặc bản sao lưu.', 'medium', 'medium', path.dirname(target) === logRoot);
  for (const relative of ['Library/Application Support', 'Library/Containers', 'Library/Group Containers', 'Library/Preferences']) {
    const applicationRoot = path.join(home, relative);
    if (inside(target, applicationRoot)) return result('application', path.relative(applicationRoot, target).split(path.sep)[0] || null,
      'Dữ liệu hoặc cấu hình của ứng dụng; chưa xác định nội dung cụ thể.', `Đường dẫn thuộc ~/${relative}.`,
      'Có thể mất tài khoản đăng nhập, cài đặt, cơ sở dữ liệu hoặc dữ liệu chưa đồng bộ.', 'Cần sao lưu hoặc cơ chế phục hồi của ứng dụng.', 'high');
  }
  if (['Documents', 'Desktop', 'Pictures', 'Movies', 'Music'].some((name) => inside(target, path.join(home, name)))) {
    return result('personal', null, 'Dữ liệu trong thư mục cá nhân; chưa xác định nội dung.', 'Vị trí lưu tài liệu cá nhân, không phải bằng chứng về cache.',
      'Có thể mất tài liệu, dự án hoặc dữ liệu duy nhất.', 'Cần bản sao lưu; không mặc định có thể tải lại.', 'high');
  }
  return result('unknown', null, 'Chưa xác định', 'Chưa đủ bằng chứng từ vị trí, loại mục và các quy tắc hiện có.',
    'Chưa biết tác động. Hãy mở trong Finder, xác định ứng dụng sử dụng và sao lưu trước khi dọn.',
    'Chưa biết khả năng tạo lại. Có thể cần bản sao lưu.', 'unknown', 'low');
}

export async function runCommand(command, args, options = {}) {
  const { input, ...settings } = options;
  const task = exec(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000, ...settings });
  if (input !== undefined) {
    task.child.stdin.on('error', () => {});
    task.child.stdin.end(input);
  }
  return (await task).stdout;
}

export async function moveToTrash(target) {
  try {
    await runCommand('/usr/bin/trash', [target], { timeout: 120000 });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await runCommand('/usr/bin/osascript', ['-e', 'on run argv\n tell application "Finder" to delete (POSIX file (item 1 of argv))\nend run', target], { timeout: 120000 });
  }
}

export async function pickFolder(home) {
  try {
    const output = await runCommand('/usr/bin/osascript', ['-e', 'on run argv\n set chosenFolder to choose folder with prompt "Chọn thư mục hoặc ổ đĩa để phân tích" default location (POSIX file (item 1 of argv))\n return POSIX path of chosenFolder\nend run', home], { timeout: 300000 });
    return output.endsWith('\n') ? output.slice(0, -1) : output;
  } catch (error) {
    if (error.stderr?.includes('(-128)')) return null;
    throw new UserError('Không mở được hộp thoại chọn thư mục. Kiểm tra quyền của ứng dụng đang chạy Node/Terminal.');
  }
}

async function* spotlightPaths(root, signal) {
  const child = spawn('/usr/bin/mdfind', ['-0', '-onlyin', root, `kMDItemFSSize >= ${LARGE_FILE_BYTES}`], { stdio: ['ignore', 'pipe', 'pipe'], signal });
  let processError;
  const completed = new Promise((resolve) => {
    child.once('error', (error) => { processError = error; });
    child.once('close', (code) => resolve({ code, error: processError }));
  });
  child.stderr.resume();
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  try {
    for await (const chunk of child.stdout) {
      signal.throwIfAborted();
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const filename = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (filename) yield filename;
      }
    }
    const outcome = await completed;
    signal.throwIfAborted();
    if (outcome.error || outcome.code !== 0) throw new UserError('Spotlight không khả dụng. Dùng quét sâu để đọc trực tiếp filesystem.');
  } finally {
    if (child.exitCode === null && !child.killed) child.kill();
    await completed;
  }
}

export class DiskCleaner {
  constructor({ home = os.homedir(), startupRoot = process.platform === 'darwin' && home === os.homedir() ? '/' : null, io = fs, trash = moveToTrash, spotlight = spotlightPaths, command = runCommand } = {}) {
    this.home = path.resolve(home);
    this.startupRoot = startupRoot && path.resolve(startupRoot);
    this.boot = null;
    this.startupError = null;
    this.io = io;
    this.trash = trash;
    this.spotlight = spotlight;
    this.command = command;
    this.items = new Map();
    this.byPath = new Map();
    this.largeIds = new Set();
    this.candidateIds = new Set();
    this.children = new Map();
    this.roots = new Set();
    this.projectRoots = new Set();
    this.listings = new Map();
    this.pendingListings = new Set();
    this.cache = new Map();
    this.confirmations = new Map();
    this.disks = new Map();
    this.revision = 0;
    this.sequence = 0;
    this.activeIO = 0;
    this.ioWaiters = [];
    this.scan = null;
    this.scanTask = Promise.resolve();
    this.cleanupBusy = false;
  }

  async limited(operation) {
    if (this.activeIO >= 16) await new Promise((resolve) => this.ioWaiters.push(resolve));
    else this.activeIO += 1;
    try { return await operation(); }
    finally {
      const next = this.ioWaiters.shift();
      if (next) next();
      else this.activeIO -= 1;
    }
  }

  async initialize() {
    this.home = await this.io.realpath(this.home);
    if (this.startupRoot) {
      try {
        const dataPath = path.join(this.startupRoot, 'System/Volumes/Data');
        const dataStat = await this.limited(() => this.io.lstat(dataPath));
        if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) throw new Error('Data volume');
        const root = await this.registerRoot(this.startupRoot);
        const disk = this.disks.get(root.id);
        this.boot = { rootId: root.id, path: root.path, systemDevice: root.device, dataDevice: dataStat.dev, container: disk.container, name: disk.name || 'Ổ khởi động', systemBytes: disk.volumeUsed ?? null };
        this.defaultRootId = root.id;
        await this.refreshDisk(this.item(root.id));
      } catch {
        this.startupError = 'Chưa mở được toàn ổ khởi động; đang dùng Home. Kiểm tra quyền truy cập rồi khởi động lại.';
      }
    }
    this.homeId = (await this.registerRoot(this.home)).id;
    this.defaultRootId ||= this.homeId;
  }

  upsert(target, stat) {
    const kind = stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    let item = this.items.get(this.byPath.get(target));
    if (!item) {
      item = { id: `i${++this.sequence}`, path: target, name: path.basename(target) || target, kind, allocatedBytes: kind === 'directory' ? null : allocatedBytes(stat), logicalBytes: kind === 'directory' ? null : stat.size, sizeState: kind === 'directory' ? 'unmeasured' : kind === 'file' ? 'complete' : 'skipped', measuredAt: null };
      this.items.set(item.id, item);
      this.byPath.set(target, item.id);
      const parent = path.dirname(target);
      if (!this.children.has(parent)) this.children.set(parent, new Set());
      this.children.get(parent).add(item.id);
    }
    if (item.kind !== kind) {
      for (const id of [...(this.children.get(target) || [])]) if (!this.roots.has(id)) this.forget(this.items.get(id));
      this.children.delete(target);
      this.listings.delete(target);
    }
    if (item.kind !== kind && kind === 'directory') {
      item.allocatedBytes = null;
      item.logicalBytes = null;
      item.sizeState = 'unmeasured';
    }
    item.kind = kind;
    item.device = stat.dev;
    const nextIdentity = identity(stat);
    if (item.identity !== nextIdentity) {
      item.version = randomUUID();
      if (item.kind === 'directory' && item.allocatedBytes !== null) item.sizeState = 'stale';
    }
    item.identity = nextIdentity;
    item.modifiedAt = stat.mtimeMs;
    item.shared = kind === 'file' && stat.nlink > 1;
    item.allocationId = item.shared ? `${stat.dev}:${stat.ino}` : null;
    if (kind !== 'directory') {
      item.allocatedBytes = allocatedBytes(stat);
      item.logicalBytes = stat.size;
      item.sizeState = kind === 'file' ? 'complete' : 'skipped';
      item.measuredAt = Date.now();
    }
    if (kind === 'file' && path.basename(target) === 'package.json' && !target.split(path.sep).includes('node_modules')) {
      const project = path.dirname(target);
      this.projectRoots.add(project);
      for (const name of ['node_modules', '.next', '.nuxt']) {
        const artifact = this.items.get(this.byPath.get(path.join(project, name)));
        if (artifact) { artifact.candidate = true; this.candidateIds.add(artifact.id); }
      }
    }
    item.candidate = (kind === 'directory' || (kind === 'file' && stat.size >= 50 * 1024 ** 2)) && classify(target, this.home, this.projectRoots).candidate;
    if (item.candidate) this.candidateIds.add(item.id);
    else this.candidateIds.delete(item.id);
    if (kind === 'file' && item.allocatedBytes >= LARGE_FILE_BYTES) this.largeIds.add(item.id);
    else this.largeIds.delete(item.id);
    return item;
  }

  item(id) {
    const item = this.items.get(id);
    if (!item) throw new UserError('Mục không còn trong kết quả. Hãy quét lại.', 404);
    return item;
  }

  allowed(target) {
    return [...this.roots].some((id) => inside(target, this.items.get(id).path));
  }

  async inspect(target, devices) {
    if (!this.allowed(target)) throw new UserError('Đường dẫn nằm ngoài phạm vi đã chọn.', 403);
    const stat = await this.limited(() => this.io.lstat(target));
    if (devices && !devices.includes(stat.dev)) throw new UserError('Filesystem khác: chọn ổ này làm phạm vi riêng.', 403);
    if (!stat.isSymbolicLink() && await this.limited(() => this.io.realpath(target)) !== target) throw new UserError('Đường dẫn đi qua liên kết tượng trưng; chỉ được xem, không đi theo.', 403);
    return this.upsert(target, stat);
  }

  async registerRoot(target) {
    if (this.cleanupBusy) throw new UserError('Đang chuyển dữ liệu vào Thùng rác. Hãy đợi hoàn tất.', 409);
    const original = await this.limited(() => this.io.lstat(path.resolve(target)));
    if (!original.isDirectory() || original.isSymbolicLink()) throw new UserError('Hãy chọn thư mục thực, không phải symlink.');
    const canonical = await this.limited(() => this.io.realpath(target));
    const stat = await this.limited(() => this.io.lstat(canonical));
    if (this.cleanupBusy) throw new UserError('Đang chuyển dữ liệu vào Thùng rác. Hãy chọn lại sau khi hoàn tất.', 409);
    const item = this.upsert(canonical, stat);
    this.roots.add(item.id);
    await this.refreshDisk(item);
    this.revision += 1;
    return this.publicItem(item);
  }

  async refreshDisk(item) {
    let filesystem;
    try {
      const output = await this.command('/bin/df', ['-kI', item.path]);
      const match = output.trim().split('\n').at(-1).match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
      if (match) filesystem = { total: Number(match[2]) * 1024, used: Number(match[3]) * 1024, available: Number(match[4]) * 1024, mounted: match[6], name: item.name, source: 'filesystem', devices: [item.device], systemBytes: null, systemDevice: null, measuredAt: Date.now() };
    } catch {}
    try {
      const plist = await this.command('/usr/sbin/diskutil', ['info', '-plist', filesystem?.mounted || item.path]);
      const info = JSON.parse(await this.command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist }));
      const container = Number.isSafeInteger(info.APFSContainerSize) && info.APFSContainerSize > 0;
      const total = container ? info.APFSContainerSize : info.TotalSize;
      const available = container ? info.APFSContainerFree : info.FreeSpace;
      if (!Number.isSafeInteger(total) || total <= 0 || !Number.isSafeInteger(available) || available < 0 || available > total) throw new Error('Disk capacity');
      if (this.boot?.rootId === item.id) {
        this.boot.container = info.APFSContainerReference || null;
        this.boot.name = info.VolumeName || 'Ổ khởi động';
        this.boot.systemBytes = Number.isSafeInteger(info.CapacityInUse) ? info.CapacityInUse : null;
      }
      const boot = this.boot?.container && info.APFSContainerReference === this.boot.container ? this.boot : null;
      this.disks.set(item.id, { total, used: total - available, available, name: boot?.name || info.VolumeName || item.name, mounted: info.MountPoint, container: info.APFSContainerReference || null, source: container ? 'apfs-container' : 'volume', volumeUsed: Number.isSafeInteger(info.CapacityInUse) ? info.CapacityInUse : null, systemBytes: boot?.systemBytes ?? null, systemDevice: boot?.systemDevice ?? null, devices: [...new Set(boot ? [item.device, boot.systemDevice, boot.dataDevice] : [item.device])], measuredAt: Date.now() });
      return;
    } catch { /* ponytail: diskutil/plutil không khả dụng thì dùng df; không suy ra dung lượng toàn container từ df. */ }
    this.disks.set(item.id, filesystem || { error: 'Chưa đọc được dung lượng filesystem.' });
  }

  protection(item) {
    if (!this.allowed(item.path)) return 'Nằm ngoài phạm vi đã chọn.';
    if (item.kind !== 'file' && item.kind !== 'directory') return 'Symlink và mục đặc biệt chỉ được xem.';
    if (item.sizeState === 'skipped') return 'Điểm gắn filesystem khác chỉ được xem. Chọn ổ đó làm phạm vi riêng để quét bên trong.';
    if (systemPaths.some((root) => inside(item.path, root))) return 'Vùng hệ thống chỉ được xem.';
    if (item.path.split(path.sep).some((part) => part === '.Trash' || part === '.Trashes')) return 'Dọn và khôi phục Thùng rác bằng Finder.';
    if (path.dirname(item.path) === '/Users') return 'Thư mục gốc của tài khoản người dùng được bảo vệ; hãy xem các mục bên trong.';
    if (this.boot && path.dirname(item.path) === this.boot.path) return 'Thư mục gốc trên ổ khởi động chỉ được xem; hãy xem các mục bên trong.';
    const protectedPaths = ['/', '/Users', '/Volumes', this.home, ...['Library', 'Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music', 'Public', 'Applications'].map((name) => path.join(this.home, name)), ...(this.scan?.status === 'running' ? this.scan.paths : []), ...[...this.roots].map((id) => this.items.get(id).path)];
    if (protectedPaths.some((target) => inside(target, item.path))) return 'Thư mục gốc hoặc thư mục chứa phạm vi đang quét được bảo vệ; hãy xem các mục bên trong.';
    return null;
  }

  publicItem(item) {
    const { identity: unused, seen: ignored, candidate: internal, ...value } = item;
    const result = { ...value, explanation: classify(item.path, this.home, this.projectRoots), protectedReason: this.protection(item) };
    if (this.scan?.status === 'running' && this.scan.mode === 'quick' && item.kind === 'directory' && !item.accessError) {
      if (this.scan.stage === 'measure' && item.seen === this.scan.id && item.sizeState === 'partial' && inside(this.scan.currentPath, item.path)) result.sizeState = 'measuring';
      else if (item.allocatedBytes === null && item.sizeState === 'unmeasured' && item.candidate && !result.protectedReason && this.scan.paths.some((root) => inside(item.path, root))) result.sizeState = 'queued';
    }
    return result;
  }

  state() {
    const scan = this.scan ? { ...this.scan } : null;
    if (scan) { delete scan.controller; delete scan.seenLinks; delete scan.largePaths; }
    return { revision: this.revision, homeId: this.homeId, defaultRootId: this.defaultRootId, startupRootId: this.boot?.rootId || null, startupError: this.startupError, roots: [...this.roots].map((id) => ({ ...this.publicItem(this.items.get(id)), disk: this.disks.get(id) })), scan, cleanupBusy: this.cleanupBusy };
  }

  recordIssue(job, target, message, error = true) {
    if (error) job.errors += 1;
    else job.skipped += 1;
    if (job.issues.length < 20) job.issues.push({ path: target, message });
    this.revision += 1;
  }

  forget(item) {
    if (!item) return;
    if (path.basename(item.path) === 'package.json' && this.projectRoots.delete(path.dirname(item.path))) {
      for (const name of ['node_modules', '.next', '.nuxt']) {
        const artifact = this.items.get(this.byPath.get(path.join(path.dirname(item.path), name)));
        if (artifact) { artifact.candidate = false; this.candidateIds.delete(artifact.id); }
      }
    }
    for (const id of [...(this.children.get(item.path) || [])]) {
      const child = this.items.get(id);
      if (child && !this.roots.has(id)) this.forget(child);
    }
    this.children.delete(item.path);
    this.listings.delete(item.path);
    this.children.get(path.dirname(item.path))?.delete(item.id);
    if (this.roots.has(item.id)) { item.sizeState = 'stale'; return; }
    this.items.delete(item.id);
    this.byPath.delete(item.path);
    this.largeIds.delete(item.id);
    this.candidateIds.delete(item.id);
  }

  async directoryEntries(item, signal, consume) {
    const physical = await this.limited(() => this.io.realpath(item.path));
    if (physical !== item.path) throw new UserError('Thư mục đã trở thành symlink. Hãy chọn lại phạm vi.', 409);
    const directory = await this.limited(() => this.io.opendir(item.path, { bufferSize: 128 }));
    try {
      let ended = false;
      while (!ended) {
        signal?.throwIfAborted();
        const batch = [];
        for (let index = 0; index < 16; index += 1) {
          const entry = await this.limited(() => directory.read());
          if (!entry) { ended = true; break; }
          batch.push(path.join(item.path, entry.name));
        }
        signal?.throwIfAborted();
        const stats = await Promise.all(batch.map(async (target) => {
          try { return { target, stat: await this.limited(() => this.io.lstat(target)) }; }
          catch (error) { return { target, error }; }
        }));
        signal?.throwIfAborted();
        await consume(stats);
      }
    } finally {
      await this.limited(() => directory.close()).catch(() => {});
    }
  }

  async ensureListed(item, signal) {
    if (item.kind !== 'directory') throw new UserError('Mục này không phải thư mục.');
    if (this.listings.has(item.path)) return this.listings.get(item.path);
    const task = (async () => {
      const seen = new Set();
      await this.directoryEntries(item, signal, async (entries) => {
        for (const { target, stat, error } of entries) {
          if (error) {
            item.accessError = describeError(error);
            item.sizeState = 'partial';
            const existing = this.items.get(this.byPath.get(target));
            if (existing) { seen.add(existing.id); existing.accessError = describeError(error); existing.sizeState = 'stale'; }
            continue;
          }
          const child = this.upsert(target, stat);
          seen.add(child.id);
        }
        this.revision += 1;
      });
      for (const id of [...(this.children.get(item.path) || [])]) {
        if (!seen.has(id) && !this.roots.has(id)) this.forget(this.items.get(id));
      }
    })();
    this.listings.set(item.path, task);
    this.pendingListings.add(task);
    try { await task; }
    catch (error) {
      this.listings.delete(item.path);
      item.accessError = describeError(error);
      throw error;
    } finally { this.pendingListings.delete(task); }
  }

  startScan(rootIds, mode, force = false) {
    if (this.cleanupBusy) throw new UserError('Đang chuyển dữ liệu vào Thùng rác.', 409);
    if (this.scan?.status === 'running') throw new UserError('Hãy dừng lượt quét hiện tại trước khi quét phạm vi khác.', 409);
    if (!Array.isArray(rootIds) || rootIds.length === 0 || rootIds.length > 32 || !['quick', 'deep'].includes(mode)) throw new UserError('Phạm vi hoặc chế độ quét không hợp lệ.');
    const paths = normalizeRoots(rootIds.map((id) => {
      const item = this.item(id);
      if (item.kind !== 'directory' || !this.allowed(item.path)) throw new UserError('Phạm vi phải là thư mục đã chọn.');
      return item.path;
    }));
    if (this.boot && paths.includes(this.boot.path)) {
      const separate = rootIds.map((id) => this.item(id)).filter((item) => item.device !== this.boot.systemDevice && item.device !== this.boot.dataDevice);
      for (const target of normalizeRoots(separate.map((item) => item.path))) if (!paths.includes(target)) paths.push(target);
    }
    const key = JSON.stringify([mode, paths]);
    if (!force && this.cache.has(key)) {
      this.scan = this.cache.get(key);
      this.revision += 1;
      return this.state().scan;
    }
    this.confirmations.clear();
    if (force) this.cache.clear();
    for (const target of paths) {
      for (const item of this.items.values()) {
        if (inside(item.path, target) && ['directory', 'file'].includes(item.kind)) {
          item.sizeState = item.allocatedBytes === null ? 'unmeasured' : 'stale';
          delete item.accessError;
        } else if (item.kind === 'directory' && inside(target, item.path) && item.allocatedBytes !== null) item.sizeState = 'stale';
      }
      for (const listed of this.listings.keys()) if (inside(listed, target)) this.listings.delete(listed);
    }
    const job = { id: randomUUID(), key, mode, paths, rootIds: paths.map((target) => this.byPath.get(target)), wholeStartup: Boolean(this.boot && paths.includes(this.boot.path)), usage: {}, status: 'running', stage: mode === 'quick' ? 'discover' : 'measure', startedAt: Date.now(), finishedAt: null, checked: 0, files: 0, folders: 0, large: 0, errors: 0, skipped: 0, issues: [], currentPath: paths[0], measuredSuggestions: 0, totalSuggestions: 0, controller: new AbortController(), seenLinks: new Set(), largePaths: new Set() };
    this.scan = job;
    this.revision += 1;
    this.scanTask = this.runScan(job);
    return this.state().scan;
  }

  async runScan(job) {
    try {
      await Promise.allSettled(this.pendingListings);
      for (const id of job.rootIds) {
        job.controller.signal.throwIfAborted();
        if (this.roots.has(id)) await this.refreshDisk(this.item(id));
      }
      for (const root of job.paths) {
        job.controller.signal.throwIfAborted();
        if (job.mode === 'quick') await this.quickScan(root, job);
        else {
          const stat = await this.limited(() => this.io.lstat(root));
          if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UserError('Phạm vi đã thay đổi hoặc trở thành symlink.');
          await this.walk(root, stat, stat.dev, job, 0);
        }
      }
      job.status = job.mode === 'quick' || job.errors || job.skipped ? 'partial' : 'complete';
      this.cache.set(job.key, job);
    } catch (error) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'error';
      if (job.status === 'error') this.recordIssue(job, job.currentPath, describeError(error));
    } finally {
      job.finishedAt = Date.now();
      job.seenLinks.clear();
      job.largePaths.clear();
      this.revision += 1;
    }
  }

  async cancelScan() {
    if (this.scan?.status === 'running') this.scan.controller.abort();
    await this.scanTask;
    return this.state().scan;
  }

  recordUsage(job, target, stat, bytes) {
    const totals = job.usage[stat.dev] ||= { applications: 0, developer: 0, documents: 0, trash: 0, system: 0 };
    totals[storageCategory(target, this.home)] += bytes;
  }

  async walk(target, stat, device, job, depth) {
    const signal = job.controller.signal;
    signal.throwIfAborted();
    job.currentPath = target;
    job.checked += 1;
    this.revision += 1;
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      const item = this.upsert(target, stat);
      item.seen = job.id;
      this.recordIssue(job, target, 'Liên kết hoặc mục đặc biệt: không đi theo, chỉ được xem.', false);
      return { allocated: stat.isSymbolicLink() ? allocatedBytes(stat) : 0, logical: stat.isSymbolicLink() ? stat.size : 0, complete: true };
    }
    const alias = job.wholeStartup && ['System/Volumes', 'Volumes'].some((relative) => target === path.join(this.boot.path, relative));
    const pairedData = job.wholeStartup && device === this.boot.systemDevice && stat.dev === this.boot.dataDevice;
    if (alias || (stat.dev !== device && !pairedData)) {
      const item = this.upsert(target, stat);
      item.seen = job.id;
      item.sizeState = 'skipped';
      item.allocatedBytes = null;
      item.logicalBytes = null;
      this.recordIssue(job, target, alias ? 'Không quét đường dẫn volume trùng hoặc ổ gắn ngoài; chọn ổ ngoài làm phạm vi riêng.' : 'Filesystem khác: chọn ổ này làm phạm vi riêng.', false);
      return { allocated: 0, logical: 0, complete: false };
    }
    device = stat.dev;
    if (stat.isFile()) {
      job.files += 1;
      const size = allocatedBytes(stat);
      if (size >= LARGE_FILE_BYTES) { job.largePaths.add(target); job.large = job.largePaths.size; }
      const installer = size >= 50 * 1024 ** 2 && ['.dmg', '.pkg', '.zip', '.ipa'].includes(path.extname(target).toLowerCase()) && classify(target, this.home, this.projectRoots).candidate;
      const retain = this.byPath.has(target) || size >= LARGE_FILE_BYTES || installer;
      const manifest = path.basename(target) === 'package.json' && !target.split(path.sep).includes('node_modules');
      if (retain || manifest) {
        const item = this.upsert(target, stat);
        item.seen = job.id;
        item.measuredAt = Date.now();
      }
      const linkKey = `${stat.dev}:${stat.ino}`;
      if (stat.nlink > 1 && job.seenLinks.has(linkKey)) return { allocated: 0, logical: 0, complete: true };
      if (stat.nlink > 1) job.seenLinks.add(linkKey);
      this.recordUsage(job, target, stat, size);
      return { allocated: size, logical: stat.size, complete: true };
    }
    job.folders += 1;
    const item = this.upsert(target, stat);
    item.seen = job.id;
    item.sizeState = 'partial';
    delete item.accessError;
    item.allocatedBytes = null;
    item.logicalBytes = null;
    let allocated = allocatedBytes(stat);
    let logical = stat.size;
    let complete = true;
    // ponytail: tối đa 256 thư mục đang lồng nhau; cần duyệt sâu hơn thì thay bằng hàng đợi thư mục có giới hạn handle.
    if (depth >= 256) {
      this.recordIssue(job, target, 'Đạt giới hạn độ sâu 256; hãy chọn thư mục này để quét riêng.', false);
      item.accessError = 'Chưa quét bên trong: đạt giới hạn độ sâu.';
      return { allocated: 0, logical: 0, complete: false };
    }
    this.recordUsage(job, target, stat, allocated);
    try {
      await this.directoryEntries(item, signal, async (entries) => {
        for (const { target: childPath, stat: childStat, error } of entries) {
          signal.throwIfAborted();
          if (error) {
            this.recordIssue(job, childPath, describeError(error));
            const previous = this.items.get(this.byPath.get(childPath));
            if (previous) { previous.sizeState = 'stale'; previous.accessError = describeError(error); }
            complete = false;
            continue;
          }
          const child = await this.walk(childPath, childStat, device, job, depth + 1);
          allocated += child.allocated;
          logical += child.logical;
          complete &&= child.complete;
          item.allocatedBytes = allocated;
          item.logicalBytes = logical;
        }
      });
      if (complete) {
        for (const id of [...(this.children.get(target) || [])]) {
          const child = this.items.get(id);
          if (child?.seen !== job.id && !this.roots.has(id)) this.forget(child);
        }
      }
      item.allocatedBytes = allocated;
      item.logicalBytes = logical;
      item.sizeState = complete ? 'complete' : 'partial';
      item.measuredAt = Date.now();
    } catch (error) {
      if (signal.aborted) throw error;
      complete = false;
      item.accessError = describeError(error);
      this.recordIssue(job, target, item.accessError);
    }
    this.revision += 1;
    return { allocated, logical, complete };
  }

  async discoverSuggestions(root, job) {
    const signal = job.controller.signal;
    const device = (await this.limited(() => this.io.lstat(root))).dev;
    const listAt = async (target) => {
      signal.throwIfAborted();
      if (!inside(target, root)) return [];
      try {
        job.currentPath = target;
        const stat = await this.limited(() => this.io.lstat(target));
        if (stat.dev !== device && !(root === this.boot?.path && stat.dev === this.boot.dataDevice)) {
          const item = this.upsert(target, stat);
          item.sizeState = 'skipped';
          item.allocatedBytes = null;
          item.logicalBytes = null;
          this.recordIssue(job, target, 'Filesystem khác: chọn ổ này làm phạm vi riêng.', false);
          return [];
        }
        const item = await this.inspect(target);
        if (item.kind !== 'directory') return [];
        await this.ensureListed(item, signal);
        if (item.accessError) this.recordIssue(job, target, item.accessError);
        return [...(this.children.get(target) || [])].map((id) => this.items.get(id)).filter(Boolean);
      } catch (error) {
        if (signal.aborted) throw error;
        if (error.code !== 'ENOENT') this.recordIssue(job, target, describeError(error));
        return [];
      }
    };
    for (const relative of ['Library/Caches', 'Library/Caches/Google', 'Library/Logs', 'Downloads']) {
      const children = await listAt(path.join(this.home, relative));
      if (relative === 'Library/Caches/Google') {
        for (const item of children) if (item.kind === 'directory' && /^AndroidStudio[\d.]+$/.test(item.name)) await listAt(item.path);
      }
    }
    for (const [relative] of appCacheRoots) {
      const children = await listAt(path.join(this.home, 'Library/Application Support', relative));
      for (const item of children) if (item.kind === 'directory' && profileName.test(item.name)) await listAt(item.path);
    }
    const ignored = new Set(['node_modules', 'build', 'dist', 'target', 'vendor', 'Pods', 'venv', '__pycache__']);
    // ponytail: khám phá dự án nhanh tối đa 2 cấp trong Desktop/Documents; dùng quét sâu cho vị trí hoặc độ sâu khác.
    const projects = async (target, depth) => {
      const children = await listAt(target);
      if (depth >= 2) return;
      for (const item of children) {
        if (item.kind !== 'directory' || item.name.startsWith('.') || ignored.has(item.name) || /\.(?:app|photoslibrary|framework|bundle)$/.test(item.name)) continue;
        await projects(item.path, depth + 1);
      }
    };
    for (const relative of ['Desktop', 'Documents']) {
      const target = path.join(this.home, relative);
      await projects(inside(root, target) ? root : target, 0);
    }
  }

  async measureSuggestions(root, job) {
    const signal = job.controller.signal;
    const rootStat = await this.limited(() => this.io.lstat(root));
    const candidates = [...this.candidateIds].map((id) => this.items.get(id))
      .filter((item) => item?.kind === 'directory' && inside(item.path, root) && !this.protection(item)).map((item) => item.path);
    if (root === this.boot?.path) {
      for (const target of [path.join(this.boot.path, 'Applications'), path.join(this.home, 'Applications'), path.join(this.home, '.Trash')]) {
        try {
          const item = await this.inspect(target);
          if (item.kind === 'directory') candidates.push(target);
        } catch (error) { if (error.code !== 'ENOENT') this.recordIssue(job, target, describeError(error)); }
      }
    }
    const targets = normalizeRoots(candidates);
    if (root === this.boot?.path) targets.sort((a, b) => Number(a === path.join(root, 'Applications')) - Number(b === path.join(root, 'Applications')));
    job.stage = 'measure';
    job.totalSuggestions += targets.length;
    this.revision += 1;
    for (const target of targets) {
      signal.throwIfAborted();
      job.currentPath = target;
      try {
        const stat = await this.limited(() => this.io.lstat(target));
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UserError('Vị trí gợi ý đã thay đổi. Hãy quét lại.');
        await this.walk(target, stat, rootStat.dev, job, 0);
      } catch (error) {
        if (signal.aborted) throw error;
        const item = this.items.get(this.byPath.get(target));
        if (item) { item.sizeState = 'stale'; item.accessError = describeError(error); }
        this.recordIssue(job, target, describeError(error));
      }
      job.measuredSuggestions += 1;
      this.revision += 1;
    }
  }

  async quickScan(root, job) {
    const signal = job.controller.signal;
    job.stage = 'discover';
    job.currentPath = root;
    this.revision += 1;
    const rootItem = await this.inspect(root);
    const wholeStartup = root === this.boot?.path;
    await this.ensureListed(rootItem, signal).catch((error) => {
      if (signal.aborted) throw error;
      this.recordIssue(job, root, describeError(error));
    });
    for (const [relative] of rules) {
      signal.throwIfAborted();
      const target = path.join(this.home, relative);
      if (!inside(target, root)) continue;
      try { await this.inspect(target); job.checked += 1; }
      catch (error) { if (error.code !== 'ENOENT') this.recordIssue(job, target, describeError(error)); }
    }
    await this.discoverSuggestions(root, job);
    job.stage = 'spotlight';
    this.revision += 1;
    const inspectBatch = async (targets) => {
      await Promise.all(targets.map(async (target) => {
        if (signal.aborted) return;
        if (!inside(target, root)) return;
        if (wholeStartup && ['System/Volumes', 'Volumes'].some((relative) => inside(target, path.join(this.boot.path, relative)))) return;
        try {
          const item = await this.inspect(target, wholeStartup ? [rootItem.device, this.boot.dataDevice] : [rootItem.device]);
          job.checked += 1;
          job.currentPath = target;
          if (item.kind === 'file' && item.allocatedBytes >= LARGE_FILE_BYTES) { job.largePaths.add(target); job.large = job.largePaths.size; }
          this.revision += 1;
        } catch (error) { if (!signal.aborted && error.code !== 'ENOENT') this.recordIssue(job, target, describeError(error)); }
      }));
      signal.throwIfAborted();
    };
    try {
      let batch = [];
      for await (const target of this.spotlight(root, signal)) {
        signal.throwIfAborted();
        batch.push(target);
        if (batch.length === 16) { await inspectBatch(batch); batch = []; }
      }
      if (batch.length) await inspectBatch(batch);
    } catch (error) {
      if (signal.aborted) throw error;
      this.recordIssue(job, root, error instanceof UserError ? error.message : 'Spotlight không khả dụng; hãy dùng quét sâu.');
    }
    await this.measureSuggestions(root, job);
  }

  async list({ view = 'suggestions', rootId = this.defaultRootId, directoryId = rootId, query = '', sort = 'size-desc', page = 1 } = {}) {
    if (this.cleanupBusy) throw new UserError('Đang xem trước hoặc chuyển dữ liệu vào Thùng rác. Hãy đợi hoàn tất.', 409);
    const root = this.item(rootId);
    const directory = this.item(directoryId);
    if (!['suggestions', 'folders', 'files', 'tree'].includes(view) || root.kind !== 'directory' || !this.allowed(root.path) || !inside(directory.path, root.path)) throw new UserError('Màn hình hoặc thư mục không hợp lệ.');
    let accessError = null;
    const blockedVolume = root.id === this.boot?.rootId && directory.device !== this.boot.systemDevice && directory.device !== this.boot.dataDevice && !this.roots.has(directory.id);
    if (view === 'folders' || view === 'tree') {
      if (blockedVolume) accessError = 'Filesystem khác: hãy chọn ổ này bằng “Chọn thư mục / ổ đĩa” để duyệt và quét riêng.';
      else {
        try { await this.ensureListed(directory); }
        catch (error) { accessError = describeError(error); }
      }
    }
    const sourceIds = blockedVolume ? [] : view === 'folders' || view === 'tree' ? this.children.get(directory.path) || [] : view === 'files' ? this.largeIds : this.candidateIds;
    const source = [...sourceIds].map((id) => this.items.get(id)).filter(Boolean);
    const search = query.toLocaleLowerCase('vi');
    const entries = source.filter((item) => {
      if (!inside(item.path, root.path) || item.id === root.id) return false;
      if (root.id === this.boot?.rootId && ['files', 'suggestions'].includes(view)
        && (item.device !== this.boot.systemDevice && item.device !== this.boot.dataDevice
          || ['System/Volumes', 'Volumes'].some((relative) => inside(item.path, path.join(this.boot.path, relative))))) return false;
      if (view === 'tree' && item.kind !== 'directory') return false;
      if (view === 'files' && (item.kind !== 'file' || item.allocatedBytes < LARGE_FILE_BYTES)) return false;
      if (view === 'suggestions') {
        if (!item.candidate || this.protection(item)) return false;
        if (item.sizeState === 'complete' && item.allocatedBytes === 0) return false;
        if (item.kind === 'file' && item.allocatedBytes < 50 * 1024 ** 2) return false;
      }
      return `${item.name} ${item.path}`.toLocaleLowerCase('vi').includes(search);
    });
    entries.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sort === 'modified') return b.modifiedAt - a.modifiedAt;
      if (a.allocatedBytes === null || b.allocatedBytes === null) return Number(a.allocatedBytes === null) - Number(b.allocatedBytes === null) || a.name.localeCompare(b.name, 'vi');
      return (sort === 'size-asc' ? 1 : -1) * (a.allocatedBytes - b.allocatedBytes) || a.path.localeCompare(b.path, 'vi');
    });
    const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const current = Math.min(Math.max(1, Number(page) || 1), pages);
    const breadcrumbs = [];
    let currentPath = directory.path;
    while (inside(currentPath, root.path)) {
      let item = this.items.get(this.byPath.get(currentPath));
      if (!item) { try { item = await this.inspect(currentPath); } catch { break; } }
      breadcrumbs.unshift({ id: item.id, name: item.name, path: item.path });
      if (currentPath === root.path) break;
      currentPath = path.dirname(currentPath);
    }
    return { items: entries.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((item) => this.publicItem(item)), total: entries.length, page: current, pages, breadcrumbs, directory: this.publicItem(directory), accessError: accessError || directory.accessError || null };
  }

  async validateTrash(item, expected = item.identity) {
    const reason = this.protection(item);
    if (reason) throw new UserError(reason, 403);
    const stat = await this.limited(() => this.io.lstat(item.path));
    if (stat.isSymbolicLink() || await this.limited(() => this.io.realpath(item.path)) !== item.path) throw new UserError('Mục đã trở thành symlink hoặc đi qua symlink. Hãy xem lại.', 409);
    if (identity(stat) !== expected) throw new UserError('Mục đã thay đổi từ lúc được hiển thị. Hãy quét lại rồi xác nhận lại.', 409);
    const parent = await this.limited(() => this.io.lstat(path.dirname(item.path)));
    if (stat.dev !== parent.dev) throw new UserError('Không chuyển điểm gắn filesystem vào Thùng rác. Hãy chọn ổ đó và xem các mục bên trong.', 403);
    const updatedReason = this.protection(item);
    if (updatedReason) throw new UserError(updatedReason, 403);
    return stat;
  }

  checkCleanup() {
    if (this.scan?.status === 'running') throw new UserError('Hãy dừng quét hoặc đợi quét xong trước khi dọn.', 409);
    if (this.cleanupBusy) throw new UserError('Đang xử lý một thao tác dọn khác.', 409);
  }

  async previewTrash(ids, versions) {
    this.checkCleanup();
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || ids.some((id) => typeof id !== 'string')) throw new UserError('Chọn từ 1 đến 200 mục mỗi lần.');
    if (!versions || typeof versions !== 'object' || Array.isArray(versions)) throw new UserError('Thiếu phiên bản của các mục đã chọn. Hãy chọn lại.');
    this.cleanupBusy = true;
    const errors = [];
    const valid = [];
    try {
      await Promise.allSettled(this.pendingListings);
      for (const id of new Set(ids)) {
        try {
          const item = this.item(id);
          if (!Object.hasOwn(versions, id) || versions[id] !== item.version) throw new UserError('Mục đã thay đổi từ lúc chọn. Hãy xem lại rồi chọn lại.', 409);
          await this.validateTrash(item);
          valid.push(item);
        }
        catch (error) { errors.push({ id, message: describeError(error) }); }
      }
      valid.sort((a, b) => a.path.length - b.path.length);
      const entries = valid.filter((item, index) => !valid.slice(0, index).some((parent) => inside(item.path, parent.path)));
      const confirmation = { id: randomUUID(), expiresAt: Date.now() + 120000, entries: entries.map((item) => ({ id: item.id, identity: item.identity })) };
      this.confirmations.clear();
      if (entries.length) this.confirmations.set(confirmation.id, confirmation);
      const items = entries.map((item) => this.publicItem(item));
      return { confirmationId: entries.length ? confirmation.id : null, expiresAt: confirmation.expiresAt, items, errors, collapsed: valid.length - entries.length, requiresAcknowledgement: items.some((item) => ['high', 'unknown'].includes(item.explanation.risk)) };
    } finally { this.cleanupBusy = false; }
  }

  async executeTrash(confirmationId, acknowledgeRisk) {
    this.checkCleanup();
    const confirmation = this.confirmations.get(confirmationId);
    if (!confirmation || confirmation.expiresAt < Date.now()) throw new UserError('Xác nhận đã hết hạn. Hãy xem lại danh sách.', 409);
    if (confirmation.entries.some(({ id }) => ['high', 'unknown'].includes(classify(this.item(id).path, this.home, this.projectRoots).risk)) && acknowledgeRisk !== true) throw new UserError('Cần xác nhận đã hiểu tác động của mục rủi ro cao hoặc chưa xác định.');
    this.confirmations.delete(confirmationId);
    this.cleanupBusy = true;
    this.revision += 1;
    const results = [];
    try {
      await Promise.allSettled(this.pendingListings);
      for (const entry of confirmation.entries) {
        const item = this.items.get(entry.id);
        try {
          if (!item) throw new UserError('Mục không còn trong kết quả.');
          await this.validateTrash(item, entry.identity);
          await this.trash(item.path);
          results.push({ id: item.id, path: item.path, ok: true, message: 'Đã chuyển vào Thùng rác.' });
          this.forget(item);
        } catch (error) {
          if (item) { item.sizeState = 'stale'; item.accessError = describeError(error); }
          results.push({ id: entry.id, path: item?.path, ok: false, message: describeError(error) });
        }
        if (item) {
          let ancestorPath = item.path;
          while (true) {
            const ancestor = this.items.get(this.byPath.get(ancestorPath));
            if (ancestor?.kind === 'directory') ancestor.sizeState = 'stale';
            this.listings.delete(ancestorPath);
            const parent = path.dirname(ancestorPath);
            if (parent === ancestorPath) break;
            ancestorPath = parent;
          }
        }
      }
      this.cache.clear();
      if (this.scan) { this.scan.usage = {}; this.scan.usageStale = true; }
      await Promise.all([...this.roots].map((id) => this.refreshDisk(this.items.get(id))));
      return { results };
    } finally { this.cleanupBusy = false; this.revision += 1; }
  }

  async reveal(id) {
    if (this.cleanupBusy) throw new UserError('Đang xử lý dọn dữ liệu. Hãy đợi hoàn tất.', 409);
    const item = this.item(id);
    await this.inspect(item.path);
    await this.command('/usr/bin/open', ['-R', item.path]);
  }
}
