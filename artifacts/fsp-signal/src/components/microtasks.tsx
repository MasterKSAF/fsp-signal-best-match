import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { professionLabel } from "@/lib/employer-workspace-navigation";
import "./employer-workspace.css";
import "./employer-task-answer.css";
import { employerTaskAnswerView } from "@/lib/employer-task-answer";
import { InlineInfo } from "./inline-info";
import { DictionaryCombobox, useSkillDictionary } from "./dictionary-input";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Lightbulb,
  Pause,
  Play,
  Plus,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  OpportunityField as Field,
  OpportunityFeedback,
  OpportunityStatus,
  opportunityApi,
  useOpportunityAction,
  useOpportunityDraft,
} from "./opportunity-ui";

const example = {
  jobId: 0,
  title: "Надёжный учебный счётчик",
  specialization: "Backend / Python",
  competency: "Обработка повторов",
  scenario:
    "Учебный сервис считает посещения вымышленной библиотеки. Клиент может повторить один запрос после сбоя сети. Предложите формат запроса, правило обработки повторного идентификатора и два тестовых сценария. Используйте только вымышленные данные. Код для внедрения и доступ к системам компании не нужны.",
  expectedMinutes: 20,
  intervalDays: 7,
  deadlineDays: 3,
  educationalOnly: true as const,
  rubric: [
    {
      id: "idempotency",
      label: "Явное правило идентификатора и повторного запроса",
      maxPoints: 4,
    },
    {
      id: "consistency",
      label: "Объяснена атомарность записи результата",
      maxPoints: 3,
    },
    {
      id: "tests",
      label: "Два проверяемых сценария с ожидаемым результатом",
      maxPoints: 3,
    },
  ],
};
const candidateKeys = ["my-microtasks"];
const employerKeys = [
  "employer-microtasks",
  "employer-micro-offers",
  "micro-eligible",
  "employer-micro-recipients",
  "micro-job-options",
];
function ResumeContext({ binding }: { binding: any }) {
  return <div className="opportunity-detail">
    <b>{binding.resumeContext?.title ?? (binding.resumeProvenance === "captured" ? "Контекст резюме недоступен" : "Резюме не сохранено")}</b>
    {binding.resumeContext ? <p className="muted">{professionLabel(binding.resumeContext.specialization)} · {binding.resumeContext.verifiedGrade}</p>
      : binding.resumeProvenance === "legacy_unbound" ? <p className="muted">Прежняя запись без снимка резюме. Ей не назначается текущее основное резюме.</p> : null}
    {binding.resumeLimitation && <small role="status">{binding.resumeLimitation}</small>}
  </div>;
}
function Conditions({ offer }: { offer: any }) {
  return (
    <>
      <div className="opportunity-tags">
        <span>Задача компании · грейд Signal не меняет</span>
        <span>
          <BookOpen size={13} /> {offer.snapshot.competency}
        </span>
        <span>
          <Clock3 size={13} /> {offer.snapshot.expectedMinutes} мин.
        </span>
        <span>Версия {offer.snapshot.version}</span>
      </div>
      {(offer.job ?? offer.snapshot.job) && <p className="micro-job-context">Вакансия: <b>{(offer.job ?? offer.snapshot.job).title}</b></p>}
      {offer.assignmentLimitation && <p className="muted" role="status">{offer.assignmentLimitation}</p>}
      <ResumeContext binding={offer} />
      <p className="opportunity-description">{offer.snapshot.scenario}</p>
      <ul className="opportunity-rubric">
        {offer.snapshot.rubric.map((r: any) => (
          <li key={r.id}>
            {r.label} — до {r.maxPoints} баллов
          </li>
        ))}
      </ul>
      <small className="opportunity-due">
        Ответ до {new Date(offer.dueAt).toLocaleString("ru-RU")}
      </small>
    </>
  );
}
function Result({ offer }: { offer: any }) {
  const result = offer.result;
  if (!result) return null;
  return (
    <div className="opportunity-detail">
      <h3>
        {result.total} из {result.max} · {result.competency}
      </h3>
      <small>
        Оценка компании {offer.snapshot.companyName} ·{" "}
        {new Date(result.evaluatedAt).toLocaleDateString("ru-RU")} · версия{" "}
        {result.templateVersion}
      </small>
      <p className="muted">Отдельный результат задачи компании. Это не квалификационный экзамен и не подтверждение грейда Signal.</p>
      {result.scores.map((s: any) => (
        <p key={s.criterionId}>
          <b>
            {
              offer.snapshot.rubric.find((r: any) => r.id === s.criterionId)
                ?.label
            }
            : {s.points}
          </b>
          <br />
          {s.comment}
        </p>
      ))}
      <p>{result.feedback}</p>
      <small>{offer.snapshot.limits}</small>
    </div>
  );
}

