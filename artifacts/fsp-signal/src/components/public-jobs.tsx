import { CompanyTrustActions } from './trust-center';
import { useResumeSelection } from './multi-resume';
import { useState } from "react";
import { DictionaryCombobox, DictionaryTags, useSkillDictionary } from "./dictionary-input";
import { ROLE_OPTIONS } from "@/lib/professional-dictionaries";
import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  Eye,
  FileText,
  Plus,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  OpportunityField as Field,
  OpportunityFeedback,
  OpportunityStatus,
  Salary,
  opportunityApi,
  useOpportunityAction,
  useOpportunityDraft,
} from "./opportunity-ui";
type Job = {
  id: number;
  companyId: number;
  companyName: string;
  version: number;
  title: string;
  description: string;
  specialization: string;
  grade: string;
  skills: string[];
  workFormat: string;
  salaryMin: number;
  salaryMax: number;
  salaryPeriod: "month" | "year";
  salaryType: "gross" | "net";
  status: string;
};
const emptyJob = {
  title: "",
  description: "",
  specialization: "Backend / Python",
  grade: "Middle",
  skills: [] as string[],
  workFormat: "Удалённо",
  salaryMin: 150000,
  salaryMax: 220000,
  salaryPeriod: "month" as const,
  salaryType: "gross" as const,
};
function JobSummary({ job }: { job: Job }) {
  return (
    <>
      <div className="opportunity-tags">
        <span>{job.specialization}</span>
        <span>От {job.grade}</span>
        <span>{job.workFormat}</span>
      </div>
      <Salary job={job} />
    </>
  );
}

