-- Мастерская Roblox · plugin protocol 1 · no credentials for cloud providers.
local Http = game:GetService("HttpService")
local History = game:GetService("ChangeHistoryService")
local Run = game:GetService("RunService")
if Run:IsRunning() then return end
local Logs = game:GetService("LogService")
local StudioTest = game:GetService("StudioTestService")
local ScriptEditor = game:GetService("ScriptEditorService")
local studioId = Http:GenerateGUID(false)
local documentId=workspace:GetAttribute("AutomationDocumentId") or game:GetAttribute("AutomationDocumentId") or Http:GenerateGUID(false)
local settingsKey = "Automation_"..documentId
local saved = plugin:GetSetting(settingsKey) or {}
local baseUrl = plugin:GetSetting("AutomationUrl") or "http://127.0.0.1:4317"
local token = nil
local revision = 0
local projectId = nil
local stopped = not saved.credentials or saved.stopped==true
local unloading = false
local busy = false
local function saveState(pending, credentials)
 local stored=plugin:GetSetting(settingsKey) or {}
 stored.pending=pending
 if credentials then stored.credentials=credentials end
 stored.stopped=stopped
 plugin:SetSetting(settingsKey,stored)
end
local output = {}
local logConnection=Logs.MessageOut:Connect(function(message, messageType)
 table.insert(output, {message=string.sub(message,1,2000), kind=tostring(messageType)})
 if #output > 150 then table.remove(output,1) end
end)
local toolbar = plugin:CreateToolbar("Мастерская")
local button = toolbar:CreateButton("Automation", "Мастерская Roblox", "rbxassetid://4458901886")
local widget = plugin:CreateDockWidgetPluginGui("AutomationStudioV1", DockWidgetPluginGuiInfo.new(Enum.InitialDockState.Right, false, false, 330, 410, 290, 350))
widget.Title = "Мастерская Roblox"
local panel=Instance.new("ScrollingFrame") panel.Size=UDim2.fromScale(1,1) panel.CanvasSize=UDim2.fromOffset(0,425) panel.ScrollBarThickness=6 panel.ScrollingDirection=Enum.ScrollingDirection.Y panel.BackgroundColor3=Color3.fromRGB(242,245,237) panel.Parent=widget
local function text(class, name, y, h, label)
 local i=Instance.new(class) i.Name=name i.Position=UDim2.fromOffset(18,y) i.Size=UDim2.new(1,-36,0,h) i.BackgroundColor3=Color3.fromRGB(255,255,255) i.BorderSizePixel=0 i.TextColor3=Color3.fromRGB(49,82,57) i.Font=Enum.Font.Gotham i.TextSize=13 i.Text=label i.Parent=panel
 local corner=Instance.new("UICorner") corner.CornerRadius=UDim.new(0,6) corner.Parent=i
 return i
