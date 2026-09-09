// Test-only local server. Never loaded by the production endpoint.
import { createHandler } from '../server/engine.mjs';
import { startDev } from '../dev.mjs';
const env={PILOT_AI_ENABLED:'true',OPENAI_API_KEY:'not-a-real-api-key',OPENAI_MODEL:'test-model',PILOT_ACCESS_CODE:'local-test-access-code-only'};
const mock=async(_url,init)=>{
 const p=JSON.parse(init.body);let output;
 const text=typeof p.input==='string'?p.input:JSON.stringify(p.input);
 if(text.includes('FAIL_ONCE_TEST')&&!globalThis.failedOnce){globalThis.failedOnce=true;return new Response('test failure',{status:503});}
 if(p.text?.format.name==='question_feedback')output=JSON.stringify({body:'【自動試験用の固定応答】質問の確認内容を表示する領域です。実AIによる評価ではありません。'});
 else if(p.text?.format.name==='final_feedback'){
  const rec=JSON.parse(p.input).records.find(r=>r.id==='chat_u1');
  output=JSON.stringify({start:'【自動試験用の固定応答】最初の発言を表示する領域です。',materials:'【自動試験用の固定応答】材料の出所を表示する領域です。',reconsideration:'【自動試験用の固定応答】再検討を表示する領域です。',decision:'【自動試験用の固定応答】最終判断を表示する領域です。',evidence:[{source_id:rec.id,quote:rec.text.slice(0,80)}]});
 }else output='【自動試験用の固定応答】通信・画面確認用です。本物のAIの返答ではありません。';
 return new Response(JSON.stringify({id:'test-response',model:'test-model',status:'completed',usage:{input_tokens:1,output_tokens:1},output:[{type:'message',content:[{type:'output_text',text:output}]}]}));
};
startDev({port:3100,handler:createHandler({env,fetchImpl:mock})});
