const $ = (id) => document.getElementById(id);
const titles = {
  overview: ['Một góc nhìn rõ ràng hơn.', 'Biết dung lượng nằm ở đâu. Hiểu tác động trước khi dọn.'],
  suggestions: ['Dọn có hiểu biết.', 'Các vị trí đã nhận diện. Gợi ý không có nghĩa là không có rủi ro.'],
  folders: ['Dung lượng nằm ở đâu?', 'Duyệt từng nhánh. Quét riêng thư mục cần đo, không phải đợi cả ổ đĩa.'],
  files: ['Những file chiếm chỗ.', 'Từ 100 MiB dung lượng cấp phát thực tế. Xem công dụng trước khi quyết định.'],
};
const riskLabels = { low: 'Thấp', medium: 'Cân nhắc', high: 'Cao', unknown: 'Chưa xác định' };
const confidenceLabels = { high: 'Cao · dựa trên vị trí đã nhận diện', medium: 'Vừa · cần kiểm tra thêm', low: 'Thấp · chưa đủ bằng chứng' };
const phaseLabels = { unmeasured: 'Chưa tính', queued: 'Chờ tính', measuring: 'Đang tính', partial: 'Chưa đầy đủ', stale: 'Cần đo lại', skipped: 'Bỏ qua' };
let state;
let view = 'overview';
let rootId;
let directoryId;
let results;
let page = 1;
let detailId;
let detailRequest = 0;
let queryRequest = 0;
let busy = false;
let connected = true;
let selected = new Map();
let preview;
let resultTimer;
let lastResultFetch = 0;
let toastTimer;
let treeRoot;
let treeScanId;
let treeScanStatus;
let fetchingResults = false;
let resultsPending = false;
let resultsDeferred = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, callback, className = 'text-button') {
  const node = element('button', text, className);
  node.type = 'button';
  node.addEventListener('click', callback);
  return node;
}

function bytes(value, decimal = false) {
  if (value === null || value === undefined) return 'Chưa tính';
  if (value === 0) return '0 B';
  const base = decimal ? 1000 : 1024;
  const units = decimal ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(base)), units.length - 1);
  return `${new Intl.NumberFormat('vi', { maximumFractionDigits: index > 1 ? decimal ? 2 : 1 : 0 }).format(value / base ** index)} ${units[index]}`;
}

function sizeText(item, field = 'allocatedBytes') {
  if (item[field] === null || item[field] === undefined) return item.accessError ? 'Không đọc đủ' : phaseLabels[item.sizeState] || 'Chưa tính';
  return `${bytes(item[field])}${item.sizeState !== 'complete' ? ` · ${phaseLabels[item.sizeState] || 'Chưa đo đủ'}` : ''}`;
}

function timestamp(value) {
  return value ? new Date(value).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : 'Chưa đo';
}

function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 7000);
}

async function api(route, body) {
  const response = await fetch(route, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Disk-Cleaner': '1' }, body: JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Yêu cầu không hoàn tất.');
  return value;
}

async function action(operation) {
  if (busy) return;
  busy = true;
  renderControls();
  try { return await operation(); }
  catch (error) { notify(error.message || 'Không kết nối được với backend.'); }
  finally { busy = false; renderControls(); }
}

function renderControls() {
  const running = state?.scan?.status === 'running';
  const unavailable = !connected || busy || state?.cleanupBusy;
  $('quick-scan').disabled = unavailable || running;
  $('refresh-scan').disabled = unavailable || running;
  $('deep-scan').disabled = unavailable || running;
  $('scan-directory').disabled = unavailable || running;
  $('pick-folder').disabled = unavailable;
  $('stop-scan').disabled = unavailable;
  $('stop-scan').hidden = !running;
  $('preview-trash').disabled = unavailable || running || selected.size === 0;
  $('preview-trash').title = running ? 'Dừng quét hoặc đợi hoàn tất trước khi dọn.' : '';
  $('confirm-trash').disabled = unavailable || running || !preview?.items?.length || (preview.requiresAcknowledgement && !$('acknowledge-risk').checked);
  $('cancel-trash').disabled = busy;
  $('trash-dialog').querySelector('.dialog-close').disabled = busy;
  document.querySelectorAll('[data-scan-item]').forEach((node) => { node.disabled = unavailable || running; });
}

