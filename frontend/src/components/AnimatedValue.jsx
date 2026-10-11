import { useEffect, useState } from 'react';
import { useReducedMotion } from '../hooks/useMotion.js';

export default function AnimatedValue({ value }) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (reduced) { setDisplay(value); return; }
    const target = Number(value.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(target)) { setDisplay(value); return; }
    const decimals = value.includes('.') ? value.split('.')[1].replace(/\D/g, '').length : 0;
    const percent = value.endsWith('%');
    const padded = /^0\d+$/.test(value);
    let frame;
    let start;
    function tick(now) {
      start ??= now;
      const progress = Math.min((now - start) / 900, 1);
      const current = target * (1 - Math.pow(1 - progress, 3));
      const number = decimals ? current.toFixed(decimals) : Math.round(current).toLocaleString('en-US');
      setDisplay(progress === 1 ? value : `${padded ? number.padStart(value.length, '0') : number}${percent ? '%' : ''}`);
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);
  return <><span className="sr-only">{value}</span><span aria-hidden="true">{display}</span></>;
}
