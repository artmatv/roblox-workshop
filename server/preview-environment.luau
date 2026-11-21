-- Automation preview environment: hide unrelated baseline geometry on this client only.
local baseline={__BASELINE_PATHS__}
local partState=setmetatable({},{__mode='k'})
local decalState=setmetatable({},{__mode='k'})
local characterParts=setmetatable({},{__mode='k'})
local forceFieldState=setmetatable({},{__mode='k'})
local player=game:GetService('Players').LocalPlayer
local character=player.Character
local Run=game:GetService('RunService')
local renderName='AutomationPreviewEnvironment'
local function isCharacter(instance) return character and instance:IsDescendantOf(character) end
local function pathOf(instance)
 local parts={}
 while instance and instance~=game do table.insert(parts,1,instance.Name); instance=instance.Parent end
 return table.concat(parts,'/')
end
local function hide(instance)
 if instance:IsA('ForceField') and isCharacter(instance) then
  if forceFieldState[instance]==nil then forceFieldState[instance]=instance.Visible end
  instance.Visible=false
  return
 end
 if instance:IsA('BasePart') and (baseline[pathOf(instance)] or isCharacter(instance)) then
  if partState[instance]==nil then partState[instance]=instance.LocalTransparencyModifier end
  instance.LocalTransparencyModifier=1
  if isCharacter(instance) then characterParts[instance]=true end
  for _,child in ipairs(instance:GetDescendants()) do
   if child:IsA('Decal') or child:IsA('Texture') then
    if decalState[child]==nil then decalState[child]=child.Transparency end
    child.Transparency=1
   end
  end
 elseif (instance:IsA('Decal') or instance:IsA('Texture')) and instance.Parent and (baseline[pathOf(instance.Parent)] or isCharacter(instance)) then
  if decalState[instance]==nil then decalState[instance]=instance.Transparency end
  instance.Transparency=1
 end
end
local added=workspace.DescendantAdded:Connect(hide)
local characterAdded=player.CharacterAdded:Connect(function(model)
 character=model
 for _,instance in ipairs(model:GetDescendants()) do hide(instance) end
end)
for _,instance in ipairs(workspace:GetDescendants()) do hide(instance) end
Run:BindToRenderStep(renderName,Enum.RenderPriority.Camera.Value+3,function()
 for part in pairs(characterParts) do if part.Parent and part.LocalTransparencyModifier~=1 then part.LocalTransparencyModifier=1 end end
end)
script.Destroying:Connect(function()
 added:Disconnect()
 characterAdded:Disconnect()
 Run:UnbindFromRenderStep(renderName)
 for part,value in pairs(partState) do if part.Parent then part.LocalTransparencyModifier=value end end
 for decal,value in pairs(decalState) do if decal.Parent then decal.Transparency=value end end
 for field,value in pairs(forceFieldState) do if field.Parent then field.Visible=value end end
end)