function renderSelection() {
  $('selection-bar').hidden = selected.size === 0;
  $('selection-count').textContent = `${selected.size} mục đã chọn`;
  const entries = [...selected.values()].filter((item) => ![...selected.values()].some((parent) => parent.id !== item.id && item.path.startsWith(`${parent.path}/`)));
  const allocations = new Set();
  const known = entries.reduce((sum, item) => {
    if (item.allocationId && allocations.has(item.allocationId)) return sum;
    if (item.allocationId) allocations.add(item.allocationId);
    return sum + (item.allocatedBytes || 0);
  }, 0);
  $('selection-size').textContent = `${bytes(known)} ước tính${entries.some((item) => item.allocatedBytes === null || item.sizeState !== 'complete') ? ' · có mục chưa đo đủ' : ''}`;
  const selectable = (results?.items || []).filter((item) => !item.protectedReason);
  $('select-page').checked = selectable.length > 0 && selectable.every((item) => selected.has(item.id));
  $('select-page').indeterminate = selectable.some((item) => selected.has(item.id)) && !$('select-page').checked;
  $('select-page').disabled = selectable.length === 0;
  renderControls();
}

function renderStorage(root) {
  const disk = root?.disk;
  $('disk-categories').replaceChildren();
  $('disk-meter').replaceChildren();
  $('disk-name').textContent = disk?.name || 'Không gian trên ổ đĩa';
  if (!disk || disk.error) {
    $('disk-used').textContent = '—';
    $('disk-total').textContent = disk?.error || 'Chưa đọc được dung lượng';
    $('disk-free').textContent = '—';
    $('disk-meter').setAttribute('aria-label', 'Chưa đọc được dung lượng ổ đĩa');
    $('disk-mount').textContent = root?.path || '';
    $('disk-note').textContent = state.startupError || 'Kiểm tra quyền truy cập rồi quét lại.';
    return;
  }
  $('disk-used').textContent = bytes(disk.used, true);
  $('disk-total').textContent = `/ ${bytes(disk.total, true)} đã dùng`;
  $('disk-free').textContent = bytes(disk.available, true);
  const totals = { documents: 0, applications: 0, developer: 0, trash: 0, system: 0 };
  for (const device of disk.devices || []) {
    if (device === disk.systemDevice && disk.systemBytes !== null) continue;
    const usage = state.scan?.usage?.[device];
    if (usage) for (const key of Object.keys(totals)) totals[key] += usage[key] || 0;
  }
  const macos = Math.min(disk.used, disk.systemBytes || 0);
  const measured = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const scale = measured ? Math.min(1, Math.max(0, disk.used - macos) / measured) : 1;
  const unclassified = Math.max(0, disk.used - macos - measured);
  const categories = [
    ['documents', 'Tài liệu', totals.documents], ['applications', 'Ứng dụng', totals.applications],
    ['developer', 'Phát triển', totals.developer], ['trash', 'Thùng rác', totals.trash],
    ['system', 'Dữ liệu hệ thống đã đo', totals.system], ['macos', 'macOS', macos],
    ['unclassified', 'Chưa phân loại', unclassified], ['free', 'Trống', disk.available],
  ];
  const descriptions = [];
  for (const [key, label, value] of categories) {
    const text = value > 0 || ['unclassified', 'free'].includes(key) ? bytes(value, true) : key === 'macos' ? 'Chưa đọc được' : 'Chưa ghi nhận';
    descriptions.push(`${label}: ${text}`);
    const segment = element('span', null, 'storage-segment');
    segment.dataset.storage = key;
    segment.style.flexGrow = String(key in totals ? value * scale : value);
    segment.title = `${label}: ${text}`;
    if (value) $('disk-meter').append(segment);
    const entry = element('li');
    const swatch = element('i');
    swatch.dataset.storage = key;
    swatch.setAttribute('aria-hidden', 'true');
    entry.append(swatch, element('span', `${label} · ${text}`));
    $('disk-categories').append(entry);
  }
  $('disk-meter').setAttribute('aria-label', `${bytes(disk.used, true)} trên ${bytes(disk.total, true)} đã dùng. ${descriptions.join('. ')}`);
  $('disk-mount').textContent = `${disk.source === 'apfs-container' ? 'Toàn container APFS' : 'Filesystem'} · Phạm vi: ${root.path} · Đọc lúc ${timestamp(disk.measuredAt)}`;
  $('disk-note').textContent = [
    state.startupError,
    disk.source === 'filesystem' ? 'Chưa đọc được tổng container APFS; đang hiển thị riêng filesystem.' : 'Tổng ổ dùng GB như macOS. macOS có thể tính thêm dung lượng có thể thu hồi.',
    state.scan ? `Các nhóm ước tính từ phạm vi ${state.scan.paths.join(', ')}; phần chưa quét, thiếu quyền, snapshot và volume phụ còn ở “Chưa phân loại”.` : 'Quét để phân nhóm dung lượng; macOS lấy trực tiếp từ volume hệ thống.',
    state.scan?.usageStale ? 'Phân nhóm cần quét lại sau khi chuyển Thùng rác.' : '',
    scale < 1 ? 'File APFS có thể dùng chung block; thanh được chuẩn hoá về tổng dung lượng ổ.' : '',
  ].filter(Boolean).join(' ');
}

