const $ = id => document.getElementById(id);
const SCHOOL = 'https://ehallapp.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do#/qxkcb01';
const EXTERNAL = 'https://ehallapp-nju-edu-cn-s.atrust.nju.edu.cn/jwapp/sys/kcbcx/*default/index.do#/qxkcb01';
let busy = false, ready = false;
function buttons() { $('check').disabled=busy; $('export-all').disabled=busy || !ready; $('export').disabled=busy || !ready; }
function guidance(error) {
  const text = error?.message || String(error);
  if (/学期/.test(text)) return '请确认学校页面的学期并点击搜索；仍无法识别时，在“更多选项”填写完整学期后重新检查。\n' + text;
  if (/列表|表头|课程|空/.test(text)) return '请切换“学生组 → 全部课程”，点击搜索并等待课程列表加载，再检查。\n' + text;
  return '页面暂时无法读取。请完成学校登录、回到课程列表，再点击“检查当前页面”。\n' + text;
}
async function activeContext() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  let url; try { url=new URL(tab?.url); } catch { throw new Error('请先打开南大课表页面。'); }
  const hosts=['ehallapp.nju.edu.cn','ehallapp-nju-edu-cn-s.atrust.nju.edu.cn'];
  const schoolwide=url.pathname.startsWith('/jwapp/sys/kcbcx/');
  if(url.protocol!=='https:' || !hosts.includes(url.hostname) || (!schoolwide && !url.pathname.startsWith('/jwapp/sys/wdkb/'))) throw new Error('请点击“打开南大全部课程”，完成登录后在课程列表页重新打开插件。');
  return {tab,options:{source:schoolwide?'schoolwide':'personal',term:$('term').value.trim()}};
}
async function checkPage() {
  if(busy)return; busy=true;ready=false;buttons();$('status').textContent='正在检查页面和学期…';$('diagnostic').hidden=true;
  try {
    const {tab,options}=await activeContext();
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extract.js']});
    // Readiness returns only a summary, never the actual course rows.
    const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:options=>{
      const data=globalThis.cengkeNjuExtract(document,options);
      return data.error ? {error:data.error,diagnostics:data.diagnostics} : {term:data.term,count:data.rows.length,source:data.source};
    },args:[options]});
    if(result?.error){
      if(result.diagnostics){$('diagnostic').hidden=false;$('diagnostic').value=JSON.stringify({version:chrome.runtime.getManifest().version,...result.diagnostics},null,2);}
      throw new Error(result.error);
    }
    if(!result?.count)throw new Error('当前列表没有课程，请调整条件后搜索。');
    ready=true;
    $('status').textContent=`课表已就绪\n学期：${result.term}\n当前页：${result.count} 个教学班${result.source==='personal'?'（个人已选课）':''}\n请核对学期和筛选条件，并回到第一页后导出。`;
  }catch(error){$('status').textContent=guidance(error);}finally{busy=false;buttons();}
}
async function exportCourses(allPages) {
  if(busy || !ready)return;busy=true;buttons();
  try{
    const {tab,options}=await activeContext();
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['extract.js']});
    if(allPages){
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['paginate.js']});
      await chrome.scripting.executeScript({target:{tabId:tab.id},func:options=>globalThis.cengkeStartPagination(options),args:[options]});
      $('status').textContent='已在学校页面右上角显示进度。完成后会发起 JSON 下载，也可点击面板中的下载按钮。保持学校页面打开，不要改变筛选。';
    }else{
      const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:options=>globalThis.cengkeNjuExtract(document,options),args:[options]});
      if(result.error)throw new Error(result.error);
      const href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
      const a=document.createElement('a');a.href=href;a.download=options.source==='schoolwide'?'nju-schoolwide-page.json':'nju-my-timetable.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),30000);
      $('status').textContent=`已发起下载：当前页 ${result.rows.length} 个教学班（${result.term}）。点击“打开蹭课网导入”，选择下载的 JSON。`;
    }
  }catch(error){ready=false;$('status').textContent=guidance(error);}finally{busy=false;buttons();}
}
$('open-school').onclick=()=>chrome.tabs.create({url:SCHOOL});
$('open-external').onclick=()=>chrome.tabs.create({url:EXTERNAL});
$('check').onclick=checkPage;
$('term').oninput=()=>{ready=false;buttons();$('status').textContent='学期已修改，请重新检查当前页面。';};
$('export').onclick=()=>exportCourses(false);
$('export-all').onclick=()=>exportCourses(true);
checkPage();
