import './fsp-brand-attribution.css';

const assetRoot = `${import.meta.env.BASE_URL}brand/fsp/`;
const lightLogo = `${assetRoot}${encodeURIComponent('Лого цвет сокращенный.svg')}`;
const darkLogo = `${assetRoot}${encodeURIComponent('Сокращенный белый.svg')}`;

/** Official, unmodified artwork; this attribution describes the contest context. */
export function FspBrandAttribution({ className = '' }: { className?: string }) {
  return <aside className={`fsp-brand-attribution ${className}`.trim()} aria-label="Специальный трек ЛЦТ2026">
    <div className="fsp-brand-attribution__logo">
      <img className="fsp-brand-attribution__image fsp-brand-attribution__image--light"
        src={lightLogo} width={281.63} height={94.28}
        alt="Федерация спортивного программирования — ФСП" decoding="async" />
      <img className="fsp-brand-attribution__image fsp-brand-attribution__image--dark"
        src={darkLogo} width={260.32} height={83.3}
        alt="Федерация спортивного программирования — ФСП" decoding="async" />
    </div>
    <p className="fsp-brand-attribution__copy">Signal — решение для специального трека Федерации спортивного программирования на ЛЦТ2026</p>
  </aside>;
}
