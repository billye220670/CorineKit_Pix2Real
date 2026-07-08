'use strict';

/**
 * CorineKit 对外 API 测试工具 —— 前端逻辑（纯原生 JS）
 *
 * 所有请求均打到本工具自己的 /proxy/* 路径，由 server.js 反向代理到后端，
 * 因此浏览器视角为“同源”，无需处理 CORS。
 */

// ── 常量 ─────────────────────────────────────────────────────────────
var API_BASE = '/proxy/api/v1';
var LS_KEY = 'corinekit_api_key';
var POLL_INTERVAL = 1500;

// ── DOM 引用 ─────────────────────────────────────────────────────────
var $ = function (id) { return document.getElementById(id); };
var apiKeyInput = $('apiKey');
var loadWorkflowsBtn = $('loadWorkflowsBtn');
var workflowsStatus = $('workflowsStatus');
var workflowSelect = $('workflowSelect');
var dynamicForm = $('dynamicForm');
var submitBtn = $('submitBtn');
var cancelBtn = $('cancelBtn');
var taskInfo = $('taskInfo');
var progressWrap = $('progressWrap');
var progressFill = $('progressFill');
var progressLabel = $('progressLabel');
var resultsEl = $('results');
var logEl = $('log');
var clearLogBtn = $('clearLogBtn');

// ── 运行时状态 ───────────────────────────────────────────────────────
var workflowSchemas = null; // GET /workflows 的返回
var currentTaskId = null;
var pollTimer = null;

// ── 工具函数 ─────────────────────────────────────────────────────────

function getApiKey() {
  return (apiKeyInput.value || '').trim();
}

function headersWithKey(extra) {
  var h = extra || {};
  var key = getApiKey();
  if (key) h['x-api-key'] = key;
  return h;
}

