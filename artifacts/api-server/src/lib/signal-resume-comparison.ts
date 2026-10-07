import { canonicalSkillKey } from "./skill-catalog";
import {
  formatFits,
  type MatchEvaluation,
  type MatchNeed,
} from "./signal-matching";
import type { CatalogResume } from "./signal-resume-catalog";

type Compared = { candidate: CatalogResume; evaluation: MatchEvaluation };
const reasonNames: Record<string, string> = {
  grade: "подтверждённый грейд",
  required_skills: "обязательные подтверждённые навыки",
  specialization: "специализация",
  consent: "согласие на подбор",
  visibility: "видимость",
  pool: "доступ к данным",
};
const salaryNames = {
  compatible: "совместимы с предложением",
  incompatible: "не пересекаются с предложением",
  unknown: "несопоставимы по доступным данным",
};

/** Fact templates, no alternate scoring and no pair-only reranking. */
export function compareResumeFacts(
  need: MatchNeed,
  left: Compared,
  right: Compared,
  fullPool: readonly Compared[],
) {
  const differences: { kind: string; text: string }[] = [];
  const l = left.evaluation,
    r = right.evaluation;
  if (l.eligible !== r.eligible) {
    const failed = l.eligible ? r : l;
    differences.push({
      kind: "admission",
      text: `${l.eligible ? "Первое" : "Второе"} резюме допущено к подбору. ${l.eligible ? "Второе" : "Первое"} не проходит обязательные условия: ${failed.ineligibilityReasons.map((reason) => reasonNames[reason] ?? reason).join(", ")}. Второстепенные факторы это не компенсируют.`,
    });
  } else if (!l.eligible && !r.eligible) {
    differences.push({
      kind: "admission",
      text: "Оба резюме не проходят обязательные условия потребности и не занимают места в выдаче.",
    });
  }
  const leftSkills = new Set(
      left.candidate.verifiedSkills.map(canonicalSkillKey),
    ),
    rightSkills = new Set(
      right.candidate.verifiedSkills.map(canonicalSkillKey),
    );
  const uniqueRequired = [
    ...new Map(
      need.requiredSkills.map((skill) => [canonicalSkillKey(skill), skill]),
    ).values(),
  ];
  const asymmetric = uniqueRequired.filter(
    (skill) =>
      leftSkills.has(canonicalSkillKey(skill)) !==
      rightSkills.has(canonicalSkillKey(skill)),
  );
  if (asymmetric.length) {
    const skill = asymmetric[0]!;
    const first = leftSkills.has(canonicalSkillKey(skill));
    const other = first ? right.candidate : left.candidate;
    const stated = [...other.stack, ...other.statedSkills].some(
      (raw) => canonicalSkillKey(raw) === canonicalSkillKey(skill),
    );
    differences.push({
      kind: "required-skill",
      text: `В ${first ? "первом" : "втором"} резюме обязательный ${skill} подтверждён; в ${first ? "втором" : "первом"} ${stated ? "только указан кандидатом" : "подтверждение отсутствует"}.`,
    });
  }
  if (l.salaryCompatibility !== r.salaryCompatibility)
    differences.push({
      kind: "salary",
      text: `Зарплатные ожидания первого резюме ${salaryNames[l.salaryCompatibility]}, второго — ${salaryNames[r.salaryCompatibility]}. Оценивается совместимость диапазонов, а не более низкая зарплата.`,
    });
  const lf = formatFits(left.candidate.workFormat, need.workFormat),
    rf = formatFits(right.candidate.workFormat, need.workFormat);
  if (lf !== rf)
    differences.push({
      kind: "work-format",
      text: `${lf ? "Первое" : "Второе"} резюме совпадает по формату работы (${need.workFormat}); в другом указан ${lf ? right.candidate.workFormat : left.candidate.workFormat}.`,
    });
  if (l.ranking.freshnessBand !== r.ranking.freshnessBand)
    differences.push({
      kind: "freshness",
      text: `Давность подтверждений различается: первое — ${l.ranking.freshnessBand}, второе — ${r.ranking.freshnessBand}. Это фактор актуальности для потребности, а не новый грейд.`,
    });
  const comparable =
    l.ranking.groupId === r.ranking.groupId &&
    l.ranking.qualityStatus === "measured" &&
    r.ranking.qualityStatus === "measured";
  const sameCategory = l.ranking.categoryId === r.ranking.categoryId;
  if (l.fspBonus !== r.fspBonus) differences.push({kind:'fsp-category',text:sameCategory
    ? `Результаты ФСП дают приоритет +${l.fspBonus} и +${r.fspBonus} только внутри одного направления и подтверждённого уровня, после соответствия требованиям и полного действующего экзамена. Разные шкалы экзаменов напрямую не сравниваются.`
    : 'Эти резюме относятся к разным категориям. Их спортивные результаты не сравниваются для порядка между категориями; ФСП не даёт одному грейду приоритет над другим.'});
  if (comparable && l.ranking.qualityScore !== r.ranking.qualityScore)
    differences.push({
      kind: "comparable-result",
      text: `В одной программе, версии и подтверждённом уровне результат первого резюме ${l.ranking.qualityScore}/100, второго — ${r.ranking.qualityScore}/100. Эти результаты можно сопоставить.`,
    });
  if (
    l.ranking.businessFitScore === r.ranking.businessFitScore &&
    !differences.some(
      (d) =>
        d.kind === "admission" ||
        d.kind === "required-skill" ||
        d.kind === "salary" ||
        d.kind === "work-format" ||
        d.kind === "freshness",
    )
  )
    differences.unshift({
      kind: "equal-fit",
      text: "Соответствие требованиям и условиям равно. При равных сопоставимых результатах порядок не означает преимущество квалификации.",
    });
  const findPosition = (entry: Compared) =>
    fullPool.findIndex(
      (row) =>
        row.candidate.userId === entry.candidate.userId &&
        row.candidate.resumeId === entry.candidate.resumeId,
    );
  const lp = findPosition(left),
    rp = findPosition(right);
  const limitations: string[] = [];
  if (!comparable)
    limitations.push(
      "Баллы этих резюме напрямую не сравниваются: различаются направление, уровень или версия экзамена либо отсутствует полный действующий результат.",
    );
  if (left.candidate.userId === right.candidate.userId)
    limitations.push(
      "Это два резюме одного человека. В выдаче человек занимает одно место; выбранный контекст может показывать только одно из них.",
    );
  let orderNote =
    "Место дано из полного актуального пула, без повторного ранжирования выбранной пары.";
  if (
    lp >= 0 &&
    rp >= 0 &&
    l.ranking.businessFitScore === r.ranking.businessFitScore
  ) {
    if (!sameCategory && l.ranking.provenancePriority === r.ranking.provenancePriority)
      orderNote += ' При равном соответствии и полном действующем экзамене разные направления и подтверждённые уровни расположены нейтрально. ФСП не меняет порядок между ними; один уровень не считается универсально лучше другого.';
    else if (!comparable && sameCategory)
      orderNote +=
        " В одном направлении и подтверждённом уровне результаты разных версий экзамена напрямую не сравниваются. ФСП может дать небольшой приоритет только внутри этой категории.";
    else if (
      l.ranking.qualityScore === r.ranking.qualityScore &&
      l.fspBonus === r.fspBonus
    )
      orderNote +=
        " При равных сопоставимых результатах порядок нейтрален и не означает преимущество квалификации.";
  }
  if (lp < 0 || rp < 0)
    orderNote +=
      " Отсутствующее место означает недопуск или другой выбранный профиль того же человека, а не худшую общую квалификацию.";
  return {
    summary:
      differences
        .slice(0, 3)
        .map((item) => item.text)
        .join(" ") || "Данных для содержательного различия недостаточно.",
    differences: differences.slice(0, 3),
    comparable,
    sameCategory,
    limitations,
    orderContext: {
      leftPosition: lp < 0 ? null : lp + 1,
      rightPosition: rp < 0 ? null : rp + 1,
      poolSize: fullPool.length,
      note: orderNote,
    },
  };
}
