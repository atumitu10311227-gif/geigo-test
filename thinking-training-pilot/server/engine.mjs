import { createHash, timingSafeEqual } from 'node:crypto';
import { CONSTANTS, COURSES } from './courses.mjs';
import { chatPrompt, questionPrompt, feedbackPrompt } from './prompts.mjs';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MAX_BODY_BYTES = 160000;
const MAX_TEXT = 2000;
const MAX_AI_TEXT = 12000;
const MAX_HISTORY_CHARS = 30000;
const COMMON_HEADERS = {
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer'
};
const KEYS = ['start','materials','reconsideration','decision'];
const STR = { type:'string' };
const questionSchema = {type:'object',properties:{body:STR},required:['body'],additionalProperties:false};
const feedbackSchema = {
  type:'object',
  properties:{
    start:STR,materials:STR,reconsideration:STR,decision:STR,
    evidence:{type:'array',items:{type:'object',properties:{source_id:STR,quote:STR},required:['source_id','quote'],additionalProperties:false}}
  },
  required:[...KEYS,'evidence'],additionalProperties:false
};

class PilotError extends Error {
  constructor(status, code, message){ super(message); this.status=status; this.code=code; }
}
function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:COMMON_HEADERS});}
function fail(status,code,message){throw new PilotError(status,code,message);}
function plain(obj){return obj !== null && typeof obj==='object' && !Array.isArray(obj);}
function text(v,label,max=MAX_TEXT,empty=false){
  if(typeof v!=='string' || (!empty && !v.trim()) || v.length>max) fail(400,'invalid_input',`${label}を確認してください（${max}文字以内）。`);
  return v;
}
function equalSecret(a,b){
  const x=createHash('sha256').update(a).digest();const y=createHash('sha256').update(b).digest();
  return timingSafeEqual(x,y);
}
function ready(env){
  return env.PILOT_AI_ENABLED==='true' && !!env.OPENAI_API_KEY && !!env.OPENAI_MODEL && typeof env.PILOT_ACCESS_CODE==='string' && env.PILOT_ACCESS_CODE.length>=16;
}
function selected(value,course,kind){
  const choices=kind==='choice'?COURSES[course].choices:COURSES[course].judgments;
  if(!choices.includes(value))fail(400,'invalid_choice','選択内容を確認してください。');
  return value;
}
function cleanHistory(value,feedback=false){
  if(!Array.isArray(value)) fail(400,'invalid_history','会話記録を確認してください。');
  const max=feedback?13:12;
  if(value.length>max) fail(400,'turn_limit','この対話は上限に達しています。振り返りへ進んでください。');
  if(feedback && (value.length<7 || value.length%2!==1)) fail(400,'invalid_history','3往復以上の対話を終えてから振り返ってください。');
  if(!feedback && value.length!==0 && value.length%2!==0) fail(400,'invalid_history','会話の送信順を確認してください。');
  let sum=0;
  return value.map((m,i)=>{
    if(!plain(m)) fail(400,'invalid_history','会話記録が正しくありません。');
    const expected=i%2===0?'assistant':'user';
    if(m.role!==expected) fail(400,'invalid_history','会話の送信順が正しくありません。');
    const t=text(m.text,'発言',expected==='assistant'?MAX_AI_TEXT:MAX_TEXT);
    sum+=t.length;if(sum>MAX_HISTORY_CHARS) fail(400,'input_too_long','会話全体が長すぎるため送信できません。記録は端末に残っています。');
    return {id:expected==='assistant'?`chat_a${i/2}`:`chat_u${(i+1)/2}`,role:expected,text:t};
  });
}
function courseId(c){if(!Object.hasOwn(COURSES,c))fail(400,'invalid_course','コースを選び直してください。');return c;}
function exercise(body,c){
  const choice=selected(body.choice,c,'choice');
  const other=text(body.other??'','その他の内容',MAX_TEXT,choice!=='その他');
  const q=text(body.question,'自由質問');
  const choiceText=choice==='その他'?`${choice}：${other}`:choice;
  const d=COURSES[c];
  const fixed=choice==='その他'?'「その他」として、独自の回答を記入しています。':d.accept[choice];
  return [
    {id:'exercise_setting',source:'app',phase:'対話例の設定',text:d.scenarioText},
    {id:'exercise_choice',source:'user',phase:'選択',text:choiceText},
    {id:'exercise_fixed_feedback',source:'app',phase:'選択後の固定解説',text:fixed+'\n'+d.add.replace(/<[^>]*>/g,'')},
    {id:'exercise_question',source:'user',phase:'固定解説後の自由質問',text:q}
  ];
}

