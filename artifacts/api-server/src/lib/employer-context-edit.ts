import { z } from 'zod';
import { CreateEmployerNeedBody } from '@workspace/api-zod';
import { postgresIntIdSchema } from './postgres-id';
import { jobInput } from './opportunity-rules';
import { jobDetailsInput } from './job-discovery';
import { EmployerRequiredSkills } from './employer-required-skills';

export const NeedPatchBody = CreateEmployerNeedBody.partial().extend({
  revision: postgresIntIdSchema, status:z.enum(['active','archived']).optional(),
  requiredSkills:EmployerRequiredSkills.optional(),
}).strict().refine(value=>Object.keys(value).some(key=>key!=='revision'),'Укажите изменения.');
export const JobInputShape = jobInput.innerType().shape;
export const JobPatchBody = z.object(JobInputShape).partial().extend({
  version:postgresIntIdSchema, ...jobDetailsInput.shape,
}).strict().refine(value=>Object.keys(value).some(key=>key!=='version'),'Укажите изменения.');
export const NeedDeleteBody = z.object({revision:postgresIntIdSchema}).strict();
export const JobDeleteBody = z.object({version:postgresIntIdSchema}).strict();
export function contextBaseFields<T extends Record<string, unknown>>(current:T, shape:Record<string,unknown>) {
  return Object.fromEntries(Object.keys(shape).filter(key=>current[key]!==undefined).map(key=>[key,current[key]]));
}
