export type DictionaryOption = { value: string; id?: string; label?: string; aliases?: readonly string[] };
export const normalizeDictionaryText = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
export function exactDictionaryOption(options: readonly DictionaryOption[], value: string) {
  const normalized = normalizeDictionaryText(value);
  return options.find(option => [option.value, option.label, option.id, ...option.aliases ?? []].some(alias => alias !== undefined && normalizeDictionaryText(alias) === normalized));
}
export function addDictionaryValues(current: readonly string[], additions: readonly string[], options: readonly DictionaryOption[], maxItems = 40) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of [...current, ...additions]) {
    const cleaned = raw.trim().replace(/\s+/g, ' ');
    if (!cleaned) continue;
    const value = exactDictionaryOption(options, cleaned)?.value ?? cleaned;
    const key = normalizeDictionaryText(value);
    if (!seen.has(key) && result.length < maxItems) { result.push(value); seen.add(key); }
  }
  return result;
}
const list = (values: readonly string[]): DictionaryOption[] => values.map(value => ({ value }));
export const ROLE_OPTIONS = list(['Backend-разработчик', 'Frontend-разработчик', 'Fullstack-разработчик', 'Python-разработчик', 'TypeScript-разработчик', 'AI-инженер', 'ML-инженер', 'ML-разработчик', 'Инженер по тестированию', 'DevOps-инженер', 'Системный аналитик', 'Аналитик данных', 'Инженер данных', 'Архитектор', 'Технический руководитель', 'Разработчик мобильных приложений']);
export const DOMAIN_OPTIONS = list(['Финансовые технологии', 'Розничная торговля', 'Электронная коммерция', 'Образование', 'Здравоохранение', 'Телекоммуникации', 'Промышленность', 'Логистика', 'Игры', 'Медиа', 'Государственные услуги', 'Корпоративные системы', 'Информационная безопасность']);
export const CITY_OPTIONS = list(['Москва', 'Санкт-Петербург', 'Казань', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Самара', 'Краснодар', 'Ростов-на-Дону', 'Уфа', 'Пермь', 'Воронеж', 'Красноярск', 'Тюмень', 'Удалённо']);
export const SOFT_SKILL_OPTIONS = list(['Командная работа', 'Коммуникация', 'Самостоятельность', 'Наставничество', 'Планирование', 'Критическое мышление', 'Переговоры', 'Презентация решений', 'Управление временем']);
export const WORK_FORMAT_OPTIONS = list(['Удалённо', 'Гибрид', 'Офис']);
