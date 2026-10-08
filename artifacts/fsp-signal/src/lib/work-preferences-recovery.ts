export type WorkPreferences = {location:string;schedule:string;employment:string;relocation:boolean;startAvailability:string};
/** A persisted row may also contain resumeId/updatedAt. Those belong to the read
 * model, never to editable state, equality checks or the strict PATCH contract. */
export function editableWorkPreferences(value:WorkPreferences):WorkPreferences {
  return {location:value.location,schedule:value.schedule,employment:value.employment,relocation:value.relocation,startAvailability:value.startAvailability};
}
export function sameWorkPreferences(left:WorkPreferences,right:WorkPreferences) {
  return JSON.stringify(editableWorkPreferences(left))===JSON.stringify(editableWorkPreferences(right));
}
/** React synchronization must settle without changing a dependency's reference
 * when the server only supplies a new read-model object or metadata. */
export function retainWorkPreferences(previous:WorkPreferences,incoming:WorkPreferences):WorkPreferences {
  return Object.keys(previous).length===5&&sameWorkPreferences(previous,incoming)?previous:editableWorkPreferences(incoming);
}
export type WorkPreferencesRevisionSnapshot={revision:number;preferences:WorkPreferences};
/** Query observers may deliver older props for a render after an accepted save. */
export function currentWorkPreferencesSnapshot(incoming:WorkPreferencesRevisionSnapshot,accepted:WorkPreferencesRevisionSnapshot|null):WorkPreferencesRevisionSnapshot {
  return accepted&&incoming.revision<accepted.revision?accepted:{revision:incoming.revision,preferences:editableWorkPreferences(incoming.preferences)};
}
export function savedWorkPreferencesRows<T extends {id:number;revision:number;workPreferences:WorkPreferences}>(rows:readonly T[],resumeId:number,snapshot:WorkPreferencesRevisionSnapshot):T[] {
  return rows.map(row=>row.id===resumeId&&row.revision<=snapshot.revision?{...row,revision:snapshot.revision,workPreferences:editableWorkPreferences(snapshot.preferences)}:row);
}
export function workPreferencesPatch(value:WorkPreferences,revision:number) {
  return {...editableWorkPreferences(value),revision};
}
export function workPreferencesSnapshot(rows:readonly {id:number;revision:number;workPreferences:WorkPreferences}[],resumeId:number) {
  const row=rows.find(item=>item.id===resumeId);
  if(!row||!Number.isSafeInteger(row.revision)||row.revision<1||typeof row.workPreferences?.relocation!=='boolean'||['location','schedule','employment','startAvailability'].some(key=>typeof row.workPreferences?.[key as keyof WorkPreferences]!=='string'))throw new Error('Не удалось получить актуальные условия выбранного резюме. Ваши правки остались в форме.');
  return {revision:row.revision,preferences:editableWorkPreferences(row.workPreferences)};
}
