'use strict';
(() => {
const $=id=>document.getElementById(id);
const STORAGE_KEY='ai-thinking-pilot-0.4-state';
const SCREENS=['start','course','choice','choiceFeedback','question','questionFeedback','dialogintro','chat','judgment','finalfeedback','closing'];
let busy=false,accessCode='',config={ready:false},storageAvailable=true,current='start';
let activeController=null,interrupted=false;
function blank(){return {version:PILOT.APP_VERSION,promptVersion:PILOT.PROMPT_VERSION,course:null,screen:'course',started:false,consent:false,choice:'',other:'',question:'',questionFeedback:null,history:[],draft:'',judgment:'',judgmentOther:'',reason:'',feedback:null,createdAt:null,updatedAt:null,callMeta:[]};}
let state=blank();
try{
 const stored=localStorage.getItem(STORAGE_KEY);
 if(stored){const s=JSON.parse(stored);if(s.version===PILOT.APP_VERSION&&Array.isArray(s.history)&&s.history.every(m=>m&&typeof m.text==='string'&&['assistant','user'].includes(m.role))&&SCREENS.includes(s.screen)&&(!s.course||PILOT.COURSES[s.course]))state={...blank(),...s};}
}catch{storageAvailable=false;}
function persist(){
 state.updatedAt=new Date().toISOString();
 try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));storageAvailable=true;}
 catch{storageAvailable=false;}
 updateStorageNote();
}
function updateStorageNote(){
 $('storageStatus').textContent=storageAvailable?'入力・履歴はこのブラウザに保存します。':'この環境では保存できません。画面を閉じると入力を失う可能性があります。';
}
function error(message){$('errorText').textContent=message;$('errorBox').hidden=false;$('errorBox').scrollIntoView({block:'nearest'});}
function clearError(){$('errorBox').hidden=true;$('errorText').textContent='';}
function show(name,{save=true}={}){
 if(!SCREENS.includes(name))return;
 SCREENS.forEach(s=>$('screen-'+s).hidden=s!==name);current=name;
 $('pauseBtn').hidden=name==='start';
 if(save&&name!=='start'){state.screen=name;persist();}
 clearError();
 if(name==='start')drawHome();
 if(name==='chat')drawChat();
 if(name==='finalfeedback')drawFeedback();
 document.title=(name==='start'?'AI思考トレーニング':($('screen-'+name).querySelector('h2')?.textContent||'')+' | AI思考トレーニング');
 window.scrollTo(0,0);$('screen-'+name).querySelector('h1,h2')?.focus({preventScroll:true});
}
function drawHome(){
 $('consent').checked=state.consent;
 $('continueBtn').hidden=!state.started;
 $('exportBtn').hidden=!state.started;
 $('deleteBtn').hidden=!state.started;
 $('startBtn').textContent=state.started?'新しくはじめる':'はじめる';
}
async function loadStatus(){
 if(location.protocol==='file:'){
  $('connectionStatus').textContent='このファイルでは画面確認のみです。本物のAIとの対話は、接続用サーバーへ配置・設定してから利用できます。';return;
 }
 try{
  const r=await fetch('/api/ai',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error();config=await r.json();
  $('connectionStatus').textContent=config.message+(config.ready?' 利用コードの確認後に進めます。':'');
 }catch{$('connectionStatus').textContent='AI接続用のサーバーを確認できません。画面の確認はできますが、AI応答はまだ利用できません。';}
}
function selectedName(name){return document.querySelector(`input[name="${name}"]:checked`)?.value||'';}
function drawRadio(parent,name,items,chosen){
 const root=$(parent);root.replaceChildren();
 items.forEach((value,i)=>{const label=document.createElement('label');label.className='choice';const radio=document.createElement('input');radio.type='radio';radio.name=name;radio.value=value;radio.id=name+'-'+i;radio.checked=value===chosen;label.append(radio,document.createTextNode(value));root.append(label);});
}
function hydrate(){
 if(!state.course)return;const d=PILOT.COURSES[state.course];
 $('scenarioTitle').textContent=d.label+'：最初の場面';
 $('scenarioText').innerHTML=d.scenario;$('choiceScene').innerHTML=d.scenario;
 $('questionContext').innerHTML=d.qctx;
 $('dialogPrompt').innerHTML=d.dialog;$('chatContext').innerHTML=d.dialog;$('judgmentContext').innerHTML=d.dialog;
 $('chatTitle').textContent=d.label+'　AI対話';
 drawRadio('choices','choice',d.choices,state.choice);drawRadio('judgments','judgment',d.judgments,state.judgment);
 $('other').value=state.other;$('q1').value=state.question;$('chatInput').value=state.draft;$('reason').value=state.reason;$('judgmentOther').value=state.judgmentOther;
 $('otherWrap').hidden=state.choice!=='その他';$('judgmentOtherWrap').hidden=state.judgment!=='その他';
 drawChoiceFeedback();$('questionView').textContent=state.question;$('questionFeedbackText').textContent=state.questionFeedback?.text||'';
}
function drawChoiceFeedback(){
 if(!state.course)return;const d=PILOT.COURSES[state.course];
 $('chosenView').textContent=state.choice==='その他'?state.choice+'：'+state.other:state.choice;
 $('choiceFeedbackText').replaceChildren();const p=document.createElement('p');
 p.textContent=state.choice==='その他'?'「その他」として、独自の回答を記入しています。':(d.accept[state.choice]||'');
 const div=document.createElement('div');div.innerHTML=d.add;$('choiceFeedbackText').append(p,div);
}
async function callAI(action,fields={}){
 if(!state.consent)throw new Error('注意事項を確認してから進めてください。');
 if(!config.ready)throw new Error('AI接続がまだ有効になっていません。入力は残っています。開始画面の接続表示を確認してください。');
 if(!accessCode)throw new Error('開始画面で利用コードを確認してください。中断しても入力は保存されます。');
 let r;
 const controller=new AbortController();activeController=controller;
 const timer=setTimeout(()=>controller.abort('timeout'),110000);
 try{
  r=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json','X-Pilot-Access':accessCode},body:JSON.stringify({action,course:state.course,...fields}),signal:controller.signal});
 }catch(e){throw new Error(controller.signal.reason==='timeout'?'通信の待ち時間を超えました。入力は残っています。処理済みの場合は料金が発生することがあります。':'通信を完了できませんでした。入力は残っています。自動再送はしていません。');}finally{clearTimeout(timer);activeController=null;}
 let body;try{body=await r.json();}catch{throw new Error('サーバーの返答を読み取れませんでした。入力は残っています。');}
 if(!r.ok){if(r.status===401)accessCode='';throw new Error(body.error?.message||'AI応答を取得できませんでした。');}
 if(body.meta){state.callMeta.push({action,...body.meta});persist();}
 return body;
}
async function task(message,fn){
 if(busy)return;busy=true;interrupted=false;clearError();$('busyText').hidden=false;$('busyText').textContent=message;
 document.querySelectorAll('button,textarea,input').forEach(el=>{if(el.id!=='pauseBtn')el.disabled=true;});
 try{await fn();}catch(e){if(!interrupted)error(e.message||'処理を完了できませんでした。入力は残っています。');}
 finally{busy=false;$('busyText').hidden=true;document.querySelectorAll('button,textarea,input').forEach(el=>el.disabled=false);if(current==='chat')drawChatControls();}
}
function exerciseFields(){return {choice:state.choice,other:state.other,question:state.question};}
function turns(){return state.history.filter(m=>m.role==='user').length;}
function appendMessage(m){
 const div=document.createElement('div');div.className='msg '+m.role;
 const label=document.createElement('span');label.className='speaker';label.textContent=m.role==='user'?'あなた':'AI';
 const p=document.createElement('span');p.textContent=m.text;div.append(label,p);$('chatBox').append(div);
}
function drawChat(){
 $('chatBox').setAttribute('aria-live','off');$('chatBox').replaceChildren();state.history.forEach(appendMessage);$('chatBox').setAttribute('aria-live','polite');
 $('chatInput').value=state.draft;drawChatControls();
}
function drawChatControls(){
 const n=turns();$('turns').textContent=`対話 ${n} / ${PILOT.MAX_TURNS}往復`;
 $('chatEntry').hidden=n>=PILOT.MAX_TURNS;$('turnLimitText').hidden=n<PILOT.MAX_TURNS;$('endChat').hidden=n<PILOT.MIN_TURNS;
 $('sendChat').disabled=busy||n>=PILOT.MAX_TURNS;
}
function drawFeedback(){
 const root=$('finalSections');root.replaceChildren();
 for(const [i,s]of (state.feedback?.sections||[]).entries()){
  const section=document.createElement('section');section.className='card feedback';const h=document.createElement('h3');h.textContent=`${i+1}. ${s.title}`;
  const p=document.createElement('p');p.className='exact';p.textContent=s.body;section.append(h,p);root.append(section);
 }
 $('feedbackClosing').textContent=PILOT.FEEDBACK_CLOSING;
 $('reviewTranscript').textContent=transcript(false);
}
function transcript(includeFeedback=true){
 if(!state.course)return 'まだ記録がありません。';const d=PILOT.COURSES[state.course];
 const lines=[`AI思考トレーニング　記録`, `アプリ ${PILOT.APP_VERSION} / 指示書 ${state.promptVersion}`,`コース：${d.label}`,`開始：${state.createdAt||''}`, '', '【アプリが示した対話例】',d.scenarioText,'','【選択】',state.choice+(state.choice==='その他'?'：'+state.other:''),'','【固定解説後の自由質問】',state.question,'','【自由質問へのAIフィードバック】',state.questionFeedback?.text||'未生成','','【実対話の開始設定／利用者が自作した発言ではない】',d.dialogueScenario,''];
 for(const m of state.history)lines.push(m.role==='user'?'利用者：':'AI：',m.text,'');
 lines.push('【対話終了後の本人の判断】',state.judgment+(state.judgment==='その他'?'：'+state.judgmentOther:''),state.reason);
 if(includeFeedback&&state.feedback){lines.push('','【対話後のフィードバック】');state.feedback.sections.forEach((s,i)=>lines.push(`${i+1}. ${s.title}`,s.body,''));lines.push(PILOT.FEEDBACK_CLOSING);}
 if(includeFeedback){lines.push('','【接続記録】');for(const m of state.callMeta)lines.push(`${m.action} / ${m.at} / model=${m.returnedModel} / response=${m.responseId} / input_tokens=${m.usage?.input_tokens??'不明'} / output_tokens=${m.usage?.output_tokens??'不明'}`);}
 return lines.join('\n');
}
function saveFile(){
 const blob=new Blob([transcript(true)],{type:'text/plain;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`思考トレーニング記録_${state.course||'未選択'}_${new Date().toISOString().slice(0,10)}.txt`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

$('consent').addEventListener('change',()=>{state.consent=$('consent').checked;persist();});
$('startBtn').addEventListener('click',()=>{
 if(!$('consent').checked)return error('注意事項を確認し、確認欄を選択してください。');
 if(state.started&&!confirm('新しく始めると、このブラウザにある前回の記録を置き換えます。必要なら先に記録をファイルに保存してください。新しく始めますか？'))return;
 state=blank();state.started=true;state.consent=true;state.createdAt=new Date().toISOString();show('course');
});
$('continueBtn').addEventListener('click',()=>{hydrate();show(state.screen||'course');});
$('pauseBtn').addEventListener('click',()=>{
 if(busy){if(!confirm('通信の待機を中断して戻ります。既にAI側で処理した分は料金が発生する場合があります。入力は端末に残します。中断しますか？'))return;interrupted=true;activeController?.abort('user');}
 persist();show('start',{save:false});
});
$('finishBtn').addEventListener('click',()=>{state.screen='finalfeedback';persist();show('start',{save:false});});
$('deleteBtn').addEventListener('click',()=>{
 if(!confirm('このブラウザに保存した入力・会話・結果を削除します。外部サービスの記録や、保存済みファイルは削除されません。削除しますか？'))return;
 try{localStorage.removeItem(STORAGE_KEY);}catch{}state=blank();accessCode='';$('accessInput').value='';$('accessStatus').textContent='';show('start',{save:false});
});
$('exportBtn').addEventListener('click',saveFile);
$('verifyAccess').addEventListener('click',()=>task('利用コードを確認しています（AIの生成は行いません）。',async()=>{
 accessCode=$('accessInput').value.trim();if(!accessCode)throw new Error('利用コードを入力してください。');
 const b=await callAI('verify');$('accessStatus').textContent=`利用コードを確認しました。設定モデル：${b.model}。まだAIには文章を送信していません。`;$('accessInput').value='';
}));
document.querySelectorAll('[data-course]').forEach(b=>b.addEventListener('click',()=>{state.course=b.dataset.course;hydrate();show('choice');}));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.go)));
$('choices').addEventListener('change',()=>{state.choice=selectedName('choice');$('otherWrap').hidden=state.choice!=='その他';persist();});
$('judgments').addEventListener('change',()=>{state.judgment=selectedName('judgment');$('judgmentOtherWrap').hidden=state.judgment!=='その他';persist();});
[['other','other'],['q1','question'],['chatInput','draft'],['reason','reason'],['judgmentOther','judgmentOther']].forEach(([id,key])=>$(id).addEventListener('input',()=>{state[key]=$(id).value;persist();}));
$('saveChoice').addEventListener('click',()=>{
 state.choice=selectedName('choice');state.other=$('other').value;
 if(!state.choice)return error('一つ選んでください。');if(state.choice==='その他'&&!state.other.trim())return error('その他の内容を入力してください。');
 drawChoiceFeedback();show('choiceFeedback');
});
$('saveQuestion').addEventListener('click',()=>{
 state.question=$('q1').value;persist();if(!state.question.trim())return error('質問を入力してください。');
 task('質問へのフィードバックを作っています。',async()=>{
  if(!state.questionFeedback||state.questionFeedback.sourceQuestion!==state.question){const r=await callAI('question',exerciseFields());state.questionFeedback={...r,sourceQuestion:state.question};persist();}
  $('questionView').textContent=state.question;$('questionFeedbackText').textContent=state.questionFeedback.text;show('questionFeedback');
 });
});
$('startChat').addEventListener('click',()=>task('AIの最初の回答を作っています。',async()=>{
 if(state.history.length===0){const r=await callAI('chat',{history:[]});state.history.push({role:'assistant',text:r.text,at:r.meta.at});persist();}
 show('chat');
}));
$('sendChat').addEventListener('click',()=>{
 const value=$('chatInput').value;state.draft=value;persist();if(!value.trim())return error('送る内容を入力してください。');if(turns()>=PILOT.MAX_TURNS)return;
 task('AIが応答しています。',async()=>{
  const message={role:'user',text:value,at:new Date().toISOString()};
  const r=await callAI('chat',{history:[...state.history,message]});
  const answer={role:'assistant',text:r.text,at:r.meta.at};state.history.push(message,answer);state.draft='';persist();$('chatInput').value='';
  appendMessage(message);appendMessage(answer);drawChatControls();
  if(turns()>=PILOT.MAX_TURNS)$('endChat').focus();else $('chatInput').focus({preventScroll:true});
 });
});
$('endChat').addEventListener('click',()=>{if(turns()>=PILOT.MIN_TURNS)show('judgment');});
$('backChat').addEventListener('click',()=>show('chat'));
$('saveJudgment').addEventListener('click',()=>{
 state.judgment=selectedName('judgment');state.judgmentOther=$('judgmentOther').value;state.reason=$('reason').value;persist();
 if(!state.judgment)return error('現時点の判断を選んでください。');if(state.judgment==='その他'&&!state.judgmentOther.trim())return error('その他の判断を入力してください。');if(!state.reason.trim())return error('理由を短く入力してください。');
 task('対話全体のフィードバックを作っています。',async()=>{
  const fields={...exerciseFields(),history:state.history,questionFeedback:state.questionFeedback?.text||'',judgment:state.judgment,judgmentOther:state.judgmentOther,reason:state.reason};
  const fingerprint=JSON.stringify(fields);
  if(!state.feedback||state.feedback.fingerprint!==fingerprint){const r=await callAI('feedback',fields);state.feedback={...r,fingerprint};persist();}
  show('finalfeedback');
 });
});
updateStorageNote();drawHome();hydrate();loadStatus();
})();