export function CandidateMicrotasksPage() {
  const params = new URLSearchParams(useSearch());
  const jobId = Number(params.get("jobId")) || null;
  const [, navigate] = useLocation();
  const query = useQuery({
    queryKey: ["my-microtasks", jobId],
    queryFn: () => opportunityApi(`/me/microtasks${jobId ? `?jobId=${jobId}` : ""}`),
    refetchInterval: 60000,
  });
  const act = useOpportunityAction(candidateKeys);
  return (
    <div className="opportunity-page">
      <header className="page-title">
        <div>
          <h1>Практика компаний<InlineInfo label="Практика компаний: подробнее">Добровольные учебные ситуации на 5–45 минут. Обратная связь компании не присваивает грейд Signal; рабочие задачи и реальные клиентские данные сюда не входят.</InlineInfo></h1>

        </div>
      </header>
      {jobId && <button className="button secondary" onClick={() => navigate("/candidate/microtasks")}>Все задания</button>}
      {query.isLoading && <p role="status">Загружаем задания…</p>}
      {query.isError && (
        <div role="alert">
          Не удалось загрузить задания.{" "}
          <button className="button secondary" onClick={() => query.refetch()}>
            Повторить
          </button>
        </div>
      )}
      {query.data && (
        <>
          <section className="panel opportunity-settings">
            <div>
              <h2>Предложения от компаний<InlineInfo label="Расписание и отключение предложений">Не чаще одного задания за 7 дней. Нужны подтверждённая категория и согласие на подбор выбранного резюме. Отключение остановит подписки и незавершённые задания; сохранённые результаты останутся.</InlineInfo></h2>
            </div>
            <button
              className={`button ${query.data.enabled ? "secondary" : ""}`}
              aria-pressed={query.data.enabled}
              disabled={act.isPending}
              onClick={() =>
                act.mutate({
                  path: "/me/microtasks/preferences",
                  method: "PUT",
                  body: { enabled: !query.data.enabled },
                })
              }
            >
              {query.data.enabled ? <Pause size={17} /> : <Play size={17} />}
              {query.data.enabled
                ? "Остановить предложения"
                : "Разрешить предложения"}
            </button>
          </section>
          <OpportunityFeedback error={act.error} />
          {query.data.subscriptions.length > 0 && (
            <section className="panel opportunity-card">
              <h2>Регулярные программы</h2>
              {query.data.subscriptions.map((s: any) => (
                <div className="opportunity-subscription" key={s.id}>
                  <div>
                    <b>{s.title}</b>
                    {s.job && <p className="micro-job-context">Вакансия: {s.job.title}</p>}
                    <ResumeContext binding={s} />
                    <small>
                      {s.companyName} ·{" "}
                      {s.active
                        ? `Следующее предложение не ранее ${new Date(s.nextDueAt).toLocaleDateString("ru-RU")}`
                        : "Приостановлено"}
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    disabled={
                      act.isPending || (!s.active && (!query.data.enabled || !s.resumeAvailable || !s.assignmentAvailable))
                    }
                    onClick={() =>
                      act.mutate({
                        path: `/me/microtasks/subscriptions/${s.id}`,
                        body: { active: !s.active },
                      })
                    }
                  >
                    {s.active ? "Приостановить" : "Возобновить"}
                  </button>
                </div>
              ))}
            </section>
          )}
          {query.data.offers.length === 0 && (
            <section className="panel opportunity-empty">
              <Lightbulb size={22} />
              <p>
                {query.data.enabled
                  ? "Пока предложений нет. Компания сможет пригласить вас на подходящее учебное задание."
                  : "Включите предложения, когда захотите попробовать короткую практику. Участие добровольное."}
              </p>
            </section>
          )}
          <div className="opportunity-grid">
            {query.data.offers.map((offer: any) => (
              <CandidateOffer key={offer.id} offer={offer} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function CandidateOffer({ offer }: { offer: any }) {
  const [consent, setConsent] = useState(false);
  const [answer, setAnswer] = useOpportunityDraft(
    `signal-micro-answer-${offer.candidateUserId}-${offer.id}`,
    offer.answer || "",
  );
  const act = useOpportunityAction(candidateKeys);
  return (
    <article className="panel opportunity-card">
      <header>
        <div>
          <small>{offer.snapshot.companyName}</small>
          <h2>{offer.snapshot.title}</h2>
        </div>
        <OpportunityStatus status={offer.status} />
      </header>
      <Conditions offer={offer} />
      {offer.status === "offered" && (
        <div className="opportunity-list">
          <label className="opportunity-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Разрешаю компании <b>{offer.snapshot.companyName}</b> прочитать и
              оценить мой ответ. Контакты не передаются; оценка останется между
              мной и этой компанией, пока я сам не разрешу показ результата.
            </span>
          </label>
          <div className="opportunity-actions">
            <button
              className="button"
              disabled={!consent || act.isPending || !offer.assignmentAvailable}
              onClick={() =>
                act.mutate({
                  path: `/me/microtasks/${offer.id}/decision`,
                  body: { decision: "accept", consentCompanyReview: true },
                })
              }
            >
              <Check size={16} /> Принять
            </button>
            <button
              className="button secondary"
              disabled={act.isPending}
              onClick={() =>
                act.mutate({
                  path: `/me/microtasks/${offer.id}/decision`,
                  body: { decision: "decline" },
                })
              }
            >
              Отказаться
            </button>
          </div>
        </div>
      )}
      {offer.status === "accepted" && offer.assignmentAvailable && (
        <form
          className="opportunity-list"
          onSubmit={(event) => {
            event.preventDefault();
            act.mutate({
              path: `/me/microtasks/${offer.id}/submit`,
              body: { answer },
            });
          }}
        >
          <Field label="Ваше решение">
            <textarea
              className="input"
              rows={7}
              required
              minLength={10}
              maxLength={10000}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            />
          </Field>
          <small>
            Черновик сохраняется в этой вкладке. После отправки ответ нельзя
            изменить.
          </small>
          <button className="button" disabled={act.isPending}>
            <Send size={16} /> Отправить на проверку
          </button>
        </form>
      )}
      {offer.answer &&
        ["submitted", "evaluated", "withdrawn"].includes(offer.status) && (
          <details>
            <summary>
              <ChevronDown size={16} /> Мой отправленный ответ
            </summary>
            <p className="opportunity-description">{offer.answer}</p>
          </details>
        )}
      <Result offer={offer} />
      {offer.result && !offer.consentRevokedAt && offer.resumeAvailable && (
        <label className="opportunity-check">
          <input
            type="checkbox"
            checked={offer.shareResult}
            disabled={act.isPending}
            onChange={(e) =>
              act.mutate({
                path: `/me/microtasks/${offer.id}/visibility`,
                body: { shareResult: e.target.checked },
              })
            }
          />
          <span>
            Разрешить другим работодателям с доступом к этому резюме видеть
            компетенцию, рубрику, баллы, отзыв и название компании. Ответ
            останется закрытым.
          </span>
        </label>
      )}
      {!offer.consentRevokedAt &&
        ["accepted", "submitted", "evaluated"].includes(offer.status) && (
          <button
            className="button secondary danger"
            disabled={act.isPending}
            onClick={() =>
              act.mutate({ path: `/me/microtasks/${offer.id}/revoke` })
            }
          >
            <ShieldCheck size={15} /> Отозвать доступ к ответу и результату
          </button>
        )}
      {offer.consentRevokedAt && (
        <small>
          Доступ компании отозван. Ваши записи сохранены; новые предложения этой
          программы остановлены.
        </small>
      )}
      <OpportunityFeedback error={act.error} />
    </article>
  );
}

export function EmployerMicrotasksPage() {
  const templates = useQuery({ queryKey: ["employer-microtasks"], queryFn: () => opportunityApi<any[]>("/employer/microtasks"), staleTime: 0, refetchInterval: 30000 });
  const me = useQuery({ queryKey: ["opportunity-me"], queryFn: () => opportunityApi("/me") });
  const params = new URLSearchParams(useSearch()), [,navigate] = useLocation();
  const templateId = Number(params.get("task")), jobId = Number(params.get("jobId")) || null;
  const tab = ["answers", "recipients"].includes(params.get("tab") ?? "") ? params.get("tab")! : "task";
  const filter = ["new", "evaluated"].includes(params.get("filter") ?? "") ? params.get("filter")! : "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const profileOfferId = params.get("profile") === "1" ? Number(params.get("offer")) : null;
  const selected = !templates.isError && templates.data?.find(item => item.id === templateId);
  const [edit,setEdit] = useState<any>(null);
  const list = useQuery({ queryKey: [tab === "recipients" ? "employer-micro-recipients" : "employer-micro-offers", templateId, filter, page],
    queryFn: () => opportunityApi(`/employer/microtasks/${templateId}/${tab === "recipients" ? "recipients" : "answers"}?filter=${filter}&page=${page}&pageSize=20`),
    enabled: !!selected && tab !== "task", staleTime: 0, gcTime: 0, retry: false, refetchInterval: 30000, refetchOnWindowFocus: "always" });
  const open = (id:number, nextTab="task", nextFilter="all", nextPage=1) => {
    setEdit(null); const next = new URLSearchParams({ task: String(id), tab: nextTab });
    if (jobId) next.set("jobId", String(jobId));
    if (nextTab === "answers" && nextFilter !== "all") next.set("filter", nextFilter);
    if (nextPage > 1) next.set("page", String(nextPage));
    navigate(`/employer/microtasks?${next}`);
  };
  const close = () => navigate(`/employer/microtasks${jobId ? `?jobId=${jobId}` : ""}`);
  useEffect(() => {setEdit(null);}, [templateId]);
  const items: any[] = list.isError || list.isFetching ? [] : list.data?.items ?? [];
  const visibleTemplates = templates.data?.filter(t => !jobId || t.jobId === jobId) ?? [];
  const filterLabels: Record<string,string> = {all:"Все ответы",new:"Новые",evaluated:"Проверены"};
  return <div className="opportunity-page employer-workspace">
    <header className="page-title"><h1>Задания кандидатам<InlineInfo label="Задания кандидатам: подробнее">Добровольная учебная практика по вакансии с обратной связью компании. Результат задания не присваивает грейд Signal.</InlineInfo></h1><button className="button primary" onClick={()=>setEdit("new")}><Plus size={17}/>Создать задание</button></header>
    {jobId && <button className="button secondary" onClick={()=>navigate("/employer/microtasks")}>Все вакансии</button>}
    {edit && me.data && <MicroEditor key={edit === "new" ? `new-${me.data.user.id}-${jobId}` : `${edit.id}-${edit.version}`} template={edit === "new" ? null : edit} initialJobId={jobId} ownerId={me.data.user.id} close={()=>{setEdit(null); void templates.refetch();}}/>}
    {me.isError && edit && <p role="alert">Не удалось открыть редактор. <button className="button secondary" onClick={()=>me.refetch()}>Повторить</button></p>}
    {templates.isLoading ? <p role="status">Загружаем задания…</p> : templates.isError ? <div className="panel opportunity-empty" role="alert">Не удалось загрузить задания. <button className="button secondary" onClick={()=>templates.refetch()}>Повторить</button></div> : <>
      {!visibleTemplates.length && <div className="panel opportunity-empty">Заданий пока нет. Выберите вакансию и создайте учебную ситуацию с критериями оценки.</div>}
      <div className="employer-task-list">{visibleTemplates.map(t=><article className="panel employer-task-row" key={t.id}>
        <button className="employer-task-open" onClick={()=>open(t.id)}><h2>{t.title}</h2><p>{t.competency} · {professionLabel(t.specialization)} · {t.expectedMinutes} мин.</p><small>{t.job ? `Вакансия: ${t.job.title}` : "История задания без вакансии"}</small></button>
        <span className="opportunity-status">{t.active ? "Активно" : "Приостановлено"}</span>
        <div className="employer-task-counters"><button className="employer-counter" onClick={()=>open(t.id,"answers","all")}>Ответы <b>{t.answerCount ?? 0}</b></button><button className="employer-counter applications" onClick={()=>open(t.id,"answers","new")}>Новые <b>{t.newAnswerCount ?? 0}</b></button><button className="employer-counter shortlisted" onClick={()=>open(t.id,"answers","evaluated")}>Проверены <b>{t.evaluatedAnswerCount ?? 0}</b></button><button className="employer-counter" onClick={()=>open(t.id,"recipients")}>Адресаты <b>{t.recipientCount ?? 0}</b></button></div>
      </article>)}</div>
      {templateId && !selected ? <div className="panel opportunity-empty">Задание недоступно. <button className="button secondary" onClick={close}>К заданиям</button></div> : null}
      {selected && <section className="panel employer-task-detail">
        <div className="opportunity-form-title"><h2>{selected.title}</h2><button className="icon-button" aria-label="Закрыть задание" onClick={close}><X size={18}/></button></div>
        <div className="opportunity-tabs" role="tablist" aria-label="Содержание задания">{[["task","Задание"],["answers",`Ответы · ${selected.answerCount ?? 0}`],["recipients",`Адресаты · ${selected.recipientCount ?? 0}`]].map(([key,label])=><button key={key} role="tab" aria-selected={tab === key} className={`button ${tab === key ? "" : "secondary"}`} onClick={()=>open(templateId,key)}>{label}</button>)}</div>
        {tab === "task" ? <EmployerTemplate key={`${selected.id}-${selected.version}`} template={selected} edit={()=>setEdit(selected.jobId ? selected : "new")}/> : <>
          {tab === "answers" && <div className="micro-answer-filters" aria-label="Фильтр ответов">{Object.entries(filterLabels).map(([key,label])=><button key={key} className={`button ${filter === key ? "" : "secondary"}`} aria-pressed={filter === key} onClick={()=>open(templateId,"answers",key)}>{label}</button>)}</div>}
          {profileOfferId && !list.isFetching && !list.isError && list.data && !items.some(item => item.id === profileOfferId) && <p className="muted" role="status">Ответ отсутствует на этой странице. Выберите «Все ответы» или другую страницу.</p>}
          {list.isLoading || list.isFetching ? <p role="status">Загружаем {tab === "recipients" ? "адресатов" : "ответы"}…</p> : list.isError ? <p role="alert">Не удалось загрузить список. <button className="button secondary" onClick={()=>list.refetch()}>Повторить</button></p> : !items.length ? <div className="opportunity-empty">{tab === "recipients" ? "Нет доступных адресатов этого задания." : filter === "new" ? "Новых ответов нет." : filter === "evaluated" ? "Проверенных ответов нет." : "Отправленных ответов пока нет."}</div> : <div className="opportunity-list">{items.map(item=>tab === "answers" ? <EmployerOffer key={item.id} offer={item} profileOpen={item.id === profileOfferId}/> : <article className="micro-recipient" key={item.id}><div><b>{item.candidateIdentity?.displayName ?? item.candidateIdentity?.alias ?? "Кандидат"}</b><p>{item.resumeTitle}</p></div><span className="opportunity-status">{item.active ? "Подписка активна" : "Приостановлена"}</span></article>)}</div>}
          {list.data && !list.isError && <div className="micro-pagination"><small>Всего: {list.data.total}</small>{list.data.pageCount > 1 && <><button className="button secondary" disabled={list.isFetching || list.data.page <= 1} onClick={()=>open(templateId,tab,filter,list.data.page-1)}>Назад</button><span>{list.data.page} / {list.data.pageCount}</span><button className="button secondary" disabled={list.isFetching || list.data.page >= list.data.pageCount} onClick={()=>open(templateId,tab,filter,list.data.page+1)}>Далее</button></>}</div>}
        </>}
      </section>}
    </>}
  </div>;
}
function EmployerTemplate({
  template: t,
  edit,
}: {
  template: any;
  edit: () => void;
}) {
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("");
  const eligible = useInfiniteQuery({ queryKey: ["micro-eligible", t.id, t.specialization, t.version, search, grade],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ templateId: String(t.id), limit: "25" });
      if (search) params.set("search", search);
      if (grade) params.set("grade", grade);
      if (pageParam) params.set("cursor", pageParam);
      return opportunityApi<{ items: any[]; nextCursor: string | null }>(`/employer/microtasks/eligible/candidates?${params}`);
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled: t.active && Boolean(t.specialization) && t.assignmentAvailable, staleTime: 0 });
  const candidates = eligible.data?.pages.flatMap(page => page.items) ?? [];
  const [resumeId, setResumeId] = useState("");
  const selected = candidates.find(candidate => candidate.resumeId === Number(resumeId));
  const [subscriptionNote, setSubscriptionNote] = useState("");
  useEffect(() => { setResumeId(""); setSubscriptionNote(""); }, [t.id, t.specialization, t.version, search, grade, t.active]);
  const act = useOpportunityAction(employerKeys);
  return (
    <article className="panel opportunity-card">
      <header>
        <h2>{t.title}</h2>
        <span className="opportunity-status">
          {t.active ? "Активна" : "Приостановлена"}
        </span>
      </header>
      <p className="micro-job-context">{t.job ? `Вакансия: ${t.job.title}` : "Сохранённое задание без привязки к вакансии. Для новых предложений создайте задание по вакансии."}</p>
      {t.job && !t.assignmentAvailable && <p className="muted">Новые предложения доступны только по действующей опубликованной вакансии.</p>}
      <div className="opportunity-tags">
        <span>{t.competency}</span>
        <span>{professionLabel(t.specialization)}</span>
        <span>{t.expectedMinutes} мин.</span>
        <span>Раз в {t.intervalDays} дней</span>
      </div>
      <small>
        Срок ответа — {t.deadlineDays} дн. · версия {t.version}
      </small>
      <details>
        <summary>
          <ChevronDown size={16} /> Условия и рубрика
        </summary>
        <p>{t.scenario}</p>
        <ul className="opportunity-rubric">
          {t.rubric.map((r: any) => (
            <li key={r.id}>
              {r.label} — до {r.maxPoints}
            </li>
          ))}
        </ul>
      </details>
      <div className="opportunity-actions">
        <button className="button secondary" onClick={edit}>
          {t.jobId ? "Редактировать" : "Создать для вакансии"}
        </button>
        <button
          className="button secondary"
          disabled={act.isPending || (!t.active && (!t.job || !["draft", "published"].includes(t.job.status)))}
          onClick={() =>
            act.mutate({
              path: `/employer/microtasks/${t.id}/availability`,
              body: { active: !t.active },
            })
          }
        >
          {t.active ? "Остановить новые выдачи" : "Возобновить выдачи"}
        </button>
      </div>
      {!t.specialization && <p className="muted">Для новых предложений откройте редактор и выберите направление. Прежняя история сохранена.</p>}
      {t.active && t.specialization && (
        <div className="opportunity-detail">
          <div className="micro-recipient-search">
            <Field label="Поиск получателя по псевдониму или резюме">
              <input className="input" value={searchDraft} maxLength={100}
                placeholder="Псевдоним или название резюме"
                onChange={(event) => setSearchDraft(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setSearch(searchDraft.trim()); } }} />
            </Field>
            <Field label="Подтверждённый уровень получателя">
              <select className="input" value={grade} onChange={(event) => setGrade(event.target.value)}>
                <option value="">Любой уровень</option><option value="Junior">Junior</option>
                <option value="Middle">Middle</option><option value="Senior">Senior</option>
              </select>
            </Field>
            <button type="button" className="button secondary" disabled={eligible.isFetching}
              onClick={() => setSearch(searchDraft.trim())}>Найти получателя</button>
            {(search || grade) && <button type="button" className="button secondary" onClick={() => {
              setSearchDraft(""); setSearch(""); setGrade("");
            }}>Сбросить поиск</button>}
          </div>
          <Field label="Резюме кандидата, разрешившего предложения">
            <select
              className="input"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
            >
              <option value="">Выберите подтверждённое резюме</option>
              {candidates.map((c) => (
                <option key={c.resumeId} value={c.resumeId}>
                  {c.alias} · {c.resumeTitle} · {professionLabel(c.specialization)} · {c.verifiedGrade}
                </option>
              ))}
            </select>
          </Field>
          {eligible.isLoading && <p role="status">Загружаем подходящие резюме…</p>}
          {eligible.isError && <p role="alert">Не удалось загрузить резюме. <button type="button" className="button secondary" onClick={() => eligible.refetch()}>Повторить</button></p>}
          {!eligible.isLoading && !eligible.isError && !candidates.length && (
            <small>
              {search || grade ? "По этому поиску доступные резюме не найдены. Измените запрос или уровень." : "Пока нет подходящих открытых подтверждённых резюме этого направления. Кандидат включает практику и разрешает подбор в выбранном резюме."}
            </small>
          )}
          {eligible.hasNextPage && <button type="button" className="button secondary"
            disabled={eligible.isFetching} onClick={() => eligible.fetchNextPage()}>
            {eligible.isFetchingNextPage ? "Загружаем ещё резюме…" : "Показать ещё резюме"}
          </button>}
          <button
            className="button"
            disabled={!selected || act.isPending || eligible.isFetching}
            onClick={() =>
              act.mutate({
                path: `/employer/microtasks/${t.id}/subscriptions`,
                body: { candidateId: selected.id, resumeId: selected.resumeId },
              }, { onSuccess: (subscription: any) => setSubscriptionNote(subscription.active ? "Резюме выбрано. Предложение появится в ближайший допустимый срок." : "Резюме выбрано. Возобновить эту подписку может только кандидат."),
                onError: () => { setResumeId(""); void eligible.refetch(); } })
            }
          >
            Предложить регулярную практику
          </button>
          <small>
            Первое предложение — в ближайший допустимый срок. Не чаще одного в
            неделю среди всех компаний. Выбор другого резюме не сбрасывает недельный лимит. Прежние задания сохранят своё резюме. Приостановленную подписку может возобновить только кандидат.
          </small>
        </div>
      )}
      <OpportunityFeedback
        error={act.error}
        success={act.isSuccess ? subscriptionNote || "Изменения сохранены" : ""}
      />
    </article>
  );
}
function MicroEditor({
  template,
  ownerId,
  initialJobId,
  close,
}: {
  template: any;
  ownerId: number;
  initialJobId: number | null;
  close: () => void;
}) {
  const skillDictionary = useSkillDictionary();
  const jobs = useQuery({queryKey:["micro-job-options",ownerId],queryFn:()=>opportunityApi<any[]>("/employer/jobs")});
  const jobOptions = jobs.data?.filter(job => ["draft","published"].includes(job.status) && !job.deletedAt) ?? [];
  const initial = template
    ? (Object.fromEntries(
        Object.keys(example).map((key) => [key, template[key] ?? (key === "specialization" ? "" : example[key as keyof typeof example])]),
      ) as typeof example)
    : {
        ...example,
        jobId: initialJobId ?? 0,
        title: "",
        scenario: "",
        competency: "",
        educationalOnly: false as unknown as true,
      };
  const [draft, setDraft] = useOpportunityDraft(
    `signal-micro-draft-job-v1-${ownerId}-${template?.id ?? "new"}-${template?.version ?? "new"}-${initialJobId ?? 0}`,
    initial,
  );
  const selectedJob = jobOptions.find(job=>job.id === draft.jobId);
  useEffect(()=>{ if(selectedJob && draft.specialization !== selectedJob.specialization) setDraft(old=>({...old,specialization:selectedJob.specialization})); },[selectedJob?.id, selectedJob?.specialization, draft.specialization, setDraft]);
  const act = useOpportunityAction(employerKeys);
  const set = (key: keyof typeof draft, value: unknown) =>
    setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="panel opportunity-form"
      onSubmit={(event) => {
        event.preventDefault();
        act.mutate(
          {
            path: template
              ? `/employer/microtasks/${template.id}`
              : "/employer/microtasks",
            method: template ? "PUT" : "POST",
            body: template ? { ...draft, version: template.version } : draft,
          },
          {
            onSuccess: () => {
              sessionStorage.removeItem(
                `signal-micro-draft-job-v1-${ownerId}-${template?.id ?? "new"}-${template?.version ?? "new"}-${initialJobId ?? 0}`,
              );
              close();
            },
          },
        );
      }}
    >
      <div className="opportunity-form-title">
        <h2>{template ? "Редактирование задания" : "Учебное задание"}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Закрыть редактор задания"
          onClick={close}
        >
          <X size={18} />
        </button>
      </div>
      <fieldset disabled={act.isPending} className="opportunity-list">
        {!template && (
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setDraft({
                ...example,
                jobId: draft.jobId,
                specialization: selectedJob?.specialization ?? draft.specialization,
                educationalOnly: false as unknown as true,
              })
            }
          >
            <Lightbulb size={16} /> Взять учебный пример за основу
          </button>
        )}
        <Field label="Вакансия">
          <select className="input" required disabled={!!template || jobs.isLoading} value={draft.jobId || ""} onChange={event=>{
            const job = jobOptions.find(item=>item.id === Number(event.target.value));
            setDraft(old=>({...old,jobId:job?.id ?? 0,specialization:job?.specialization ?? ""}));
          }}><option value="">Выберите свою вакансию</option>{jobOptions.map(job=><option key={job.id} value={job.id}>{job.title} · {job.status === "draft" ? "черновик" : "опубликована"}</option>)}{template && !selectedJob && <option value={template.jobId}>{template.job?.title ?? "Вакансия недоступна"}</option>}</select>
        </Field>
        {jobs.isError && <p role="alert">Не удалось загрузить вакансии. <button type="button" className="button secondary" onClick={()=>jobs.refetch()}>Повторить</button></p>}
        {!jobs.isLoading && !jobs.isError && !jobOptions.length && <p>Сначала создайте вакансию в разделе «Вакансии и запросы».</p>}
        {draft.jobId > 0 && <p className="muted">{professionLabel(draft.specialization)} · Новые предложения доступны после публикации вакансии.</p>}
        <div className="opportunity-form-grid">
          <Field label="Название">
            <input
              className="input"
              required
              minLength={3}
              maxLength={160}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>
          <Field label="Одна проверяемая компетенция">
            <DictionaryCombobox required minLength={2} maxLength={100} value={draft.competency}
              options={skillDictionary.data ?? []} onChange={value => set("competency", value)} allowCustom />
          </Field>
        </div>
        <Field label="Учебная ситуация и ожидаемый ответ">
          <textarea
            className="input"
            rows={5}
            required
            minLength={50}
            maxLength={6000}
            value={draft.scenario}
            onChange={(e) => set("scenario", e.target.value)}
          />
        </Field>
        <div className="opportunity-form-grid">
          <Field label="Ожидаемое время, минут">
            <input
              className="input"
              type="number"
              required
              min={5}
              max={45}
              value={draft.expectedMinutes}
              onChange={(e) => set("expectedMinutes", Number(e.target.value))}
            />
          </Field>
          <Field label="Период предложений, дней">
            <input
              className="input"
              type="number"
              required
              min={7}
              max={90}
              value={draft.intervalDays}
              onChange={(e) => set("intervalDays", Number(e.target.value))}
            />
          </Field>
          <Field label="Срок ответа, дней">
            <input
              className="input"
              type="number"
              required
              min={1}
              max={7}
              value={draft.deadlineDays}
              onChange={(e) => set("deadlineDays", Number(e.target.value))}
            />
          </Field>
        </div>
        <h3>Рубрика оценки</h3>
        {draft.rubric.map((r, index) => (
          <div className="opportunity-score-row" key={r.id}>
            <Field label={`Критерий ${index + 1}`}>
              <input
                className="input"
                required
                minLength={3}
                maxLength={200}
                value={r.label}
                onChange={(e) =>
                  set(
                    "rubric",
                    draft.rubric.map((v, i) =>
                      i === index ? { ...v, label: e.target.value } : v,
                    ),
                  )
                }
              />
            </Field>
            <Field label="Максимум">
              <input
                className="input"
                type="number"
                required
                min={1}
                max={10}
                value={r.maxPoints}
                onChange={(e) =>
                  set(
                    "rubric",
                    draft.rubric.map((v, i) =>
                      i === index
                        ? { ...v, maxPoints: Number(e.target.value) }
                        : v,
                    ),
                  )
                }
              />
            </Field>
          </div>
        ))}
        <label className="opportunity-check">
          <input
            type="checkbox"
            required
            checked={draft.educationalOnly}
            onChange={(e) => set("educationalOnly", e.target.checked)}
          />
          <span>
            Это добровольная учебная ситуация на вымышленных данных. Задание не
            требует неоплаченной производственной работы, доступа к системам
            компании и персональных данных.
          </span>
        </label>
        <button className="button" disabled={!selectedJob || act.isPending}>
          <Check size={17} />{" "}
          {act.isPending ? "Сохраняем…" : "Сохранить задание"}
        </button>
        <small>
          Изменения действуют только для будущих предложений. Ранее выданные
          условия и рубрики сохраняются.
        </small>
      </fieldset>
      <OpportunityFeedback error={act.error} />
    </form>
  );
}
function EmployerOffer({ offer, profileOpen = false }: { offer: any; profileOpen?: boolean }) {
  const [, navigate] = useLocation();
  const view = employerTaskAnswerView(offer);
  const currentParams = new URLSearchParams(useSearch());
  const profileParams = new URLSearchParams(view.profileHref?.split("?")[1] ?? "");
  for (const key of ["page", "filter", "jobId"]) {
    const value = currentParams.get(key); if (value) profileParams.set(key, value);
  }
  const profileHref = view.profileHref ? `/employer/microtasks?${profileParams}` : null;
  const [overviewOpen, setOverviewOpen] = useState(profileOpen);
  const overview = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!profileOpen) return;
    setOverviewOpen(true);
    const frame = requestAnimationFrame(() => { overview.current?.scrollIntoView({ block: 'nearest' }); overview.current?.querySelector('summary')?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [profileOpen]);
  const [scores, setScores] = useOpportunityDraft(
    `signal-micro-grade-${offer.companyId}-${offer.id}`,
    offer.snapshot.rubric.map((r: any) => ({
      criterionId: r.id,
      points: 0,
      comment: "",
    })) as { criterionId: string; points: number; comment: string }[],
  );
  const [feedback, setFeedback] = useOpportunityDraft(
    `signal-micro-feedback-${offer.companyId}-${offer.id}`,
    "",
  );
  const act = useOpportunityAction(employerKeys);
  return (
    <article className="panel opportunity-card employer-task-answer" id={`task-answer-${offer.id}`}>
      <header>
        <div>
          <small className="employer-task-answer-label">Ответ от {view.pseudonymous ? 'кандидата · псевдоним' : 'кандидата'}</small>
          <h3>{view.name}</h3>
          <p className="employer-task-answer-resume">{view.resumeLabel}</p>
          {offer.submittedAt && <small>Ответ отправлен <time dateTime={offer.submittedAt}>{new Date(offer.submittedAt).toLocaleString('ru-RU')}</time></small>}
        </div>
        <OpportunityStatus status={offer.status} />
      </header>
      {profileHref && <a className="employer-task-answer-profile text-link" href={profileHref} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); setOverviewOpen(true); navigate(profileHref!); } }}>Профиль кандидата</a>}
      {view.readable && <details ref={overview} className="employer-task-answer-section employer-task-answer-overview" open={overviewOpen} onToggle={event => setOverviewOpen(event.currentTarget.open)}>
        <summary><ChevronDown size={16}/><span><b>Профиль кандидата</b><small>{view.resumeLabel}</small></span></summary>
        <div className="employer-task-answer-section-body"><h4>{view.name}</h4>{!view.pseudonymous && <p className="muted">Псевдоним: {view.alias}</p>}<ResumeContext binding={offer}/><p className="muted">Сохранённый контекст выбранного резюме на момент выдачи задания. Доступ проверяется по этому резюме. Результат практики не меняет грейд Signal.</p></div>
      </details>}
      <details className="employer-task-answer-section">
        <summary>
          <ChevronDown size={16} /><span><b>Задание</b><small>{offer.snapshot.title} · сохранённые условия</small></span>
        </summary>
        <div className="employer-task-answer-section-body"><h4>{offer.snapshot.title}</h4><Conditions offer={offer}/></div>
      </details>
      {offer.answer && !offer.consentRevokedAt && offer.resumeAvailable && (
        <details className="employer-task-answer-section">
          <summary><ChevronDown size={16}/><span><b>Ответ кандидата</b><small>{view.preview}</small></span></summary>
          <div className="employer-task-answer-section-body"><p className="opportunity-description">{offer.answer}</p></div>
        </details>
      )}
      {offer.status === "submitted" && !offer.consentRevokedAt && offer.resumeAvailable && (
        <details className="employer-task-answer-section">
        <summary><ChevronDown size={16}/><span><b>Оценить ответ</b><small>По сохранённой рубрике задания · {offer.snapshot.rubric.length} критерия</small></span></summary>
        <form
          className="opportunity-list employer-task-answer-section-body"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate({
              path: `/employer/microtasks/offers/${offer.id}/evaluate`,
              body: { scores, feedback },
            });
          }}
        >
          <h3>Оценка по рубрике</h3>
          {scores.map((score, index) => {
            const rubric = offer.snapshot.rubric.find(
              (r: any) => r.id === score.criterionId,
            );
            return (
              <div key={score.criterionId} className="opportunity-list">
                <Field label={`${rubric.label} · 0–${rubric.maxPoints}`}>
                  <input
                    className="input"
                    type="number"
                    required
                    min={0}
                    max={rubric.maxPoints}
                    value={score.points}
                    onChange={(e) =>
                      setScores((old) =>
                        old.map((s, i) =>
                          i === index
                            ? { ...s, points: Number(e.target.value) }
                            : s,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Основание оценки">
                  <input
                    className="input"
                    required
                    minLength={3}
                    maxLength={500}
                    value={score.comment}
                    onChange={(e) =>
                      setScores((old) =>
                        old.map((s, i) =>
                          i === index ? { ...s, comment: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            );
          })}
          <Field label="Что получилось и что улучшить">
            <textarea
              className="input"
              rows={3}
              required
              minLength={10}
              maxLength={2000}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
            />
          </Field>
          <button className="button" disabled={act.isPending}>
            Сохранить результат
          </button>
          <small>
            Результат не повышает общую категорию и не подтверждает другие
            навыки. После сохранения оценка неизменяема.
          </small>
        </form>
        </details>
      )}
      {!offer.consentRevokedAt && offer.resumeAvailable && offer.result && <details className="employer-task-answer-section"><summary><ChevronDown size={16}/><span><b>Оценка компании</b><small>{offer.result.total} из {offer.result.max} · грейд Signal не меняет</small></span></summary><div className="employer-task-answer-section-body"><Result offer={offer}/></div></details>}
      {offer.consentRevokedAt && (
        <small>
          Кандидат отозвал согласие. Ответ и результат больше недоступны.
        </small>
      )}
      <OpportunityFeedback error={act.error} />
    </article>
  );
}
