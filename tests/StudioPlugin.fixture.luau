local RealHttp=game:GetService("HttpService")
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
local services={"Workspace","ReplicatedStorage","ServerScriptService","ServerStorage","StarterGui","StarterPlayer","Lighting","SoundService"}
local props={"Anchored","CanCollide","CanTouch","CanQuery","Size","CFrame","Color","Material","Transparency","Reflectance","Shape","CastShadow","Brightness","ClockTime","Ambient","OutdoorAmbient","FogColor","FogStart","FogEnd","Enabled","Disabled","Texture","TextureID","MeshId","SoundId","Volume","Looped","Position","Rotation","BackgroundColor3","BackgroundTransparency","BorderSizePixel","Text","TextColor3","TextSize","TextScaled","TextWrapped","Font","SizeConstraint","AnchorPoint","Visible","Active","ZIndex","DisplayOrder","IgnoreGuiInset","ResetOnSpawn","CanvasSize","ScrollBarThickness","ScrollingDirection","AutomaticCanvasSize","Padding","FillDirection","SortOrder","HorizontalAlignment","VerticalAlignment","CellSize","CellPadding","CornerRadius","Thickness","ApplyStrokeMode","Image","ImageColor3","ImageTransparency","ScaleType","Value","MaxDistance","Range","Shadows","Face","TopSurface","BottomSurface"}
local function encode(v)
 local t=typeof(v)
 if t=="Vector3" then return {type=t,value={v.X,v.Y,v.Z}} end
 if t=="Vector2" then return {type=t,value={v.X,v.Y}} end
 if t=="Color3" then return {type=t,value={v.R,v.G,v.B}} end
 if t=="CFrame" then return {type=t,value={v:GetComponents()}} end
 if t=="UDim2" then return {type=t,value={v.X.Scale,v.X.Offset,v.Y.Scale,v.Y.Offset}} end
 if t=="UDim" then return {type=t,value={v.Scale,v.Offset}} end
 if t=="EnumItem" then return {type="Enum",value=string.gsub(tostring(v),"^Enum%.",""),token=v.Value} end
 if t=="string" or t=="number" or t=="boolean" then return v end
 return nil
