import {escapeHtml as e,valueLabel,timeLabel,statusLabel,basisLabel,sourceLink} from "./macroModel.js";
const $=id=>document.getElementById(id);
let version=0,controller=null,historyController=null,definitions=[],historyCursor=null,calendarCursor=null,historyVersion=0;
const state=(value)=>`<span class="macro-state" data-state="${e(value)}">${e(statusLabel(value))}</span>`;
async function read(path,signal){const response=await fetch(`/api/v1/macro/${path}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(`讀取失敗（HTTP ${response.status}）`);const payload=await response.json();if(payload.profile!=="macro_v1"||!payload.data)throw new Error("數據格式不符，請稍後重新讀取");return payload;}
function calendarRows(items){return items.map(r=>`<div class="macro-entry"><div><strong>${e(r.reference_period)} · ${e(r.release_group.toUpperCase())}${r.release_stage_label?` · ${e(r.release_stage_label)}`:""}</strong><span>${timeLabel(r.scheduled_at)}${r.scheduled_semantics==="regular_meeting_1400_eastern_policy"?"（例會標準時間）":""}</span></div><div>${state(r.status)}${state(r.acquisition_status)}</div></div>`).join("");}
async function load(){
  const token=++version;controller?.abort();historyController?.abort();controller=new AbortController();const signal=controller.signal,group=$("group").value;
  $("reload").disabled=true;$("current").setAttribute("aria-busy","true");$("page-status").textContent="正在讀取數據…";
  for(const id of ["values","calendar","sources","release-summary","policy-decision","artifacts","history","indicator"])$(id).replaceChildren();
  $("history-status").textContent="";$("history-more").hidden=true;$("calendar-more").hidden=true;
  try{
    const [indicators,calendar]=await Promise.all([read(`indicators?group=${group}`,signal),read(`calendar?group=${group}&limit=30`,signal)]);
    if(token!==version)return;definitions=indicators.data;
    $("indicator").innerHTML=definitions.map(i=>`<option value="${e(i.id)}">${e(i.name)} · ${e(basisLabel(i))}</option>`).join("");
    $("calendar").innerHTML=calendarRows(calendar.data)||"<p>此時間範圍尚無發布日曆。</p>";calendarCursor=calendar.pagination?.next_cursor;$("calendar-more").hidden=!calendarCursor;
    const expected=indicators.coverage.groups.find(g=>g.group===group);
    const release=expected?.expected_release_id ? await read(`releases/${encodeURIComponent(expected.expected_release_id)}`,signal) : null;
    if(token!==version)return;const payload=release||indicators;
    $("page-status").textContent=`${statusLabel(payload.freshness.status)} · ${expected?.expected_reference_period || "尚無預期發布期間"}${payload.warnings.includes("raw_payload_archival_truncated")?" · 部分原始表格受保存上限限制":""}`;
    $("sources").innerHTML=payload.coverage.sources.map(s=>`<div class="macro-entry"><div><strong>${e(s.source_id)}</strong><span>上次成功：${timeLabel(s.last_success_at)}</span>${s.last_error?`<small>${e(s.last_error)}</small>`:""}</div>${state(s.status)}</div>`).join("")||"<p>尚無來源狀態。</p>";
    const r=release?.data;
    const decision=r?.policy_decision;
    $("policy-decision").innerHTML=decision?`<p><strong>${e(({hold:"維持利率",hike:"升息",cut:"降息"})[decision.decision_type]||decision.decision_type)}</strong> · 目標區間 ${e(decision.target_lower)}%–${e(decision.target_upper)}% · 生效日期 ${e(decision.effective_date||"未提供")}${decision.effective_date?"（官方未提供時分）":""}</p>`:"";
    $("artifacts").innerHTML=(r?.artifacts||[]).map(a=>`<p>${e(({statement:"決議聲明",implementation_note:"執行說明",minutes:"會議紀錄",sep:"經濟預測",dot_plot:"利率點陣圖",press_conference:"記者會資料"})[a.artifact_type]||a.artifact_type)} · ${sourceLink(a.source_url)}</p>`).join("");
    $("release-summary").innerHTML=r?`<strong>${e(r.reference_period)}</strong> · ${e(statusLabel(r.acquisition_status))} · 預定發布 ${timeLabel(r.scheduled_at || r.source_published_at)} · 首次取得 ${timeLabel(r.first_observed_at)}${r.provider_published_at?` · 官方實際發布 ${timeLabel(r.provider_published_at)}`:""}${r.effective_at?` · 生效 ${timeLabel(r.effective_at)}`:""} · ${sourceLink(r.release_url)}`:"<p>尚無本期發布資料；來源未啟用或日曆尚未取得時不推測數值。</p>";
    if(r?.release_stage_label)$("release-summary").insertAdjacentHTML("beforeend",` · ${e(r.release_stage_label)}`);
    $("values").innerHTML=definitions.map(i=>{const o=r?.observations.find(o=>o.indicator_id===i.id),definition=o||i;return `<tr><td>${e(i.name)}${o?`<br><small>${e(o.reference_period)}</small>`:""}</td><td>${e(basisLabel(definition))}</td><td><strong>${e(valueLabel(o?.actual,definition.unit,definition.display_semantics))}</strong></td><td>${e(valueLabel(o?.previous,definition.unit,definition.display_semantics))}</td><td>${e(valueLabel(o?.revised_previous,definition.unit,definition.display_semantics))}</td><td>${o?e(o.revision_number):"—"}</td></tr>`;}).join("");
    $("checked-at").textContent=`資料讀取時間 ${timeLabel(payload.generated_at)}（臺北）`;
    await history(false);
  }catch(error){if(error.name!=="AbortError"&&token===version)$("page-status").textContent=`${error.message}；請使用「重新讀取」。`;
  }finally{if(token===version){$("reload").disabled=false;$("current").setAttribute("aria-busy","false");}}
}
async function history(append){
  const indicator=$("indicator").value;if(!indicator)return;historyController?.abort();historyController=new AbortController();const token=++historyVersion,page=version;
  if(!append){historyCursor=null;$("history").replaceChildren();}$("history-more").hidden=true;$("history-status").textContent="讀取歷史觀測…";
  try{const params=new URLSearchParams({indicator_id:indicator,history:String($("revisions").checked),limit:"30"});if(append&&historyCursor)params.set("cursor",historyCursor);
    const p=await read(`observations?${params}`,historyController.signal);if(token!==historyVersion||page!==version)return;
    $("history").insertAdjacentHTML("beforeend",p.data.map(o=>`<tr><td>${e(o.reference_period)}</td><td>${e(valueLabel(o.actual,o.unit,o.display_semantics))}</td><td>${e(basisLabel(o))}</td><td>${e(o.revision_number)}</td><td>${timeLabel(o.fetched_at)}</td><td>${sourceLink(o.source_url)}</td></tr>`).join(""));
    historyCursor=p.pagination?.next_cursor;$("history-more").hidden=!historyCursor;$("history-status").textContent=p.data.length?`${statusLabel(p.freshness.status)} · 依本機觀測順序排列；修訂版本不代表官方初值。`:"此指標尚無已取得的觀測。";
  }catch(error){if(error.name!=="AbortError"&&page===version){$("history-status").textContent=error.message;$("history-more").hidden=!historyCursor;}}
}
$("calendar-more").addEventListener("click",async()=>{const token=version,button=$("calendar-more");button.disabled=true;try{const p=await read(`calendar?group=${$("group").value}&limit=30&cursor=${encodeURIComponent(calendarCursor)}`,controller.signal);if(token!==version)return;$("calendar").insertAdjacentHTML("beforeend",calendarRows(p.data));calendarCursor=p.pagination?.next_cursor;button.hidden=!calendarCursor;}catch(error){if(error.name!=="AbortError")$("page-status").textContent=error.message;}finally{button.disabled=false;}});
$("group-form").addEventListener("submit",event=>event.preventDefault());$("group").addEventListener("change",load);$("reload").addEventListener("click",load);$("indicator").addEventListener("change",()=>history(false));$("revisions").addEventListener("change",()=>history(false));$("history-more").addEventListener("click",()=>history(true));
load();
