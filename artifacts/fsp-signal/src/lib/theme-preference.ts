export type PaletteId='pearl'|'cashmere'|'graphite'|'midnight';
export type ThemePreference=PaletteId|'system';
export const themeLabels={pearl:'Жемчуг',cashmere:'Кашемир',graphite:'Графит',midnight:'Полночь',system:'Как в системе'} as const;
export function normalizeThemePreference(value:unknown):ThemePreference {
  if(value==='light')return 'pearl';if(value==='dark')return 'graphite';
  return value==='pearl'||value==='cashmere'||value==='graphite'||value==='midnight'?value:'system';
}
export function resolveTheme(preference:ThemePreference,systemDark:boolean):PaletteId {return preference==='system'?(systemDark?'graphite':'pearl'):preference;}
export function themeScheme(palette:PaletteId){return palette==='graphite'||palette==='midnight'?'dark':'light';}
