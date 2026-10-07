import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  addDictionaryValues,
  exactDictionaryOption,
  normalizeDictionaryText,
  type DictionaryOption,
} from "@/lib/professional-dictionaries";
import "./dictionary-input.css";

type ComboProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onSelect"
> & {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (value: string) => void;
  options: readonly DictionaryOption[];
  allowCustom?: boolean;
  validationMessage?: string;
};
export function DictionaryCombobox({
  value,
  onChange,
  onSelect,
  options,
  allowCustom = true,
  validationMessage = '',
  id,
  disabled,
  className = "",
  ...inputProps
}: ComboProps) {
  const generatedId = useId();
  const controlId = id ?? `dictionary-${generatedId}`;
  const listId = `${controlId}-options`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.setCustomValidity(validationMessage); }, [validationMessage]);
  const search = normalizeDictionaryText(value);
  const filtered = options
    .filter((option) =>
      [option.value, option.label, ...(option.aliases ?? [])].some((text) =>
        text !== undefined && normalizeDictionaryText(text).includes(search),
      ),
    )
    .slice(0, 12);
  const exact = exactDictionaryOption(options, value);
  const custom = allowCustom && value.trim().length > 0 && !exact;
  const choices = [
    ...filtered.map((option) => ({
      value: option.value,
      text: option.label ?? option.value,
      custom: false,
    })),
    ...(custom
      ? [
          {
            value: value.trim(),
            text: `Использовать своё: ${value.trim()}`,
            custom: true,
          },
        ]
      : []),
  ];
  const choose = (selected: string) => {
    onChange(selected);
    onSelect?.(selected);
    setOpen(false);
    setActive(0);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActive((previous) =>
        choices.length
          ? (previous + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
            choices.length
          : 0,
      );
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (choices[active]) choose(choices[active].value);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Tab") setOpen(false);
  };
  return (
    <div
      className="dictionary-control"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="dictionary-input-wrap">
      <input
        ref={inputRef}
          {...inputProps}
          id={controlId}
          className={`input ${className}`}
          disabled={disabled}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && choices[active] ? `${listId}-${active}` : undefined
          }
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={keyDown}
          autoComplete="off"
        />
        {value && !disabled && <button type="button" className="dictionary-clear" aria-label="Очистить значение" onClick={() => { onChange(''); setOpen(false); setActive(0); inputRef.current?.focus(); }}><X size={13}/></button>}
        <button
          type="button"
          className="dictionary-toggle"
          aria-label="Показать варианты"
          tabIndex={-1}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((previous) => !previous)}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && !disabled && (
        <div
          className="dictionary-options"
          role="listbox"
          id={listId}
          aria-label="Варианты значения"
        >
          {choices.length ? (
            choices.map((choice, index) => (
              <button
                type="button"
                role="option"
                aria-selected={exact?.value === choice.value}
                id={`${listId}-${index}`}
                className={`${active === index ? "is-active" : ""} ${choice.custom ? "is-custom" : ""}`}
                key={`${choice.custom}:${choice.value}`}
                tabIndex={-1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(choice.value)}
              >
                {choice.custom ? (
                  <Plus size={14} />
                ) : exact?.value === choice.value ? (
                  <Check size={14} />
                ) : null}
                <span>{choice.text}</span>
              </button>
            ))
          ) : (
            <p role="status">Подходящих вариантов нет</p>
          )}
        </div>
      )}
      {custom && !open && (
        <span className="dictionary-custom-note">Собственное значение</span>
      )}
    </div>
  );
}

export function DictionaryTags({
  value,
  onChange,
  options,
  name,
  required = false,
  maxItems = 40,
  ...props
}: Omit<ComboProps, "value" | "onChange" | "onSelect"> & {
  value: readonly string[];
  onChange: (value: string[]) => void;
  maxItems?: number;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState('');
  const errorId = `dictionary-tags-error-${useId()}`;
  const add = (raw: string) => {
    const parts = raw.split(',').map(value => value.trim()).filter(Boolean);
    if (parts.some(value => value.length > (props.maxLength ?? 100))) { setText(raw); setError(`Каждое значение должно быть не длиннее ${props.maxLength ?? 100} символов.`); return; }
    const complete = addDictionaryValues(value, parts, options, Number.MAX_SAFE_INTEGER);
    if (complete.length > maxItems) { setText(raw); setError(`Можно выбрать до ${maxItems} значений. Удалите лишние перед добавлением.`); return; }
    onChange(addDictionaryValues(value, raw.split(","), options, maxItems));
    setError('');
    setText("");
  };
  return (
    <div className="dictionary-tags" data-multivalue="true" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget) && text.trim()) add(text); }} onKeyDown={event => { if (!event.defaultPrevented && event.key === 'Enter' && text.trim()) { event.preventDefault(); add(text); } }}>
      {name && <input type="hidden" name={name} value={value.join(", ")} />}
      {value.length > 0 && (
        <ul className="dictionary-tag-list" aria-label="Выбранные значения">
          {value.map((item, index) => (
            <li key={`${item}-${index}`}>
              <span>{item}</span>
              <button
                type="button"
                disabled={props.disabled}
                aria-label={`Удалить ${item}`}
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <DictionaryCombobox
        {...props}
        options={options}
        value={text}
        onChange={value => { setText(value); setError(''); }}
        onSelect={add}
        required={required && value.length === 0}
        aria-invalid={error ? true : props['aria-invalid']}
        validationMessage={error}
        aria-describedby={[props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (pasted.includes(",")) {
            event.preventDefault();
            add(pasted);
          }
        }}
      />
      {error && <p id={errorId} className="form-field__error" role="alert">{error}</p>}
      <div className="dictionary-tag-actions">
        <span>
          {value.length}/{maxItems} · выберите вариант или добавьте свой
        </span>
        {text.trim() && (
          <button
            type="button"
            disabled={props.disabled || value.length >= maxItems}
            onClick={() => add(text)}
          >
            <Plus size={13} />
            Добавить
          </button>
        )}
      </div>
    </div>
  );
}

export function useSkillDictionary() {
  return useQuery({
    queryKey: ["skill-dictionary", "signal-skills-v1"],
    staleTime: 60000,
    queryFn: async (): Promise<DictionaryOption[]> => {
      const response = await fetch("/api/dictionaries/skills", {
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error(
          "Справочник навыков недоступен. Можно сохранить собственные значения.",
        );
      const result = await response.json();
      return result.skills.map(
        (skill: { id: string; label: string; aliases: string[] }) => ({
          id: skill.id,
          value: skill.label,
          aliases: skill.aliases,
        }),
      );
    },
  });
}