function renderState(next) {
  if (state && next.revision < state.revision) return;
  state = next;
  if (!rootId) { rootId = state.defaultRootId || state.homeId; directoryId = rootId; }
  const picker = $('root-picker');
  const previousOptions = [...picker.options].map((option) => option.value).join(',');
  if (previousOptions !== state.roots.map((root) => root.id).join(',')) {
    picker.replaceChildren(...state.roots.map((root) => {
      const option = element('option', root.id === state.startupRootId ? `${root.disk?.name || 'Ổ khởi động'} · Toàn ổ` : root.id === state.homeId ? `Home · ${root.name}` : root.name);
      option.value = root.id;
      option.title = root.path;
      return option;
    }));
  }
  picker.value = rootId;
  const root = state.roots.find((item) => item.id === rootId);
  renderStorage(root);
  $('deep-scan').textContent = rootId === state.startupRootId ? 'Quét sâu toàn ổ' : 'Quét sâu phạm vi';
  const scan = state.scan;
  if (scan) {
    if ((treeScanId !== scan.id || (treeScanStatus === 'running' && scan.status !== 'running')) && view === 'folders') renderTree(true);
    treeScanId = scan.id;
    treeScanStatus = scan.status;
    const labels = { running: 'Đang quét', complete: 'Đã quét xong', partial: scan.mode === 'quick' ? 'Đã có kết quả nhanh · chưa đầy đủ' : 'Đã quét · có phần bị bỏ qua', cancelled: 'Đã dừng · giữ kết quả hiện có', error: 'Quét chưa hoàn tất' };
    const stages = { discover: 'Đang nhận diện gợi ý', spotlight: 'Đang tìm file lớn bằng Spotlight', measure: 'Đang tính dung lượng' };
    $('scan-title').textContent = scan.status === 'running' && scan.mode === 'quick' ? stages[scan.stage] || labels.running : labels[scan.status];
    $('scan-dot').classList.toggle('running', scan.status === 'running');
    $('scan-time').textContent = `${scan.mode === 'quick' ? 'Quét nhanh' : 'Quét sâu'} · ${timestamp(scan.startedAt)}`;
    $('scan-summary').textContent = scan.mode === 'quick'
      ? `${scan.checked.toLocaleString('vi')} mục đã kiểm tra · ${scan.large.toLocaleString('vi')} file lớn${scan.totalSuggestions ? ` · đã xử lý ${scan.measuredSuggestions}/${scan.totalSuggestions} vị trí` : ''}. Gợi ý${scan.wholeStartup ? ', Ứng dụng và Thùng rác' : ''} được tự đo; dùng quét sâu để phân nhóm đầy đủ hơn. Spotlight có thể bỏ sót file.`
      : `${scan.checked.toLocaleString('vi')} mục · ${scan.folders.toLocaleString('vi')} thư mục · ${scan.files.toLocaleString('vi')} file · ${scan.large.toLocaleString('vi')} file lớn. ${scan.wholeStartup ? 'Gồm volume macOS và Data; bỏ đường dẫn volume trùng và ổ ngoài.' : 'Không tự vượt sang filesystem khác.'} Không đi theo symlink.`;
    $('scan-current').hidden = !scan.currentPath;
    $('scan-current').textContent = `Phạm vi: ${scan.paths.join(' · ')}${scan.status === 'running' ? ` · Đang đọc: ${scan.currentPath}` : ''}`;
    $('scan-current').title = `${scan.paths.join('\n')}\n${scan.currentPath}`;
    $('scan-issues').hidden = scan.errors + scan.skipped === 0;
    $('issues-summary').textContent = `${scan.errors} lỗi hoặc thiếu quyền · ${scan.skipped} mục bỏ qua${scan.errors + scan.skipped > 20 ? ' · hiển thị 20 mục đầu' : ''}`;
    $('issues-list').replaceChildren(...scan.issues.map((issue) => element('li', `${issue.path}: ${issue.message}`)));
  } else {
    $('scan-title').textContent = 'Sẵn sàng phân tích';
  }
  for (const item of state.roots) if (selected.has(item.id)) selected.delete(item.id);
  renderSelection();
  scheduleResults();
}

