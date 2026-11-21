# English UI and Roblox localization

User requirement, 2 November 2026: all game interfaces start in English and include Roblox automatic localization. This applies to every project and development role. The local workshop dashboard remains Russian.

The service passes this requirement on every new or resumed agent turn. English source strings, native `AutoLocalize`, a source catalogue and an executable `localization` check are mandatory. QA also loads the reviewed Roblox UI and game UI/UX skills automatically. Old Russian previews do not establish compliance with this requirement.

Static GUI text is authored in English in editable instance properties. The service enables `AutoLocalize` on GUI ancestors and generates a client-side `LocalizationTable` with `SourceLocaleId="en-us"`. It exports `localization/en-us.csv` with keys, sources, contexts and examples. Do not put text into images. Leave space for longer translations on both layouts.

Dynamic UI uses complete messages and named parameters. For example, catalogue key `hud.parcels`, source `Parcels: {count:int} / {total:int}`; client call `I18n.set(label, "hud.parcels", {count=delivered, total=required})`. The injected `ReplicatedStorage/AutomationI18n` uses a native player Translator, refreshes bindings after player locale changes and immediately supplies English from the local source table while cloud lookup is pending or unavailable. Use `I18n.literal` for player names; TextBox user input is not translated. Destroying the localization module disconnects its event handlers.

Production merges catalogues from all roles and rejects conflicting keys. Native previews and final builds receive the same integration. Non-English authored properties, a different source locale and malformed parameter names are rejected before applying a scene. `I18n.audit` measures actual client GUI configuration and English formatting; a missing or failed runtime localization check prevents style acceptance. Source validation alone cannot prove that every runtime path has correct wording, so the four screens must also be inspected visually.

Dynamic bindings deliberately set `AutoLocalize=false` on the formatted label to avoid translating twice. Their ancestors keep `AutoLocalize=true`; the native audit recognizes the registered binding. Do not reject a correctly bound dynamic label simply because this one property is false. Player-name literals have an explicit separate binding.

## Published experience configuration

The place used for native previews is unpublished (`GameId=0`). Cloud machine translation has not been enabled or verified there. The following setup belongs to the target published experience:

1. In Creator Hub → Localization, set the experience source language to English (`en-us`). This is an experience setting; changing `LocalizationService.RobloxLocaleId` is not a source-language setting.
2. Enable capture of text from experience UI and use of translated content. Add the desired target languages for experience strings/products. Confirm any Roblox translation quota before enabling paid capacity; the workshop does not purchase it automatically.
3. Import the generated English CSV, retaining stable keys and parameter names. Review translations and text expansion for static and dynamic strings. Capture alone does not replace keyed dynamic message entries.
4. Test with an account using a supported target locale, including a locale change and unavailable-translator fallback. Record the experience, build, language, date and evidence. A Studio fixture containing a known French string only verifies native formatting; it does not prove cloud translation.

Primary Roblox documentation checked on 2 November 2026:

- [Automatic translations](https://create.roblox.com/docs/production/localization/automatic-translations)
- [Translate dynamic content](https://create.roblox.com/docs/production/localization/translate-dynamic-content)
- [Localize with scripting](https://create.roblox.com/docs/production/localization/localize-with-scripting)
- [LocalizationTable](https://create.roblox.com/docs/reference/engine/classes/LocalizationTable)
- [GuiBase2d.AutoLocalize](https://create.roblox.com/docs/reference/engine/classes/GuiBase2d#AutoLocalize)
