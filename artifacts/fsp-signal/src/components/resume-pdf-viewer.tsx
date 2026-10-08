import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileWarning, LoaderCircle, RotateCw } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import './resume-pdf-viewer.css';

export type ResumePdfViewerProps = { resumeId: number; title?: string; accessKey?: string; fields?:string; projectionVersion:string };
type Loaded = { pdf: PDFDocumentProxy; resumeId: number; revision: number; accessKey?: string;projectionVersion:string };
class PdfAccessError extends Error {}

async function readPdf(resumeId: number, signal: AbortSignal, projectionVersion:string, fields?:string) {
  if (!Number.isSafeInteger(resumeId) || resumeId < 1) throw new PdfAccessError('Резюме не найдено.');
  // A fixed same-origin route performs the ordinary document ACL. No fallback URL or cached blob.
  const response = await fetch(`/api/resumes/${resumeId}/preview.pdf${fields===undefined?'':`?fields=${encodeURIComponent(fields)}`}`, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal });
  if (!response.ok) {
    if (response.status === 401) throw new PdfAccessError('Войдите в аккаунт, чтобы открыть документ.');
    if (response.status === 403 || response.status === 404) throw new PdfAccessError('Документ недоступен. Проверьте разрешение на просмотр резюме.');
    throw new PdfAccessError('Не удалось загрузить PDF. Попробуйте ещё раз.');
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/pdf')) throw new PdfAccessError('Сервер не вернул PDF. Попробуйте ещё раз.');
  // The account/evidence may change after JSON polling but before this request.
  // Never attach bytes from a different projection to the current viewer key.
  if(response.headers.get('X-Signal-Document-Version')!==projectionVersion)throw new PdfAccessError('Документ обновляется. Повторите просмотр через несколько секунд.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') throw new PdfAccessError('Не удалось прочитать PDF. Попробуйте ещё раз.');
  return bytes;
}

/** Bytes and document workers live only in this mounted viewer; never placed in a query/cache/store. */
export function ResumePdfViewer({ resumeId, title = 'PDF резюме', accessKey, fields,projectionVersion }: ResumePdfViewerProps) {
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const [rendering, setRendering] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const current = loaded?.resumeId === resumeId && loaded.revision === revision && loaded.accessKey === accessKey &&loaded.projectionVersion===projectionVersion ? loaded.pdf : null;

  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.floor(entries[0]?.contentRect.width ?? element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let task: PDFDocumentLoadingTask | undefined;
    setLoaded(null); setError(null); setPage(1); setRendering(false);
    stage.current?.replaceChildren();
    void (async () => {
      try {
        const bytes = await readPdf(resumeId, controller.signal,projectionVersion, fields);
        if (!active) return;
        // Both engine and matching worker are bundled locally, loaded only when PDF is requested.
        const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
        if (!active) return;
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        // 6.4 removed isEvalSupported and its dynamic compiler. We render canvas only: no scripting,
        // actions, annotation DOM, external PDF URLs, or unsupported security switches.
        task = pdfjs.getDocument({ data: bytes, stopAtErrors: true, enableXfa: false, useWasm: false, useSystemFonts: true });
        const pdf = await task.promise;
        if (active) setLoaded({ pdf, resumeId, revision, accessKey,projectionVersion });
      } catch (failure) {
        if (active && !controller.signal.aborted) setError(failure instanceof PdfAccessError ? failure.message : 'Не удалось открыть PDF. Попробуйте ещё раз.');
        if (task) void task.destroy().catch(() => {});
      }
    })();
    return () => {
      active = false; controller.abort(); stage.current?.replaceChildren();
      if (task) void task.destroy().catch(() => {});
    };
  }, [resumeId, revision, accessKey, fields,projectionVersion]);

  useEffect(() => {
    if (!current || width < 1) return;
    let active = true;
    let task: RenderTask | undefined;
    setRendering(true); stage.current?.replaceChildren();
    void (async () => {
      try {
        const pdfPage = await current.getPage(page);
        if (!active) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(1100, Math.max(160, width - 32)) / base.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${title}, страница ${page} из ${current.numPages}`);
        task = pdfPage.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], background: '#ffffff' });
        await task.promise;
        if (active) { stage.current?.replaceChildren(canvas); setRendering(false); }
      } catch (failure) {
        if (active) { setRendering(false); setError('Не удалось показать страницу PDF. Попробуйте ещё раз.'); }
      }
    })();
    return () => { active = false; task?.cancel(); stage.current?.replaceChildren(); };
  }, [current, page, width, title]);

  return <section className="resume-pdf-viewer" aria-label={title}>
    <div className="resume-pdf-toolbar">
      <span className="resume-pdf-page-count" aria-live="polite">{current ? `Страница ${page} из ${current.numPages}` : 'PDF резюме'}</span>
      <div className="resume-pdf-navigation">
        <button type="button" className="button ghost" aria-label="Предыдущая страница PDF" disabled={!current || page <= 1 || rendering || !!error} onClick={() => setPage(p => p - 1)}><ChevronLeft size={17}/></button>
        <button type="button" className="button ghost" aria-label="Следующая страница PDF" disabled={!current || page >= current.numPages || rendering || !!error} onClick={() => setPage(p => p + 1)}><ChevronRight size={17}/></button>
      </div>
    </div>
    <div className="resume-pdf-surface" ref={surface} aria-busy={!error && (!current || rendering)}>
      {error ? <div className="resume-pdf-message" role="alert"><FileWarning size={26}/><p>{error}</p><button type="button" className="button secondary" onClick={() => setRevision(r => r + 1)}><RotateCw size={15}/> Повторить</button></div> : (!current || rendering) && <div className="resume-pdf-message" role="status"><LoaderCircle className="resume-pdf-spinner" size={24}/><p>{current ? 'Показываем страницу…' : 'Готовим PDF…'}</p></div>}
      <div className="resume-pdf-canvas-stage" ref={stage} hidden={!!error || !current}/>
    </div>
  </section>;
}