function setView(nextView) {
  view = nextView;
  page = 1;
  $('page-title').textContent = titles[view][0];
  $('page-description').textContent = titles[view][1];
  $('overview-panel').hidden = view !== 'overview';
  $('browser-panel').hidden = view === 'overview';
  document.querySelectorAll('.nav-button').forEach((node) => {
    const active = node.dataset.view === view;
    node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  });
  $('scan-directory').hidden = view !== 'folders';
  $('folder-tree').hidden = view !== 'folders';
  queryRequest += 1;
  if (view !== 'overview') { refreshResults(); if (view === 'folders') renderTree(); }
}

function scheduleResults() {
  if (view === 'overview' || !rootId || resultTimer) return;
  resultTimer = setTimeout(() => {
    resultTimer = null;
    if ($('results-body').contains(document.activeElement)) { resultsDeferred = true; return; }
    refreshResults();
    if (detailId && !$('detail-panel').querySelector('button:focus, input:focus')) showDetail(detailId, false);
  }, Math.max(0, 1000 - (Date.now() - lastResultFetch)));
}

async function refreshResults() {
  if (view === 'overview' || !rootId) return;
  const request = queryRequest;
  if (fetchingResults) { resultsPending = true; return; }
  fetchingResults = true;
  lastResultFetch = Date.now();
  const parameters = new URLSearchParams({ view, rootId, directoryId, q: $('search').value, sort: $('sort').value, page });
  $('results-panel').setAttribute('aria-busy', 'true');
  try {
    const value = await api(`/api/items?${parameters}`);
    if (request !== queryRequest) return;
    results = value;
    page = value.page;
    renderResults();
  } catch (error) {
    if (request !== queryRequest) return;
    $('directory-error').textContent = error.message;
    $('directory-error').hidden = false;
    $('results-body').replaceChildren();
    results = null;
    renderSelection();
  } finally {
    fetchingResults = false;
    $('results-panel').removeAttribute('aria-busy');
    if (resultsPending) { resultsPending = false; scheduleResults(); }
  }
}

