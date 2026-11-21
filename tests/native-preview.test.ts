import { test } from "node:test";
import assert from "node:assert/strict";
import { manifestSchema, type Task } from "../shared/domain.js";
import { hash } from "../server/store.js";
import { isCompleteNativePreview, mergeNativePreviewPatch, validateServiceProperties } from "../server/native-preview.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { Codex } from "../server/codex.js";
const scene = () => manifestSchema.parse({summary: "Native scene", instances: [
  {path: "Workspace/Courier", className: "Part", properties: {Anchored: true}},
  {path: "StarterGui/Main", className: "ScreenGui", properties: {}},
  {path: "StarterGui/Main/Title", className: "TextLabel", properties: {Text: "Лунная почта"}},
  {path: "ServerStorage/AutomationTests", className: "ModuleScript", properties: {}, source: "return {run=function() return {} end}"},
], files: [{path: "ART_DIRECTION.md", content: "Original world"}]});
test("unsupported Lighting service fields are reported together before a Studio write", () => {
 const m=manifestSchema.parse({summary:"Lighting contract",instances:[{path:"Lighting",className:"Lighting",properties:{ClockTime:14,GlobalShadows:true,ExposureCompensation:0}}]});
 assert.throws(()=>validateServiceProperties(m),/GlobalShadows, ExposureCompensation/);
 delete m.instances[0].properties.GlobalShadows;delete m.instances[0].properties.ExposureCompensation;
 assert.doesNotThrow(()=>validateServiceProperties(m));
});

test("a refusal or empty result cannot count as a prepared native scene", () => {
  assert.equal(isCompleteNativePreview(manifestSchema.parse({summary: "Not implemented", data: {complete: false}})), false);
  assert.equal(isCompleteNativePreview(manifestSchema.parse({summary: "Empty"})), false);
  assert.equal(isCompleteNativePreview(scene()), true);
});

test("a bounded native patch preserves unchanged world and files and rejects stale or foreign bases", () => {
  const base = {id: "base", projectId: "project", previewStyleId: "style", result: scene()} as Task;
  const task = {projectId: "project", previewStyleId: "style", previewBaseTaskId: "base", previewBaseHash: hash(base.result)} as Task;
  const result = manifestSchema.parse({summary: "English title", instances: [
    {path: "StarterGui/Main/Title", className: "TextLabel", properties: {Text: "Lunar Couriers"}},
  ], data: {previewPatch: {baseTaskId: "base", baseHash: task.previewBaseHash}, localization: {sourceLocaleId: "en-us", entries: []}}});
  const merged = mergeNativePreviewPatch(result, task, base);
  assert.equal(merged.instances.length, 4);
  assert.deepEqual(merged.instances[0], base.result!.instances[0]);
  assert.equal(merged.instances[2].properties.Text, "Lunar Couriers");
  assert.equal(merged.files[0].content, "Original world");
  assert.equal(merged.data.previewPatch, undefined);
  assert.equal(base.result!.instances[2].properties.Text, "Лунная почта");
  assert.throws(() => mergeNativePreviewPatch(result, {...task, previewBaseHash: "0".repeat(64)}, base), /устарела/);
  assert.throws(() => mergeNativePreviewPatch(result, task, {...base, projectId: "foreign"}), /другому стилю/);
});

test("a reviewed local correction creates a new skill-backed artifact, preserves its base and cannot target a stale source", () => {
  const root = mkdtempSync(resolve(tmpdir(), "automation-local-preview-patch-")), store = new Store(root), engine = new Engine(store, new Codex());
  try {
    const p = engine.createProject({name:"Patch fixture",genre:"Obby",goal:"English migration without replacing the world"});
    p.concept="Approved fixture";engine.save(p);engine.approve(p.id,"concept");
    const base = engine.task(p,{title:"Legacy preview",role:"art",kind:"style-preview-draft",instructions:"fixture",status:"succeeded",result:scene(),scope:["Workspace","StarterGui","ServerStorage","ReplicatedStorage","StarterPlayer"],previewStyleId:"style"});
    store.put("style",{id:"style",projectId:p.id,familyId:"roblox-classic",version:1,name:"Fixture",status:"concept",rules:{},references:[],previews:[],studioEvidence:null,previewTaskId:base.id});
    const patch=manifestSchema.parse({summary:"English title correction",instances:[{path:"StarterGui/Main/Title",className:"TextLabel",properties:{Text:"Lunar Couriers"}}]});
    assert.throws(()=>engine.patchPreparedStyle(p.id,"style",base.id,"0".repeat(64),patch,"Reviewed correction"),/устарела/);
    store.put("command",{id:"pending-fixture",projectId:p.id,status:"uncertain"});
    assert.throws(()=>engine.patchPreparedStyle(p.id,"style",base.id,hash(base.result),patch,"Reviewed correction"),/сверьте/);
    store.delete("command","pending-fixture");
    const fresh=engine.patchPreparedStyle(p.id,"style",base.id,hash(base.result),patch,"Reviewed correction to the English interface");
    assert.equal(fresh.status,"succeeded");
    assert.equal(fresh.provider,"studio");
    assert.ok(fresh.skills.some((s)=>s.id==="roblox-ui"));
    assert.equal((fresh.result!.data.localization as any).sourceLocaleId,"en-us");
    assert.equal(store.get<any>("style","style").previewTaskId,fresh.id);
    assert.equal(store.get<Task>("task",base.id)!.result!.instances[2].properties.Text,"Лунная почта");
    assert.deepEqual(fresh.result!.instances[0],base.result!.instances[0]);
    assert.equal(engine.project(p.id).approvals.style,undefined);
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test("resuming work preserves diagnostics and does not resurrect replaced previews or completed Studio failures", async () => {
  const root=mkdtempSync(resolve(tmpdir(),"automation-preview-resume-")),store=new Store(root),engine=new Engine(store,new Codex());
  try {
    const p=engine.createProject({name:"Resume fixture",genre:"Obby",goal:"Resume only current work"});
    const old=engine.task(p,{title:"Replaced",role:"art",kind:"style-preview-draft",instructions:"fixture",status:"blocked",attempt:1,error:"Old diagnostic",previewStyleId:"style"});
    const current=engine.task(p,{title:"Current",role:"art",kind:"style-preview-draft",instructions:"fixture",status:"blocked",attempt:1,error:"Current diagnostic",previewStyleId:"style"});
    const pastStudio=engine.task(p,{title:"Past test",role:"qa",kind:"manual-check",instructions:"fixture",provider:"studio",status:"failed",error:"Past failure"});
    store.put("style",{id:"style",previewTaskId:current.id});
    engine.control(p.id,"resume");
    assert.equal(store.get<Task>("task",old.id)!.status,"blocked");
    assert.equal(store.get<Task>("task",current.id)!.status,"queued");
    assert.equal(store.get<Task>("task",current.id)!.error,"Current diagnostic");
    assert.equal(store.get<Task>("task",pastStudio.id)!.status,"failed");
    assert.throws(()=>engine.retryTask(old.id),/заменён/);
    const done=store.get<Task>("task",current.id)!;done.status="succeeded";store.put("task",done);
    engine.lastPoll=Date.now();
    await engine.tick();
    assert.equal(engine.project(p.id).execution,"decision");
  }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