end
local function decode(v)
 if type(v)~="table" then return v end
 local a=v.value
 if v.type=="Vector3" then return Vector3.new(table.unpack(a)) end
 if v.type=="Vector2" then return Vector2.new(table.unpack(a)) end
 if v.type=="Color3" then return Color3.new(table.unpack(a)) end
 if v.type=="CFrame" then return CFrame.new(table.unpack(a)) end
 if v.type=="UDim2" then return UDim2.new(table.unpack(a)) end
 if v.type=="UDim" then return UDim.new(table.unpack(a)) end
 if v.type=="Content" then return a end
 if v.type=="Enum" then local pieces=string.split(a,".") assert(#pieces==2,"Enum: Type.Item") return Enum[pieces[1]][pieces[2]] end
 error("Unsupported property type: "..tostring(v.type))
end
local function pathOf(i)
 local pieces={} local current=i
 while current and current~=game do table.insert(pieces,1,current.Name) current=current.Parent end
 return table.concat(pieces,"/")
end
local function stable(value)
 if type(value)~="table" then return Http:JSONEncode(value) end
 local keys={} for k in pairs(value) do table.insert(keys,k) end
 table.sort(keys,function(a,b)return tostring(a)<tostring(b)end)
 local s="{" for _,k in ipairs(keys) do s..=tostring(k)..":"..stable(value[k]).."," end
 return s.."}"
end
local function snapshot()
 local list={} local count=0
 for _,serviceName in ipairs(services) do
  if serviceName=="Lighting" then
   local service=game:GetService(serviceName) local record={path=serviceName,className=serviceName,properties={}}
   for _,key in ipairs({"Brightness","ClockTime","Ambient","OutdoorAmbient","FogColor","FogStart","FogEnd"}) do record.properties[key]=encode(service[key]) end
   table.insert(list,record)
  end
  for _,i in ipairs(game:GetService(serviceName):GetDescendants()) do
   if not i:IsA("Camera") and not i:IsA("Terrain") then
    local record={path=pathOf(i),className=i.ClassName,properties={}}
    for _,key in ipairs(props) do local ok,value=pcall(function()return i[key]end) if ok then record.properties[key]=encode(value) end end
    if i:IsA("LuaSourceContainer") then record.source=i.Source end
    table.insert(list,record) count+=1
    if count%250==0 then task.wait() end
    assert(count<=12000,"Scene exceeds snapshot limit 12000; split the project")
   end
  end
 end
 table.sort(list,function(a,b)return a.path<b.path end)
 local raw=stable(list) local h=0 for k=1,#raw do h=(h*31+string.byte(raw,k))%2147483647 end
 return list,tostring(h)..":"..tostring(#raw)
end
local function request(endpoint,body,identity)
 assert(string.match(baseUrl,"^http://127%.0%.0%.1:%d+$") or string.match(baseUrl,"^http://localhost:%d+$"),"Only loopback is allowed")
 local headers={["Content-Type"]="application/json",["x-studio-id"]=identity and identity.studioId or studioId}
 if identity or token then headers.Authorization="Bearer "..(identity and identity.token or token) end
 local r=Http:RequestAsync({Url=baseUrl..endpoint,Method="POST",Headers=headers,Body=Http:JSONEncode(body)})
 assert(r.Success,"Local service HTTP "..tostring(r.StatusCode)..": "..string.sub(r.Body,1,300))
 return Http:JSONDecode(r.Body)
end
local function find(path)
 local parts=string.split(path,"/") local current=game:GetService(parts[1])
 for k=2,#parts do current=current and current:FindFirstChild(parts[k]) end
 return current
end
local function apply(manifest,replaceAll)
 assert(not Run:IsRunning(),"Stop Play before applying a build")
 local specs=manifest.instances or {} local staged={} local serviceChanges={} local serviceBackup={} local owned=plugin:GetSetting("AutomationOwned") or {}
 local allowed={} for _,s in ipairs(services) do allowed[s]=true end
 for n,s in ipairs(specs) do
  local parts=string.split(s.path,"/") assert(allowed[parts[1]],"Invalid instance path")
  if #parts==1 then
   assert(s.path=="Lighting" and s.className=="Lighting" and not s.source,"Only Lighting service properties can be changed")
   local permit={Brightness=true,ClockTime=true,Ambient=true,OutdoorAmbient=true,FogColor=true,FogStart=true,FogEnd=true}
   for key,value in pairs(s.properties or {}) do assert(permit[key],"Unsupported service property") serviceChanges[key]=decode(value) serviceBackup[key]=game:GetService("Lighting")[key] end
   continue
  end
  if s.className=="StarterPlayerScripts" or s.className=="StarterCharacterScripts" then
   local current=find(s.path) assert(current and current.ClassName==s.className,"Missing structural container "..s.path)
   assert(not s.source,"Source is invalid for structural container")
   continue
  end
  assert(not staged[s.path],"Duplicate path "..s.path)
  local previous=find(s.path)
  local item=nil
  if previous and previous.ClassName==s.className then
   local archivable=previous.Archivable previous.Archivable=true
   local ok,copy=pcall(function()return previous:Clone()end)
   previous.Archivable=archivable
   if ok and copy then item=copy item:ClearAllChildren() item.Archivable=archivable end
  end
  if not item then item=Instance.new(s.className) end
  item.Name=parts[#parts]
  for k,v in pairs(s.properties or {}) do assert(k~="Parent" and k~="Name" and k~="Source","Reserved property") item[k]=decode(v) end
  if s.source then assert(item:IsA("LuaSourceContainer"),"Source on a non-script") item.Source=s.source end
  staged[s.path]=item
  if n%100==0 then task.wait() end
 end
 local allPaths={} for p in pairs(staged) do table.insert(allPaths,p) end table.sort(allPaths,function(a,b)return #string.split(a,"/")<#string.split(b,"/")end)
 -- Save the pre-change state outside the live tree. Restore it if any mutation fails.
 local backups={} local absent={}
 local touched={} for _,p in ipairs(allPaths) do touched[p]=true end
 if replaceAll then for _,p in ipairs(owned) do touched[p]=true end end
 local roots={} for p in pairs(touched) do local parent=string.match(p,"^(.*)/[^/]+$") local covered=false while parent do if touched[parent] then covered=true break end parent=string.match(parent,"^(.*)/[^/]+$") end if not covered then table.insert(roots,p) end end
 for _,p in ipairs(roots) do local old=find(p) if old then local was=old.Archivable old.Archivable=true backups[p]={item=old:Clone(),parent=old.Parent} old.Archivable=was else absent[p]=true end end
 local recording=History:TryBeginRecording("AutomationBuild","Мастерская: сборка")
 local createdParents={}
 local ok,err=pcall(function()
  for key,value in pairs(serviceChanges) do game:GetService("Lighting")[key]=value end
  if replaceAll then for _,p in ipairs(owned) do if not staged[p] then local old=find(p) if old then old:Destroy() end end end end
  for n,p in ipairs(allPaths) do
   local parts=string.split(p,"/") local parent=game:GetService(parts[1])
   for k=2,#parts-1 do local child=parent:FindFirstChild(parts[k]) if not child then child=Instance.new("Folder") child.Name=parts[k] child.Parent=parent table.insert(createdParents,child) end parent=child end
   local old=parent:FindFirstChild(parts[#parts]) local item=staged[p]
   -- Preserve children when a parent is also part of this incremental manifest.
   if old then for _,child in ipairs(old:GetChildren()) do child.Parent=item end old:Destroy() end
   item.Parent=parent
   if n%100==0 then task.wait() end
  end
 end)
 if not ok then
  for key,value in pairs(serviceBackup) do game:GetService("Lighting")[key]=value end
  for _,p in ipairs(roots) do local current=find(p) if current then current:Destroy() end end
  for _,backup in pairs(backups) do backup.item.Parent=backup.parent end
  for k=#createdParents,1,-1 do local i=createdParents[k] if i.Parent and #i:GetChildren()==0 then i:Destroy() end end
  if recording then History:FinishRecording(recording,Enum.FinishRecordingOperation.Cancel) end
  error(err)
 end
 if recording then History:FinishRecording(recording,Enum.FinishRecordingOperation.Commit) end
 for _,backup in pairs(backups) do backup.item:Destroy() end
 if replaceAll then owned=allPaths else local set={} for _,p in ipairs(owned) do set[p]=true end for _,p in ipairs(allPaths) do if not set[p] then table.insert(owned,p) end end end
 plugin:SetSetting("AutomationOwned",owned)
 return {applied=#allPaths}
end

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
return report