export function makePayload(body,env){
  if(!plain(body))fail(400,'invalid_body','送信内容を確認してください。');
  const c=courseId(body.course);
  const model=text(env.OPENAI_MODEL,'接続モデル',160);
  let instructions,input,schema,name,maxOutput,history=[],sources=[];
  if(body.action==='question'){
    sources=exercise(body,c);
    instructions=questionPrompt(c);input=JSON.stringify({course:c,records:sources});
    schema=questionSchema;name='question_feedback';maxOutput=2000;
  }else if(body.action==='chat'){
    history=cleanHistory(body.history,false);
    instructions=chatPrompt(c);
    input=[{role:'user',content:`【アプリが用意した開始設定】\n${COURSES[c].dialogueScenario}\nこの設定への最初の回答から始めてください。`},
      ...history.map(m=>({role:m.role,content:m.text}))];
    maxOutput=2500;
  }else if(body.action==='feedback'){
    history=cleanHistory(body.history,true);
    sources=exercise(body,c);
    sources.push({id:'exercise_question_feedback',source:'ai',phase:'自由質問へのAIフィードバック',text:text(body.questionFeedback,'質問フィードバック',12000)});
    sources.push({id:'dialogue_setting',source:'app',phase:'実対話の開始設定（利用者の実発言ではない）',text:COURSES[c].dialogueScenario});
    sources.push(...history.map(m=>({id:m.id,source:m.role==='user'?'user':'ai',phase:'実対話',text:m.text})));
    const judgment=selected(body.judgment,c,'judgment');
    const jother=text(body.judgmentOther??'','最終判断のその他',MAX_TEXT,judgment!=='その他');
    sources.push({id:'final_choice',source:'user',phase:'対話終了後の最終判断',text:judgment==='その他'?judgment+'：'+jother:judgment});
    sources.push({id:'final_reason',source:'user',phase:'対話終了後の判断理由',text:text(body.reason,'判断理由')});
    instructions=feedbackPrompt(c);input=JSON.stringify({course:c,records:sources});
    schema=feedbackSchema;name='final_feedback';maxOutput=6500;
  }else fail(400,'invalid_action','操作を確認してください。');
  const payload={model,instructions,input,store:false,max_output_tokens:maxOutput,tools:[]};
  if(schema) payload.text={format:{type:'json_schema',name,strict:true,schema}};
  const effort=env.OPENAI_REASONING_EFFORT?.trim();
  if(effort){
    if(!['none','minimal','low','medium','high','xhigh','max'].includes(effort))fail(503,'configuration','推論設定を確認してください。');
    payload.reasoning={effort};
  }
  return {payload,sources,action:body.action};
}

function outputText(result){
  let chunks=[];
  for(const item of result.output??[]){
    if(item.type!=='message')continue;
    for(const c of item.content??[]){
      if(c.type==='refusal')fail(422,'ai_refusal','この内容にはAIが応答できませんでした。入力は保存されています。題材や表現を確認してください。');
      if(c.type==='output_text' && typeof c.text==='string')chunks.push(c.text);
    }
  }
  if(result.status!=='completed')fail(502,'incomplete','AIの返答が最後まで生成されませんでした。架空の返答では補いません。入力は残っています。');
  const value=chunks.join('\n').trim();
  if(!value || value.length>30000)fail(502,'empty_output','AIの返答を読み取れませんでした。入力は残っています。');
  return value;
}
export function validateOutput(result,job){
  const raw=outputText(result);
  const meta={appVersion:CONSTANTS.APP_VERSION,promptVersion:CONSTANTS.PROMPT_VERSION,requestedModel:job.payload.model,returnedModel:result.model??job.payload.model,responseId:result.id??null,at:new Date().toISOString(),usage:result.usage??null};
  if(job.action==='chat')return {text:raw,meta};
  let parsed;try{parsed=JSON.parse(raw);}catch{fail(502,'invalid_output','AIの返答形式を確認できませんでした。自動で再課金せず、ここで停止しています。');}
  if(!plain(parsed))fail(502,'invalid_output','AIの返答形式が正しくありませんでした。');
  if(job.action==='question'){
    if(typeof parsed.body!=='string'|| !parsed.body.trim() || parsed.body.length>6000)fail(502,'invalid_output','質問フィードバックを確認できませんでした。');
    return {text:parsed.body,meta};
  }
  for(const k of KEYS)if(typeof parsed[k]!=='string'|| !parsed[k].trim()||parsed[k].length>5000)fail(502,'invalid_output','フィードバックの一部が欠けています。');
  if(!Array.isArray(parsed.evidence)||parsed.evidence.length>12)fail(502,'invalid_evidence','フィードバックの参照元を確認できませんでした。');
  const texts=new Map(job.sources.map(s=>[s.id,s.text]));
  for(const ev of parsed.evidence){
    if(!plain(ev)||typeof ev.quote!=='string'||!ev.quote.trim()||ev.quote.length>500||!texts.has(ev.source_id)||!texts.get(ev.source_id).includes(ev.quote))
      fail(502,'invalid_evidence','AIの引用が元の記録と一致しませんでした。誤ったフィードバックを表示せず停止しています。入力は保存されています。');
  }
  // Evidence consistency is not a proof that the interpretation is correct.
  return {sections:KEYS.map((k,i)=>({title:CONSTANTS.FEEDBACK_TITLES[i],body:parsed[k]})),evidence:parsed.evidence,meta};
}
async function limitedJSON(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'content_type','JSON形式の送信のみ受け付けます。');
  const n=Number(request.headers.get('content-length')??0);
  if(n>MAX_BODY_BYTES)fail(413,'body_too_large','送信内容が長すぎます。');
  const reader=request.body?.getReader();if(!reader)fail(400,'empty','送信内容がありません。');
  let total=0;const chunks=[];
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BODY_BYTES){await reader.cancel();fail(413,'body_too_large','送信内容が長すぎます。');}chunks.push(value);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'invalid_json','送信形式が正しくありません。');}
}

