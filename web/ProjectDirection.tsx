import React, { useId, useState } from "react";
import { directionGroups as groups } from "../shared/vocabulary";

const CUSTOM = "__custom__";
export function ProjectDirection() {
  const [selected, setSelected] = useState("Obby");
  const id = useId(),
    custom = selected === CUSTOM;
  const description = groups
    .flatMap((group) => group.items)
    .find((item) => item[0] === selected)?.[1];
  return (
    <div className="project-direction">
      <label htmlFor={id}>Направление</label>
      <select
        id={id}
        name={custom ? undefined : "genre"}
        value={selected}
        aria-describedby={id + "-hint"}
        onChange={(e) => setSelected(e.target.value)}
      >
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.items.map(([name]) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>Своё направление / смешанный жанр</option>
      </select>
      <p className="direction-hint" id={id + "-hint"}>
        {custom
          ? "Можно объединить несколько жанров. Основные механики опишите в поле «Идея и ограничения»."
          : description}
      </p>
      {custom && (
        <>
          <label htmlFor={id + "-custom"}>Своё направление</label>
          <input
            id={id + "-custom"}
            name="genre"
            required
            minLength={2}
            maxLength={100}
            placeholder="Например, кооперативное выживание с фермой"
            onInput={(e) =>
              e.currentTarget.setCustomValidity(
                e.currentTarget.value.trim().length < 2
                  ? "Укажите направление: минимум 2 символа, кроме пробелов."
                  : "",
              )
            }
          />
        </>
      )}
    </div>
  );
}
