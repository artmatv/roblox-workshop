import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store, hash } from "../server/store.js";
import { Vault } from "../server/vault.js";
const root=resolve(import.meta.dirname,".."), store=new Store(resolve(root,"data"));
const token=await new Vault(store).get("dashboard-token");store.close();
const call=async(path:string,body?:unknown)=>{
 const r=await fetch("http://127.0.0.1:4317/api"+path,{method:body?"POST":"GET",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw new Error(data.error);return data;
};
const p=JSON.parse(readFileSync(resolve(root,"docs/control-projects/projects.json"),"utf8")).projects.find((p:any)=>p.key===(process.argv[2]||"moon"));
const d=await call("/projects/"+p.id),style=d.styles[Number(process.argv[3]||1)-1],base=d.tasks.find((t:any)=>t.id===style.previewTaskId);
const suite=base.result.instances.find((i:any)=>i.path==="ServerStorage/AutomationTests");
if(!suite?.source)throw new Error("No existing test module");
const lines=suite.source.split("\n"), matches=lines.filter((l:string)=>l.includes("if not measured[device]")&&l.includes("id='localization'")&&l.includes("status='not_run'"));
if(matches.length!==1)throw new Error("Expected exactly one incorrect opposite-device placeholder");
const source=lines.filter((l:string)=>l!==matches[0]).join("\n");
const task=await call("/projects/"+p.id+"/styles/"+style.id+"/patch",{baseTaskId:base.id,baseHash:hash(base.result),reason:"Исправлен QA протокол: run(args) проверяет только текущее реальное устройство; исполнитель уже запускает desktop и mobile отдельно. Удалена ошибочная запись localization=not_run для противоположного устройства. Реальные четыре экрана, аудит локализации, геометрия, TextBounds и все прочие проверки сохранены.",manifest:{summary:"Исправлен учёт текущего устройства в native localization QA",instances:[{...suite,source}],files:[],deletions:[],checks:[],findings:base.result.findings,data:{}}});
console.log(JSON.stringify({style:style.name,baseTaskId:base.id,taskId:task.id,instances:task.result.instances.length,sourceLocaleId:task.result.data.localization.sourceLocaleId}));
