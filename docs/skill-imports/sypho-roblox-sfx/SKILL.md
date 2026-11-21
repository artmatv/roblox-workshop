---
name: sypho-roblox-sfx
description: Find sound candidates through workshop, verify in Studio, then emit an offline sound bank.
---

# Звуки Roblox: поиск, измерение и сборка банка

# Адаптация SyphoDev для мастерской

Выборочная адаптация исходного навыка для Roblox Automation. Точная неизменённая upstream-версия находится в UPSTREAM.md. Исходники в resources/ являются справочными; запускать их только в workspace активной native-задачи с отключённой сетью.

## Граница изменений

Изменять игру может только агент действительно запущенной задачи мастерской и только через её контролируемые инструменты. Соблюдать очередь, утверждённые стиль, механики и данные проекта. Не обходить очередь, не публиковать автоматически и не выполнять платежи. В одном проекте должен быть один Studio writer. Не использовать .claude/, Claude agents/orchestrators, LOCAL.md, model roster, sessions, отдельные очереди, установщики или внешние генераторы, Cloudflare, Kaggle, Pollinations и их ключи.

Офлайн Python запускать только внутри workspace активной native-задачи с отключённой сетью. Изменения сцены и проверки в Studio выполнять только через контролируемые workshop MCP вызовы этой задачи. Не запускать произвольные Studio команды из shell.

## Sound workflow

For planning/spec tasks without bound Studio, record sound requirements and unverified assumptions only. In the active native task, search candidates through controlled workshop.search_sfx(query, limit); its compact results are the source of candidate IDs and metadata.

Before running offline helpers, normalize the tool result to the shape expected by emit_probe.py and pick.py: {name, roles:[{role, query, kind, min_len, max_len, volume, looped, candidates:[{id, name, creator, audioType, score, listed_duration}]}]}. Map each task role's query and constraints from the approved sound spec. Convert string IDs only when they are safe positive integers. If search_sfx supplies no score, set score to negative array rank solely to preserve stable order; do not present that as a relevance or quality score. Keep listed_duration as a listing claim, never as a measured duration.

Offline commands in the active task workspace: python resources/scripts/emit_probe.py <candidates.json> --out <workspace-probes>; use its generated Luau only as a starting point. It targets SoundService.SFXProbe and clears that folder, so do not execute it unchanged. Adapt a task-owned copy to use a unique __SyphoSkillProbe_<task-id> folder, create it only if absent, never clear or alter existing SFXProbe, and include only the bounded candidate IDs. Run each measurement in a separate controlled workshop MCP execute_luau call. Record one CSV row per result as role,id,loaded,length using actual IsLoaded and Sound.TimeLength: python resources/scripts/pick.py <candidates.json> <report.csv> --out <manifest.json>.

Then run python resources/scripts/emit_bank.py <manifest.json> --out <workspace-bank>. It may create install.lua as an output file; do not execute or submit that file unless a separate task explicitly authorizes installation. Listen to selected sounds in Studio in a separate controlled step. Never call upstream find_sfx.py or use network search from shell.
