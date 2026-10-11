import { useEffect, useState } from 'react';
import { storageRead, storageWrite } from '../lib/preferences.js';

const eventName = 'ciftron-motion-change';

export function useMotionPreference() {
  const [motion, setMotion] = useState(() => storageRead('ciftron-motion', 'full'));
  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    storageWrite('ciftron-motion', motion);
    window.dispatchEvent(new Event(eventName));
  }, [motion]);
  return [motion, setMotion];
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    document.documentElement.dataset.motion === 'reduced'
  );
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches || document.documentElement.dataset.motion === 'reduced');
    update();
    media.addEventListener('change', update);
    window.addEventListener(eventName, update);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener(eventName, update);
    };
  }, []);
  return reduced;
}

export function usePageReveal(ref, page, workspaceId, motion) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced || motion === 'reduced' || !('IntersectionObserver' in window)) return;
    const elements = [...root.querySelectorAll('.metric-card, .dashboard-main-grid > .card, .dashboard-bottom-grid > .card, .builder-grid > .card, .integration-card, .role-card, .monitoring-card, .settings-card')];
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05 });
    elements.forEach((element, index) => {
      element.style.setProperty('--reveal-delay', `${Math.min(index % 4, 3) * 65}ms`);
      element.classList.add('reveal-pending');
      observer.observe(element);
    });
    return () => {
      observer.disconnect();
      elements.forEach(element => {
        element.classList.remove('reveal-pending', 'is-revealed');
        element.style.removeProperty('--reveal-delay');
      });
    };
  }, [ref, page, workspaceId, motion, reduced]);
}
