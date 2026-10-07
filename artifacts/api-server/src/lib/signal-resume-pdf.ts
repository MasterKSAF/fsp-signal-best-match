import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recommendResumeGrade, resumeAnswerScale, questionsForResume, type ResumeInput } from "./signal-resume-contract";

export type ResumePdfProfile = {
  displayName: string; professionalAlias: string; specialization: string; assumedGrade: string;
  verifiedGrade: string | null; verifiedSkills: string[]; stack: string[]; skills: string[];
  yearsExperience: number; workFormat: string; salaryMin: number | null; salaryMax: number | null;
  salaryPeriod: string; salaryType: string; latestAssessmentAt: Date | null;
  qualificationSource?: "assessment" | "legacy" | "none";
  qualificationLimitation?: string | null;
};

function resumeFont(weight = "Regular") {
  const candidates = [
    path.resolve(process.cwd(), `artifacts/api-server/assets/fonts/Manrope-${weight}.ttf`),
    path.resolve(process.cwd(), `assets/fonts/Manrope-${weight}.ttf`),
    fileURLToPath(new URL(`../../assets/fonts/Manrope-${weight}.ttf`, import.meta.url)),
  ];
  const font = candidates.find(existsSync);
  if (!font) throw new Error("Resume font asset is missing");
  return font;
}

function safeText(value: string) { return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\t/g, "  "); }
function monthLabel(value: string) { const [year, month] = value.split("-"); return `${month}.${year}`; }

/** Generate a private, portable copy. Contact email/phone are not accepted by this renderer. */
export function renderCandidateResumePdf(profile: ResumePdfProfile, resume: ResumeInput, generatedAt = new Date()): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const regularFont = resumeFont();
      const headingFont = resumeFont("SemiBold");
      // Reuse PDFKit's document-local path cache, including the constructor font.
      const doc = new PDFDocument({ size: "A4", margins: { top: 48, right: 48, bottom: 58, left: 48 }, bufferPages: true, font: regularFont, info: { Title: "Резюме Signal", Author: "Signal", Subject: "Профессиональный профиль и результаты проверки навыков" } });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const ink = "#172535", muted = "#596776", accent = "#216E67";
      const width = doc.page.width - 96;
      const ensureSpace = (height: number) => { if (doc.y + height > doc.page.height - 58) doc.addPage(); };
      const line = (value: string, size = 10, color = ink) => {
        doc.font(size >= 11 ? headingFont : regularFont).fontSize(size).fillColor(color).text(safeText(value), { width, lineGap: 4 });
      };
      const section = (title: string) => {
        ensureSpace(82); doc.moveDown(.7); line(title, 14, accent); doc.moveDown(.3);
      };
      const small = (value: string) => line(value, 9, muted);

      line("Signal  /  Резюме", 11, accent);
      doc.moveDown(.6);
      line(profile.displayName || profile.professionalAlias, 25);
      line(profile.specialization, 13, muted);
      doc.moveDown(.4);
      small(`Опыт в годах: ${profile.yearsExperience}  ·  Формат: ${profile.workFormat}`);
      if (profile.salaryMin !== null || profile.salaryMax !== null) {
        const amounts = [profile.salaryMin === null ? "" : `от ${profile.salaryMin.toLocaleString("ru-RU")}`, profile.salaryMax === null ? "" : `до ${profile.salaryMax.toLocaleString("ru-RU")}`].filter(Boolean).join(" ");
        small(`Ожидания: ${amounts} ₽ / ${profile.salaryPeriod === "year" ? "год" : "месяц"}, ${profile.salaryType === "net" ? "на руки" : "до вычета налогов"}`);
      }
      section("Навыки и уровень");
      line(`Подтверждённая категория: ${profile.verifiedGrade || "пока не подтверждена"}`);
      if (profile.verifiedGrade) small(profile.qualificationSource === "assessment"
        ? "Источник категории: полная квалификационная программа Signal."
        : "Источник категории: сохранённый исторический результат. Подробное происхождение программы не подтверждено.");
      if (profile.qualificationLimitation) small(profile.qualificationLimitation);
      if (profile.verifiedGrade && profile.latestAssessmentAt) small(`Дата проверки: ${profile.latestAssessmentAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}`);
      small(`Заявленный уровень: ${profile.assumedGrade}. Указан кандидатом.`);
      small("Практические задания компаний оцениваются отдельно и не присваивают категорию Signal.");
      if (profile.verifiedSkills.length) line(`Подтверждено проверкой: ${profile.verifiedSkills.join(", ")}`);
      if (profile.stack.length) line(`Технологии: ${profile.stack.join(", ")}`);
      if (profile.skills.length) line(`Профессиональные навыки (со слов кандидата): ${profile.skills.join(", ")}`);
      if (resume.softSkills.length) line(`Личные навыки (со слов кандидата): ${resume.softSkills.join(", ")}`);
      if (resume.summary) { section("О себе"); line(resume.summary); }
      if (resume.experience.length) {
        section("Опыт работы");
        for (const job of resume.experience) {
          ensureSpace(80); line(`${job.role} · ${job.company}`, 11);
          small(`${monthLabel(job.start)} - ${job.end ? monthLabel(job.end) : "по настоящее время"}`);
          if (job.description) line(job.description); doc.moveDown(.6);
        }
      }
      if (resume.projects.length) {
        section("Проекты");
        for (const project of resume.projects) {
          ensureSpace(70); line(project.title, 11); if (project.role) small(project.role);
          if (project.description) line(project.description);
          if (project.url) doc.fontSize(9).fillColor(accent).text(project.url, { width, link: project.url, lineGap: 3 });
          doc.moveDown(.6);
        }
      }
      if (resume.education.length) {
        section("Образование");
        for (const item of resume.education) {
          ensureSpace(66); line(item.institution, 11); line(item.qualification);
          small(`${monthLabel(item.start)} - ${item.end ? monthLabel(item.end) : "обучаюсь"}`); doc.moveDown(.4);
        }
      }
      if (resume.portfolio.length) {
        section("Портфолио и ссылки");
        for (const link of resume.portfolio) {
          ensureSpace(48); line(link.title);
          doc.fontSize(9).fillColor(accent).text(link.url, { width, link: link.url, lineGap: 3 }); doc.moveDown(.4);
        }
      }
      const recommendation = recommendResumeGrade(resume.questionnaire);
      section("Профессиональный опрос");
      small(`${resume.questionnaire.industry} · ${resume.questionnaire.specialization}`);
      for (const question of questionsForResume(resume.questionnaire.specialization)) {
        const answer = (resume.questionnaire.answers as Record<string, number | null>)[question.key];
        line(`${question.title}: ${answer === null ? "нет ответа" : resumeAnswerScale[answer]?.label || "нет ответа"}`, 9);
      }
      small(recommendation.explanation);
      section("О документе");
      small("Опыт, образование и самооценка заполнены кандидатом. Подтверждённые навыки отмечены отдельно. Контактные поля аккаунта в этот файл не добавляются. Текст резюме и ссылки сохранены как указаны кандидатом. Публикуя файл самостоятельно, проверьте сведения и ссылки в резюме.");
      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index++) {
        doc.switchToPage(index);
        const bottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font(regularFont).fontSize(8).fillColor(muted).text(`Signal · ${generatedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })} · ${index + 1} / ${range.count}`, 48, doc.page.height - 36, { width, align: "right", lineBreak: false });
        doc.page.margins.bottom = bottomMargin;
      }
      doc.end();
    } catch (error) { reject(error); }
  });
}
