// Runs in the extension's isolated world. Only uses visible pagination controls.
globalThis.cengkeCollectPages = async function ({ read, next, sleep, stopped, progress }) {
  const rows = new Map(), seen = new Set();
  let first, pages = 0, expected = 1;
  const result = (complete, reason) => ({ format: 'cengke-nju-visible-v1', source: first?.data.source || 'schoolwide', term: first?.data.term || '', scope: complete ? 'all-filtered-pages' : 'partial-pages', complete, reason, pages, expectedRows: first?.total, rows: [...rows.values()] });
  try {
    let current = await read();
    first = current;
    if (current.start !== 1) throw new Error('请先在学校页面回到第一页，再开始全部导出。');
    while (true) {
      if (stopped()) throw new Error('用户已停止');
      if (current.start !== expected || current.total !== first.total || current.data.term !== first.data.term) throw new Error('页码、总条数或学期变化，已停止；请保持筛选条件不变。');
      if (!Number.isInteger(current.total) || current.total < 1 || current.total > 20000 || current.end < current.start || current.end > current.total) throw new Error('分页数量无效或超过 20000 条，请缩小查询范围。');
      const fingerprint = JSON.stringify(current.data.rows);
      if (seen.has(fingerprint)) throw new Error('翻页后仍是重复数据，未将其当作新页。');
      if (current.data.rows.length !== current.end - current.start + 1) throw new Error('当前页读取条数与分页条数不一致，无法确认完整性。');
      seen.add(fingerprint);
      for (const row of current.data.rows) rows.set(JSON.stringify(row), row);
      pages++;
      progress(`已读取 ${pages} 页，${current.end}/${current.total} 条，去重后 ${rows.size} 个教学班`);
      if (current.end === current.total) {
        if (rows.size !== current.total) throw new Error('跨页存在重复教学班，总条数不一致，请核对部分结果。');
        return result(true, '已核对分页连续性和总条数；范围为当前筛选结果');
      }
      if (pages >= 2000) throw new Error('达到页数上限，请缩小范围');
      expected = current.end + 1;
      await sleep(1500);
      if (stopped()) throw new Error('用户已停止');
      await next();
      let stable = '', candidate, ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (stopped()) throw new Error('用户已停止');
        await sleep(500);
        try { candidate = await read(); } catch { stable = ''; continue; }
        const signature = JSON.stringify(candidate);
        if (candidate.start === expected && JSON.stringify(candidate.data.rows) !== fingerprint && signature === stable) { ready = true; break; }
        stable = signature;
      }
      if (!ready) throw new Error('下一页在 15 秒内未稳定加载，已停止，避免漏页');
      current = candidate;
    }
  } catch (error) { return result(false, error.message); }
};

globalThis.cengkeFindPager = function (doc) {
  const pattern = /(\d+)[-–—](\d+)总记录数[:：]?(\d+)/;
  const candidates = [...doc.querySelectorAll('div, nav, section, td')].filter(el => {
    if (!el.getClientRects().length || el.closest('#cengke-export-panel')) return false;
    const text = el.textContent.replace(/\s/g, '');
    return text.length < 1500 && pattern.test(text) && /总页数/.test(text) && /跳转/.test(text);
  });
  const roots = candidates.filter(el => !candidates.some(other => other !== el && el.contains(other)));
  if (roots.length !== 1) throw new Error(`分页栏识别结果为 ${roots.length} 个；请用“指定下一页按钮”绑定实际分页栏。`);
  return roots[0];
};