export function CandidateJobsPage({
  publicOnly = false,
}: {
  publicOnly?: boolean;
}) {
  const resumeSelection = useResumeSelection();
  const query = useQuery({
    queryKey: ["public-jobs"],
    queryFn: () => opportunityApi<Job[]>("/public/jobs"),
  });
  const applications = useQuery({
    queryKey: ["my-applications"],
    queryFn: () => opportunityApi<any[]>("/me/applications"),
    enabled: !publicOnly,
  });
  const permissions = useQuery({
    queryKey: ["contact-permissions"],
    queryFn: () => opportunityApi<any[]>("/me/contact-permissions"),
    enabled: !publicOnly,
  });
  const me = useQuery({
    queryKey: ["opportunity-me"],
    queryFn: () => opportunityApi("/me"),
    enabled: !publicOnly,
  });
  const [tab, setTab] = useState("jobs");
  const [selected, setSelected] = useState<number | null>(null);
  const act = useOpportunityAction([
    "public-jobs",
    "my-applications",
    "contact-permissions",
  ]);
  return (
    <div className="opportunity-page">
      <header>
        <h1>Открытые вакансии</h1>
        <p className="opportunity-intro">
          Конкретные задачи, понятные условия и зарплата. Выберите предложение и
          сами решите, какой компании представиться.
        </p>
      </header>
      {!publicOnly && (
        <div className="opportunity-tabs">
          <button
            className={`button ${tab === "jobs" ? "" : "secondary"}`}
            onClick={() => setTab("jobs")}
          >
            <BriefcaseBusiness size={17} /> Вакансии
          </button>
          <button
            className={`button ${tab === "applications" ? "" : "secondary"}`}
            onClick={() => setTab("applications")}
          >
            <Send size={17} /> Мои отклики · {applications.data?.length ?? 0}
          </button>
          <button
            className={`button ${tab === "privacy" ? "" : "secondary"}`}
            onClick={() => setTab("privacy")}
          >
            <ShieldCheck size={17} /> Доступ компаний
          </button>
        </div>
      )}
      <OpportunityFeedback error={act.error} />
      {tab === "jobs" && (
        <>
          {query.isLoading && <p role="status">Загружаем вакансии…</p>}
          {query.isError && (
            <div role="alert">
              <p>Вакансии временно недоступны.</p>
              <button
                className="button secondary"
                onClick={() => query.refetch()}
              >
                Повторить
              </button>
            </div>
          )}
          {query.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Пока нет открытых вакансий. Новые предложения появятся здесь после
              публикации работодателями.
            </div>
          )}
          <div className="opportunity-grid">
            {query.data?.map((job) => (
              <article className="panel opportunity-card" key={job.id}>
                <small>
                  <Building2 size={14} /> {job.companyName}
                </small>
                <h2>{job.title}</h2>
                <JobSummary job={job} />{!publicOnly && <CompanyTrustActions companyId={job.companyId} objectType="job" objectId={job.id}/>}
                <button
                  className="button secondary"
                  onClick={() =>
                    setSelected(selected === job.id ? null : job.id)
                  }
                  aria-expanded={selected === job.id}
                >
                  Условия вакансии <ChevronDown size={16} />
                </button>
                {selected === job.id && (
                  <div className="opportunity-detail">
                    <p className="opportunity-description">{job.description}</p>
                    <div className="opportunity-tags">
                      {job.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                    {publicOnly ? (
                      <a className="button" href="/auth?role=candidate">
                        Войти и откликнуться
                      </a>
                    ) : applications.data?.some((a) => a.jobId === job.id) ? (
                      <p>
                        <Check size={16} /> Вы уже откликнулись. Статус — в
                        разделе «Мои отклики».
                      </p>
                    ) : (
                      <ApplicationForm resumeId={resumeSelection.resumeId}
                        key={`${me.data?.user.id}-${job.id}-${job.version}-${resumeSelection.resumeId}`}
                        job={job}
                        ownerId={me.data?.user.id ?? 0}
                      />
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "applications" && (
        <div className="opportunity-list">
          {applications.isLoading && <p>Загружаем отклики…</p>}
          {applications.isError && (
            <p role="alert">
              Не удалось загрузить отклики.{" "}
              <button
                className="button secondary"
                onClick={() => applications.refetch()}
              >
                Повторить
              </button>
            </p>
          )}
          {applications.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Вы пока не откликались на вакансии.
            </div>
          )}
          {applications.data?.map((a) => (
            <article className="panel opportunity-card" key={a.id}>
              <header>
                <div>
                  <small>{a.snapshot.companyName}</small>
                  <h2>{a.snapshot.title}</h2>
                </div>
                <OpportunityStatus status={a.status} />
              </header>
              <Salary job={a.snapshot} />
              <details>
                <summary>
                  <FileText size={16} /> Условия на момент отклика · версия{" "}
                  {a.snapshot.version}
                </summary>
                <p className="opportunity-description">
                  {a.snapshot.description}
                </p>
                <p>{a.message}</p>
              </details>
              <small>
                {new Date(a.createdAt).toLocaleString("ru-RU")} ·{" "}
                {a.contactShared
                  ? "Компания имеет доступ к контактам"
                  : "Доступ к контактам отозван"}
              </small>
              {a.status !== "withdrawn" && (
                <button
                  className="button secondary danger"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate({ path: `/me/applications/${a.id}/withdraw` })
                  }
                >
                  Отозвать отклик и доступ компании
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      {tab === "privacy" && (
        <div className="opportunity-list">
          <p className="opportunity-intro">
            Отзыв закрывает дальнейший доступ компании по всем её приглашениям и
            вашим откликам. Уже полученные компанией сведения нельзя удалить с
            её устройств через Signal.
          </p>
          {permissions.isError && (
            <p role="alert">Не удалось загрузить разрешения.</p>
          )}
          {permissions.data &&
            [...new Set(permissions.data.map((p) => p.companyId))].map((id) => {
              const rows = permissions.data!.filter((p) => p.companyId === id);
              const active = rows.filter((p) => !p.revokedAt);
              return (
                <article key={id} className="panel opportunity-card">
                  <h2>{rows[0].companyName}</h2>
                  <small>Оснований доступа: {active.length}</small>
                  {rows.map((p) => (
                    <div key={p.id}>
                      {p.invitationId
                        ? `Приглашение № ${p.invitationId}`
                        : `Отклик № ${p.applicationId}`}{" "}
                      · {p.revokedAt ? "отозвано" : "активно"}
                    </div>
                  ))}
                  {!!active.length && (
                    <button
                      className="button secondary danger"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({
                          path: `/me/contact-permissions/${id}/revoke`,
                        })
                      }
                    >
                      Отозвать весь доступ компании
                    </button>
                  )}
                </article>
              );
            })}
          {permissions.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Вы ещё не открывали доступ компаниям.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function ApplicationForm({ job, ownerId, resumeId }: { job: Job; ownerId: number; resumeId: number | null }) {
  const [message, setMessage] = useOpportunityDraft(
    `signal-job-message-${ownerId}-${job.id}-${resumeId}`,
    "",
  );
  const [consent, setConsent] = useState(false);
  const action = useOpportunityAction([
    "my-applications",
    "contact-permissions",
  ]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate({
          path: `/jobs/${job.id}/applications`,
          body: {
            message,
            consentDisclosure: consent,
            resumeId,
            companyId: job.companyId,
            jobVersion: job.version,
          },
        });
      }}
    >
      <fieldset disabled={action.isPending || !resumeId} className="opportunity-list">
        <Field label="Коротко о вашем интересе к роли">
          <textarea
            className="input"
            maxLength={2000}
            rows={3}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
        <label className="opportunity-check">
          <input
            type="checkbox"
            checked={consent}
            required
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Передать компании <b>{job.companyName}</b> моё имя, email, телефон
            (если указан), профессиональный псевдоним, специализацию,
            подтверждённую категорию и это письмо. Контакты откроются только
            этой компании. Отклик не является рекомендацией Signal.
          </span>
        </label>
        <button className="button" disabled={!consent || action.isPending}>
          <Send size={16} /> {action.isPending ? "Отправляем…" : "Откликнуться"}
        </button>
      </fieldset>
      <OpportunityFeedback error={action.error} />
    </form>
  );
}

export function EmployerJobsPage() {
  const query = useQuery({
    queryKey: ["employer-jobs"],
    queryFn: () => opportunityApi<Job[]>("/employer/jobs"),
  });
  const me = useQuery({
    queryKey: ["opportunity-me"],
    queryFn: () => opportunityApi("/me"),
  });
  const applications = useQuery({
    queryKey: ["employer-applications"],
    queryFn: () => opportunityApi<any[]>("/employer/applications"),
  });
  const [edit, setEdit] = useState<Job | "new" | null>(null);
  const [tab, setTab] = useState("jobs");
  const act = useOpportunityAction(["employer-jobs", "employer-applications"]);
  return (
    <div className="opportunity-page">
      <header>
        <h1>Вакансии и отклики</h1>
        <p className="opportunity-intro">
          Опубликуйте задачу команды с зарплатой. Приватные потребности для
          подбора остаются в отдельном разделе и автоматически сюда не попадают.
        </p>
      </header>
      <div className="opportunity-tabs">
        <button
          className={`button ${tab === "jobs" ? "" : "secondary"}`}
          onClick={() => setTab("jobs")}
        >
          <BriefcaseBusiness size={17} /> Публикации
        </button>
        <button
          className={`button ${tab === "applications" ? "" : "secondary"}`}
          onClick={() => setTab("applications")}
        >
          <Send size={17} /> Отклики · {applications.data?.length ?? 0}
        </button>
        {tab === "jobs" && (
          <button className="button secondary" onClick={() => setEdit("new")}>
            <Plus size={17} /> Создать вакансию
          </button>
        )}
      </div>
      <OpportunityFeedback error={act.error} />
      {edit && me.data && (
        <JobEditor
          key={edit === "new" ? `new-${me.data.user.id}` : edit.id}
          job={edit === "new" ? undefined : edit}
          ownerId={me.data.user.id}
          close={() => setEdit(null)}
        />
      )}
      {tab === "jobs" && (
        <>
          {query.isLoading && <p role="status">Загружаем публикации…</p>}
          {query.isError && (
            <p role="alert">
              Не удалось загрузить публикации.{" "}
              <button
                className="button secondary"
                onClick={() => query.refetch()}
              >
                Повторить
              </button>
            </p>
          )}
          {query.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Создайте первую вакансию. Она сохранится в черновиках: публикация
              — отдельное действие.
            </div>
          )}
          <div className="opportunity-grid">
            {query.data?.map((job) => (
              <article className="panel opportunity-card" key={job.id}>
                <header>
                  <h2>{job.title}</h2>
                  <OpportunityStatus status={job.status} />
                </header>
                <JobSummary job={job} />
                <p>
                  {job.description.slice(0, 180)}
                  {job.description.length > 180 ? "…" : ""}
                </p>
                <small>
                  Версия {job.version}. Изменения не переписывают уже полученные
                  отклики.
                </small>
                <div className="opportunity-actions">
                  {job.status !== "archived" && (
                    <button
                      className="button secondary"
                      onClick={() => setEdit(job)}
                    >
                      Редактировать
                    </button>
                  )}
                  {["draft", "closed"].includes(job.status) && (
                    <button
                      className="button"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({
                          path: `/employer/jobs/${job.id}/status`,
                          body: { status: "published" },
                        })
                      }
                    >
                      Опубликовать
                    </button>
                  )}
                  {job.status === "published" && (
                    <button
                      className="button secondary"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({
                          path: `/employer/jobs/${job.id}/status`,
                          body: { status: "closed" },
                        })
                      }
                    >
                      Закрыть приём
                    </button>
                  )}
                  {["draft", "closed"].includes(job.status) && (
                    <button
                      className="button secondary"
                      disabled={act.isPending}
                      onClick={() =>
                        act.mutate({
                          path: `/employer/jobs/${job.id}/status`,
                          body: { status: "archived" },
                        })
                      }
                    >
                      В архив
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab === "applications" && (
        <div className="opportunity-list">
          {applications.isError && (
            <p role="alert">Отклики временно недоступны.</p>
          )}
          {applications.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Самостоятельные отклики на ваши публикации появятся здесь.
            </div>
          )}
          {applications.data?.map((a) => (
            <EmployerApplication key={a.id} application={a} />
          ))}
        </div>
      )}
    </div>
  );
}
function JobEditor({
  job,
  ownerId,
  close,
}: {
  job?: Job;
  ownerId: number;
  close: () => void;
}) {
  const fromJob = job
    ? (Object.fromEntries(
        Object.keys(emptyJob).map((key) => [key, job[key as keyof Job]]),
      ) as typeof emptyJob)
    : emptyJob;
  const [draft, setDraft] = useOpportunityDraft(
    `signal-job-draft-${ownerId}-${job?.id ?? "new"}`,
    fromJob,
  );
  const skills = useSkillDictionary();
  const action = useOpportunityAction(["employer-jobs"]);
  const set = (key: keyof typeof draft, value: unknown) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="panel opportunity-form"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate(
          {
            path: job ? `/employer/jobs/${job.id}` : "/employer/jobs",
            method: job ? "PUT" : "POST",
            body: draft,
          },
          {
            onSuccess: () => {
              sessionStorage.removeItem(
                `signal-job-draft-${ownerId}-${job?.id ?? "new"}`,
              );
              close();
            },
          },
        );
      }}
    >
      <div className="opportunity-form-title">
        <h2>{job ? "Редактировать условия" : "Новая вакансия"}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Закрыть редактор вакансии"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <fieldset disabled={action.isPending} className="opportunity-list">
        <Field label="Название роли">
          <DictionaryCombobox required minLength={3} maxLength={160} value={draft.title}
            onChange={value => set("title", value)} options={ROLE_OPTIONS} allowCustom />
        </Field>
        <Field label="Задачи, требования и условия">
          <textarea
            className="input"
            required
            minLength={30}
            maxLength={6000}
            rows={5}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <div className="opportunity-form-grid">
          <Field label="Специализация">
            <select
              className="input"
              value={draft.specialization}
              onChange={(e) => set("specialization", e.target.value)}
            >
              <option>Backend / Python</option>
              <option>Frontend / TypeScript</option>
            </select>
          </Field>
          <Field label="Минимальная категория">
            <select
              className="input"
              value={draft.grade}
              onChange={(e) => set("grade", e.target.value)}
            >
              <option>Junior</option>
              <option>Middle</option>
              <option>Senior</option>
            </select>
          </Field>
          <Field label="Зарплата от, ₽">
            <input
              className="input"
              type="number"
              required
              min={1}
              max={100000000}
              value={draft.salaryMin}
              onChange={(e) => set("salaryMin", Number(e.target.value))}
            />
          </Field>
          <Field label="Зарплата до, ₽">
            <input
              className="input"
              type="number"
              required
              min={draft.salaryMin}
              max={100000000}
              value={draft.salaryMax}
              onChange={(e) => set("salaryMax", Number(e.target.value))}
            />
          </Field>
          <Field label="Период">
            <select
              className="input"
              value={draft.salaryPeriod}
              onChange={(e) => set("salaryPeriod", e.target.value)}
            >
              <option value="month">В месяц</option>
              <option value="year">В год</option>
            </select>
          </Field>
          <Field label="Налоги">
            <select
              className="input"
              value={draft.salaryType}
              onChange={(e) => set("salaryType", e.target.value)}
            >
              <option value="gross">До налогов</option>
              <option value="net">На руки</option>
            </select>
          </Field>
          <Field label="Формат работы">
            <select
              className="input"
              value={draft.workFormat}
              onChange={(e) => set("workFormat", e.target.value)}
            >
              <option>Удалённо</option>
              <option>Гибрид</option>
              <option>Офис</option>
            </select>
          </Field>
          <Field label="Требуемые навыки">
            <DictionaryTags value={draft.skills} onChange={value => set("skills", value)}
              options={skills.data ?? []} allowCustom maxItems={20} maxLength={60} />
            <small>Можно сохранить собственные требования. Они не становятся подтверждёнными навыками кандидата автоматически.</small>
          </Field>
        </div>
        <button className="button">
          <Check size={16} />{" "}
          {action.isPending
            ? "Сохраняем…"
            : job
              ? "Сохранить новую версию"
              : "Сохранить черновик"}
        </button>
      </fieldset>
      <OpportunityFeedback error={action.error} />
    </form>
  );
}
function EmployerApplication({ application: a }: { application: any }) {
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<any>(null);
  const action = useOpportunityAction(["employer-applications"]);
  return (
    <article className="panel opportunity-card">
      <header>
        <div>
          <small>{a.snapshot.title}</small>
          <h2>{a.candidate?.alias || "Кандидат отозвал доступ"}</h2>
        </div>
        <OpportunityStatus status={a.status} />
      </header>
      {a.candidate && (
        <p>
          {a.candidate.specialization} ·{" "}
          {a.candidate.verifiedGrade || "Категория не подтверждена"}
        </p>
      )}
      <button
        className="button secondary"
        onClick={() => {
          setOpen(!open);
          if (!open && a.status === "sent")
            action.mutate({
              path: `/employer/applications/${a.id}/status`,
              body: { status: "viewed" },
            });
        }}
      >
        <Eye size={16} /> {open ? "Свернуть отклик" : "Открыть отклик"}
      </button>
      {open && (
        <div className="opportunity-detail">
          <Salary job={a.snapshot} />
          <p>{a.message || "Без сопроводительного письма"}</p>
          <details>
            <summary>Исходные условия · версия {a.snapshot.version}</summary>
            <p className="opportunity-description">{a.snapshot.description}</p>
          </details>
          <div className="opportunity-actions">
            {!["withdrawn", "declined"].includes(a.status) && (
              <>
                <button
                  className="button"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      path: `/employer/applications/${a.id}/status`,
                      body: { status: "shortlisted" },
                    })
                  }
                >
                  В рассмотрение
                </button>
                <button
                  className="button secondary"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      path: `/employer/applications/${a.id}/status`,
                      body: { status: "declined" },
                    })
                  }
                >
                  Отказать
                </button>
              </>
            )}
            {a.contactShared && (
              <button
                className="button secondary"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate(
                    {
                      path: `/employer/applications/${a.id}/contacts`,
                      method: "GET",
                    },
                    {
                      onSuccess: setContacts,
                      onError: () => setContacts(null),
                    },
                  )
                }
              >
                Открыть контакты
              </button>
            )}
          </div>
          {a.contactShared && contacts && (
            <div className="opportunity-contact">
              <b>{contacts.displayName}</b>
              <span>{contacts.email}</span>
              <span>{contacts.phone}</span>
            </div>
          )}
          <OpportunityFeedback error={action.error} />
        </div>
      )}
    </article>
  );
}
