import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {Store,hash} from "../server/store.js";
import {Vault} from "../server/vault.js";
import {GAME_LANGUAGE_POLICY} from "../server/game-localization.js";
const root=resolve(import.meta.dirname,".."),store=new Store(resolve(root,"data"));
const token=await new Vault(store).get("dashboard-token");store.close();
const controls=JSON.parse(readFileSync(resolve(root,"docs/control-projects/projects.json"),"utf8")).projects;
const projects=[];
for(const p of controls){
 const response=await fetch("http://127.0.0.1:4317/api/projects/"+p.id,{headers:{Authorization:"Bearer "+token}});
 const d=await response.json();if(!response.ok)throw new Error(d.error);
 projects.push({key:p.key,id:p.id,policy:d.gameLanguage,requiredCheck:d.project.requiredChecks.includes("localization"),styles:d.styles.map((s:any)=>{
  const t=d.tasks.find((t:any)=>t.id===s.previewTaskId),m=t?.result,locale=m?.data?.localization,c=d.commands.find((c:any)=>c.id===s.studioEvidence);
  return {id:s.id,name:s.name,taskId:t?.id,status:t?.status,provider:t?.provider,artifactHash:m?hash(m):null,sourceLocaleId:locale?.sourceLocaleId||null,entries:locale?.entries?.length||0,
   catalogueCSV:m?.files.some((f:any)=>f.path==="localization/en-us.csv")||false,
   clientModule:m?.instances.some((i:any)=>i.path==="ReplicatedStorage/AutomationI18n")||false,
   studioEvidence:s.studioEvidence,runtimePassed:!!c&&c.status==="succeeded"&&["style-runtime","localization"].every(id=>c.result?.checks?.some((v:any)=>v.id===id&&v.status==="passed")),
   studioImages:s.previews.filter((v:any)=>v.kind==="studio").length,skills:t?.skills?.map((s:any)=>s.id),cloudTranslation:"unpublished-not-verified"};
 })});
}
const styles=projects.flatMap((p)=>p.styles),report={at:new Date().toISOString(),policy:GAME_LANGUAGE_POLICY,
 sourceCatalogues:styles.filter((s)=>s.sourceLocaleId==="en-us"&&s.entries>0&&s.catalogueCSV&&s.clientModule).length,
 totalStyles:styles.length,totalEntries:styles.reduce((n,s)=>n+s.entries,0),runtimePassed:styles.filter((s)=>s.runtimePassed).length,
 nativeImages:styles.reduce((n,s)=>n+s.studioImages,0),projects,
 limits:["Automatic cloud translation and player locale changes in a published experience are not verified.","Studio device simulation does not replace a physical phone.","Visual style choices, final specifications and budgets still require the user's decisions."]};
writeFileSync(resolve(root,"docs/verification/game-localization.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({sourceCatalogues:report.sourceCatalogues,totalStyles:report.totalStyles,totalEntries:report.totalEntries,runtimePassed:report.runtimePassed,nativeImages:report.nativeImages}));
