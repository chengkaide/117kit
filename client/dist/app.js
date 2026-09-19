/* 117kit 实验室管理 - 单页应用（先简单，逐步丰满） */
const $app = document.getElementById('app');
let me = null;
let tab = 'home';

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    credentials: 'same-origin',
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDT = (s) => (s || '').replace('T', ' ').slice(5, 16);

// ---------- 渲染框架 ----------
function render(html) { $app.innerHTML = html; }

function topbar() {
  return `<div class="topbar"><div><h1>117kit 实验室</h1><div class="who">${esc(me.displayName)} · ${me.role === 'admin' ? '管理员' : '成员'}</div></div>
  <button class="link" onclick="logout()">退出</button></div>`;
}

const TABS = [
  ['home', '今日'], ['reserve', '预约'], ['exp', '实验'], ['qtegra', '数据'], ['record', '运行记录'],
  ['gas', '气体'], ['book', '记录本'], ['equip', '配件'], ...(me?.role === 'admin' ? [['admin', '管理']] : []),
];

function tabbar() {
  return `<nav class="tabbar">${TABS.map(([k, n]) =>
    `<button class="${tab === k ? 'active' : ''}" onclick="go('${k}')">${n}</button>`).join('')}</nav>`;
}

function go(t) { tab = t; main(); }
async function main() {
  try {
    if (!me) { me = await api('/auth/me'); } else { me = await api('/auth/me'); }
  } catch { return renderAuth(); }
  render(topbar() + `<main id="view"></main>` + tabbar());
  const v = document.getElementById('view');
  try {
    if (tab === 'home') await viewHome(v);
    else if (tab === 'reserve') await viewReserve(v);
    else if (tab === 'exp') await viewExp(v);
    else if (tab === 'record') await viewRecord(v);
    else if (tab === 'qtegra') await viewQtegra(v);
    else if (tab === 'gas') await viewGas(v);
    else if (tab === 'book') await viewBook(v);
    else if (tab === 'equip') await viewEquip(v);
    else if (tab === 'admin') await viewAdmin(v);
  } catch (e) { v.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

// ---------- 登录 / 注册 ----------
function renderAuth(mode = 'login') {
  render(`<div class="auth-wrap">
    <div class="logo"><div class="big">117kit</div><div style="color:var(--muted);font-size:13px">117 实验室管理及小工具系统</div></div>
    <div class="card">
      ${mode === 'login' ? `
      <label>用户名</label><input id="li_u" autocomplete="username">
      <label>密码</label><input id="li_p" type="password" autocomplete="current-password">
      <button class="primary" onclick="doLogin()">登 录</button>
      <button class="ghost" style="width:100%" onclick="renderAuth('register')">没有账号？注册（需管理员审批）</button>` : `
      <label>姓名（显示用）</label><input id="rg_n">
      <label>用户名（3-30 位字母/数字/下划线）</label><input id="rg_u" autocomplete="off">
      <label>密码（至少 8 位）</label><input id="rg_p" type="password">
      <button class="primary" onclick="doRegister()">注 册</button>
      <button class="ghost" style="width:100%" onclick="renderAuth('login')">返回登录</button>`}
      <div id="auth_msg"></div>
    </div></div>`);
  window._authMode = mode;
}

async function doLogin() {
  const m = document.getElementById('auth_msg');
  try {
    await api('/auth/login', { method: 'POST', body: { username: v('li_u'), password: v('li_p') } });
    me = await api('/auth/me'); tab = 'home'; main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function doRegister() {
  const m = document.getElementById('auth_msg');
  try {
    const r = await api('/auth/register', { method: 'POST', body: { displayName: v('rg_n'), username: v('rg_u'), password: v('rg_p') } });
    const msg = r.message;
    renderAuth('login');
    document.getElementById('auth_msg').innerHTML = `<div class="msg ok">${esc(msg)}</div>`;
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
const v = (id) => document.getElementById(id)?.value.trim() || '';
async function logout() { await api('/auth/logout', { method: 'POST' }); me = null; renderAuth(); }

// ---------- 今日（打卡） ----------
async function viewHome(v) {
  const [today, list] = await Promise.all([api('/lab/checkin/today'), api('/lab/checkin/list?limit=14')]);
  v.innerHTML = `
  <div class="card">
    <h2>今日打卡 · ${todayStr()}</h2>
    <div id="ck">${today.today
      ? `<span class="tag ok">已签到 ${fmtDT(today.today.checkin_at)}</span>` +
        (today.today.checkout_at ? `<span class="tag info">已签退 ${fmtDT(today.today.checkout_at)}</span>`
          : `<button class="ghost" onclick="checkout()">签退</button>`)
      : `<button class="primary" onclick="checkin()">签 到</button>`}</div>
    ${today.today?.note ? `<div class="m" style="color:var(--muted);font-size:12px;margin-top:6px">备注：${esc(today.today.note)}</div>` : ''}
  </div>
  <div class="card"><h2>最近打卡记录</h2>
    ${list.length ? `<table><tr><th>日期</th><th>${me.role === 'admin' ? '姓名' : ''}</th><th>签到</th><th>签退</th></tr>
    ${list.map((r) => `<tr><td>${r.work_date}</td><td>${me.role === 'admin' ? esc(r.display_name) : ''}</td><td>${fmtDT(r.checkin_at)}</td><td>${r.checkout_at ? fmtDT(r.checkout_at) : '—'}</td></tr>`).join('')}</table>`
      : '<div class="empty">还没有打卡记录</div>'}
  </div>`;
}
async function checkin() { try { await api('/lab/checkin', { method: 'POST', body: { note: '' } }); main(); } catch (e) { alert(e.message); } }
async function checkout() { try { await api('/lab/checkin/checkout', { method: 'POST' }); main(); } catch (e) { alert(e.message); } }

// ---------- 预约 ----------
async function viewReserve(v) {
  const from = todayStr(), to = addDays(from, 13);
  const all = await api(`/lab/reservations?from=${from}&to=${to}`);
  const mine = all.filter((r) => r.user_id === me.id);
  v.innerHTML = `
  <div class="card"><h2>新建预约（工作日 8:00-22:00，周六日可预约）</h2>
    <div class="row"><div><label>日期</label><input type="date" id="rs_d" min="${from}" value="${from}"></div>
    <div><label>仪器</label><select id="rs_i"><option>LA-ICP-MS</option><option>其他</option></select></div></div>
    <div class="row"><div><label>开始</label><input type="time" id="rs_s" value="09:00"></div>
    <div><label>结束</label><input type="time" id="rs_e" value="12:00"></div></div>
    <label>用途说明</label><input id="rs_p" placeholder="例如：锆石 U-Pb 定年">
    <button class="primary" onclick="addResv()">提交预约</button><div id="rs_msg"></div></div>
  <div class="card"><h2>未来两周已约时段（全室可见）</h2>
    ${all.length ? all.map((r) => `<div class="item"><div class="t">${r.work_date} ${r.start_time}~${r.end_time} · ${esc(r.instrument)}
      ${r.user_id === me.id ? `<button class="danger" style="float:right" onclick="cancelResv(${r.id})">取消</button>` : ''}</div>
      <div class="m">${esc(r.display_name)}${r.purpose ? ' · ' + esc(r.purpose) : ''}</div></div>`).join('')
      : '<div class="empty">暂无预约</div>'}</div>`;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); }
async function addResv() {
  const m = document.getElementById('rs_msg');
  try {
    await api('/lab/reservations', { method: 'POST', body: { workDate: v('rs_d'), startTime: v('rs_s'), endTime: v('rs_e'), instrument: v('rs_i'), purpose: v('rs_p') } });
    main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function cancelResv(id) { if (confirm('确认取消该预约？')) { await api(`/lab/reservations/${id}/cancel`, { method: 'POST' }); main(); } }

// ---------- 实验 ----------
async function viewExp(v) {
  const list = await api('/exp');
  v.innerHTML = `
  <div class="card"><h2>新建实验</h2>
    <label>实验标题</label><input id="ex_t" placeholder="例如：ZK-01 锆石 U-Pb">
    <label>样品信息</label><input id="ex_s" placeholder="样品号、点数等">
    <button class="primary" onclick="addExp()">创建</button><div id="ex_msg"></div></div>
  <div class="card"><h2>我的实验（仅本人和管理员可见）</h2>
    ${list.length ? list.map((e) => `<div class="item" onclick="expDetail(${e.id})" style="cursor:pointer">
      <div class="t">${esc(e.title)} ${e.status === 'submitted' ? '<span class="tag ok">已提交结果</span>' : '<span class="tag warn">进行中</span>'}</div>
      <div class="m">${esc(e.display_name)} · 创建 ${fmtDT(e.created_at)} · 数据 ${e.data_count} 个 · 结果 ${e.result_count} 个</div></div>`).join('')
      : '<div class="empty">还没有实验记录</div>'}</div>`;
}
async function addExp() {
  const m = document.getElementById('ex_msg');
  try { await api('/exp', { method: 'POST', body: { title: v('ex_t'), sampleInfo: v('ex_s') } }); main(); }
  catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function expDetail(id) {
  try {
    const e = await api(`/exp/${id}`);
    render(topbar() + `<main id="view">
    <button class="ghost" onclick="go('exp')">← 返回列表</button>
    <div class="card"><h2>${esc(e.title)} ${e.status === 'submitted' ? '<span class="tag ok">已提交结果</span>' : '<span class="tag warn">进行中</span>'}</h2>
      <div class="m" style="font-size:12px;color:var(--muted)">负责人：${esc(e.display_name)} · 创建 ${fmtDT(e.created_at)}</div>
      ${e.sample_info ? `<div style="margin-top:6px;font-size:13px">${esc(e.sample_info)}</div>` : ''}
      <h3>实验数据（每种格式上传后自动保存）</h3>
      <div id="files">${e.files.map((f) => `<div class="item"><div class="t">${esc(f.orig_name)} <span class="tag ${f.kind === 'result' ? 'ok' : 'info'}">${f.kind === 'result' ? '结果' : '数据'}</span></div>
        <div class="m">${(f.size / 1024).toFixed(1)} KB · ${fmtDT(f.created_at)} · <a href="/api/exp/files/${f.id}/download">下载</a></div></div>`).join('') || '<div class="empty">暂无文件</div>'}</div>
      ${e.user_id === me.id ? `
      <label>上传实验数据 / 结果文件</label>
      <input type="file" id="up_f">
      <div class="row" style="margin-top:6px"><div><label>类型</label><select id="up_k"><option value="experiment_data">实验数据</option><option value="result">结果文件</option></select></div></div>
      <button class="primary" onclick="uploadFile(${e.id})">上传</button>
      ${e.status !== 'submitted' ? `
      <h3>提交最终结果</h3>
      <label>结果说明</label><textarea id="sm_r" placeholder="年龄结果、结论要点等"></textarea>
      <button class="primary" onclick="submitExp(${e.id})">提交结果（提交后仅本人和管理员可见）</button>` : `
      <h3>结果</h3><div style="font-size:13px;white-space:pre-wrap">${esc(e.result_summary || '')}</div>
      <div class="m" style="font-size:12px;color:var(--muted)">提交于 ${fmtDT(e.submitted_at)}</div>`}` : ''}
      <div id="dt_msg"></div></div></main>` + tabbar());
  } catch (err) { alert(err.message); }
}
async function uploadFile(id) {
  const m = document.getElementById('dt_msg');
  const input = document.getElementById('up_f');
  if (!input.files[0]) { m.innerHTML = '<div class="msg err">请选择文件</div>'; return; }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  fd.append('kind', document.getElementById('up_k').value);
  try { await api(`/exp/${id}/files`, { method: 'POST', body: fd }); expDetail(id); }
  catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function submitExp(id) {
  const m = document.getElementById('dt_msg');
  try {
    await api(`/exp/${id}/submit`, { method: 'POST', body: { resultSummary: document.getElementById('sm_r').value } });
    alert('结果已提交'); main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

// ---------- Qtegra 数据导入 ----------
async function viewQtegra(v) {
  const files = await api('/qtegra/files');
  v.innerHTML = `
  <div class="card"><h2>自动导入</h2>
    <div style="font-size:13px;color:var(--muted)">在 Qtegra 里把分析结果自动导出到本机目录
      <b>server\\qtegra-inbox</b>（可用环境变量 QTEGRA_WATCH_DIR 改），
      系统会自动解析入库并归档到 imported 子目录。也可手动上传：</div>
    <label>手动导入 Qtegra CSV</label><input type="file" id="qt_f" accept=".csv">
    <button class="primary" onclick="importQtegra()">导入</button><div id="qt_msg"></div></div>
  <div class="card"><h2>已导入 ${files.length} 个文件</h2>
    ${files.length ? files.map((f) => `<div class="item"><div class="t">${esc(f.sample_name || f.orig_name)}
      <span class="tag ${f.source === 'watch' ? 'ok' : 'info'}">${f.source === 'watch' ? '自动' : '手动'}</span></div>
      <div class="m">${esc(f.orig_name)} · ${f.n_sweeps} sweeps · ${f.isotopes.length} 同位素（${f.isotopes.slice(0, 8).join(' ')}${f.isotopes.length > 8 ? '…' : ''}）</div>
      <div class="m">测定时间 ${esc(f.run_time) || '—'} · 导入 ${fmtDT(f.created_at)}
      ${me.role === 'admin' ? ` · <a href="javascript:void(0)" onclick="delQtegra(${f.id})" style="color:var(--bad)">删除</a>` : ''}</div></div>`).join('')
      : '<div class="empty">还没有导入的数据。把 Qtegra 导出的 CSV 放进监视目录或手动上传试试。</div>'}</div>`;
}
async function importQtegra() {
  const m = document.getElementById('qt_msg');
  const input = document.getElementById('qt_f');
  if (!input.files[0]) { m.innerHTML = '<div class="msg err">请选择 CSV 文件</div>'; return; }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  fd.append('kind', 'qtegra');
  try {
    const r = await api('/qtegra/import', { method: 'POST', body: fd });
    m.innerHTML = `<div class="msg ok">已导入：${esc(r.sampleName)}（${r.nSweeps} sweeps）</div>`;
    setTimeout(main, 800);
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function delQtegra(id) { if (confirm('确认删除该导入记录？')) { await api(`/qtegra/files/${id}`, { method: 'DELETE' }); main(); } }

// ---------- 运行记录 + 值班日志 + 导出 ----------
async function viewRecord(v) {
  const from = window._recFrom || addDays(todayStr(), -30), to = todayStr();
  const [runs, duty] = await Promise.all([
    api(`/record/run-logs?from=${from}&to=${to}`), api(`/record/duty-logs?from=${from}&to=${to}`)]);
  v.innerHTML = `
  <div class="card"><h2>导出记录（CSV，Excel 直接打开）</h2>
    <div class="row"><div><label>起始日期</label><input type="date" id="ex_from" value="${from}"></div>
    <div><label>截止日期</label><input type="date" id="ex_to" value="${to}"></div></div>
    <div class="row">
      <button class="primary" onclick="exportCsv('run')">导出运行记录</button>
      <button class="primary" onclick="exportCsv('duty')">导出值班日志</button>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:6px">${me.role === 'admin' ? '管理员导出全室记录' : '导出你自己的记录'}</div></div>
  <div class="card"><h2>实验运行记录</h2>
    <div class="row"><div><label>日期</label><input type="date" id="rl_d" value="${todayStr()}"></div>
    <div><label>仪器</label><select id="rl_i"><option>LA-ICP-MS</option><option>其他</option></select></div></div>
    <div class="row"><div><label>温度 ℃</label><input id="rl_t" placeholder="23"></div>
    <div><label>湿度 %</label><input id="rl_h" placeholder="45"></div></div>
    <div class="row"><div><label>数据点数</label><input type="number" id="rl_dp"></div>
    <div><label>标样点数</label><input type="number" id="rl_sp"></div>
    <div><label>样品点数</label><input type="number" id="rl_ap"></div></div>
    <label>仪器信号参数</label><input id="rl_sig" placeholder="如：ICP RF 1350W, 载气 0.85 L/min">
    <label>信号强度</label><input id="rl_int" placeholder="如：238U ≈ 3.5e6 cps">
    <label>意外和事件</label><textarea id="rl_inc" placeholder="无异常可留空；如：14:20 氩气瓶报警，更换新瓶"></textarea>
    <label>备注</label><input id="rl_n">
    <button class="primary" onclick="addRunLog()">保存运行记录</button><div id="rl_msg"></div></div>
  <div class="card"><h2>值班日志</h2>
    <div class="row"><div><label>日期</label><input type="date" id="dt_d" value="${todayStr()}"></div></div>
    <label>值班情况</label><textarea id="dt_c" placeholder="值班时段、做了什么、交接事项"></textarea>
    <button class="primary" onclick="addDutyLog()">保存值班日志</button><div id="dt_msg"></div></div>
  <div class="card"><h2>最近运行记录</h2>
    ${runs.length ? runs.map((r) => `<div class="item"><div class="t">${r.work_date} · ${esc(r.display_name)} · ${esc(r.instrument)}</div>
      <div class="m">温度 ${esc(r.temp_c) || '—'}℃ · 湿度 ${esc(r.humidity_pct) || '—'}% · 数据点 ${r.data_points ?? '—'} · 标样 ${r.std_points ?? '—'} · 样品 ${r.sample_points ?? '—'}</div>
      ${r.signal_params ? `<div class="m">信号参数：${esc(r.signal_params)}${r.signal_intensity ? ' · 强度：' + esc(r.signal_intensity) : ''}</div>` : ''}
      ${r.incidents ? `<div class="m" style="color:var(--bad)">意外/事件：${esc(r.incidents)}</div>` : ''}
      ${r.notes ? `<div class="m">备注：${esc(r.notes)}</div>` : ''}</div>`).join('')
      : '<div class="empty">暂无运行记录</div>'}</div>
  <div class="card"><h2>最近值班日志</h2>
    ${duty.length ? duty.map((d) => `<div class="item"><div class="t">${d.work_date} · ${esc(d.display_name)}</div>
      <div class="m">${esc(d.content)}</div></div>`).join('')
      : '<div class="empty">暂无值班日志</div>'}</div>`;
}
async function exportCsv(kind) {
  window._recFrom = document.getElementById('ex_from').value;
  const to = document.getElementById('ex_to').value;
  const path = kind === 'run' ? '/record/run-logs/export' : '/record/duty-logs/export';
  window.location.href = `/api${path}?from=${encodeURIComponent(window._recFrom)}&to=${encodeURIComponent(to)}`;
}
async function addRunLog() {
  const m = document.getElementById('rl_msg');
  try {
    await api('/record/run-logs', { method: 'POST', body: {
      workDate: v('rl_d'), instrument: v('rl_i'), tempC: v('rl_t'), humidityPct: v('rl_h'),
      dataPoints: v('rl_dp'), stdPoints: v('rl_sp'), samplePoints: v('rl_ap'),
      signalParams: v('rl_sig'), signalIntensity: v('rl_int'), incidents: v('rl_inc'), notes: v('rl_n') } });
    main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function addDutyLog() {
  const m = document.getElementById('dt_msg');
  try {
    await api('/record/duty-logs', { method: 'POST', body: { workDate: v('dt_d'), content: document.getElementById('dt_c').value } });
    main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

// ---------- 气体 ----------
const GASES = ['氮气', '氩气', '高纯氦', '高纯氮'];
const LEVELS = ['充足', '一半', '偏低', '已用完'];
async function viewGas(v) {
  const date = window._gasDate || todayStr();
  const data = await api(`/lab/gas?date=${date}`);
  window._gasDate = date;
  v.innerHTML = `
  <div class="card"><h2>每日气体状态 · 含周六周日</h2>
    <div class="row"><div><label>日期</label><input type="date" id="gas_d" value="${date}" max="${todayStr()}"></div>
    <div style="align-self:flex-end"><button class="ghost" onclick="loadGas()">查看</button></div></div>
    ${GASES.map((g) => { const r = data.gases.find((x) => x.gas_name === g) || {};
      return `<div class="item"><div class="t">${g}
        <span class="tag ${r.level === '充足' ? 'ok' : r.level === '已用完' ? 'bad' : r.level ? 'warn' : 'info'}">${r.level || '未登记'}</span></div>
        <div class="row" style="margin-top:6px">
          <div><label>压力/读数</label><input id="gp_${g}" value="${esc(r.pressure || '')}" placeholder="如 1.8 MPa"></div>
          <div><label>余量</label><select id="gl_${g}">${LEVELS.map((l) => `<option ${r.level === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        </div>
        <label>备注</label><input id="gn_${g}" value="${esc(r.note || '')}"></div>`; }).join('')}
    <button class="primary" onclick="saveGas()">保存今日气体状态</button><div id="gas_msg"></div></div>`;
}
async function loadGas() { window._gasDate = v('gas_d'); main(); }
async function saveGas() {
  const m = document.getElementById('gas_msg');
  try {
    for (const g of GASES) {
      await api('/lab/gas', { method: 'POST', body: { reportDate: window._gasDate, gasName: g,
        pressure: v(`gp_${g}`), level: v(`gl_${g}`), note: v(`gn_${g}`) } });
    }
    m.innerHTML = '<div class="msg ok">已保存</div>';
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

// ---------- 记录本 ----------
async function viewBook(v) {
  const list = await api('/lab/logbook');
  v.innerHTML = `
  <div class="card"><h2>实验室记录本拍照上传</h2>
    <label>日期</label><input type="date" id="bk_d" value="${todayStr()}">
    <label>选择照片</label><input type="file" id="bk_f" accept="image/*" capture="environment">
    <label>备注</label><input id="bk_n" placeholder="如：第 3 页，ZK-01 剥蚀参数">
    <button class="primary" onclick="uploadBook()">上传</button><div id="bk_msg"></div></div>
  <div class="card"><h2>已上传（${me.role === 'admin' ? '全部成员' : '本人'}）</h2>
    ${list.length ? list.map((f) => `<div class="item"><div class="t">${f.work_date} · ${esc(f.orig_name)}</div>
      <div class="m">${esc(f.display_name)} · ${fmtDT(f.created_at)}${f.note ? ' · ' + esc(f.note) : ''} · <a href="/api/exp/files/${f.id}/download">查看</a></div></div>`).join('')
      : '<div class="empty">暂无记录</div>'}</div>`;
}
async function uploadBook() {
  const m = document.getElementById('bk_msg');
  const input = document.getElementById('bk_f');
  if (!input.files[0]) { m.innerHTML = '<div class="msg err">请选择照片</div>'; return; }
  const fd = new FormData();
  fd.append('file', input.files[0]);
  fd.append('kind', 'logbook');
  fd.append('work_date', v('bk_d'));
  fd.append('note', v('bk_n'));
  try { await api('/lab/logbook', { method: 'POST', body: fd }); main(); }
  catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}

// ---------- 配件位置 ----------
async function viewEquip(v) {
  const list = await api('/lab/equipment');
  const kw = (window._eqKw || '').toLowerCase();
  const shown = kw ? list.filter((e) => [e.name, e.category, e.room, e.cabinet, e.position, e.description].join(' ').toLowerCase().includes(kw)) : list;
  v.innerHTML = `
  <div class="card"><h2>配件位置台账</h2>
    <input id="eq_q" placeholder="搜索：名称 / 柜号 / 位置…" value="${esc(window._eqKw || '')}" oninput="window._eqKw=this.value" onkeydown="if(event.key==='Enter')loadEquip()">
    <button class="ghost" style="width:100%" onclick="loadEquip()">搜索</button></div>
  <div class="card"><h2>登记新配件</h2>
    <div class="row"><div><label>名称</label><input id="eq_n"></div><div><label>类别</label><input id="eq_c" placeholder="样品座/气路/工控机…"></div></div>
    <div class="row"><div><label>房间</label><input id="eq_r" placeholder="117"></div><div><label>柜号</label><input id="eq_cb"></div></div>
    <label>具体位置</label><input id="eq_p" placeholder="如：B 柜第 2 层左侧">
    <label>描述</label><input id="eq_d">
    <button class="primary" onclick="addEquip()">登记</button><div id="eq_msg"></div></div>
  <div class="card"><h2>共 ${shown.length} 件</h2>
    ${shown.map((e) => `<div class="item"><div class="t">${esc(e.name)} <span class="tag info">${esc(e.category || '未分类')}</span></div>
      <div class="m">📍 ${esc(e.room || '117')} ${esc(e.cabinet || '')} ${esc(e.position || '')}</div>
      ${e.description ? `<div class="m">${esc(e.description)}</div>` : ''}
      ${me.role === 'admin' ? `<button class="danger" onclick="delEquip(${e.id})">删除</button>` : ''}</div>`).join('')
      || '<div class="empty">暂无记录，登记第一件吧</div>'}</div>`;
}
function loadEquip() { main(); }
async function addEquip() {
  const m = document.getElementById('eq_msg');
  try {
    await api('/lab/equipment', { method: 'POST', body: { name: v('eq_n'), category: v('eq_c'), room: v('eq_r'), cabinet: v('eq_cb'), position: v('eq_p'), description: v('eq_d') } });
    window._eqKw = ''; main();
  } catch (e) { m.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; }
}
async function delEquip(id) { if (confirm('确认删除？')) { await api(`/lab/equipment/${id}`, { method: 'DELETE' }); main(); } }

// ---------- 管理员 ----------
async function viewAdmin(v) {
  const users = await api('/admin/users');
  const statusTag = { pending: ['warn', '待审批'], active: ['ok', '正常'], disabled: ['bad', '已停用'] };
  v.innerHTML = `
  <div class="card"><h2>成员管理</h2>
    ${users.map((u) => `<div class="item"><div class="t">${esc(u.display_name)}（${esc(u.username)}）
      ${u.role === 'admin' ? '<span class="tag info">管理员</span>' : ''}
      <span class="tag ${statusTag[u.status][0]}">${statusTag[u.status][1]}</span></div>
      <div class="m">注册于 ${fmtDT(u.created_at)}</div>
      ${u.status === 'pending' ? `<button class="ghost" onclick="adminDo(${u.id},'approve')">通过审批</button>` : ''}
      ${u.status === 'active' && u.role !== 'admin' ? `<button class="ghost" onclick="adminDo(${u.id},'disable')">停用</button>
      <button class="ghost" onclick="adminDo(${u.id},'make-admin')">设为管理员</button>` : ''}
      ${u.status === 'disabled' ? `<button class="ghost" onclick="adminDo(${u.id},'enable')">恢复</button>` : ''}
      <button class="ghost" onclick="resetPwd(${u.id})">重置密码</button></div>`).join('')}</div>`;
}
async function adminDo(id, action) {
  try { const r = await api(`/admin/users/${id}/${action}`, { method: 'POST' }); if (r.message) alert(r.message); main(); }
  catch (e) { alert(e.message); }
}
async function resetPwd(id) {
  const p = prompt('输入新密码（至少 8 位）：');
  if (!p) return;
  try { const r = await api(`/admin/users/${id}/reset-password`, { method: 'POST', body: { newPassword: p } }); alert(r.message); }
  catch (e) { alert(e.message); }
}

// ---------- 启动 ----------
(async function boot() {
  try { me = await api('/auth/me'); main(); } catch { renderAuth(); }
})();