function navigateDirectory(id) {
  directoryId = id;
  page = 1;
  $('search').value = '';
  setView('folders');
}

function renderResults() {
  $('result-count').textContent = `${results.total.toLocaleString('vi')} mục${view === 'files' ? ' · dung lượng trên đĩa' : ''}`;
  $('directory-error').textContent = results.accessError || '';
  $('directory-error').hidden = !results.accessError;
  $('breadcrumbs').hidden = view !== 'folders';
  $('breadcrumbs').replaceChildren();
  for (const [index, crumb] of results.breadcrumbs.entries()) {
    if (index) $('breadcrumbs').append(element('span', '/'));
    const node = button(crumb.name, () => navigateDirectory(crumb.id));
    node.title = crumb.path;
    $('breadcrumbs').append(node);
  }
  $('results-body').replaceChildren(...results.items.map((item) => {
    if (selected.has(item.id)) {
      if (item.protectedReason || selected.get(item.id).version !== item.version) {
        selected.delete(item.id);
        notify('Một mục đã thay đổi hoặc được bảo vệ; đã bỏ chọn. Hãy xem lại trước khi dọn.');
      }
      else selected.set(item.id, item);
    }
    const row = element('tr');
    row.classList.toggle('selected', selected.has(item.id));
    const checkCell = element('td', null, 'check-cell');
    const check = element('input');
    check.type = 'checkbox';
    check.checked = selected.has(item.id);
    check.disabled = Boolean(item.protectedReason);
    check.setAttribute('aria-label', `Chọn ${item.name}`);
    check.title = item.protectedReason || 'Chọn để xem trước khi dọn';
    check.addEventListener('change', () => {
      if (check.checked) selected.set(item.id, item);
      else selected.delete(item.id);
      row.classList.toggle('selected', check.checked);
      renderSelection();
    });
    checkCell.append(check);
    const nameCell = element('td', null, 'file-cell');
    nameCell.append(element('span', item.kind === 'directory' ? 'DIR' : item.kind === 'symlink' ? 'LINK' : 'FILE', 'file-kind'));
    nameCell.append(button(item.name, () => showDetail(item.id), 'file-name'));
    const filepath = element('p', item.path, 'file-path');
    filepath.title = item.path;
    nameCell.append(filepath);
    if (item.kind === 'directory') nameCell.append(button('Mở thư mục ↗', () => navigateDirectory(item.id), 'text-button file-open'));
    const sizeCell = element('td', sizeText(item), 'size-cell');
    if (item.sizeState === 'complete' && item.logicalBytes !== item.allocatedBytes) sizeCell.append(element('small', `${bytes(item.logicalBytes)} logic`));
    if (item.accessError) sizeCell.append(element('small', 'Không đọc đủ · xem chi tiết'));
    if (item.shared) sizeCell.append(element('small', 'Hard link · dùng chung'));
    const riskCell = element('td');
    riskCell.append(element('span', riskLabels[item.explanation.risk], `badge ${item.explanation.risk}`));
    row.append(checkCell, nameCell, sizeCell, riskCell);
    return row;
  }));
  $('empty-state').hidden = results.items.length > 0;
  $('empty-title').textContent = results.accessError ? 'Có phần chưa đọc được' : $('search').value ? 'Không có mục khớp bộ lọc' : 'Chưa có kết quả trong phạm vi này';
  $('empty-description').textContent = results.accessError ? 'Kiểm tra quyền truy cập rồi quét lại; đây không phải kết luận thư mục rỗng.' : view === 'files' ? 'Spotlight có thể chưa lập chỉ mục. Dùng quét sâu để tìm trực tiếp các file từ 100 MiB.' : view === 'suggestions' ? 'Quét sâu để nhận diện thêm dependency và dữ liệu phát triển. Không có gợi ý không có nghĩa là ổ đĩa đã sạch.' : 'Thư mục có thể rỗng, vừa thay đổi hoặc không có mục khớp tìm kiếm.';
  $('page-label').textContent = `Trang ${results.page} / ${results.pages} · tối đa 100 mục/trang`;
  $('previous-page').disabled = results.page <= 1;
  $('next-page').disabled = results.page >= results.pages;
  renderSelection();
}