end
local title=text("TextLabel","Title",15,38,"Мастерская · локальный мост") title.BackgroundTransparency=1 title.Font=Enum.Font.GothamBold
local url=text("TextBox","Url",64,36,baseUrl) url.ClearTextOnFocus=false
local code=text("TextBox","Code",109,36,"") code.PlaceholderText="Код подключения из дашборда" code.ClearTextOnFocus=false
local connect=text("TextButton","Connect",154,36,"Подключить")
local resume=text("TextButton","Resume",199,36,"Продолжить соединение")
local stop=text("TextButton","Stop",244,36,"Остановить") stop.BackgroundColor3=Color3.fromRGB(232,221,201)
local state=text("TextLabel","Status",290,78,"Остановлено. Подключите дашборд и выберите проект.") state.BackgroundTransparency=1 state.TextWrapped=true state.TextSize=11
local note=text("TextLabel","Note",371,35,"Публикация доступна только в дашборде") note.BackgroundTransparency=1 note.TextSize=10
button.Click:Connect(function()widget.Enabled=not widget.Enabled end)
local services={"Workspace","ReplicatedStorage","ServerScriptService","ServerStorage","StarterGui","StarterPlayer","Lighting","SoundService"}
local props={"Anchored","CanCollide","CanTouch","CanQuery","Size","CFrame","Color","Material","Transparency","Reflectance","Shape","CastShadow","Brightness","ClockTime","Ambient","OutdoorAmbient","FogColor","FogStart","FogEnd","Enabled","Disabled","Texture","TextureID","MeshId","SoundId","Volume","Looped","Position","Rotation","BackgroundColor3","BackgroundTransparency","BorderSizePixel","Text","TextColor3","TextSize","TextScaled","TextWrapped","Font","SizeConstraint","AnchorPoint","Visible","Active","ZIndex","DisplayOrder","IgnoreGuiInset","ResetOnSpawn","CanvasSize","ScrollBarThickness","ScrollingDirection","AutomaticCanvasSize","Padding","FillDirection","SortOrder","HorizontalAlignment","VerticalAlignment","CellSize","CellPadding","CornerRadius","Thickness","ApplyStrokeMode","Image","ImageColor3","ImageTransparency","ScaleType","Value","MaxDistance","Range","Shadows","Face","TopSurface","BottomSurface"}
for _,key in ipairs({"ScreenInsets","SafeAreaCompatibility","ClipToDeviceSafeArea","AutomaticSize","TextXAlignment","TextYAlignment","TextTransparency","TextStrokeTransparency","RichText","TextTruncate","LayoutOrder","MinSize","MaxSize","MinTextSize","MaxTextSize","PaddingLeft","PaddingRight","PaddingTop","PaddingBottom","Selectable","SelectionGroup","SelectionBehaviorUp","SelectionBehaviorDown","SelectionBehaviorLeft","SelectionBehaviorRight","Intensity","Threshold","Contrast","Saturation","TintColor","Density","Offset","Haze","Glare","Decay","FarIntensity","NearIntensity","FocusDistance","InFocusRadius"}) do table.insert(props,key) end
table.insert(props,"ModelStreamingMode")
table.insert(props,"AutoLocalize")
table.insert(props,"PlaceholderText")
for _,key in ipairs({"ClipsDescendants","AutoButtonColor","LineHeight","TextStrokeColor3","ScrollBarImageColor3","ScrollBarImageTransparency","Scale"}) do table.insert(props,key) end
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
    for _,key in ipairs(props) do
     if key~="AutoLocalize" or i:IsA("GuiBase2d") then
      local ok,value=pcall(function()return i[key]end)
      if ok then record.properties[key]=encode(value) end
     end
    end
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
 local specs=manifest.instances or {} local staged={} local serviceChanges={} local serviceBackup={} local owned=plugin:GetSetting((settingsKey or "AutomationFixture").."_Owned") or {}
 local allowed={} for _,s in ipairs(services) do allowed[s]=true end
 for n,s in ipairs(specs) do
  local parts=string.split(s.path,"/") assert(allowed[parts[1]],"Invalid instance path")
  if #parts==1 then
   assert(s.path=="Lighting" and s.className=="Lighting" and not s.source,"Only Lighting service properties can be changed")
   local permit={Brightness=true,ClockTime=true,Ambient=true,OutdoorAmbient=true,FogColor=true,FogStart=true,FogEnd=true}
   for key,value in pairs(s.properties or {}) do assert(permit[key],"Unsupported service property: Lighting."..key) serviceChanges[key]=decode(value) serviceBackup[key]=game:GetService("Lighting")[key] end
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
 plugin:SetSetting((settingsKey or "AutomationFixture").."_Owned",owned)
 return {applied=#allPaths}
end
local function capture()
 local captureService=game:GetService("StudioCaptureService")
 if not captureService:CanCaptureScreenshot() then assert(captureService:RequestScreenshotPermissionAsync(),"Screenshot permission denied") end
 local image=captureService:CaptureScreenshot({Format=Enum.StudioCaptureScreenshotFormat.PNG,UICaptureMode=Enum.UICaptureMode.All})
 local start=os.clock() repeat task.wait(.1) until tostring(image.BufferStatus):find("Ready") or tostring(image.BufferStatus):find("Complete") or os.clock()-start>20
 local data=image:GetBuffer() assert(data,"Screenshot buffer is unavailable")
 local alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
 local raw=buffer.tostring(data)
 local parts={} for k=1,#raw,3 do local a,b,c=string.byte(raw,k,k+2) local n=a*65536+(b or 0)*256+(c or 0) local i1=math.floor(n/262144)%64+1 local i2=math.floor(n/4096)%64+1 local i3=math.floor(n/64)%64+1 local i4=n%64+1 table.insert(parts,string.sub(alphabet,i1,i1)..string.sub(alphabet,i2,i2)..(b and string.sub(alphabet,i3,i3) or '=')..(c and string.sub(alphabet,i4,i4) or '=')) if k%30000==1 then task.wait() end end
 return {imageBase64=table.concat(parts),width=image.Resolution.X,height=image.Resolution.Y}
end
local function test(command)
 assert(not Run:IsRunning(),"Stop Play before testing")
 local suiteBackup=nil
 local suite=game:GetService("ServerStorage"):FindFirstChild("AutomationTests")
 if command.payload.suiteSource then
  if suite then suiteBackup=suite:Clone() suite:Destroy() end
  suite=Instance.new("ModuleScript") suite.Name="AutomationTests" suite.Source=command.payload.suiteSource suite.Parent=game:GetService("ServerStorage")
 end
 local runner=Instance.new("Script") runner.Name="AutomationTestRunner"
 runner.Source=[[
  local RunService=game:GetService("RunService") if not RunService:IsStudio() then return end
  local ST=game:GetService("StudioTestService") local args=ST:GetTestArgs()
  for _=1,50 do if args~=nil then break end task.wait(.1) args=ST:GetTestArgs() end
  if type(args)~="table" or not args.automation then return end
  local ended=false
  local function finish(result) if not ended then ended=true ST:EndTest(result) end end
  task.delay(90,function()finish({checks={},findings={{severity="blocker",message="Test timeout (90s)"}}})end)
  local ok,result=pcall(function()
   local Players=game:GetService("Players") local deadline=os.clock()+25
   repeat if #Players:GetPlayers()>=(args.players or 1) then break end task.wait(.1) until os.clock()>=deadline
   assert(#Players:GetPlayers()>=(args.players or 1),"Player join timeout (25s)")
   local suite=game:GetService("ServerStorage"):FindFirstChild("AutomationTests")
   assert(suite and suite:IsA("ModuleScript"),"QA ModuleScript ServerStorage/AutomationTests missing")
   local module=require(suite) assert(type(module.run)=="function","QA module needs run(args)")
   return module.run(args)
  end)
  finish(ok and result or {checks={},findings={{severity="blocker",message=tostring(result)}}})
 ]]
 runner.Parent=game:GetService("ServerScriptService")
 local ok,result=pcall(function()
  local args={automation=true,checks=command.payload.checks,commandId=command.id,device=command.payload.device,players=command.payload.players or 1}
  if (command.payload.players or 1)>1 then return StudioTest:ExecuteMultiplayerTestAsync(command.payload.players,args) end
  return StudioTest:ExecutePlayModeAsync(args)
 end)
 runner:Destroy() if command.payload.suiteSource then if suite then suite:Destroy() end if suiteBackup then suiteBackup.Parent=game:GetService("ServerStorage") end end assert(ok,result) assert(type(result)=="table","Test returned no structured result") return result
end
local function execute(command)
 assert(command.studioId==studioId,"Wrong Studio")
 assert(command.projectId==projectId,"Wrong project")
 assert(command.baseRevision==revision,"Version mismatch")
 local _,fingerprint=snapshot()
 if command.operation~="snapshot" then assert(command.expectedFingerprint==fingerprint,"Unexpected Studio edits. Snapshot and resolve conflict before applying.") end
 if command.operation=="snapshot" then local instances,fp=snapshot() return {instances=instances,fingerprint=fp} end
 if command.operation=="apply" or command.operation=="restore" then
  local result=apply(command.payload.manifest,not command.payload.qaOnly)
  if command.payload.styleReset then plugin:SetSetting((settingsKey or "AutomationFixture").."_Owned",{}) end
  return result
 end
 if command.operation=="test" then
  local simulator=game:GetService("StudioDeviceSimulatorService")
  local previousDevice=simulator:GetDeviceAsync()
  local previousOrientation=simulator:GetOrientationAsync()
  local previousResolution,previousDensity
  if previousDevice and previousDevice~="default" then
   previousResolution=simulator:GetResolutionAsync()
   previousDensity=simulator:GetPixelDensityAsync()
  end
  local temporaryDevices={}
  local results={checks={},findings={}}
  local devices={{width=1366,height=768,name="desktop"},{width=390,height=844,name="mobile"}}
  local ok,err=pcall(function()
   for _,device in ipairs(devices) do
    local custom=simulator:CreateDeviceAsync({Name="Automation "..string.sub(command.id,1,8).." "..device.name,Width=math.max(device.width,device.height),Height=math.min(device.width,device.height),PixelDensity=96,DeviceForm=device.name=="mobile" and Enum.DeviceForm.Phone or Enum.DeviceForm.Desktop})
    table.insert(temporaryDevices,custom)
    simulator:SetDeviceAsync(custom) task.wait(.2)
    if device.name=="mobile" then simulator:SetOrientationAsync(Enum.ScreenOrientation.Portrait) task.wait(.2) end
    simulator:SetResolutionAsync(math.max(device.width,device.height),math.min(device.width,device.height))
    task.wait(.2)
    command.payload.device=device
    local result=test(command)
    for _,required in ipairs(command.payload.checks or {}) do
     local found=false
     for _,check in ipairs(result.checks or {}) do if check.id==required then found=true break end end
     if not found then
      result.checks=result.checks or {}
      table.insert(result.checks,{id=required,name=required,status="failed",evidence="Required check missing on "..device.name})
     end
    end
    for _,check in ipairs(result.checks or {}) do if type(check.evidence)=="table" then check.evidence=Http:JSONEncode(check.evidence) end check.device=device.name table.insert(results.checks,check) end
    for _,finding in ipairs(result.findings or {}) do table.insert(results.findings,finding) end
   end
  end)
  -- Orientation persists across devices; restore it while the last mobile device is active.
  pcall(function()simulator:SetOrientationAsync(previousOrientation) task.wait(.2)end)
  pcall(function()
   if previousDevice and previousDevice~="default" then
    simulator:SetDeviceAsync(previousDevice) task.wait(.2)
    if previousResolution then simulator:SetResolutionAsync(previousResolution.X,previousResolution.Y) task.wait(.2) end
    if previousDensity then simulator:SetPixelDensityAsync(previousDensity) task.wait(.2) end
   else simulator:StopSimulationAsync() end
  end)
  for _,custom in ipairs(temporaryDevices) do pcall(function()simulator:RemoveDeviceAsync(custom)end) end
  assert(ok,err)
  local merged={} for _,check in ipairs(results.checks) do local old=merged[check.id] if not old then merged[check.id]=check else if check.status~="passed" then old.status=check.status end old.evidence=(old.evidence or "").."; "..(check.device or "")..": "..(check.evidence or "") end end
  results.checks={} for _,check in pairs(merged) do table.insert(results.checks,check) end
  return results
 end
 if command.operation=="capture" then return capture() end
 if command.operation=="import" then
  local assetId=tonumber(command.payload.assetId) assert(assetId and assetId>0,"assetId is required")
  local model=game:GetService("InsertService"):LoadAsset(assetId)
  -- Imported scripts never execute implicitly.
  for _,child in ipairs(model:GetDescendants()) do if child:IsA("LuaSourceContainer") then child:Destroy() end end
  model.Name="Imported_"..tostring(assetId) model.Parent=game:GetService("Workspace")
  return {assetId=assetId,status="imported",moderation="not_verified",experiencePermission="not_verified"}
 end
 error("Unsupported operation")
end
local function pair(pairCode, serviceUrl)
  baseUrl=serviceUrl local _,fp=snapshot()
  local result=request("/bridge/pair",{code=pairCode,studioId=studioId,documentId=documentId,name=game.Name,placeId=tostring(game.PlaceId),universeId=tostring(game.GameId),fingerprint=fp,capabilities={"snapshot","apply","test","capture","import"}})
  token=result.token plugin:SetSetting("AutomationToken",token) plugin:SetSetting("AutomationUrl",baseUrl) stopped=false code.Text="" state.Text="Подключено. Выберите эту Studio в дашборде."
  game:SetAttribute("AutomationDocumentId",documentId)
  workspace:SetAttribute("AutomationDocumentId",documentId)
  saveState(nil,{studioId=studioId,token=token})
  return studioId
end
connect.MouseButton1Click:Connect(function()
 local ok,err=pcall(pair,code.Text,url.Text)
 if not ok then state.Text=tostring(err) end
end)
local reconnecting = false
-- Keeps trying until the service answers: Studio may be opened before the
-- service starts. Only «Остановить» or a new pairing code ends the attempts.
local function reconnect()
 local current=plugin:GetSetting(settingsKey) or {}
 if not current.credentials or reconnecting then return false end
 local previous=current.credentials
 reconnecting=true
 local attempt=0
 while not (unloading or stopped or token) do
  attempt+=1
  local ok,result=pcall(function()
   if current.pending then request("/bridge/result",current.pending.response,current.pending) current.pending=nil saveState(nil) end
   return request("/bridge/resume",{studioId=studioId,documentId=documentId,name=game.Name,placeId=tostring(game.PlaceId),universeId=tostring(game.GameId),capabilities={"snapshot","apply","test","capture","import"}},previous)
  end)
  if ok and not (unloading or stopped or token) then game:SetAttribute("AutomationDocumentId",documentId) workspace:SetAttribute("AutomationDocumentId",documentId) token=result.token projectId=result.projectId revision=result.revision or 0 saveState(nil,{studioId=studioId,token=token}) state.Text="Подключение восстановлено" reconnecting=false return true end
  if not ok then state.Text="Восстановление (попытка "..tostring(attempt).."): "..string.sub(tostring(result),1,160) end
  task.wait(attempt<=8 and 5 or 15)
 end
 reconnecting=false return false
end
resume.MouseButton1Click:Connect(function()stopped=false state.Text="Соединение возобновляется…" saveState((plugin:GetSetting(settingsKey) or {}).pending) if not token then task.spawn(reconnect) end end)
stop.MouseButton1Click:Connect(function()stopped=true saveState((plugin:GetSetting(settingsKey) or {}).pending) state.Text="Остановлено. Новые изменения не применяются." task.spawn(function()pcall(request,"/bridge/stop",{})end)end)
local function shutdown()
 if unloading then return end
 unloading=true stopped=true logConnection:Disconnect()
 widget:Destroy() button:Destroy() toolbar:Destroy()
end
plugin.Unloading:Connect(shutdown)
plugin.Destroying:Connect(shutdown)
if saved.credentials and not stopped then task.spawn(reconnect) end
task.spawn(function()
 while not unloading do
  if token and not stopped and not busy then
   busy=true
   local ok,err=pcall(function()
    local savedState=plugin:GetSetting(settingsKey) or {}
    local pending=savedState.pending
    if pending then request("/bridge/result",pending.response,pending) saveState(nil) end
    local playing=not StudioTest.EditModeActive
    local poll=request("/bridge/poll",{stopped=stopped,playing=playing})
    if projectId~=poll.projectId or revision~=(poll.revision or 0) then
     projectId=poll.projectId revision=poll.revision or 0
     plugin:SetSetting("AutomationProjectId",projectId or "") plugin:SetSetting("AutomationRevision",revision)
    end
    if playing then state.Text="Игра запущена. Подключение активно; команды ждут остановки Play." return end
    local command=poll.command
    if command then
     table.clear(output)
     state.Text="Задание: "..command.operation.." · v"..tostring(command.targetRevision)
     local applied,result=pcall(execute,command)
     local response=applied and result or {error=tostring(result)} response.ok=applied response.commandId=command.id response.projectId=command.projectId response.baseRevision=command.baseRevision response.logs=output
     local _,fp=snapshot() response.fingerprint=fp
     if applied and (command.operation=="apply" or command.operation=="restore") then revision=command.targetRevision plugin:SetSetting("AutomationRevision",revision) end
     -- Persist before sending: on reconnect this same outcome is sent again, never the operation.
     saveState({response=response,studioId=studioId,token=token})
     request("/bridge/result",response) saveState(nil)
     state.Text=applied and ("Готово · v"..tostring(revision)) or tostring(result)
    else state.Text=projectId and ("Подключено · v"..tostring(revision).." · ожидаю задачи") or "Выберите проект в дашборде" end
   end)
   if not ok then state.Text=string.sub(tostring(err),1,300) end
   busy=false
  end
  task.wait(2)
 end
end)
