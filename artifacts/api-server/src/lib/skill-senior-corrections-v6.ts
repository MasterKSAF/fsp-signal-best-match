import type { SeniorPart } from './skill-senior-outcomes';
export const seniorV6ChangedFamilies = new Set(['react:identity:s1', 'react:identity:s3']);
const primary = (prompt: string, expected: string, explanation: string): SeniorPart => ({ prompt, expected, explanation, responseType: 'text' });
const plan = (prompt: string, choices: readonly string[], explanation: string): SeniorPart => ({ prompt, choices, expected: '1', explanation, responseType: 'integer' });
export function seniorCorrectionV6(skill: string, c: number, s: number, n: number, flag: boolean): readonly [SeniorPart, SeniorPart] | null {
  if (skill !== 'react' || c !== 3) return null;
  if (s === 0) return [
    primary(`Optimistic Editor A имеет client identity CA, draft='draftA', request opKA; B независим. ${flag ? `ACK opKA связывает CA с новым server id=${n}; server list содержит ту же запись. Reconciler убирает optimistic duplicate по opKA.` : 'Definitive validation failure opKA не создал server row; A оставлен для исправления, client identity CA не менялась.'} Naive render key=serverId после ACK, до ACK=clientId; local initial='empty'. Safe вариант хранит постоянный UI key=CA, server identity отдельна, draft owner scoped CA. Введите draft A после naive commit|после safe commit|число persistent A rows.`, `${flag ? 'empty' : 'draftA'}|draftA|${flag ? 1 : 0}`, 'Смена canonical server-id не обязана быть сменой UI identity. В naive success меняется key и state сбрасывается; UI/client identity сохраняет draft, операция/receipt связывает optimistic и persisted запись, failure не создаёт persistent row.'),
    plan('Нужны дедупликация ACK/server-list, сохранение A/B draft и корректная цель будущего save. Как разделить identities?', [
      'Client/UI identity стабильна на время editing; receipt opKA связывает её с server-id. Merge duplicate только по доказанной связи, command target использует server-id после ACK; A/B draft и late results scoped по client/operation generation.',
      'После ACK заменить client key новым server-id, не перенося draft. Это уберёт duplicate в списке; stable persisted key считаем достаточным для сохранения состояния уже mounted optimistic Editor.',
      'Никогда не принимать server-id, чтобы client key сохранялся. Следующие saves отправлять temp id как canonical server target; совпадение draft текста связывает optimistic и любую server row.',
      'Использовать одинаковый key для A и persisted duplicate, не проверяя op receipt. React сам объединит sibling states; late ACK другой операции можно применять по совпадению отображаемого поля.',
    ], 'Это миграция временной/canonical identity с доказанным reconciliation, а не Junior правило key=id при reorder. UI lifetime, business target и operation receipt имеют разные роли.'),
  ];
  if (s === 2) return [
    primary(`Editor plugin V1 сменился новым component type V2 для той же entity A. Durable owner вне plugin хранит draft={value:${n}} после явной schema-v1→v2 миграции; V2 transient validation initial='empty'. Незавершённый validator V1 возвращает success после V2 commit, entity id и CV revision прежние, schema/generation разные. ${flag ? 'Guard проверяет entity+schema+generation.' : 'Guard проверяет только entity+CV revision.'} Введите принято старых validation results (0/1)|durable draft.value|V2 transient initial.`, `${flag ? 0 : 1}|${n}|empty`, 'Type replacement remounts transient state, durable owner переживает его. Entity/revision совпадение не доказывает совместимость старой validation schema; schema/generation fencing отклоняет V1 success.'),
    plan('Как обновить Editor type/schema без потери draft и без ложного подтверждения нового ввода старым validator?', [
      'Durable draft вне plugin, versioned migration либо явный conflict; transient state remount. Validation/result cache scoped entity+schema+generation, old completion отклоняется; mount V2 не означает успешный business save.',
      'Вынести V2 component type на module scope и оставить тот же entity key. Этого достаточно сохранить состояние V1 и принять его validator, поскольку business entity не изменилась.',
      'Сохранить draft выше plugin, но validation cache только по entity/CV revision. Схема изменилась без записи CV, значит V1 success считаем доказательством валидности любого V2 поля.',
      'На remount принять old raw draft as V2 schema, затем применить любой завершённый validator. Type assertion объявляет миграцию выполненной; сохранённый operation-id заменяет проверку schema version.',
    ], 'Junior stable-type/key не покрывает versioned draft migration, ownership через замену plugin и позднюю несовместимую validation. Эти границы оцениваются отдельно от component remount.'),
  ];
  return null;
}
