import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { Store, hash } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root=resolve(import.meta.dirname,".."),store=new Store(resolve(root,"data"));
const token=await new Vault(store).get("dashboard-token");store.close();
const call=async(path:string,body?:unknown)=>{const r=await fetch("http://127.0.0.1:4317/api"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;};
const key=process.argv[2]||"moon",number=Number(process.argv[3]||1),submit=process.argv.includes("--submit");
const reason=process.argv.find((a)=>a.startsWith("--reason="))?.slice(9)||"Проверенное исправление Lua исходников после фактического отказа native QA. Клиентский и серверный контекст локализации разделены; настоящие проверки интерфейса сохранены.";
const p=JSON.parse(readFileSync(resolve(root,"docs/control-projects/projects.json"),"utf8")).projects.find((p:any)=>p.key===key);
const d=await call("/projects/"+p.id),style=d.styles[number-1],base=d.tasks.find((t:any)=>t.id===style.previewTaskId);
const folder=resolve(root,"outputs/source-review",key+"-"+number),reviewFile=resolve(folder,"review.json");
if(submit){
 const review=JSON.parse(readFileSync(reviewFile,"utf8"));
 if(review.baseTaskId!==base.id||review.baseHash!==hash(base.result))throw new Error("Review base changed");
 const instances=review.sources.flatMap((entry:any)=>{const source=readFileSync(resolve(folder,entry.file),"utf8");return hash(source)===entry.hash?[]:[{...base.result.instances.find((i:any)=>i.path===entry.path),source}];});
 if(!instances.length)throw new Error("No source changes");
 const task=await call("/projects/"+p.id+"/styles/"+style.id+"/patch",{baseTaskId:base.id,baseHash:review.baseHash,reason,manifest:{summary:"Проверенная доработка демонстрационной сцены",instances,files:[],deletions:[],findings:base.result.findings,data:{}}});
 console.log(JSON.stringify({taskId:task.id,changed:instances.map((i:any)=>i.path)}));
}else{
 mkdirSync(folder,{recursive:true});
 const sources=[];
 for(const i of base.result.instances){if(!i.source||/\/(AutomationI18n|AutomationLocaleCatalog|AutomationLocalization|AutomationPreviewEnvironment)$/.test(i.path))continue;const file=i.path.replaceAll("/","__")+".luau";writeFileSync(resolve(folder,file),i.source);sources.push({path:i.path,file,hash:hash(i.source)});}
 writeFileSync(reviewFile,JSON.stringify({projectId:p.id,styleId:style.id,baseTaskId:base.id,baseHash:hash(base.result),sources},null,2));
 console.log(JSON.stringify({folder,sources:sources.map((i)=>i.path)}));
}
