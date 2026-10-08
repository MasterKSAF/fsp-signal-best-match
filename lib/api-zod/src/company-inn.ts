/** Local format/check-digit validation only; no registry lookup or assurance
 * that an identifier belongs to the company. Keep the value a string. */
export function companyInnError(value: string): string | null {
  const inn = value.trim();
  if (!inn) return null;
  if (!/^(?:[0-9]{10}|[0-9]{12})$/.test(inn)) return 'ИНН должен содержать 10 или 12 цифр.';
  if (/^0+$/.test(inn)) return 'Укажите ИНН или оставьте поле пустым.';
  const digits = [...inn].map(Number);
  const check = (weights: readonly number[]) => weights.reduce((sum,weight,index)=>sum+weight*digits[index]!,0)%11%10;
  const valid = inn.length === 10
    ? check([2,4,10,3,5,9,4,6,8]) === digits[9]
    : check([7,2,4,10,3,5,9,4,6,8]) === digits[10]
      && check([3,7,2,4,10,3,5,9,4,6,8]) === digits[11];
  return valid ? null : 'Проверьте ИНН: контрольные цифры не совпадают.';
}
