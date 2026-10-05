import { evaluateDecision } from '../shell-service/dist/system-one/client.js'
import { DecisionStore } from '../shell-service/dist/system-one/store.js'
import { DecisionBroker } from '../shell-service/dist/system-one/broker.js'
import extension from '../shell-service/dist/system-one/pi-extension.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const output = process.argv[2] || '/private/tmp/pi-ui-laya-validation.json'
const provider={id:'laya',name:'Local Laya',protocol:'systemone-http',endpoint:'http://127.0.0.1:8000/v1/systemone',auth:{mode:'none'},timeoutMs:120000}
const models=['english','multilingual'].map(id=>({id,providerId:'laya',name:'Laya '+id,remoteModel:id,questionTypes:['choice','score','noul'],confidenceSemantics:'normalized-entropy',maxQuestions:64,maxOptions:100}))
const store=new DecisionStore(mkdtempSync(join(tmpdir(),'laya-validation-config-')))
await store.save({revision:0,enabled:true,providers:[provider],models,defaultModelId:'english'})
const questions={department:{type:'choice',instructions:'Which team should handle the customer request?',criteria:{billing:'Payments, invoices, refunds and duplicate charges',technical:'Software errors, crashes and broken features'}},urgency:{type:'score',instructions:'How urgent is this request?',criteria:['Not urgent','Normal priority','Urgent: immediate action requested']},refund:{type:'noul',instructions:'Is the customer asking for a refund?'}}
const cases=[['en-refund','english','I was charged twice. Please refund the duplicate charge immediately.','billing',true],['en-crash','english','The app crashes when I open settings. Please fix this bug.','technical',false],['zh-refund','multilingual','我被重复扣款了，请立即退还多收的钱。','billing',true],['zh-crash','multilingual','打开设置页面时软件崩溃，请修复这个问题。','technical',false]]
const report={at:new Date().toISOString(),health:await(await fetch('http://127.0.0.1:8000/health')).json(),cases:[],warm:[],checks:{}}
try{
 for(const [id,modelId,state,expectedChoice,expectedYes] of cases){
  store.select('/validation',modelId)
  const result=await evaluateDecision(store.resolve('/validation'),{state,questions})
  const raw = await (await fetch(provider.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,questions,model:modelId})})).json()
  assert.equal(raw.routing?.model,modelId)
  report.cases.push({routing:raw.routing,id,expectedChoice,expectedYes,choiceCorrect:result.answers.department.choice===expectedChoice,noulCorrect:(result.answers.refund.noul>=.5)===expectedYes,result})
  writeFileSync(output,JSON.stringify(report,null,2))
  console.log(id,result.actualModel,result.latencyMs+'ms',JSON.stringify(result.answers))
 }
 for(let i=0;i<20;i++){
  const result=await evaluateDecision(store.resolveModel('english'),{state:cases[i%2][2],questions})
  report.warm.push(result.latencyMs)
 }
 const sorted=[...report.warm].sort((a,b)=>a-b);report.performance={p50:sorted[9],p95:sorted[18],samples:20}
 const broker=new DecisionBroker(store);const grant=await broker.grant('/validation')
 try{
  let tool;extension({registerTool:t=>{tool=t}});process.env.PI_UI_DECISION_URL=grant.url;process.env.PI_UI_DECISION_TOKEN=grant.token
  store.select('/validation','english');const first=await tool.execute('en',{state:cases[0][2],questions})
  store.select('/validation','multilingual');const second=await tool.execute('zh',{state:cases[2][2],questions})
  assert.equal(first.details.modelConfigId,'english'); assert.equal(second.details.modelConfigId,'multilingual'); report.checks.toolSwitch={english:first.details,multilingual:second.details}
  store.select('/validation',null);await assert.rejects(tool.execute('off',{state:'x',questions}),/disabled/);report.checks.disabled=true
  grant.revoke();await assert.rejects(tool.execute('revoked',{state:'x',questions}),/unauthorized/);report.checks.revoked=true
 }finally{await broker.close()}
 report.healthAfter=await(await fetch('http://127.0.0.1:8000/health')).json()
 report.status='passed'
}catch(e){report.status='failed';report.error=e.message;process.exitCode=1;console.error(e)}finally{writeFileSync(output,JSON.stringify(report,null,2))}