async function showDetail(id, focus = true) {
  const request = ++detailRequest;
  detailId = id;
  try {
    const item = await api(`/api/items/${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    const panel = $('detail-panel');
    const explanation = item.explanation;
    panel.replaceChildren(element('span', 'CHI TIẾT MỤC', 'eyebrow'), element('h2', item.name), element('p', item.path, 'detail-path'), element('span', `Rủi ro: ${riskLabels[explanation.risk]}`, `badge ${explanation.risk}`));
    const info = element('dl');
    const fields = [
      ['Ứng dụng liên quan', explanation.app || 'Chưa xác định'], ['Công dụng', explanation.purpose],
      ['Dung lượng trên đĩa', sizeText(item)],
      ['Dung lượng logic', sizeText(item, 'logicalBytes')], ['Bằng chứng', explanation.evidence], ['Độ chắc chắn', confidenceLabels[explanation.confidence]],
      ['Nếu xoá thì sao?', explanation.impact], ['Khả năng tạo lại', explanation.recovery], ['Thời điểm đo', timestamp(item.measuredAt)],
    ];
    for (const [label, value] of fields) info.append(element('dt', label), element('dd', value));
    panel.append(info);
    if (item.accessError) panel.append(element('p', item.accessError, 'detail-warning'));
    if (item.shared) panel.append(element('p', 'File có hard link. Dung lượng dùng chung chỉ được cộng một lần khi quét; xoá một đường dẫn có thể không thu hồi dung lượng.', 'detail-warning'));
    panel.append(element('p', item.protectedReason || 'Dung lượng là ước tính. APFS clone, hard link, snapshot và Thùng rác có thể khiến số thực thu hồi khác số hiển thị.', 'detail-warning'));
    const actions = element('div', null, 'detail-actions');
    actions.append(button('Mở vị trí trong Finder', () => action(() => api('/api/reveal', { id: item.id })), 'button'));
    if (item.kind === 'directory') {
      actions.append(button('Duyệt bên trong', () => navigateDirectory(item.id), 'button'));
      const scan = button('Quét sâu riêng mục này', () => startScan('deep', item.id), 'button');
      scan.dataset.scanItem = item.id;
      scan.disabled = busy || !connected || state?.scan?.status === 'running';
      actions.append(scan);
    }
    if (!item.protectedReason) actions.append(button(selected.has(item.id) ? 'Bỏ chọn mục này' : 'Chọn để xem trước khi dọn', () => {
      if (selected.has(item.id)) selected.delete(item.id);
      else selected.set(item.id, item);
      renderSelection();
      if (results) renderResults();
      showDetail(item.id, false);
    }, 'button'));
    panel.append(actions);
    if (focus) { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
  } catch (error) { if (focus && request === detailRequest) notify(error.message); }
}

function treeNode(item, open = false) {
  const li = element('li');
  const details = element('details');
  const summary = element('summary');
  const label = button(item.name, (event) => { event.preventDefault(); navigateDirectory(item.id); });
  label.title = item.path;
  summary.append(label);
  const children = element('ul');
  let loaded = false;
  const load = async (nextPage = 1) => {
    try {
      const response = await api(`/api/items?${new URLSearchParams({ view: 'tree', rootId, directoryId: item.id, sort: 'name', page: nextPage })}`);
      if (!li.isConnected) return;
      if (nextPage === 1) children.replaceChildren();
      for (const child of response.items) children.append(treeNode(child));
      if (response.accessError) children.append(element('li', 'Thiếu quyền đọc'));
      if (response.page < response.pages) {
        const more = element('li');
        more.append(button('Thêm thư mục…', () => { more.remove(); load(nextPage + 1); }));
        children.append(more);
      }
      loaded = true;
    } catch { children.replaceChildren(element('li', 'Chưa đọc được')); }
  };
  details.addEventListener('toggle', () => { if (details.open && !loaded) load(); });
  details.append(summary, children);
  li.append(details);
  details.open = open;
  return li;
}

function renderTree(force = false) {
  if (treeRoot === rootId && !force) return;
  treeRoot = rootId;
  const root = state.roots.find((item) => item.id === rootId);
  if (!root) return;
  const list = element('ul');
  list.append(treeNode(root, true));
  $('folder-tree').replaceChildren(list);
}

function changeRoot(id) {
  rootId = id;
  directoryId = id;
  selected.clear();
  detailId = null;
  detailRequest += 1;
  results = null;
  $('results-body').replaceChildren();
  $('detail-panel').replaceChildren(element('p', 'Chọn một mục để xem công dụng và tác động khi xoá.'));
  $('search').value = '';
  renderState(state);
  setView(view);
  if (view === 'folders') renderTree(true);
}

function startScan(mode, scope = rootId) {
  return action(async () => {
    queryRequest += 1;
    selected.clear();
    renderSelection();
    await api('/api/scans', { rootIds: [scope], mode, force: true });
    renderState(await api('/api/state'));
    await refreshResults();
  });
}

async function previewTrash() {
  await action(async () => {
    preview = await api('/api/trash/preview', { ids: [...selected.keys()], versions: Object.fromEntries([...selected].map(([id, item]) => [id, item.version])) });
    $('acknowledge-risk').checked = false;
    $('risk-acknowledgement').hidden = !preview.requiresAcknowledgement;
    $('trash-dialog-error').hidden = true;
    $('trash-preview-list').replaceChildren(...preview.items.map((item) => {
      const row = element('article', null, 'preview-item');
      row.append(element('strong', item.name), element('span', riskLabels[item.explanation.risk], `badge ${item.explanation.risk}`), element('p', item.path, 'preview-path'), element('p', item.explanation.impact), element('p', `Dung lượng trên đĩa: ${sizeText(item)} · ước tính`));
      return row;
    }));
    const messages = preview.errors.map((error) => `${selected.get(error.id)?.name || error.id}: ${error.message}`);
    if (preview.collapsed) messages.push(`${preview.collapsed} mục con đã gộp vào thư mục cha để tránh thao tác và cộng trùng.`);
    $('trash-preview-errors').textContent = messages.join('\n');
    $('trash-preview-errors').hidden = messages.length === 0;
    $('trash-dialog').showModal();
  });
}

document.querySelectorAll('[data-view]').forEach((node) => node.addEventListener('click', () => setView(node.dataset.view)));
$('root-picker').addEventListener('change', (event) => changeRoot(event.target.value));
$('quick-scan').addEventListener('click', () => startScan('quick'));
$('deep-scan').addEventListener('click', () => startScan('deep'));
$('refresh-scan').addEventListener('click', () => startScan(state?.scan?.mode || 'quick'));
$('scan-directory').addEventListener('click', () => startScan('deep', directoryId));
$('stop-scan').addEventListener('click', () => action(async () => { await api('/api/scans/cancel', {}); renderState(await api('/api/state')); await refreshResults(); }));
$('pick-folder').addEventListener('click', () => action(async () => {
  const { root } = await api('/api/pick-folder', {});
  if (!root) return;
  renderState(await api('/api/state'));
  changeRoot(root.id);
  if (state.scan?.status !== 'running') {
    await api('/api/scans', { rootIds: [root.id], mode: 'quick', force: true });
    renderState(await api('/api/state'));
  }
}));
let searchTimer;
$('search').addEventListener('input', () => { queryRequest += 1; clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 1; refreshResults(); }, 180); });
$('sort').addEventListener('change', () => { queryRequest += 1; page = 1; refreshResults(); });
$('previous-page').addEventListener('click', () => { queryRequest += 1; page -= 1; refreshResults(); });
$('next-page').addEventListener('click', () => { queryRequest += 1; page += 1; refreshResults(); });
$('select-page').addEventListener('change', (event) => {
  for (const item of results?.items || []) if (!item.protectedReason) {
    if (event.target.checked) selected.set(item.id, item);
    else selected.delete(item.id);
  }
  renderResults();
});
$('clear-selection').addEventListener('click', () => { selected.clear(); renderSelection(); if (results) renderResults(); });
$('preview-trash').addEventListener('click', previewTrash);
$('acknowledge-risk').addEventListener('change', renderControls);
$('cancel-trash').addEventListener('click', () => $('trash-dialog').close());
$('trash-dialog').addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
$('confirm-trash').addEventListener('click', () => action(async () => {
  try {
    const { results: outcomes } = await api('/api/trash', { confirmationId: preview.confirmationId, acknowledgeRisk: $('acknowledge-risk').checked });
    const successful = outcomes.filter((item) => item.ok);
    selected.clear();
    preview = null;
    detailId = null;
    detailRequest += 1;
    $('detail-panel').replaceChildren(element('p', 'Đã cập nhật kết quả. Dung lượng thư mục liên quan cần quét lại.'));
    notify(`${successful.length}/${outcomes.length} mục đã vào Thùng rác. Dung lượng chưa được giải phóng.${outcomes.some((item) => !item.ok) ? '\nMột số mục chưa chuyển được; xem kết quả từng mục.' : ''}`);
    $('trash-preview-list').replaceChildren(...outcomes.map((outcome) => {
      const row = element('article', null, 'preview-item');
      row.append(element('strong', outcome.ok ? 'Đã chuyển' : 'Chưa chuyển'), element('p', outcome.path || outcome.id, 'preview-path'), element('p', outcome.message));
      return row;
    }));
    $('trash-dialog-title').textContent = 'Kết quả chuyển vào Thùng rác';
    $('trash-dialog-title').tabIndex = -1;
    $('trash-dialog-title').focus();
    $('risk-acknowledgement').hidden = true;
    $('trash-preview-errors').hidden = true;
    $('confirm-trash').hidden = true;
    $('cancel-trash').textContent = 'Đóng';
    queryRequest += 1;
    directoryId = rootId;
    renderState(await api('/api/state'));
    await refreshResults();
    renderTree(true);
  } catch (error) { $('trash-dialog-error').textContent = error.message; $('trash-dialog-error').hidden = false; }
}));
$('trash-dialog').addEventListener('close', () => { $('trash-dialog-title').textContent = 'Chuyển vào Thùng rác?'; $('confirm-trash').hidden = false; $('cancel-trash').textContent = 'Giữ lại'; });
$('open-permissions').addEventListener('click', () => $('permissions-dialog').showModal());
$('settings-button').addEventListener('click', () => action(() => api('/api/permissions', {})));
$('results-body').addEventListener('focusout', () => {
  setTimeout(() => {
    if (resultsDeferred && !$('results-body').contains(document.activeElement)) {
      resultsDeferred = false;
      scheduleResults();
    }
  }, 0);
});

try {
  renderState(await api('/api/state'));
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => {
    connected = true;
    $('connection-warning').hidden = true;
    renderState(JSON.parse(event.data));
  });
  events.onopen = () => { connected = true; $('connection-warning').hidden = true; renderControls(); };
  events.onerror = () => { connected = false; $('connection-warning').hidden = false; renderControls(); };
} catch (error) {
  connected = false;
  $('connection-warning').hidden = false;
  $('connection-warning').textContent = `${error.message} Giữ terminal đang chạy rồi tải lại trang.`;
  renderControls();
}
