import {getView,getModeLabels} from './state.mjs';
const $=id=>document.getElementById(id);
let run=null,ready=false,starting=false,epoch=0,config=null;
function text(tag,value,cls){const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;}
function render(){
 const view=getView(run);
 if(config){const labels=getModeLabels(config);$('mode-badge').textContent=labels.badge;$('mode-notice').textContent=`선택된 모드: ${labels.providerText} · ${labels.environmentText} · 지원 fixture 하나`;$('running-mode').textContent=`${labels.environmentText}에서 같은 기준으로 실행합니다.`;$('patch-stage-label').textContent=labels.providerText;$('running-scope').textContent=labels.remote?'설정된 어댑터를 사용합니다. 각 단계의 실제 결과와 정리 상태를 증거로 남깁니다.':'현재는 로컬 규칙 기반 수정입니다. AI 생성이 아니며 로컬 프로세스 분리는 OS sandbox 격리가 아닙니다.';}
 if(config){
  const labels=getModeLabels(run?.result?{...config,...run.result,transportTestDouble:run.result.evidence?.transportTestDouble}:config);
  document.querySelector('nav .tag').textContent=labels.badge;
  document.querySelector('nav + p').textContent=`지원 합성 fixture · ${labels.providerText} · ${labels.environmentText} · 실제 원격 연결은 별도 검증`;
  document.querySelector('#running-screen .kicker').textContent=`RUNNING / ${labels.environmentText}`;
  document.querySelector('#running-screen > p').textContent=`${labels.environmentText}에서 같은 고정 기준으로 비교합니다.`;
  document.querySelector('[data-stage="patch"] b').textContent=labels.providerText;
  document.querySelector('#running-screen .scope').textContent=labels.remote?'선택한 adapter로 합성 fixture만 실행합니다. 실제 결과와 정리 여부를 증거로 확인합니다.':'모델이 생성한 패치가 아닙니다. 로컬 수정 규칙을 적용합니다. 로컬 프로세스 분리는 OS sandbox 격리가 아닙니다.';
  document.querySelector('.hero-right p').textContent=`${labels.environmentText} · ${labels.providerText}`;
  document.querySelector('#start-screen .formgrid section > p').textContent=config.readiness?.ready?'고정된 합성 입력만 검증합니다. 외부 실행은 명시적 opt-in이 필요합니다.':`실행 불가: ${(config.readiness?.issues??[]).join(' / ')}`;
 }
 for(const name of ['start','running','result','error'])$(name+'-screen').hidden=view.screen!==name;
 $('start-button').disabled=!ready||view.busy||starting;
 if(view.screen==='error'){$('error-code').textContent=view.error.code;$('error-message').textContent=view.error.message;return;}
 if(view.screen==='running'){
 const stages=['baseline','upgraded','patch','patched'];const at=stages.indexOf(run.stage);
 document.querySelectorAll('[data-stage]').forEach(n=>{const i=stages.indexOf(n.dataset.stage);n.classList.toggle('current',i===at);n.classList.toggle('done',i<at);n.classList.toggle('pending',i>at);});
 const titles={baseline:'기존 동작을 확인합니다.',upgraded:'업그레이드 후 차이를 확인합니다.',patch:'근거 있는 수정안을 적용합니다.',patched:'같은 기준으로 재검증합니다.'};
 $('running-title').textContent=titles[run.stage]??'실행 결과를 정리합니다.';
 $('event-list').replaceChildren(...(run.events??[]).map(e=>text('li',e.message)));
 }
 if(view.screen==='result'){
 const r=run.result;
 const labels=getModeLabels({...r,transportTestDouble:r.evidence?.transportTestDouble});
 $('mode-badge').textContent=labels.badge;
 $('result-mode').textContent=`${labels.providerText} · ${labels.environmentText}`;
 $('result-scope').textContent=`검증 범위: 지원 fixture의 고정 입력에 대한 런타임 비교. ${r.evidence?.transportTestDouble?'테스트용 응답이며 실제 외부 서비스 검증이 아닙니다.':labels.remote?'표시된 결과는 이 실행의 지정 provider 범위에서만 유효합니다.':'현재 실행은 실제 모델 생성 및 Daytona 연결 검증이 아닙니다.'} TypeScript 컴파일, 실제 앱 요청, 범용 호환성 및 운영 안전은 보장하지 않습니다.`;
 $('result-title').textContent=view.downloads?'부분 설정 요청, 다시 허용됩니다.':r.verdict==='TEST_DOUBLE_VERIFIED'?'테스트 대역 검증 결과입니다.':'계약을 회복하지 못했습니다.';
 $('result-subtitle').textContent=view.downloads?'시험한 입력 범위에서 기존 계약을 회복했습니다.':'실패 내용과 실제 실행 증거를 확인하세요.';
 $('result-versions').textContent=`Zod ${config.baselineVersion} → ${config.targetVersion}`;
 $('phase-cards').replaceChildren(...r.phases.map((p,i)=>{const el=text('section','','card'+(i===1?' bad':i===2&&view.downloads?' lime':''));el.append(text('span',['01 기존 버전','02 버전만 변경','03 수정 후'][i],'small'),text('strong',`${p.matched}/${p.total}`),text('span','요구사항 검사 일치','small'));return el;}));
 $('regression-list').replaceChildren(...r.regressions.map(id=>{const row=text('div','','row');row.append(text('span',id),text('span','동작 차이','failure'));return row;}));
 if(!r.regressions.length)$('regression-list').append(text('p','검사 범위에서 회귀를 발견하지 못했습니다.'));
 $('patch').textContent=r.patch;
 $('patch-download').hidden=!view.downloads;
 $('patch-download').href=`/api/runs/${encodeURIComponent(run.id)}/patch`;
 $('evidence-download').href=`/api/runs/${encodeURIComponent(run.id)}/evidence`;
 $('case-rows').replaceChildren(...r.phases[0].rows.map((row,i)=>{const tr=document.createElement('tr');tr.append(text('td',row.id));for(const phase of r.phases){const x=phase.rows[i];tr.append(text('td',x.matches?'일치':'불일치',x.matches?'pass':'failure'));}return tr;}));
 $('run-id').textContent=`실행 ID: ${run.id} · ${r.verdict} · ${r.provider} · ${r.environment}`;
 }
}
async function json(url,options={}){const response=await fetch(url,{...options,headers:{...(options.headers??{}),'Accept':'application/json'}});let data;try{data=await response.json();}catch{throw new Error('서버 응답을 해석할 수 없습니다.');}if(!response.ok)throw Object.assign(new Error(data.error?.message??data.message??`HTTP ${response.status}`),{code:data.error?.code??'INFRA_ERROR'});return data;}
function failure(err){run={status:'failed',error:{code:err.code??'INFRA_ERROR',message:err.message}};render();}
async function poll(id,token){try{while(token===epoch){const current=await json(`/api/runs/${encodeURIComponent(id)}`);if(token!==epoch)return;run=current;render();if(current.status!=='running')return;await new Promise(resolve=>setTimeout(resolve,180));}}catch(e){if(token===epoch)failure(e);}}
$('start-button').addEventListener('click',async()=>{if(starting||run?.status==='running'||!ready)return;starting=true;render();const token=++epoch;try{const created=await json('/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fixtureId:'zod-settings'})});if(token!==epoch)return;run={id:created.id,status:'running',stage:'baseline',events:[]};starting=false;render();await poll(created.id,token);}catch(e){starting=false;failure(e);}});
function reset(){epoch++;run=null;starting=false;render();}
$('reset-button').addEventListener('click',reset);
$('retry-button').addEventListener('click',()=>{reset();if(!ready)init();});
async function init(){try{config=await json('/api/config');if(config.readiness?.ready===false)throw Object.assign(new Error(config.readiness.issues.join('; ')),{code:'CONFIG_ERROR'});$('versions').textContent=`zod · ${config.baselineVersion} → ${config.targetVersion}`;ready=config.readiness?.ready===true;render();}catch(e){failure(e);}}
render();init();
