import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import './form-field.css';
import { InlineInfo } from './inline-info';

export function FormField({ label, children, hint, error, className = '', layout = 'auto' }: { label: string; children: ReactNode; hint?: ReactNode; error?: string; className?: string; layout?: 'auto' | 'vertical' }) {
  const generatedId = useId();
  const nodes = Children.toArray(children);
  const index = nodes.findIndex(node => isValidElement(node) && !['small', 'p', 'span'].includes(String(node.type)));
  const control = index >= 0 ? nodes[index] as ReactElement<Record<string, unknown>> : undefined;
  const id = typeof control?.props.id === 'string' ? control.props.id : `field-${generatedId}`;
  const helperId = `${id}-hint`, errorId = `${id}-error`;
  const extraHints = nodes.filter(node => isValidElement<Record<string, unknown>>(node) && ['small', 'p'].includes(String(node.type)) && node.props.role !== 'alert' && node.props.role !== 'status' && !String(node.props.className ?? '').includes('error'));
  const describedBy = [control?.props['aria-describedby'], hint || extraHints.length ? helperId : null, error ? errorId : null].filter(Boolean).join(' ');
  const vertical = layout === 'vertical' || label.length > 42 || control?.type === 'textarea' || !!control?.props.rows || control?.props['data-multivalue'];
  if (control) nodes[index] = cloneElement(control, { id, 'aria-describedby': describedBy || undefined, 'aria-invalid': error ? true : control.props['aria-invalid'] });
  return <div className={`form-field ${vertical ? 'form-field--vertical' : 'form-field--compact'} ${className}`}><div className="form-field__layout"><div className="form-field__label-row"><label className="form-field__label" htmlFor={id}>{label}</label>{(hint || extraHints.length > 0) && <InlineInfo id={`${helperId}-popup`} label={`${label}: подробнее`}>{hint}{extraHints}</InlineInfo>}</div><div className="form-field__control">{nodes.filter(node => !extraHints.includes(node))}{(hint || extraHints.length > 0) && <span id={helperId} className="sr-only">{hint}{extraHints}</span>}{error && <p className="form-field__error" id={errorId} role="alert">{error}</p>}</div></div></div>;
}
