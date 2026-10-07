import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import "./opportunities.css";
import { FormField } from './form-field';
export async function opportunityApi<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      (value.error || "Не удалось выполнить действие. Попробуйте ещё раз.") + (value.retryAt && Number.isFinite(Date.parse(value.retryAt)) ? ` Повторить можно после ${new Date(value.retryAt).toLocaleString("ru-RU")}.` : ""),
    );
  return value;
}
export function useOpportunityAction(keys: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) => opportunityApi(path, method, body),
    onSuccess: () =>
      Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: [key] }))),
  });
}
export function OpportunityField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <FormField className="opportunity-field" label={label}>{children}</FormField>
  );
}
export function OpportunityFeedback({
  error,
  success,
}: {
  error?: Error | null;
  success?: string;
}) {
  return error ? (
    <p className="opportunity-error" role="alert">
      {error.message}
    </p>
  ) : success ? (
    <p className="opportunity-success" role="status">
      {success}
    </p>
  ) : null;
}
export function useOpportunityDraft<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null") ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}
export const opportunityStatuses: Record<string, string> = {
  draft: "Черновик",
  published: "Опубликована",
  closed: "Закрыта",
  archived: "В архиве",
  sent: "Отправлен",
  viewed: "Просмотрен",
  shortlisted: "В рассмотрении",
  declined: "Отказ",
  withdrawn: "Отозвано",
  offered: "Предложено",
  accepted: "Принято",
  submitted: "На проверке",
  evaluated: "Есть результат",
  expired: "Срок истёк",
};
export function OpportunityStatus({ status }: { status: string }) {
  return (
    <span className={`opportunity-status ${status}`}>
      {opportunityStatuses[status] || status}
    </span>
  );
}
export function Salary({ job }: { job: any }) {
  return (
    <span className="opportunity-salary">
      {Number(job.salaryMin).toLocaleString("ru-RU")}–
      {Number(job.salaryMax).toLocaleString("ru-RU")} ₽ /{" "}
      {job.salaryPeriod === "year" ? "год" : "мес."}{" "}
      <small>{job.salaryType === "net" ? "на руки" : "до налогов"}</small>
    </span>
  );
}
