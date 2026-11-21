import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync(new URL('../plugin/Automation.plugin.luau',import.meta.url),'utf8');
const body=src.slice(src.indexOf('local services='),src.indexOf('local function capture()'));
const harness=`local RealHttp=game:GetService("HttpService")
local roots={}
for _,name in ipairs({"Workspace","ReplicatedStorage","ServerScriptService","ServerStorage","StarterGui","StarterPlayer","Lighting","SoundService"}) do local f=Instance.new("Folder") f.Name=name roots[name]=f end
roots.Lighting:Destroy()
roots.Lighting={Brightness=1,ClockTime=14,Ambient=Color3.new(),OutdoorAmbient=Color3.new(),FogColor=Color3.new(),FogStart=0,FogEnd=100000,GetDescendants=function()return {}end,Destroy=function()end}
local game={GetService=function(self,n)return roots[n]end}
local Http=RealHttp
local History={TryBeginRecording=function()return nil end}
local Run={IsRunning=function()return false end}
local settings={}
local plugin={GetSetting=function(self,k)return settings[k]end,SetSetting=function(self,k,v)settings[k]=v end}
${body}
local report={}
local m={instances={{path="Workspace/World",className="Model",properties={}},{path="Workspace/World/Platform",className="Part",properties={Anchored=true,Size={type="Vector3",value={5,1,5}},Color={type="Color3",value={.2,.5,.3}}}},{path="ServerScriptService/Main",className="Script",properties={},source="print('fixture')"},{path="Lighting",className="Lighting",properties={Brightness=2}}}}
apply(m,true)
assert(roots.Workspace.World.Platform.Size.X==5 and roots.Lighting.Brightness==2)
local _,a=snapshot()
roots.Workspace.World.Platform.Size=Vector3.new(6,1,5)
local _,b=snapshot()
assert(a~=b)
report.typedProperties=true report.fingerprintDetectsEdits=true report.lightingService=true
apply(m,true)
local _,c=snapshot()
assert(a==c)
report.repeatIsIdempotent=true
apply({instances={{path="Workspace/New",className="Part",properties={Anchored=true}}}},true)
assert(not roots.Workspace:FindFirstChild("World") and not roots.ServerScriptService:FindFirstChild("Main"))
report.removesOldManagedObjects=true
local before=roots.Workspace.New
local ok=pcall(apply,{instances={{path="Workspace/Bad",className="Part",properties={NotAProperty=true}}}},true)
assert(not ok and roots.Workspace.New==before)
report.invalidPatchPreservesScene=true
for _,r in pairs(roots) do r:Destroy()end
return report`;
writeFileSync(new URL('../tests/StudioPlugin.fixture.luau',import.meta.url),harness);