globalThis.cengkeStartPagination = function (options) {
  if (document.getElementById('cengke-export-panel')) return;
  const panel = document.createElement('section');
  panel.id = 'cengke-export-panel';
  panel.style.cssText = 'position:fixed;right:20px;top:90px;z-index:2147483647;background:white;color:#222;padding:18px;width:330px;border:2px solid #7642a8;box-shadow:0 4px 20px #777;font:14px/1.6 sans-serif';
  const title = document.createElement('strong'); title.textContent = '蹭课网 · 全部分页导出';
  const status = document.createElement('p'); status.textContent = '准备读取；请勿更改筛选条件、翻页或关闭此学校页面。';
  const stop = document.createElement('button'); stop.textContent = '停止';
  const download = document.createElement('button'); download.textContent = '下载结果'; download.hidden = true;
  const close = document.createElement('button'); close.textContent = '关闭面板'; close.hidden = true;
  const select = document.createElement('button'); select.textContent = '指定下一页按钮并重试'; select.hidden = true;
  const importLink = document.createElement('a'); importLink.textContent = '打开蹭课网导入'; importLink.href = 'https://cengke-parse-probe.app.workbuddy.host/'; importLink.target = '_blank'; importLink.rel = 'noopener noreferrer'; importLink.style.display = 'none';
  panel.append(title, status, stop, download, importLink, select, close); document.body.append(panel);
  let cancelled = false, selectedNext = null, selectedRoot = null, selecting = null;
  stop.onclick = () => { cancelled = true; stop.disabled = true; status.textContent = '正在停止…'; };
  close.onclick = () => { if (selecting) document.removeEventListener('click', selecting, true); panel.remove(); };
  const pager = () => {
    if (selectedRoot?.isConnected) return selectedRoot;
    return globalThis.cengkeFindPager(document);
  };
  const read = () => {
    const root = pager(), text = root.textContent.replace(/\s/g, '');
    const match = text.match(/(\d+)[-–—](\d+)总记录数[:：]?(\d+)/);
    if (!match) throw new Error('无法识别分页范围和总记录数，请反馈分页栏截图。');
    const data = globalThis.cengkeNjuExtract(document, options);
    if (data.error) throw new Error(data.error);
    return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]), data };
  };
  const next = () => {
    const root = pager();
    const icons = [...root.querySelectorAll('.jqx-icon-arrow-right, [class*="jqx-icon-arrow-right-"]')];
    const labelled = [...root.querySelectorAll('button, a, [role="button"], [title], [aria-label]')].filter(el => /^(下一页|Next(?: page)?)$/i.test(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent.trim()));
    const buttons = selectedNext ? (selectedNext.isConnected ? [selectedNext] : []) : [...new Set([...labelled, ...icons.map(icon => icon.closest('button, [role="button"]') || icon.parentElement)])].filter(el => el.getClientRects().length);
    if (buttons.length !== 1 || buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true' || /jqx-fill-state-disabled/.test(buttons[0].className)) throw new Error('无法确认可用的下一页按钮，已停止');
    buttons[0].click();
  };
  const run = () => {
    cancelled = false; stop.disabled = false; stop.hidden = false; close.hidden = true; select.hidden = true; download.hidden = true; importLink.style.display = 'none';
    globalThis.cengkeCollectPages({ read, next, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), stopped: () => cancelled, progress: text => { status.textContent = text; } }).then(result => {
    stop.hidden = true; close.hidden = false;
    select.hidden = result.complete;
    status.textContent = `${result.complete ? '全部完成' : '未全部完成'}：${result.reason}。已保留 ${result.rows.length} 个教学班。`;
    download.hidden = !result.rows.length;
    download.textContent = result.complete ? '下载全部结果 JSON' : '下载部分结果 JSON';
    download.onclick = () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = result.complete ? 'nju-schoolwide-all.json' : 'nju-schoolwide-partial.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
    importLink.style.display = result.rows.length ? 'block' : 'none';
    if (result.complete) { download.onclick(); status.textContent += ' 已发起 JSON 下载；若未下载，请点下载按钮。接着打开蹭课网，选择刚下载的文件导入。'; }
  });
  };
  select.onclick = () => {
    if (selecting) return;
    status.textContent = '先确认仍在第一页，再点击底部分页栏的“下一页”（从左数第三个方形按钮）。此次点击仅用于指定，不会翻页；随后自动重试。';
    selecting = event => {
      if (panel.contains(event.target)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const target = event.target.closest('button, [role="button"], a, input[type="button"]') || event.target;
      let root = target.parentElement, matched = false;
      for (let i = 0; root && i < 8; i++, root = root.parentElement) {
        const text = root.textContent.replace(/\s/g, '');
        if (text.length < 1500 && /\d+[-–—]\d+总记录数[:：]?\d+/.test(text) && /总页数/.test(text)) { matched = true; break; }
      }
      if (!matched || !root || target === root) { status.textContent = '未选中分页栏内的按钮，请重新点击下一页按钮。'; return; }
      selectedRoot = root; selectedNext = target;
      document.removeEventListener('click', selecting, true); selecting = null;
      run();
    };
    document.addEventListener('click', selecting, true);
  };
  run();
};