function nowTime() {
  var d = new Date();
  function p(n) { return String(n).padStart(2, '0'); }
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

/** 追加一行日志 */
function log(method, path, status, detail) {
  var line = document.createElement('div');
  line.className = 'log-line';

  var ok = typeof status === 'number' && status >= 200 && status < 300;
  var statusHtml = status === undefined || status === null
    ? ''
    : ' <span class="' + (ok ? 'ok' : 'fail') + '">[' + status + ']</span>';

  var detailStr = detail === undefined || detail === null ? '' : String(detail);
  if (detailStr.length > 300) detailStr = detailStr.slice(0, 300) + '…';

  line.innerHTML =
    '<span class="ts">' + nowTime() + '</span> ' +
    '<span class="method">' + method + '</span> ' +
    escapeHtml(path) + statusHtml +
    (detailStr ? ' ' + escapeHtml(detailStr) : '');

  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 安全解析 JSON 响应；非 JSON 时返回文本 */
async function readResponse(res) {
  var ctype = res.headers.get('content-type') || '';
  var text = await res.text();
  if (ctype.indexOf('application/json') !== -1) {
    try {
      return { json: JSON.parse(text), text: text };
    } catch (e) {
      return { json: null, text: text };
    }
  }
  return { json: null, text: text };
}

/** 简短化 body 摘要用于日志 */
function briefBody(parsed) {
  if (parsed.json) {
    try { return JSON.stringify(parsed.json); } catch (e) { return parsed.text; }
  }
  return parsed.text;
}

// ── ① API Key 持久化 ─────────────────────────────────────────────────
(function initApiKey() {
  try {
    var saved = localStorage.getItem(LS_KEY);
    if (saved) apiKeyInput.value = saved;
  } catch (e) { /* ignore */ }

  apiKeyInput.addEventListener('input', function () {
    try { localStorage.setItem(LS_KEY, getApiKey()); } catch (e) { /* ignore */ }
  });
})();

// ── ② 加载工作流 ─────────────────────────────────────────────────────
loadWorkflowsBtn.addEventListener('click', loadWorkflows);

async function loadWorkflows() {
  if (!getApiKey()) {
    workflowsStatus.textContent = '请先填写 API Key';
    return;
  }
  workflowsStatus.textContent = '加载中…';
  var path = API_BASE + '/workflows';
  try {
    var res = await fetch(path, { headers: headersWithKey() });
    var parsed = await readResponse(res);
    log('GET', path, res.status, briefBody(parsed));

    if (!res.ok) {
      workflowsStatus.textContent = '加载失败：' + (parsed.json && parsed.json.error ? parsed.json.error : res.status);
      return;
    }
    if (!parsed.json || typeof parsed.json !== 'object') {
      workflowsStatus.textContent = '返回不是有效的 schema';
      return;
    }

    workflowSchemas = parsed.json;
    populateWorkflowSelect(workflowSchemas);
    workflowsStatus.textContent = '已加载 ' + Object.keys(workflowSchemas).length + ' 个工作流';
  } catch (err) {
    log('GET', path, 'ERR', err.message);
    workflowsStatus.textContent = '请求异常：' + err.message;
  }
}

function populateWorkflowSelect(schemas) {
  workflowSelect.innerHTML = '';
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '（请选择工作流）';
  workflowSelect.appendChild(placeholder);

  // 按数字顺序排序键
  var keys = Object.keys(schemas).sort(function (a, b) { return Number(a) - Number(b); });
  keys.forEach(function (id) {
    var s = schemas[id] || {};
    var opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id + ' - ' + (s.description || '(无描述)');
    workflowSelect.appendChild(opt);
  });

  workflowSelect.disabled = false;
}

// ── ③ 选中工作流 → 动态渲染表单 ──────────────────────────────────────
workflowSelect.addEventListener('change', function () {
  var id = workflowSelect.value;
  if (id === '' || !workflowSchemas || !workflowSchemas[id]) {
    dynamicForm.innerHTML = '<p class="hint">选择工作流后，这里会根据其 schema 动态生成表单。</p>';
    submitBtn.disabled = true;
    return;
  }
  renderForm(id, workflowSchemas[id]);
  submitBtn.disabled = false;
});

function renderForm(id, schema) {
  dynamicForm.innerHTML = '';

  var title = document.createElement('p');
  title.className = 'hint';
  title.textContent = '工作流 ' + id + '：' + (schema.description || '');
  dynamicForm.appendChild(title);

  // 文件输入
  var inputFiles = schema.inputFiles || [];
  inputFiles.forEach(function (field) {
    var wrap = document.createElement('div');
    wrap.className = 'field';

    var label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = '文件：' + field;
    var req = document.createElement('span');
    req.className = 'required-mark';
    req.textContent = '*';
    label.appendChild(req);
    wrap.appendChild(label);

    var input = document.createElement('input');
    input.type = 'file';
    input.dataset.fileField = field;
    input.id = 'file_' + field;
    wrap.appendChild(input);

    dynamicForm.appendChild(wrap);
  });

  // 参数输入
  var params = schema.parameters || {};
  Object.keys(params).forEach(function (name) {
    var def = params[name] || {};
    dynamicForm.appendChild(renderParamField(name, def));
  });

  if (inputFiles.length === 0 && Object.keys(params).length === 0) {
    var none = document.createElement('p');
    none.className = 'hint';
    none.textContent = '该工作流无需任何输入参数。';
    dynamicForm.appendChild(none);
  }
}

function renderParamField(name, def) {
  var type = def.type || 'string';
  var required = def.required === true;

  var wrap = document.createElement('div');
  wrap.className = 'field' + (type === 'boolean' ? ' checkbox-field' : '');

  var label = document.createElement('label');
  label.className = 'field-label';
  label.setAttribute('for', 'param_' + name);
  label.textContent = name;
  if (required) {
    var req = document.createElement('span');
    req.className = 'required-mark';
    req.textContent = '*';
    label.appendChild(req);
  }
  if (def.description) {
    var desc = document.createElement('span');
    desc.className = 'field-desc';
    desc.textContent = def.description;
    label.appendChild(desc);
  }

  var input;
  if (type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
    input.id = 'param_' + name;
    // checkbox：label 在 input 之后更符合布局，这里把 input 放前面
    wrap.appendChild(input);
    wrap.appendChild(label);
  } else if (type === 'number') {
    input = document.createElement('input');
    input.type = 'number';
    input.id = 'param_' + name;
    input.step = 'any';
    wrap.appendChild(label);
    wrap.appendChild(input);
  } else if (type === 'array' && name === 'loras') {
    input = document.createElement('textarea');
    input.id = 'param_' + name;
    input.placeholder = 'JSON 数组示例：[{"name":"xxx.safetensors","weight":0.8}]';
    wrap.appendChild(label);
    wrap.appendChild(input);
  } else if (type === 'array') {
    input = document.createElement('textarea');
    input.id = 'param_' + name;
    input.placeholder = 'JSON 数组，例如：["a","b"]';
    wrap.appendChild(label);
    wrap.appendChild(input);
  } else {
    // string 或其它
    input = document.createElement('input');
    input.type = 'text';
    input.id = 'param_' + name;
    wrap.appendChild(label);
    wrap.appendChild(input);
  }

  input.dataset.paramName = name;
  input.dataset.paramType = type;
  input.dataset.required = required ? 'true' : 'false';
  return wrap;
}

/** 收集表单参数为对象；返回 {parameters, error} */
function collectParameters() {
  var parameters = {};
  var nodes = dynamicForm.querySelectorAll('[data-param-name]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var name = el.dataset.paramName;
    var type = el.dataset.paramType;
    var required = el.dataset.required === 'true';

    if (type === 'boolean') {
      // 只有勾选时才放入（默认 false 的可选项不放入）
      if (el.checked) parameters[name] = true;
      else if (required) parameters[name] = false;
      continue;
    }

    var raw = (el.value || '').trim();

    if (raw === '') {
      if (required) return { error: '缺少必填参数：' + name };
      continue; // 空的可选项不放入
    }

    if (type === 'number') {
      var num = Number(raw);
      if (!isFinite(num)) return { error: '参数 ' + name + ' 不是合法数字' };
      parameters[name] = num;
    } else if (type === 'array') {
      try {
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return { error: '参数 ' + name + ' 必须是 JSON 数组' };
        parameters[name] = arr;
      } catch (e) {
        return { error: '参数 ' + name + ' 不是合法的 JSON：' + e.message };
      }
    } else {
      parameters[name] = raw;
    }
  }
  return { parameters: parameters };
}

// ── ④ 提交任务 ───────────────────────────────────────────────────────
submitBtn.addEventListener('click', submitTask);

async function submitTask() {
  if (!getApiKey()) { alert('请先填写 API Key'); return; }
  var id = workflowSelect.value;
  if (id === '' || !workflowSchemas || !workflowSchemas[id]) { alert('请先选择工作流'); return; }
  var schema = workflowSchemas[id];

  // 校验必需文件
  var inputFiles = schema.inputFiles || [];
  for (var f = 0; f < inputFiles.length; f++) {
    var fileInput = dynamicForm.querySelector('[data-file-field="' + inputFiles[f] + '"]');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      alert('请上传必需文件：' + inputFiles[f]);
      return;
    }
  }

  // 收集参数
  var collected = collectParameters();
  if (collected.error) { alert(collected.error); return; }

  // 构造 FormData
  var form = new FormData();
  form.append('workflowId', String(id));
  if (Object.keys(collected.parameters).length > 0) {
    form.append('parameters', JSON.stringify(collected.parameters));
  }
  inputFiles.forEach(function (field) {
    var fileInput = dynamicForm.querySelector('[data-file-field="' + field + '"]');
    if (fileInput && fileInput.files && fileInput.files[0]) {
      form.append(field, fileInput.files[0]);
    }
  });

  stopPolling();
  clearResults();
  submitBtn.disabled = true;
  cancelBtn.disabled = true;
  taskInfo.innerHTML = '<p class="hint">提交中…</p>';

  var path = API_BASE + '/tasks';
  try {
    // 注意：不要手动设置 content-type，让浏览器自动带 multipart boundary
    var res = await fetch(path, {
      method: 'POST',
      headers: headersWithKey(),
      body: form,
    });
    var parsed = await readResponse(res);
    log('POST', path, res.status, briefBody(parsed));

    if (!res.ok) {
      taskInfo.innerHTML = '<p class="error-text">提交失败：' +
        escapeHtml(parsed.json && parsed.json.error ? parsed.json.error : parsed.text || res.status) + '</p>';
      submitBtn.disabled = false;
      return;
    }

    var data = parsed.json || {};
    currentTaskId = data.taskId;
    renderTaskInfo(data);
    submitBtn.disabled = false;

    if (currentTaskId) {
      cancelBtn.disabled = false;
      startPolling();
    }
  } catch (err) {
    log('POST', path, 'ERR', err.message);
    taskInfo.innerHTML = '<p class="error-text">请求异常：' + escapeHtml(err.message) + '</p>';
    submitBtn.disabled = false;
  }
}

function renderTaskInfo(data) {
  var status = data.status || '-';
  taskInfo.innerHTML =
    '<span class="kv"><b>taskId：</b>' + escapeHtml(data.taskId || '-') + '</span>' +
    '<span class="kv"><b>工作流：</b>' + escapeHtml((data.workflowName || '-') + ' (id=' + (data.workflowId != null ? data.workflowId : '-') + ')') + '</span>' +
    '<span class="kv"><b>状态：</b><span class="badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span></span>';
}

// ── ⑤ 轮询任务状态 ───────────────────────────────────────────────────
function startPolling() {
  stopPolling();
  pollOnce(); // 立即查一次
  pollTimer = setInterval(pollOnce, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce() {
  if (!currentTaskId) { stopPolling(); return; }
  var path = API_BASE + '/tasks/' + encodeURIComponent(currentTaskId);
  try {
    var res = await fetch(path, { headers: headersWithKey() });
    var parsed = await readResponse(res);
    log('GET', path, res.status, briefBody(parsed));

    if (!res.ok) {
      // 404/403 等：停止轮询并提示
      stopPolling();
      cancelBtn.disabled = true;
      taskInfo.innerHTML += '<p class="error-text">查询失败：' +
        escapeHtml(parsed.json && parsed.json.error ? parsed.json.error : res.status) + '</p>';
      return;
    }

    var task = parsed.json || {};
    updateTaskView(task);

    if (task.status === 'completed') {
      stopPolling();
      cancelBtn.disabled = true;
      await renderOutputs(task);
    } else if (task.status === 'error') {
      stopPolling();
      cancelBtn.disabled = true;
      showTaskError(task.error || '任务执行失败');
    }
  } catch (err) {
    log('GET', path, 'ERR', err.message);
    // 网络抖动不立即停止轮询，仅记录日志
  }
}

function updateTaskView(task) {
  renderTaskInfo(task);

  var progress = task.progress || {};
  var pct = typeof progress.percentage === 'number' ? progress.percentage : null;
  if (pct !== null || progress.stage) {
    progressWrap.style.display = 'flex';
    var width = pct !== null ? Math.max(0, Math.min(100, pct)) : 0;
    progressFill.style.width = width + '%';
    var labelParts = [];
    if (pct !== null) labelParts.push(width + '%');
    if (progress.stage) labelParts.push(progress.stage);
    progressLabel.textContent = labelParts.join(' · ');
  }
}

function showTaskError(errText) {
  var p = document.createElement('p');
  p.className = 'error-text';
  p.textContent = '错误：' + errText;
  taskInfo.appendChild(p);
}

// ── 结果展示 ─────────────────────────────────────────────────────────
function clearResults() {
  resultsEl.innerHTML = '';
  progressWrap.style.display = 'none';
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
}

async function renderOutputs(task) {
  resultsEl.innerHTML = '';
  var outputs = (task.results && task.results.outputs) || [];
  if (outputs.length === 0) {
    resultsEl.innerHTML = '<p class="hint">任务已完成，但没有产物。</p>';
    return;
  }

  for (var i = 0; i < outputs.length; i++) {
    await renderOneOutput(outputs[i]);
  }
}

async function renderOneOutput(output) {
  var filename = output.filename || 'output';
  var urlPath = output.url || '';
  // 该 url 形如 /api/v1/tasks/xxx/result/0，需要加 /proxy 前缀
  var fetchPath = '/proxy' + urlPath;

  var item = document.createElement('div');
  item.className = 'result-item';
  var loading = document.createElement('p');
  loading.className = 'filename';
  loading.textContent = '加载 ' + filename + ' …';
  item.appendChild(loading);
  resultsEl.appendChild(item);

  try {
    var res = await fetch(fetchPath, { headers: headersWithKey() });
    log('GET', fetchPath, res.status, res.headers.get('content-type') || '');
    if (!res.ok) {
      item.innerHTML = '<p class="error-text">下载失败（' + res.status + '）：' + escapeHtml(filename) + '</p>';
      return;
    }

    var blob = await res.blob();
    var objectUrl = URL.createObjectURL(blob);
    var ctype = res.headers.get('content-type') || '';
    var isVideo = /video\//i.test(ctype) || /\.(mp4|webm|mov|mkv)$/i.test(filename);

    item.innerHTML = '';
    var media;
    if (isVideo) {
      media = document.createElement('video');
      media.controls = true;
      media.src = objectUrl;
    } else {
      media = document.createElement('img');
      media.src = objectUrl;
      media.alt = filename;
    }
    item.appendChild(media);

    var nameEl = document.createElement('div');
    nameEl.className = 'filename';
    nameEl.textContent = filename;
    item.appendChild(nameEl);

    var dl = document.createElement('a');
    dl.className = 'download';
    dl.href = objectUrl;
    dl.download = filename;
    dl.textContent = '下载';
    item.appendChild(dl);
  } catch (err) {
    log('GET', fetchPath, 'ERR', err.message);
    item.innerHTML = '<p class="error-text">下载异常：' + escapeHtml(err.message) + '</p>';
  }
}

// ── ⑥ 取消任务 ───────────────────────────────────────────────────────
cancelBtn.addEventListener('click', cancelTask);

async function cancelTask() {
  if (!currentTaskId) return;
  var path = API_BASE + '/tasks/' + encodeURIComponent(currentTaskId) + '/cancel';
  try {
    var res = await fetch(path, { method: 'POST', headers: headersWithKey() });
    var parsed = await readResponse(res);
    log('POST', path, res.status, briefBody(parsed));

    if (res.ok) {
      stopPolling();
      cancelBtn.disabled = true;
      var p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '已发送取消请求。';
      taskInfo.appendChild(p);
    } else {
      alert('取消失败：' + (parsed.json && parsed.json.error ? parsed.json.error : res.status));
    }
  } catch (err) {
    log('POST', path, 'ERR', err.message);
    alert('取消请求异常：' + err.message);
  }
}

// ── ⑦ 日志清空 ───────────────────────────────────────────────────────
clearLogBtn.addEventListener('click', function () {
  logEl.innerHTML = '';
});
