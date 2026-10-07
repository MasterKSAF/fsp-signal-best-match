import { useState } from "react";
import { DictionaryCombobox, useSkillDictionary } from "./dictionary-input";
import { useQuery } from "@tanstack/react-query";
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
    {binding.resumeContext ? <p className="muted">{binding.resumeContext.specialization} · {binding.resumeContext.verifiedGrade} · ревизия {binding.resumeRevision}</p>
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
      <header>
        <h1>Практика компаний</h1>
        <p className="opportunity-intro">
          Добровольные учебные ситуации от компаний, 5–45 минут. Получайте
          обратную связь по конкретному навыку. Рабочие задачи компании и
          контакты в этот формат не входят. Результат компании не меняет подтверждённый грейд Signal.
        </p>
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
              <h2>Предложения от компаний</h2>
              <p>
                Не чаще одного задания в 7 дней, только после подтверждения
                категории и разрешения подбора в выбранном резюме. Отключение остановит
                подписки и незавершённые задания. Сохранённые результаты
                останутся у вас.
              </p>
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
  const templates = useQuery({
    queryKey: ["employer-microtasks"],
    queryFn: () => opportunityApi<any[]>("/employer/microtasks"),
  });
  const offers = useQuery({
    queryKey: ["employer-micro-offers"],
    queryFn: () => opportunityApi<any[]>("/employer/microtasks/offers"),
    refetchInterval: 60000,
  });
  const me = useQuery({
    queryKey: ["opportunity-me"],
    queryFn: () => opportunityApi("/me"),
  });
  const [edit, setEdit] = useState<any>(null);
  const [tab, setTab] = useState("programs");
  return (
    <div className="opportunity-page">
      <header>
        <h1>Практика от компании</h1>
        <p className="opportunity-intro">
          Предложите короткую учебную ситуацию и дайте полезную обратную связь.
          Используйте вымышленные данные: задания для бесплатной разработки
          продукта, доступа к инфраструктуре или обработки клиентских данных
          здесь не допускаются.
        </p>
      </header>
      <div className="opportunity-tabs">
        <button
          className={`button ${tab === "programs" ? "" : "secondary"}`}
          onClick={() => setTab("programs")}
        >
          <BookOpen size={17} /> Программы
        </button>
        <button
          className={`button ${tab === "answers" ? "" : "secondary"}`}
          onClick={() => setTab("answers")}
        >
          <Send size={17} /> Ответы и результаты
        </button>
        {tab === "programs" && (
          <button className="button secondary" onClick={() => setEdit("new")}>
            <Plus size={17} /> Создать задание
          </button>
        )}
      </div>
      {edit && me.data && (
        <MicroEditor
          key={edit === "new" ? `new-${me.data.user.id}` : edit.id}
          template={edit === "new" ? null : edit}
          ownerId={me.data.user.id}
          close={() => setEdit(null)}
        />
      )}
      {tab === "programs" && (
        <>
          {templates.isLoading && <p role="status">Загружаем программы…</p>}
          {templates.isError && (
            <p role="alert">
              Данные временно недоступны.{" "}
              <button
                className="button secondary"
                onClick={() => {
                  templates.refetch();
                }}
              >
                Повторить
              </button>
            </p>
          )}
          {templates.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Создайте учебное задание с рубрикой, затем выберите кандидата,
              разрешившего предложения. Сервер будет предлагать задания по
              сохранённому расписанию.
            </div>
          )}
          <div className="opportunity-grid">
            {templates.data?.map((t) => (
              <EmployerTemplate
                key={t.id}
                template={t}
                edit={() => setEdit(t)}
              />
            ))}
          </div>
        </>
      )}
      {tab === "answers" && (
        <>
          {offers.isLoading && <p role="status">Загружаем ответы…</p>}
          {offers.isError && (
            <p role="alert">
              Не удалось загрузить ответы.{" "}
              <button
                className="button secondary"
                onClick={() => offers.refetch()}
              >
                Повторить
              </button>
            </p>
          )}
          {offers.data?.length === 0 && (
            <div className="panel opportunity-empty">
              Предложения, ответы и результаты появятся здесь.
            </div>
          )}
          <div className="opportunity-grid">
            {offers.data?.map((o) => (
              <EmployerOffer key={o.id} offer={o} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
function EmployerTemplate({
  template: t,
  edit,
}: {
  template: any;
  edit: () => void;
}) {
  const eligible = useQuery({ queryKey: ["micro-eligible", t.id, t.specialization],
    queryFn: () => opportunityApi<any[]>(`/employer/microtasks/eligible/candidates?templateId=${t.id}`),
    enabled: t.active && Boolean(t.specialization), staleTime: 0 });
  const candidates = eligible.data ?? [];
  const [resumeId, setResumeId] = useState("");
  const selected = candidates.find(candidate => candidate.resumeId === Number(resumeId));
  const [subscriptionNote, setSubscriptionNote] = useState("");
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
        <span>{t.specialization ?? "Направление не указано"}</span>
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
          <Field label="Резюме кандидата, разрешившего предложения">
            <select
              className="input"
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
            >
              <option value="">Выберите подтверждённое резюме</option>
              {candidates.map((c) => (
                <option key={c.resumeId} value={c.resumeId}>
                  {c.alias} · {c.resumeTitle} · {c.specialization} · {c.verifiedGrade}
                </option>
              ))}
            </select>
          </Field>
          {eligible.isLoading && <p role="status">Загружаем подходящие резюме…</p>}
          {eligible.isError && <p role="alert">Не удалось загрузить резюме. <button type="button" className="button secondary" onClick={() => eligible.refetch()}>Повторить</button></p>}
          {!eligible.isLoading && !eligible.isError && !candidates.length && (
            <small>
              Пока нет подходящих открытых подтверждённых резюме этого направления. Кандидат включает практику и разрешает подбор в выбранном резюме.
            </small>
          )}
          <button
            className="button"
            disabled={!selected || act.isPending || eligible.isFetching}
            onClick={() =>
              act.mutate({
                path: `/employer/microtasks/${t.id}/subscriptions`,
                body: { candidateId: selected.id, resumeId: selected.resumeId },
              }, { onSuccess: (subscription: any) => setSubscriptionNote(subscription.active ? "Резюме выбрано. Предложение появится в ближайший допустимый срок." : "Резюме выбрано. Возобновить эту подписку может только кандидат.") })
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
    `signal-micro-draft-${ownerId}-${template?.id ?? "new"}`,
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
            body: draft,
          },
          {
            onSuccess: () => {
              sessionStorage.removeItem(
                `signal-micro-draft-${ownerId}-${template?.id ?? "new"}`,
              );
              close();
            },
          },
        );
      }}
    >
      <div className="opportunity-form-title">
        <h2>{template ? "Новая версия программы" : "Учебное задание"}</h2>
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
            <option value="Backend / Python">Backend / Python</option>
            <option value="Frontend / TypeScript">Frontend / TypeScript</option>
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
          {act.isPending ? "Сохраняем…" : "Сохранить программу"}
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
function EmployerOffer({ offer }: { offer: any }) {
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
    <article className="panel opportunity-card">
      <header>
        <div>
          <small>{offer.alias}</small>
          <h2>{offer.snapshot.title}</h2>
        </div>
        <OpportunityStatus status={offer.status} />
      </header>
      <details>
        <summary>
          <ChevronDown size={16} /> Выданные условия
        </summary>
        <Conditions offer={offer} />
      </details>
      {offer.answer && (
        <div className="opportunity-detail">
          <h3>Ответ кандидата</h3>
          <p className="opportunity-description">{offer.answer}</p>
        </div>
      )}
      {offer.status === "submitted" && !offer.consentRevokedAt && offer.resumeAvailable && (
        <form
          className="opportunity-list"
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
      )}
      <Result offer={offer} />
      {offer.consentRevokedAt && (
        <small>
          Кандидат отозвал согласие. Ответ и результат больше недоступны.
        </small>
      )}
      <OpportunityFeedback error={act.error} />
    </article>
  );
}