/** Per-process throttling is deliberately NOT advertised as a hard spending cap. */
export function createHandler({env=process.env,fetchImpl=(...args)=>fetch(...args),now=()=>Date.now()}={}){
  let globalWindow={until:0,count:0};const attempts=new Map();let running=0;
  function rate(request){
    const t=now();if(t>globalWindow.until)globalWindow={until:t+3600000,count:0};
    const ip=request.headers.get('x-forwarded-for')?.split(',')[0]??'local';
    const key=createHash('sha256').update(ip).digest('hex');
    for(const [k,v]of attempts)if(t>v.until)attempts.delete(k);
    const entry=attempts.get(key)??{until:t+600000,count:0};entry.count++;attempts.set(key,entry);
    if(entry.count>60)fail(429,'request_limit','短時間の操作が多いため一時停止しています。少し時間を空けてください。');
    if(attempts.size>10000)attempts.clear();
  }
  return async request=>{
    let reserved=false;
    try{
      if(request.method==='GET')return response({ready:ready(env),appVersion:CONSTANTS.APP_VERSION,promptVersion:CONSTANTS.PROMPT_VERSION,mode:'connection',maxTurns:6,minTurns:3,model:env.OPENAI_MODEL||null,message:ready(env)?'サーバー設定済み。実際のモデルへの接続可否は初回応答で確認します。':'AI接続はまだ有効になっていません。公開先で認証情報・モデル・利用許可の設定が必要です。'});
      if(request.method!=='POST')return response({error:{code:'method',message:'この操作は受け付けません。'}},405);
      const origin=request.headers.get('origin');
      if(!origin || origin!==new URL(request.url).origin)fail(403,'origin','このアプリの画面から操作してください。');
      rate(request);
      if(!ready(env))fail(503,'not_configured','AI接続はまだ有効になっていません。入力はこの端末に残っています。');
      const supplied=request.headers.get('x-pilot-access')??'';
      if(supplied.length>256 || !equalSecret(supplied,env.PILOT_ACCESS_CODE))fail(401,'access_denied','利用コードが一致しません。AIにはまだ送信していません。');
      const body=await limitedJSON(request);
      if(!plain(body))fail(400,'invalid_body','送信内容を確認してください。');
      if(body.action==='verify')return response({ok:true,model:env.OPENAI_MODEL,aiCalled:false});
      const job=makePayload(body,env);
      if(globalWindow.count>=100)fail(429,'local_limit','このサーバーの一時的な利用回数制限に達しました。しばらく待つか管理者が設定を確認してください。');
      if(running>=3)fail(429,'busy','現在ほかの応答を処理中です。少し待ってから操作してください。');
      globalWindow.count++;running++;reserved=true;
      let upstream;
      try{
        upstream=await fetchImpl(ENDPOINT,{
          method:'POST',headers:{'authorization':`Bearer ${env.OPENAI_API_KEY}`,'content-type':'application/json'},
          body:JSON.stringify(job.payload),signal:AbortSignal.timeout(100000)
        });
      }catch(err){
        if(err.name==='AbortError'||err.name==='TimeoutError')fail(504,'timeout','AI応答の待ち時間を超えました。入力は残っています。処理済みの場合は料金が発生することがあります。');
        fail(502,'upstream_network','AIへの通信に失敗しました。入力は残っています。自動再送はしていません。');
      }
      if(!upstream.ok){
        // Never expose upstream bodies, keys, headers, or conversations in errors/logs.
        if(upstream.status===401||upstream.status===403)fail(502,'upstream_auth','AIサービス側の認証・利用権限を確認してください。');
        if(upstream.status===429)fail(429,'upstream_limit','AIサービス側の残高または利用制限により停止しました。自動再送はしていません。');
        if(upstream.status===400||upstream.status===404)fail(502,'model_configuration','接続モデルまたはリクエスト設定を確認してください。');
        fail(502,'upstream_error','AIサービスから正常な返答がありませんでした。入力は残っています。');
      }
      let result;try{result=await upstream.json();}catch{fail(502,'invalid_response','AIサービスの返答を読み取れませんでした。');}
      return response(validateOutput(result,job));
    }catch(err){
      if(err instanceof PilotError)return response({error:{code:err.code,message:err.message}},err.status);
      return response({error:{code:'internal_error',message:'処理を完了できませんでした。入力は端末に残っています。'}},500);
    }finally{if(reserved)running--;}
  };
}
