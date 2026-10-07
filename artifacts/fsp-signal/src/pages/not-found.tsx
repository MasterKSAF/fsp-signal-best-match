import { AlertCircle } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="state-panel">
      <AlertCircle size={30} />
      <h1>Страница не найдена</h1>
      <p>Возможно, адрес изменился. Перейдите на главную и выберите нужный раздел.</p>
      <Link className="button primary" href="/">На главную</Link>
    </div>
  );
}
