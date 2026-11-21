export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function connectionError(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    return {
      kind: "access" as const,
      title: "Восстанавливаем доступ к мастерской",
      message:
        "В этом браузере ещё нет сохранённого доступа. Откройте мастерскую через её запускатель один раз — следующие вкладки будут подключаться автоматически.",
    };
  if (error instanceof ApiError)
    return {
      kind: "service" as const,
      title: "Мастерская временно не отвечает",
      message: error.message,
    };
  return {
    kind: "offline" as const,
    title: "Восстанавливаем соединение",
    message:
      "Связь с локальным сервисом прервалась. Подключение проверяется автоматически; проекты сохранены на компьютере.",
  };
}
