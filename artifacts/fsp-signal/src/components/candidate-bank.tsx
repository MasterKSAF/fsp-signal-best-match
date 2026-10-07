import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowRight,
  BadgeCheck,
  CircleHelp,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "./product-enhancements";
import {FspSignalDetails,type SportingSignal} from './matching-support';
import {DictionaryCombobox} from './dictionary-input';
import {FormField} from './form-field';
import {WORK_FORMAT_OPTIONS} from '@/lib/professional-dictionaries';
import "./candidate-bank.css";

type SkillProof = {
  skill: string;
  date: string | null;
  criterion: string | null;
  programId: string | null;
  programVersion: string | null;
  limitation: string | null;
};
type ResumeSummary = {
  resumeId: number;
  resumeRevision: number;
  title: string;
  specialization: string;
  verifiedGrade: string | null;
  verifiedScore: number | null;
  verifiedSkills: string[];
  stack: string[];
  yearsExperience: number;
  workFormat: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: "month" | "year";
  salaryType: "gross" | "net";
  readyForOffers: boolean;
  evidenceDate: string | null;
  confirmationStatus:'confirmed'|'unconfirmed';
  qualificationNextStep:{action:'take_signal_qualification';resumeId:number;specialization:string}|null;
  fspSignal:SportingSignal;
};
type BankCandidate = ResumeSummary & {
  candidateId: number;
  alias: string;
  publicName: string | null;
  avatarDataUrl: string | null;
  fspHistory: boolean;
  availableResumes: Pick<
    ResumeSummary,
    | "resumeId"
    | "resumeRevision"
    | "title"
    | "specialization"
    | "verifiedGrade"
    | "evidenceDate"
  >[];
  badges: { id: string; label: string; skills: SkillProof[]; note: string }[];
  skillEvidence: SkillProof[];
  whySuitable?: string[];
};
type BankResponse = {
  availableTotal: number;
  candidates: BankCandidate[];
  total: number;
  page: number;
  pageSize: number;
  specializations: string[];
  order: string;
  orderNote: string;
  confirmedTotal:number;
  unconfirmedTotal:number;
  confirmedOrder:'comparable-qualification'|'neutral-alias'|'need-fit';
};
const emptyFilters = {
  q: "",
  specialization: "",
  grade: "",
  skills: "",
  fsp: "",
  experienceMin: "",
  experienceMax: "",
  workFormat: "",
  salaryMin: "",
  salaryMax: "",
  salaryPeriod: "month",
  salaryType: "gross",
  hasPhoto: "",
  readyForOffers: "",
  checkedWithinDays: "",
};
const fmt = (date: string | null) =>
  date ? new Date(date).toLocaleDateString("ru-RU") : "Дата неизвестна";

