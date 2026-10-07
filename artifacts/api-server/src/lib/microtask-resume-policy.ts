import { z } from "zod";
import type { MicroResumeContext } from "@workspace/db";
import { microInput } from "./opportunity-rules";
import { sameSignalPool, type SignalScopedAccount } from "./signal-pool-scope";

export const microSpecializationInput = z.enum(["Backend / Python", "Frontend / TypeScript"]);
// Keep the existing strict teaching/rubric rules; only the target category is new.
export const microTemplateInput = z.object({ specialization: microSpecializationInput }).passthrough()
  .transform(({ specialization, ...rest }, context) => {
    const base = microInput.safeParse(rest);
    if (!base.success) {
      for (const issue of base.error.issues) context.addIssue(issue);
      return z.NEVER;
    }
    return { ...base.data, specialization };
  });

export type MicroLiveResume = {
  id: number; userId: number; revision: number; title: string; specialization: string;
  verifiedGrade: "Junior" | "Middle" | "Senior" | null; verifiedSkills: string[];
  visibility: string; consentMatching: boolean; deletedAt: Date | null;
};
export type MicroResumeBinding = {
  resumeId: number | null; resumeRevision: number | null;
  resumeContext: MicroResumeContext | null; resumeProvenance: "captured" | "legacy_unbound";
};

export function microResumeEligible(resume: MicroLiveResume | null | undefined, candidateUserId: number,
  specialization: string | null | undefined, candidate: SignalScopedAccount, company: SignalScopedAccount): boolean {
  return !!resume && resume.userId === candidateUserId && resume.deletedAt === null &&
    resume.visibility !== "private" && resume.consentMatching && !!resume.verifiedGrade &&
    microSpecializationInput.safeParse(specialization).success && resume.specialization === specialization &&
    sameSignalPool(candidate, company);
}

export function captureMicroResume(resume: MicroLiveResume, professionalAlias: string): MicroResumeBinding {
  if (!resume.verifiedGrade) throw new Error("Cannot capture an unqualified practice resume");
  return {
    resumeId: resume.id, resumeRevision: resume.revision, resumeProvenance: "captured",
    resumeContext: { resumeId: resume.id, revision: resume.revision, title: resume.title,
      specialization: resume.specialization, verifiedGrade: resume.verifiedGrade,
      verifiedSkills: [...resume.verifiedSkills], professionalAlias },
  };
}

/** A primary/revision change does not replace the original target. Category/rights do. */
export function microBindingAccessible(binding: MicroResumeBinding, resume: MicroLiveResume | null | undefined,
  candidateUserId: number, candidate: SignalScopedAccount, company: SignalScopedAccount): boolean {
  const context = binding.resumeContext;
  return binding.resumeProvenance === "captured" && !!context && binding.resumeId === context.resumeId &&
    binding.resumeRevision === context.revision && binding.resumeId === resume?.id &&
    microResumeEligible(resume, candidateUserId, context.specialization, candidate, company);
}

export const MICRO_RESUME_UNAVAILABLE = "Выбранное резюме скрыто, удалено, изменило направление или больше не разрешает подбор. Выберите доступное подтверждённое резюме для нового предложения.";
export const MICRO_LEGACY_LIMITATION = "Это прежнее задание без сохранённого резюме. История доступна владельцу; для нового ответа или предложения требуется явно выбранное резюме.";
