// Page selectors documented at https://github.com/WheretoSleepinNJU/NJU-Class-Shedule-Flutter
// Independently implemented: explicit headers and closed failure avoid silently reading unrelated tables.
globalThis.cengkeNjuExtract = function (doc, options = {}) {
  const schoolwide = options.source === 'schoolwide';
  const fullTerm = text => /^\d{4}\s*[-—]\s*\d{4}\s*学年\s*第\s*[123一二三]\s*学期$/.test(text || '');
  let term = schoolwide ? '' : doc.querySelector('#dqxnxqkclb')?.textContent?.trim();
  if (!schoolwide && !fullTerm(term)) return { error: '未识别学期，请进入本科生“我的课表”列表。' };
  const aliases = { code: ['课程号', '课程编号', '课程代码'], name: ['课程名', '课程名称', '教学班名称'], teacher: ['教师', '任课教师', '授课教师', '上课教师'], schedule: ['上课时间及地点', '上课时间地点', '时间地点', '上课时间/地点', '上课时间与地点'], campus: ['校区'], department: ['开课单位'], term: ['学年学期'] };
  const candidates = [];
  const diagnostics = { tables: 0, matchedHeaders: 0, headerOnly: 0, grids: 0, matchedGrids: 0, shapes: [] };
  const indicesFor = cells => Object.fromEntries(Object.entries(aliases).map(([key, labels]) => [key, cells.findIndex(c => labels.includes(c.textContent.replace(/\s/g, '')))]));
  const complete = indices => ['code', 'name', 'teacher', 'schedule'].every(key => indices[key] >= 0);
  const readRows = (trs, indices, width, selector = 'td') => {
    const rows = [];
    for (const tr of trs) {
      const cells = [...tr.querySelectorAll(selector)];
      if (!cells.length) continue;
      if (cells.length !== width || cells.some(c => c.rowSpan > 1 || c.colSpan > 1)) return null;
      rows.push(Object.fromEntries(Object.entries(indices).filter(([, i]) => i >= 0).map(([key, i]) => {
        const cell = cells[i];
        let text = (cell.innerText || cell.textContent).trim();
        // Tooltip text is consulted only inside the explicitly selected course field.
        const title = cell.getAttribute?.('title') || cell.querySelector?.('[title]')?.getAttribute('title');
        if (title && (text.includes('...') || text.includes('…')) && title.trim().length > text.length) text = title.trim();
        return [key, text];
      })));
    }
    return rows;
  };
  for (const table of doc.querySelectorAll('table')) {
    diagnostics.tables++;
    const trs = [...table.querySelectorAll('tr')];
    diagnostics.shapes.push(trs.slice(0, 3).map(tr => tr.querySelectorAll('th,td').length));
    for (let h = 0; h < Math.min(3, trs.length); h++) {
      const headers = [...trs[h].querySelectorAll('th,td')];
      const indices = indicesFor(headers);
      if (!complete(indices)) continue;
      diagnostics.matchedHeaders++;
      const rows = readRows(trs.slice(h + 1), indices, headers.length);
      if (!rows) return { error: '存在合并单元格或不完整行，请导出标准课程列表；未生成不完整文件。' };
      if (!rows.length) {
        diagnostics.headerOnly++;
        // Only pair a header-only table with exactly one data table in a nearby container.
        // Never guess by joining unrelated tables elsewhere in the document.
        let parent = table.parentElement;
        for (let depth = 0; parent && depth < 3 && !['BODY', 'HTML'].includes(parent.tagName); depth++, parent = parent.parentElement) {
          const siblings = [...parent.querySelectorAll('table')];
          if (siblings.length > 2) break;
          if (siblings.length !== 2) continue;
          const other = siblings.find(t => t !== table);
          const otherRows = [...other.querySelectorAll('tr')];
          if (otherRows.some(tr => complete(indicesFor([...tr.querySelectorAll('th,td')])))) break;
          const extracted = readRows(otherRows, indices, headers.length);
          if (extracted?.length) candidates.push(extracted);
          break;
        }
      }
      if (rows.length) candidates.push(rows);
      break;
    }
  }
  // Some grid widgets place column headers in DIVs and the body in a separate table.
  for (const grid of doc.querySelectorAll('[role="grid"], .jqx-grid')) {
    diagnostics.grids++;
    const headers = [...grid.querySelectorAll('[role="columnheader"]')];
    const indices = indicesFor(headers);
    if (!complete(indices)) continue;
    diagnostics.matchedGrids++;
    const bodyRows = [...grid.querySelectorAll('[role="row"]')].filter(row => row.querySelectorAll('[role="gridcell"]').length);
    const rows = bodyRows.length
      ? readRows(bodyRows, indices, headers.length, '[role="gridcell"]')
      : readRows([...grid.querySelectorAll('tbody tr')], indices, headers.length);
    if (rows?.length) candidates.push(rows);
  }
  const dedupe = rows => [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  const unique = [...new Map(candidates.map(dedupe).map(rows => [JSON.stringify(rows), rows])).values()];
  if (unique.length !== 1) return { error: `未找到唯一的标准课表列表（候选 ${unique.length} 个）。请复制下方结构诊断反馈；不含课程内容。`, diagnostics };
  if (unique[0].length > 500) return { error: '当前页超过 500 行，请缩小范围。' };
  const rows = unique[0];
  if (schoolwide) {
    const terms = [...new Set(rows.map(row => row.term).filter(fullTerm))];
    if (terms.length > 1) return { error: '当前页包含不同学期，请按单个学期筛选后导出。' };
    const override = (options.term || '').trim();
    if (override && !fullTerm(override)) return { error: '请按完整格式填写学期，例如：2026-2027学年 第1学期。' };
    if (override && terms.length && terms[0].replace(/\s/g, '') !== override.replace(/\s/g, '')) return { error: '填写学期与课程行中的学期不一致，请核对筛选条件。' };
    if (rows.every(row => fullTerm(row.term)) && terms.length === 1) term = terms[0];
    else if (override) term = override;
    else return { error: '课程行中的学期缺失或被截断。请核对页面学期，在扩展中填写完整学期后重试。' };
    for (const row of rows) row.term = term;
  }
  return { format: 'cengke-nju-visible-v1', source: schoolwide ? 'schoolwide' : 'personal', scope: 'current-page', term, rows };
};
