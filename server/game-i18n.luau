-- Native Roblox localization. Source strings always remain English.
local Players = game:GetService("Players")
local LocalizationService = game:GetService("LocalizationService")
local RunService = game:GetService("RunService")
assert(RunService:IsClient(), "AutomationI18n is a client module")
local player = Players.LocalPlayer
local catalog = require(script.Parent:WaitForChild("AutomationLocaleCatalog", 10))
local sourceTable = Instance.new("LocalizationTable")
sourceTable.Name = "AutomationEnglishSource"
sourceTable.SourceLocaleId = "en-us"
sourceTable:SetEntries(catalog.entries)
sourceTable.Parent = LocalizationService
local english = sourceTable:GetTranslator("en-us")
local translator = english
local bindings = {}
local roots = {}
local alive = true
local generation = 0
local I18n = {sourceLocaleId = "en-us"}

function I18n.format(key, args)
    local ok, text = pcall(function() return translator:FormatByKey(key, args or {}) end)
    if ok then return text end
    -- The local English table works offline, including an unpublished Studio place.
    return english:FormatByKey(key, args or {})
end

local function render(binding)
    if not alive or not binding.label.Parent then return end
    local args = type(binding.args) == "function" and binding.args() or binding.args or {}
    binding.label[binding.property] = binding.literal and binding.args or I18n.format(binding.key, args)
end

function I18n.set(label, key, args, property)
    assert(alive, "Localization was destroyed")
    property = property or "Text"
    assert(property == "Text" or property == "PlaceholderText", "Unsupported localized property")
    assert(not (label:IsA("TextBox") and property == "Text"), "Do not translate user input")
    local binding = bindings[label]
    if not binding then
        binding = {label = label}
        bindings[label] = binding
        binding.connection = label.Destroying:Connect(function()
            bindings[label] = nil
            binding.connection:Disconnect()
        end)
    end
    binding.key, binding.args, binding.property, binding.literal = key, args, property, false
    label:SetAttribute("LocalizationKey", key)
    label:SetAttribute("LocalizationLiteral", nil)
    label.RootLocalizationTable = sourceTable
    label.AutoLocalize = false -- already formatted by the player's native Translator
    render(binding)
end

-- Player names and other user-provided text are never sent through a Translator.
function I18n.literal(label, text, property)
    property = property or "Text"
    assert(property == "Text" or property == "PlaceholderText", "Unsupported literal property")
    if not bindings[label] then
        local binding = {label = label}
        bindings[label] = binding
        binding.connection = label.Destroying:Connect(function()
            bindings[label] = nil
            binding.connection:Disconnect()
        end)
    end
    local binding = bindings[label]
    binding.key, binding.args, binding.property, binding.literal = nil, tostring(text), property, true
    label:SetAttribute("LocalizationKey", nil)
    label:SetAttribute("LocalizationLiteral", true)
    label.AutoLocalize = false
    label.RootLocalizationTable = sourceTable
    render(binding)
end

function I18n.bind(label, key, args, property)
    I18n.set(label, key, args, property)
    local handle = {}
    function handle:refresh() if bindings[label] then render(bindings[label]) end end
    function handle:disconnect()
        local binding = bindings[label]
        if binding then binding.connection:Disconnect() bindings[label] = nil end
        if label.Parent then label:SetAttribute("LocalizationKey", nil) label:SetAttribute("LocalizationLiteral", nil) label.AutoLocalize = true end
    end
    return handle
end

function I18n.refresh()
    for _, binding in pairs(bindings) do render(binding) end
end

function I18n.audit(root)
    local errors = {}
    local count = 0
    local function inspect(object)
        if not object:IsA("GuiBase2d") then return end
        count += 1
        if object.RootLocalizationTable ~= sourceTable then
            table.insert(errors, object:GetFullName() .. ": missing source table")
        end
        local key = object:GetAttribute("LocalizationKey")
        local literal = object:GetAttribute("LocalizationLiteral") and bindings[object] and bindings[object].literal
        if not object.AutoLocalize and not (key and bindings[object]) and not literal then
            table.insert(errors, object:GetFullName() .. ": automatic localization disabled")
        end
        if not literal and (game.GameId == 0 or player.LocaleId:lower():sub(1,2) == "en") and
            (object:IsA("TextLabel") or object:IsA("TextButton") or object:IsA("TextBox")) then
            local text = object:IsA("TextBox") and object.PlaceholderText or object.Text
            for _, codepoint in utf8.codes(text) do
                if (codepoint >= 0x400 and codepoint <= 0x52f) or
                    (codepoint >= 0xe00 and codepoint <= 0xe7f) or
                    (codepoint >= 0x3040 and codepoint <= 0x9fff) then
                    table.insert(errors, object:GetFullName() .. ": non-English authored text")
                    break
                end
            end
        end
    end
    inspect(root)
    for _, object in root:GetDescendants() do inspect(object) end
    for _, entry in catalog.entries do
        local args = {}
        for name, format in entry.Source:gmatch("{([%a][%w_]*):?([%a]*)}") do
            args[name] = (format == "int" or format == "fixed" or format == "num") and 12 or "Sample"
        end
        local ok, result = pcall(function() return english:FormatByKey(entry.Key, args) end)
        if not ok or result == "" then table.insert(errors, entry.Key .. ": English formatting failed") end
    end
    if sourceTable.SourceLocaleId ~= "en-us" or #catalog.entries == 0 then
        table.insert(errors, "English source catalogue missing")
    end
    return {passed = #errors == 0, errors = errors, guiCount = count,
        sourceLocaleId = sourceTable.SourceLocaleId, entries = #catalog.entries,
        cloudTranslation = game.GameId == 0 and "unpublished-not-tested" or "requires-Creator-Hub-verification"}
end

local function configureObject(object)
    if object:IsA("GuiBase2d") then
        object.RootLocalizationTable = sourceTable
        object.AutoLocalize = bindings[object] == nil
        if object:IsA("LayerCollector") then
            object:SetAttribute("SourceLocaleId", "en-us")
            object:SetAttribute("LocalizationProvider", "Roblox")
        end
    end
end

function I18n.configure(root)
    if roots[root] then return end
    configureObject(root)
    for _, object in root:GetDescendants() do configureObject(object) end
    local added = root.DescendantAdded:Connect(configureObject)
    local destroyed
    destroyed = root.Destroying:Connect(function()
        added:Disconnect()
        destroyed:Disconnect()
        roots[root] = nil
    end)
    roots[root] = {added, destroyed}
end

local function updateTranslator()
    generation += 1
    local current = generation
    translator = english
    I18n.refresh()
    if game.GameId == 0 then return end
    task.spawn(function()
        local ok, result = pcall(function()
            return LocalizationService:GetTranslatorForPlayerAsync(player)
        end)
        if not alive or current ~= generation then return end
        if ok then translator = result I18n.refresh() end
    end)
end
local localeConnection = player:GetPropertyChangedSignal("LocaleId"):Connect(updateTranslator)
function I18n.destroy()
    if not alive then return end
    alive = false
    generation += 1
    localeConnection:Disconnect()
    for _, binding in pairs(bindings) do binding.connection:Disconnect() end
    for _, connections in pairs(roots) do for _, connection in connections do connection:Disconnect() end end
    table.clear(bindings)
    table.clear(roots)
    sourceTable:Destroy()
end
script.Destroying:Connect(I18n.destroy)
updateTranslator()
return I18n