function SpecialistCard({ initial }: { initial: BankCandidate }) {
  const [resumeId, setResumeId] = useState(initial.resumeId);
  const detail = useQuery({
    queryKey: ["catalog-resume", resumeId],
    enabled: resumeId !== initial.resumeId,
    queryFn: () => api<BankCandidate>(`/api/employer/candidates/${resumeId}`),
  });
  const candidate = resumeId === initial.resumeId ? initial : detail.data;
  return (
    <article className="panel bank-card" aria-busy={!candidate}>
      <div className="bank-card-top">
        {candidate?.avatarDataUrl ? (
          <img
            className="bank-avatar bank-photo"
            src={candidate.avatarDataUrl}
            alt="Фото кандидата"
          />
        ) : (
          <span className="bank-avatar">
            <Users size={22} />
          </span>
        )}
        <div>
          <h2>{initial.alias}</h2>
          {candidate?.publicName && <small>{candidate.publicName}</small>}
        </div>
      </div>
      {initial.availableResumes.length > 1 && (
        <FormField label="Доступное резюме" layout="vertical" className="bank-field">
          <select
            id={`bank-resume-${initial.candidateId}`}
            className="input"
            value={resumeId}
            onChange={(e) => setResumeId(Number(e.target.value))}
          >
            {initial.availableResumes.map((resume) => (
              <option value={resume.resumeId} key={resume.resumeId}>
                {resume.title} ·{" "}
                {resume.verifiedGrade ?? "Грейд не подтверждён"}
              </option>
            ))}
          </select>
        </FormField>
      )}
      {!candidate ? (
        detail.isError ? (
          <p role="alert">
            Резюме недоступно или скрыто.{" "}
            <button
              className="button text-button"
              onClick={() => detail.refetch()}
            >
              Повторить
            </button>
          </p>
        ) : (
          <p role="status">Загружаем выбранное резюме…</p>
        )
      ) : (
        <>
          <div className="bank-category">
            {candidate.confirmationStatus==='confirmed'?<BadgeCheck size={17}/>:<CircleHelp size={17}/>}
            <strong>
              {candidate.specialization} ·{" "}
              {candidate.verifiedGrade ?? "Без подтверждённого грейда"}
            </strong>
          </div>
          {candidate.confirmationStatus==='unconfirmed'&&<div className="bank-qualification-nextstep"><CircleHelp size={17}/><p>Резюме доступно в каталоге. Для подбора и обычного приглашения кандидату нужно пройти квалификационный экзамен Signal по направлению «{candidate.qualificationNextStep?.specialization??candidate.specialization}».</p></div>}
          <div className="bank-achievements">
            {candidate.badges.map((badge) => (
              <details
                className="bank-achievement"
                key={`${candidate.resumeId}-${badge.id}`}
                onPointerEnter={(e) => {
                  if (e.pointerType === "mouse") e.currentTarget.open = true;
                }}
                onPointerLeave={(e) => {
                  if (
                    e.pointerType === "mouse" &&
                    !e.currentTarget.matches(":focus-within")
                  )
                    e.currentTarget.open = false;
                }}
              >
                <summary>
                  <BadgeCheck size={14} />
                  {badge.label}
                </summary>
                <div className="bank-badge-details">
                  <p>{badge.note}</p>
                  <ul>
                    {badge.skills.map((proof, index) => (
                      <li key={`${proof.skill}-${index}`}>
                        <strong>{proof.skill}</strong>
                        <span>
                          {fmt(proof.date)} ·{" "}
                          {proof.criterion ?? "Проверка навыка"}
                        </span>
                        <small>{proof.programVersion ?? proof.programId}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
          <div className="bank-skill-list" aria-label="Подтверждённые навыки">
            {candidate.verifiedSkills.length ? (
              candidate.verifiedSkills.map((skill) => (
                <span className="badge badge-verified" key={skill}>
                  <BadgeCheck size={12} />
                  {skill}
                </span>
              ))
            ) : (
              <small>Подтверждённых навыков пока нет</small>
            )}
          </div>
          <p className="bank-stack">
            <span>Указано кандидатом</span>
            {candidate.stack.join(" · ") || "Стек не указан"}
          </p>
          <dl className="bank-facts">
            <dt>Опыт со слов кандидата</dt>
            <dd>{candidate.yearsExperience} лет</dd>
            <dt>Формат работы</dt>
            <dd>{candidate.workFormat}</dd>
            <dt>Ожидания</dt>
            <dd>
              {candidate.salaryMin !== null && candidate.salaryMax !== null
                ? `${candidate.salaryMin.toLocaleString("ru-RU")}–${candidate.salaryMax.toLocaleString("ru-RU")} ₽ / ${candidate.salaryPeriod === "year" ? "год" : "месяц"} · ${candidate.salaryType === "net" ? "на руки" : "до вычета"}`
                : "Не указаны"}
            </dd>
            <dt>Предложения</dt>
            <dd>
              {candidate.readyForOffers
                ? "Готов получать"
                : "Готовность не указана"}
            </dd>
          </dl>
          <div className="bank-evidence">
            <span>
              {candidate.verifiedGrade ? (
                <>
                  Результат своей программы{" "}
                  <b>
                    {candidate.verifiedScore ?? "—"}
                    {candidate.verifiedScore !== null ? " / 100" : ""}
                  </b>
                </>
              ) : (
                "Для грейда нужна полная программа проверки"
              )}
            </span>
          </div>
          <FspSignalDetails signal={candidate.fspSignal}/>
          <small>Дата квалификации: {fmt(candidate.evidenceDate)}</small>
          <details className="bank-proof">
            <summary>Основания навыков</summary>
            {candidate.skillEvidence.length ? (
              <ul>
                {candidate.skillEvidence.map((proof, index) => (
                  <li key={`${proof.skill}-${index}`}>
                    <strong>{proof.skill}</strong> · {fmt(proof.date)}
                    <p>
                      {proof.criterion ?? "Сохранённое подтверждение"}
                      {proof.limitation && ` · ${proof.limitation}`}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Применимых подтверждений нет. Самоописание не считается
                результатом проверки.
              </p>
            )}
          </details>
          {candidate.whySuitable?.length ? (
            <p className="bank-fit-note">
              {candidate.whySuitable.join(" · ")}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

export function CandidateBankPage() {
  const [draft, setDraft] = useState(emptyFilters),
    [filters, setFilters] = useState(emptyFilters),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = useQuery({
    queryKey: ["candidate-bank", filters, page],
    queryFn: () => api<BankResponse>(`/api/employer/candidates?${params}`),
  });
  const update = (key: keyof typeof draft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const apply = (event: FormEvent) => {
    event.preventDefault();
    setFilters({ ...draft });
    setPage(1);
  };
  const reset = () => {
    setDraft(emptyFilters);
    setFilters(emptyFilters);
    setPage(1);
  };
  const input = (
    key: keyof typeof draft,
    title: string,
    placeholder = "",
    numeric = false,
  ) => (
    <FormField label={title} layout="vertical" className="bank-field">
      <input
        id={`bank-filter-${key}`}
        className="input"
        type={numeric ? "number" : "text"}
        min={numeric ? 0 : undefined}
        max={numeric ? key==='experienceMin'||key==='experienceMax'?80:2000000000 : undefined}
        step={numeric?1:undefined}
        value={draft[key]}
        onChange={(e) => update(key, e.target.value)}
        placeholder={placeholder}
        maxLength={numeric ? undefined : key==='q'?120:1600}
      />
    </FormField>
  );
  const yesNo = (key: "fsp" | "hasPhoto" | "readyForOffers", title: string) => (
    <FormField label={title} layout="vertical" className="bank-field">
      <select
        id={`bank-filter-${key}`}
        className="input"
        value={draft[key]}
        onChange={(e) => update(key, e.target.value)}
      >
        <option value="">Неважно</option>
        <option value="yes">Да</option>
        <option value="no">Нет</option>
      </select>
    </FormField>
  );
  return (
    <section className="candidate-bank">
      <div className="page-title">
        <div>
          <div className="eyebrow">ПОИСК СПЕЦИАЛИСТОВ</div>
          <h1>Каталог специалистов</h1>
          <p>
            Один человек — одна карточка. Навыки и условия относятся к
            выбранному резюме. Сначала — кандидаты с подтверждённым грейдом.
          </p>
        </div>
        <Link className="button secondary" href="/employer/matches">
          Подбор под потребность <ArrowRight size={16} />
        </Link>
      </div>
      <form
        className="panel bank-filters"
        onSubmit={apply}
        aria-label="Фильтры каталога специалистов"
      >
        {input("q", "Псевдоним", "Поиск по псевдониму")}
        <FormField label="Специализация" layout="vertical" className="bank-field">
          <select
            id="bank-filter-specialization"
            className="input"
            value={draft.specialization}
            onChange={(e) => update("specialization", e.target.value)}
          >
            <option value="">Все специализации</option>
            {(query.data?.specializations ?? []).map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Подтверждённый грейд" layout="vertical" className="bank-field">
          <select
            id="bank-filter-grade"
            className="input"
            value={draft.grade}
            onChange={(e) => update("grade", e.target.value)}
          >
            <option value="">Любой</option>
            {["Junior", "Middle", "Senior"].map((item) => (
              <option key={item}>{item}</option>
            ))}
            <option value="unconfirmed">Грейд не подтверждён</option>
          </select>
        </FormField>
        {input("skills", "Подтверждённые навыки: все указанные", "Python, SQL")}
        <FormField label="Формат работы" layout="vertical" className="bank-field">
          <DictionaryCombobox
            id="bank-filter-workFormat"
            options={WORK_FORMAT_OPTIONS}
            value={draft.workFormat}
            onChange={(value) => update("workFormat", value)}
            maxLength={120}
            placeholder="Любой или укажите условия"
          />
        </FormField>
        <details className="bank-extra-filters">
          <summary>Опыт, зарплата и доступность</summary>
          <div className="bank-extra-grid">
            {input("experienceMin", "Опыт от, лет", "", true)}
            {input("experienceMax", "Опыт до, лет", "", true)}
            {input("salaryMin", "Зарплата от, ₽", "", true)}
            {input("salaryMax", "Зарплата до, ₽", "", true)}
            <FormField label="Период зарплаты" layout="vertical" className="bank-field">
              <select
                id="bank-filter-salaryPeriod"
                className="input"
                value={draft.salaryPeriod}
                onChange={(e) => update("salaryPeriod", e.target.value)}
              >
                <option value="month">Месяц</option>
                <option value="year">Год</option>
              </select>
            </FormField>
            <FormField label="Расчёт зарплаты" layout="vertical" className="bank-field">
              <select
                id="bank-filter-salaryType"
                className="input"
                value={draft.salaryType}
                onChange={(e) => update("salaryType", e.target.value)}
              >
                <option value="gross">До вычета налогов</option>
                <option value="net">На руки</option>
              </select>
            </FormField>
            {yesNo("hasPhoto", "Доступное фото")}
            {yesNo("readyForOffers", "Готов к предложениям")}
            {yesNo("fsp", "История ФСП")}
            <FormField label="Проверка навыков" layout="vertical" className="bank-field">
              <select
                id="bank-filter-checkedWithinDays"
                className="input"
                value={draft.checkedWithinDays}
                onChange={(e) => update("checkedWithinDays", e.target.value)}
              >
                <option value="">Любая давность</option>
                <option value="30">Последние 30 дней</option>
                <option value="90">Последние 90 дней</option>
                <option value="180">Последние 180 дней</option>
              </select>
            </FormField>
          </div>
        </details>
        <div className="bank-filter-actions">
          <button className="button primary" type="submit">
            <Search size={16} /> Найти
          </button>
          <button className="button ghost" type="button" onClick={reset}>
            Сбросить
          </button>
        </div>
      </form>
      <div className="bank-summary">
        <span role="status">
          {query.isPending
            ? "Ищем специалистов…"
            : query.data
              ? `Найдено людей: ${query.data.total}`
              : ""}
        </span>
        <span>
          <ShieldCheck size={15} /> Контакты доступны по отдельному согласию
        </span>
      </div>
      {query.data && <p className="bank-order-note">{query.data.orderNote}</p>}
      {query.data&&<div className="bank-confirmation-summary" aria-label="Подтверждения после фильтров"><span className="badge badge-verified"><BadgeCheck size={13}/> С грейдом: {query.data.confirmedTotal}</span><span className="badge badge-neutral"><CircleHelp size={13}/> Без грейда: {query.data.unconfirmedTotal}</span></div>}
      {query.isError ? (
        <div className="state-panel error-panel" role="alert">
          <p>{query.error.message || "Не удалось загрузить специалистов."}</p>
          <button className="button secondary" onClick={() => query.refetch()}>
            Повторить
          </button>
        </div>
      ) : query.isPending ? (
        <div className="state-panel" aria-busy="true">
          <div className="skeleton-line wide" />
          <div className="skeleton-line" />
        </div>
      ) : query.data?.candidates.length ? (
        <>
          <div className="bank-grid">
            {query.data.candidates.map((candidate) => (
              <SpecialistCard
                initial={candidate}
                key={`${candidate.candidateId}-${candidate.resumeId}`}
              />
            ))}
          </div>
          <nav className="bank-pagination" aria-label="Страницы специалистов">
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Назад
            </button>
            <span>
              {page} /{" "}
              {Math.max(1, Math.ceil(query.data.total / query.data.pageSize))}
            </span>
            <button
              className="button secondary"
              disabled={page * query.data.pageSize >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Далее
            </button>
          </nav>
        </>
      ) : (
        <div className="empty-state">
          <Users size={30} />
          <h3>
            {query.data?.availableTotal
              ? "Специалисты не совпали с фильтрами"
              : "Пока нет опубликованных резюме"}
          </h3>
          <p>
            {query.data?.availableTotal
              ? `Доступно ${query.data.availableTotal} человек. Попробуйте другие условия.`
              : "Кандидаты сами выбирают публикацию в каталоге. Согласие на подбор не публикует резюме автоматически."}
          </p>
          <button className="button secondary" onClick={reset}>
            Сбросить фильтры
          </button>
        </div>
      )}
    </section>
  );
}
