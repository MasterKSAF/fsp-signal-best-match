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
  const query = useQuery({
    queryKey: ["my-microtasks"],
    queryFn: () => opportunityApi("/me/microtasks"),
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
                      act.isPending || (!s.active && (!query.data.enabled || !s.resumeAvailable))
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
              disabled={!consent || act.isPending || !offer.resumeAvailable}
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
      {offer.status === "accepted" && offer.resumeAvailable && (
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
  const search = useSearch(), params = new URLSearchParams(search), [,navigate] = useLocation();
  const templateId = Number(params.get("task")), tab = params.get("tab") === "answers" ? "answers" : "task";
  const profileOfferId = params.get('profile') === '1' ? Number(params.get('offer')) : null;
  const selected = !templates.isError && templates.data?.find(item => item.id === templateId);
  const [edit,setEdit] = useState<any>(null);
  const offers = useQuery({ queryKey: ["employer-micro-offers", templateId, "submitted"],
    queryFn: () => opportunityApi<any[]>(`/employer/microtasks/offers?templateId=${templateId}&submittedOnly=1`),
    enabled: !!selected && tab === "answers", staleTime: 0, gcTime: 0, retry: false, refetchInterval: 30000, refetchOnWindowFocus: 'always' });
  const open = (id:number, nextTab="task") => { setEdit(null); navigate(`/employer/microtasks?task=${id}&tab=${nextTab}`); };
  useEffect(() => {setEdit(null);}, [templateId]);
  const answers = offers.isError || offers.isFetching ? [] : offers.data?.filter(item => item.templateId === templateId && ["submitted", "evaluated"].includes(item.status) && !item.consentRevokedAt && item.resumeAvailable) ?? [];
  return <div className="opportunity-page employer-workspace">
    <header className="page-title"><h1>Задания кандидатам<InlineInfo label="Задания кандидатам: подробнее">Добровольная учебная практика с обратной связью компании. Результат задания не присваивает грейд Signal.</InlineInfo></h1><button className="button primary" onClick={()=>setEdit("new")}><Plus size={17}/>Создать задание</button></header>
    {edit && me.data && <MicroEditor key={edit === "new" ? `new-${me.data.user.id}` : `${edit.id}-${edit.version}`} template={edit === "new" ? null : edit} ownerId={me.data.user.id} close={()=>{setEdit(null); void templates.refetch();}}/>}
    {me.isError && edit && <p role="alert">Не удалось открыть редактор. <button className="button secondary" onClick={()=>me.refetch()}>Повторить</button></p>}
    {templates.isLoading ? <p role="status">Загружаем задания…</p> : templates.isError ? <div className="panel opportunity-empty" role="alert">Не удалось загрузить задания. <button className="button secondary" onClick={()=>templates.refetch()}>Повторить</button></div> : <>
      {!templates.data?.length && <div className="panel opportunity-empty">Создайте учебное задание с понятными условиями и критериями оценки.</div>}
      <div className="employer-task-list">{templates.data?.map(t=><article className="panel employer-task-row" key={t.id}>
        <button className="employer-task-open" onClick={()=>open(t.id)}><h2>{t.title}</h2><p>{t.competency} · {professionLabel(t.specialization)} · {t.expectedMinutes} мин.</p></button>
        <span className="opportunity-status">{t.active ? "Активно" : "Приостановлено"}</span>
        <div className="employer-task-counters"><button className="employer-counter" onClick={()=>open(t.id,"answers")}>Ответы <b>{t.answerCount ?? '—'}</b></button><button className="employer-counter applications" onClick={()=>open(t.id,"answers")}>Новые <b>{t.newAnswerCount ?? '—'}</b></button><button className="employer-counter shortlisted" onClick={()=>open(t.id,"answers")}>Проверены <b>{t.evaluatedAnswerCount ?? '—'}</b></button>{typeof t.recipientCount === 'number' && <span className="employer-counter">Адресаты <b>{t.recipientCount}</b></span>}</div>
      </article>)}</div>
      {templateId && !selected ? <div className="panel opportunity-empty">Задание недоступно. <button className="button secondary" onClick={()=>navigate('/employer/microtasks')}>К заданиям</button></div> : null}
      {selected && <section className="panel employer-task-detail">
        <div className="opportunity-form-title"><h2>{selected.title}</h2><button className="icon-button" aria-label="Закрыть задание" onClick={()=>navigate('/employer/microtasks')}><X size={18}/></button></div>
        <div className="opportunity-tabs" role="tablist" aria-label="Содержание задания"><button role="tab" aria-selected={tab === "task"} className={`button ${tab === "task" ? '' : 'secondary'}`} onClick={()=>open(templateId,"task")}>Задание</button><button role="tab" aria-selected={tab === "answers"} className={`button ${tab === "answers" ? '' : 'secondary'}`} onClick={()=>open(templateId,"answers")}>Ответы · {selected.answerCount ?? '—'}</button></div>
        {tab === "task" ? <EmployerTemplate key={`${selected.id}-${selected.version}`} template={selected} edit={()=>setEdit(selected)}/> : <>
          {profileOfferId && !offers.isFetching && !offers.isError && offers.data && !answers.some(offer => offer.id === profileOfferId) && <p className="muted" role="status">Профиль кандидата сейчас недоступен для этого ответа.</p>}{offers.isLoading || offers.isFetching ? <p role="status">Загружаем ответы…</p> : offers.isError ? <p role="alert">Не удалось загрузить ответы. <button className="button secondary" onClick={()=>offers.refetch()}>Повторить</button></p> : !answers.length ? <div className="opportunity-empty">По этому заданию пока нет доступных отправленных ответов.</div> : <div className="opportunity-list">{answers.map(offer=><EmployerOffer key={offer.id} offer={offer} profileOpen={offer.id === profileOfferId}/>)}</div>}
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
    enabled: t.active && Boolean(t.specialization), staleTime: 0 });
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
          Редактировать
        </button>
        <button
          className="button secondary"
          disabled={act.isPending}
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
  close,
}: {
  template: any;
  ownerId: number;
  close: () => void;
}) {
  const skillDictionary = useSkillDictionary();
  const initial = template
    ? (Object.fromEntries(
        Object.keys(example).map((key) => [key, template[key] ?? (key === "specialization" ? "" : example[key as keyof typeof example])]),
      ) as typeof example)
    : {
        ...example,
        title: "",
        scenario: "",
        competency: "",
        educationalOnly: false as unknown as true,
      };
  const [draft, setDraft] = useOpportunityDraft(
    `signal-micro-draft-${ownerId}-${template?.id ?? "new"}-${template?.version ?? "new"}`,
    initial,
  );
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
                `signal-micro-draft-${ownerId}-${template?.id ?? "new"}-${template?.version ?? "new"}`,
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
                educationalOnly: false as unknown as true,
              })
            }
          >
            <Lightbulb size={16} /> Взять учебный пример за основу
          </button>
        )}
        <Field label="Направление практики">
          <select className="input" required value={draft.specialization} onChange={event => set("specialization", event.target.value)}>
            <option value="">Выберите направление</option>
            <option value="Backend / Python">Backend-разработчик</option>
            <option value="Frontend / TypeScript">Frontend-разработчик</option>
          </select>
        </Field>
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
        <button className="button">
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
      {view.profileHref && <a className="employer-task-answer-profile text-link" href={view.profileHref} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) { event.preventDefault(); setOverviewOpen(true); navigate(view.profileHref!); } }}>Профиль кандидата</a>}
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
