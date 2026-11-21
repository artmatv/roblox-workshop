import React from "react";
import type { Project } from "../shared/domain";
import { usesSpecialists } from "../shared/agent-policy";
export function AgentPolicy({
  project,
  onEnable,
}: {
  project: Project;
  onEnable: () => Promise<unknown>;
}) {
  const enabled = usesSpecialists(project);
  return (
    <section className="card agent-policy">
      <h2>Команда разработки</h2>
      <p>
        Sol ведёт игру и принимает работу. Помощники получают небольшое ТЗ и
        конкретные файлы. Живую сцену Studio меняет только ведущий.
      </p>
      <table>
        <thead>
          <tr>
            <th>Работа</th>
            <th>Модель</th>
            <th>Effort</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>ТЗ, разработка и приёмка</td>
            <td>Sol 6.1</td>
            <td>Medium</td>
          </tr>
          <tr>
            <td>Код по ТЗ</td>
            <td>Luna</td>
            <td>Medium</td>
          </tr>
          <tr>
            <td>Проектирование и проверка архитектуры</td>
            <td>Astra</td>
            <td>Medium</td>
          </tr>
        </tbody>
      </table>
      <p>
        Без автоматического повышения effort, лишних сред, копий реализации и
        этапов. Оформление проверяется по настоящим кадрам игры.
      </p>
      {enabled ? (
        <small>
          Применяется со следующего запуска. Внешняя оценка результата
          сохраняется.
        </small>
      ) : (
        <button onClick={() => void onEnable()}>
          Применить распределение моделей
        </button>
      )}
    </section>
  );
}
