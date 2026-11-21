import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root=resolve(import.meta.dirname,".."), store=new Store(resolve(root,"data"));
const token=await new Vault(store).get("dashboard-token"); store.close();
const call=async(path:string,body?:unknown)=>{
 const r=await fetch("http://127.0.0.1:4317/api"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json(); if(!r.ok) throw new Error(data.error); return data;
};
const file=resolve(root,"docs/verification/agent-resume.json"), mode=process.argv[2];
if(mode==="--before"){
 const projects=JSON.parse(readFileSync(resolve(root,"docs/control-projects/projects.json"),"utf8")).projects;
 const tasks=[];
 for(const p of projects){const d=await call("/projects/"+p.id); for(const t of d.tasks.filter((t:any)=>t.status==="running"&&t.provider==="codex")) tasks.push({projectId:p.id,taskId:t.id,threadId:t.threadId,turnId:t.turnId,attempt:t.attempt});}
 if(!tasks.length) throw new Error("No active agent turns to verify");
 writeFileSync(file,JSON.stringify({beforeAt:new Date().toISOString(),tasks,phase:"before-restart",passed:false},null,2));
 console.log(JSON.stringify({saved:tasks.length}));
}else{
 const report=JSON.parse(readFileSync(file,"utf8"));
 for(const entry of report.tasks){
  let d=await call("/projects/"+entry.projectId), t=d.tasks.find((t:any)=>t.id===entry.taskId);
  if(mode==="--resume"&&["blocked","failed"].includes(t.status)){await call("/tasks/"+t.id+"/retry",{}); d=await call("/projects/"+entry.projectId);t=d.tasks.find((t:any)=>t.id===entry.taskId);}
  entry.after={at:new Date().toISOString(),status:t.status,threadId:t.threadId,turnId:t.turnId,attempt:t.attempt,error:t.error,instances:t.result?.instances?.length||0,sourceLocaleId:t.result?.data?.localization?.sourceLocaleId};
  entry.passed=t.status==="succeeded"&&t.threadId===entry.threadId&&t.attempt>entry.attempt&&t.turnId!==entry.turnId&&t.result?.data?.localization?.sourceLocaleId==="en-us";
 }
 report.passed=report.tasks.every((t:any)=>t.passed);report.phase=report.passed?"completed":"resumed-pending-completion";
 writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
