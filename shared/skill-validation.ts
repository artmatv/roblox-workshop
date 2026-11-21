export const SKILL_VALIDATION_PROFILE = "sypho-skills" as const;

export const SKILL_VALIDATION_CHECKS = [
  "runtime-imports",
  "map-selftest",
  "terrain-selftest",
  "unreachable-check",
  "sfx-search",
  "sfx-probe",
  "sfx-cleanup",
  "sfx-bank",
  "ui-selftest",
  "touch-fit-positive",
  "touch-fit-negative",
  "labels-positive",
  "labels-negative",
  "hud-desktop-mobile",
  "five-captures",
  "scene-preserved",
] as const;

export const SKILL_VALIDATION_PROMPT = `Проведи ограниченную диагностику закреплённых навыков Sypho на существующей игре. Это только проверка инструментов и текущей сцены. Не исправляй и не сохраняй игровые изменения; не создавай новые арт-ассеты; не публикуй игру и не выполняй покупки. Не подключай новые платные сервисы. Существующая независимая проверка остаётся под контролем мастерской и её бюджета. Не изменяй входные ресурсы навыков, fixtures или outputs предыдущих задач.

Сначала прочитай skills/ACTIVE.json. Для каждого навыка используй только instructionPath и root, указанные в ACTIVE. Для содержимого ресурсов бери фактические files[].path из записи пакета и разрешай их относительно указанного root; не подменяй фактический путь полем 'storedPath' и не делай вывод о содержимом по одному manifest-полю. При фиксации хешей учитывай фактические файлы по этим путям и соответствующие им manifest hashes. Не угадывай корни. Для verify_map.py сразу выполни selftest один раз без --help (этот скрипт игнорирует --help и запускает весь selftest из 11 случаев). Для checks_terrain.py выполни --selftest один раз; его --help выводит doc. У остальных argparse CLI при необходимости смотри --help или документацию. Если точная команда уже дана здесь или в прочитанной инструкции, не запускай её повторно только ради справки. Сохраняй отчёты/fixtures только в своей папке reports/sypho-<текущий taskId>/; не записывай их рядом с общими исходниками.

Все команды, включая офлайн Python-команды, их exit codes, версии библиотек и пути roots занеси в отчёт. Не устанавливай пакеты, не запускай pip, не включай сеть и не обращайся к пользовательскому Python site-packages.

1. Проверь Python runtime: импортируй numpy, scipy и PIL.Image; зафиксируй фактические версии и пути импорта. Требуемые версии: NumPy 2.4.3, SciPy 1.18.1, Pillow 10.4.0. Успешный runtime-imports gate требует совпадения всех трёх.
2. Выполни map verify_map selftest и checks_terrain selftest. Проведи map prove/plan для минимального spec и одного заведомо недостижимого варианта; отчетливо покажи FAIL на недостижимой проверке. Офлайн создай PNG плана и выполни emit.py minimal --lua в файл внутри reports только как генерацию. Не запускай и не применяй полученный Luau. Офлайн proof не доказывает физику игры.
3. Вызови workshop.search_sfx({query:'ui click',limit:3}). Сохрани кандидатов в согласованной схеме: {name,roles:[{role:'ui_click',query,min_len:0.01,max_len:10,volume:0.2,looped:false,candidates:[{id:integer,name,creator,audioType:'SoundEffect',score:числовой rank-derived,listed_duration}]}]}. В Edit mode вызови только fixed tool workshop.validation_control({action:'before'}) для исходного scene/device snapshot. Затем перейди в Play обычным workshop start_stop_play. Сначала вызови workshop.probe_sfx({action:'create',ids:[...]}) с 1–3 уникальными positive safe integer IDs, выбранными только из успешного поиска. Вызови workshop.probe_sfx({action:'measure'}) отдельно и сохрани фактические measurements в reports CSV role,id,loaded,length. Измеряй только созданные для этой задачи sounds. Вызови workshop.probe_sfx({action:'play'}); fixed tool сам воспроизводит первый созданный измеренный ID. Человеческое прослушивание остаётся humanListening:'not_run'. Затем workshop.probe_sfx({action:'cleanup'}) удаляет только уникальную папку SoundService.__SyphoSkillProbe_<taskId-fragment>; проверь returned removed/remaining. Никаких execute_luau вызовов или собственных JSON markers для SFX/scene не делай: fixed host tools сами проверяют taskId, attempt, реальные search IDs, измерения, scene fingerprint и device state. Не допускай подмены результата константами или нарисованным JSON. Не запускай emit_probe.py upstream: он очищает фиксированный SoundService.SFXProbe. Не запускай install.lua/tour.lua и не меняй SFXProbe, SoundService.SFX или исходные звуки. До остановки Play сохрани четыре свежих кадра world-desktop, hud-desktop, shop-desktop, collection-desktop. Для shop/collection сначала изучи реальное дерево и скрипт интерфейса в Client DataModel, прочитай UI controls и controller input bindings, а также schema screen_capture; найди реальные button instances и их полные пути. Открой каждую панель через предусмотренный интерфейсом input: используй существующую клавишу контроллера, если она явно описана, или нажми на найденный button instance обычным UI interaction tool. Не угадывай координаты и не запускай Luau. Визуально проверь, что нужная shop/collection панель раскрыта, и только потом записывай кадр с соответствующим capture_id. HUD нельзя обозначать кадром shop или collection. Если ошибся с кадром, разрешён ровно один дополнительный desktop Play-проход только для пересъёмки недостающих панелей; повторно открой и проверь их до screen_capture. После очистки останови Play через start_stop_play.
   Для offline bank запусти pick.py по candidates.json и измеренному CSV, затем emit_bank.py в reports/sfx-bank. Зафиксируй команды/exit codes; проверь SoundBank.luau, Sfx.luau и совпадение manifest actualID в SoundBank для ui_click. Сохрани humanListening:'not_run'.
4. Выполни реальные UI verify_ui selftest, positive и negative spec на touch 44px/fit, verify_labels с positive и negative fixture. Negative fixture ожидаемо возвращает FAIL и остаётся обозначенной как отрицательная, это не повод менять результат на PASS. Все fixtures и результаты держи в task-local reports.
5. Вызови workshop.validation_control({action:'mobile'}) только после остановки Play, чтобы переключить simulator через фиксированный host tool; затем начни Play и проверь HUD свежим screen_capture hud-mobile. Останови Play. За desktop и mobile проходы сделай пять обязательных кадров: world-desktop, hud-desktop, shop-desktop, collection-desktop, hud-mobile. Запиши найденные ограничения, не исправляй игру. Если после просмотра кадра обнаружилось, что shop или collection capture показывает HUD/другую панель, до финальных validation_control default/after разрешён один дополнительный Play проход для пересъёмки недостающих desktop панелей; после него снова останови Play и только затем выполни default и after.
6. После остановки Play вызови workshop.validation_control({action:'default'}) для остановки/reset simulator, затем workshop.validation_control({action:'after'}). Сопоставь возвращённые before/after scene fingerprints и scenePreserved. Gate scene-preserved проходит лишь при подтверждённом совпадении зафиксированной сцены; не генерируй собственные fingerprint/JSON и не меняй исходники, UI или SoundService. Если сравнение отсутствует или helper сообщает отличие — gate не пройден.

Сохрани reports/sypho-<текущий taskId>/report.json и краткий Markdown summary. В checks перечисли ровно эти 16 ID, каждый один раз: runtime-imports, map-selftest, terrain-selftest, unreachable-check, sfx-search, sfx-probe, sfx-cleanup, sfx-bank, ui-selftest, touch-fit-positive, touch-fit-negative, labels-positive, labels-negative, hud-desktop-mobile, five-captures, scene-preserved. Это фиксированная схема отчёта; не ищи другие ID и не добавляй новые gates. JSON должен содержать taskId и attempt из контекста текущей задачи, profile='sypho-skills', status='passed'|'failed'|'blocked', и checks как массив {id,status,evidence} ровно с перечисленными выше ID. Статус passed разрешён, только если каждый gate пройден и исходная сцена сохранена. Не считай статус самой задачи доказательством gates. Сохрани humanListening:'not_run', все команды/exit codes, версии, package hashes/roots, измеренный SFX CSV и пути пяти кадров. При любой ошибке/невозможности честно укажи failed или blocked, не подменяй их успехом.`;

export function skillValidationReportPath(taskId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId))
    throw new Error("Нужен корректный UUID taskId для validation report path");
  return `reports/sypho-${taskId}/report.json`;
}
