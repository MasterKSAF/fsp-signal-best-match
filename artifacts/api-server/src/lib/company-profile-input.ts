import {z} from 'zod';
import {companyInnError} from '@workspace/api-zod/company-inn';

export const CompanyUpdateBody=z.object({
  name:z.string().trim().min(2).max(160),
  description:z.string().trim().max(3000),
  industry:z.string().trim().min(2).max(160),
  inn:z.string().trim().max(12,'ИНН должен содержать 10 или 12 цифр.').superRefine((value,context)=>{
    const message=companyInnError(value);if(message)context.addIssue({code:z.ZodIssueCode.custom,message});
  }).optional(),
  contactEmail:z.string().trim().email().max(320),
  contactPhone:z.string().trim().max(64).regex(/^[0-9+() .-]*$/).nullable().optional(),
  contactMethod:z.enum(['Электронная почта','Телефон','Мессенджер']),
}).strict();

/** Legacy callers omitting inn preserve it. An explicit empty string clears it. */
export function companyInnUpdate(inn:string|undefined) {
  return inn===undefined?{}:{inn:inn||null};
}
