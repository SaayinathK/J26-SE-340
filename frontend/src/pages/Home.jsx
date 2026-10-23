import { useEffect, useRef, useState } from 'react';
import { Icon, Logo } from '../components/ui.jsx';
import { useReducedMotion } from '../hooks/useMotion.js';
import '../styles/home.css';

const agents = [
  { name: 'Strategy Agent', short: 'Strategy', icon: 'overview', verb: 'Plan with purpose', title: 'A clearer direction for every campaign.', description: 'Connect your business goals, audience, and campaign context to a focused marketing direction.', input: 'Business goals & campaign context', output: 'A focused marketing plan', items: ['Define the campaign objective', 'Align channels with your audience', 'Shape a consistent marketing direction'], preview: 'Campaign direction', sample: 'Introduce a new collection', fields: [['Objective', 'Build product awareness'], ['Audience', 'Returning customers'], ['Approach', 'A story-led product launch']] },
  { name: 'Content Agent', short: 'Content', icon: 'file', verb: 'Create with consistency', title: 'Your brand voice. Across every idea.', description: 'Bring brand guidelines and business knowledge into the creative process for more relevant marketing content.', input: 'Brand guidelines & business knowledge', output: 'Brand-aligned creative content', items: ['Ground ideas in your business', 'Keep your tone and voice consistent', 'Adapt the message to the format'], preview: 'Creative direction', sample: 'A fresh chapter for your brand', fields: [['Brand voice', 'Confident, warm & helpful'], ['Message', 'Thoughtfully made. Made for you.'], ['Format', 'Social copy & campaign content']] },
  { name: 'Lead Intelligence Agent', short: 'Lead Intelligence', icon: 'users', verb: 'Understand your audience', title: 'Better context. More meaningful opportunities.', description: 'Bring customer context and behavioral signals into focus to support more informed lead prioritization.', input: 'Customer context & engagement signals', output: 'Lead insights & recommendations', items: ['Understand customer behavior', 'Explore relevant audience context', 'Focus on promising relationships'], preview: 'Audience perspective', sample: 'Understand the next conversation', fields: [['Signal', 'Interest in the new collection'], ['Context', 'An existing customer relationship'], ['Next step', 'A relevant product introduction']] },
  { name: 'Email Agent', short: 'Email', icon: 'mail', verb: 'Connect with relevance', title: 'Turn the right context into the right conversation.', description: 'Shape personalized email sequences around your business, audience, and campaign message.', input: 'Business knowledge & campaign brief', output: 'Personalized email sequences', items: ['Create with your business context', 'Develop a connected email sequence', 'Review and refine every message'], preview: 'Email sequence', sample: 'A conversation, thoughtfully sequenced', fields: [['01 · Introduce', 'Something new, with you in mind'], ['02 · Inspire', 'A closer look at the collection'], ['03 · Follow up', 'Let’s keep the conversation going']] },
];

const workflow = [
  { icon: 'book', title: 'Start with your business.', description: 'Bring your brand, audience, and business knowledge together. Context gives your marketing a stronger foundation.', label: 'YOUR BUSINESS CONTEXT', detail: ['Brand identity', 'Audience', 'Business goals'] },
  { icon: 'sparkles', title: 'Explore four perspectives.', description: 'Strategy, Content, Lead Intelligence, and Email bring specialized perspectives to the same marketing challenge.', label: 'FOUR SPECIALIST AGENTS', detail: ['Plan', 'Create', 'Understand', 'Connect'] },
  { icon: 'checks', title: 'Make the next move yours.', description: 'Review the ideas, refine the details, and keep your team aligned. Your business stays at the center of every decision.', label: 'HUMAN-LED MARKETING', detail: ['Review', 'Refine', 'Move forward'] },
];

const questions = [
  ['What is Ciftron?', 'Ciftron is a digital marketing SaaS platform organized around four specialist AI agents: Strategy, Content, Lead Intelligence, and Email. It brings business context, marketing work, and team collaboration into one workspace.'],
  ['How do the four agents fit together?', 'Strategy focuses on marketing direction, Content on brand-aligned creative work, Lead Intelligence on customer understanding, and Email on personalized outreach. Each brings a different perspective to your marketing, grounded in your business context.'],
  ['Who is the platform designed for?', 'Marketing agencies managing client work, small and growing businesses, and independent consultants who want a more connected approach to AI-assisted digital marketing.'],
  ['How does Ciftron support team collaboration?', 'Workspace administrators manage membership and permissions. Marketers can create and edit, while viewers can review work with read-only access. Your team keeps control over how AI-assisted work is used.'],
];

function useHomeMotion(root, enabled) {
  useEffect(() => {
    const surface = root.current;
    if (!surface || !enabled) return;
    const elements = [...surface.querySelectorAll('[data-home-reveal]')];
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('home-visible'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.08 }) : null;
    if (observer) elements.forEach(element => { element.classList.add('home-will-reveal'); observer.observe(element); });
    let frame = 0;
    const update = () => {
      frame = 0;
      const distance = document.documentElement.scrollHeight - window.innerHeight;
      surface.style.setProperty('--home-scroll', distance > 0 ? Math.min(1, Math.max(0, window.scrollY / distance)) : 0);
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('resize', scroll);
    return () => {
      observer?.disconnect();
      elements.forEach(element => element.classList.remove('home-will-reveal', 'home-visible'));
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('resize', scroll);
      surface.style.removeProperty('--home-scroll');
    };
  }, [root, enabled]);
}

function AgentNetwork({ enabled, onExplore }) {
  const stage = useRef(null);
  useEffect(() => {
    const element = stage.current;
    if (!enabled || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let frame = 0;
    let pointer = null;
    const render = () => {
      frame = 0;
      if (!pointer) return;
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (pointer.x - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (pointer.y - rect.top) / rect.height));
      element.style.setProperty('--network-rx', `${(0.5 - y) * 7}deg`);
      element.style.setProperty('--network-ry', `${(x - 0.5) * 9}deg`);
      element.style.setProperty('--network-x', `${x * 100}%`);
      element.style.setProperty('--network-y', `${y * 100}%`);
    };
    const move = event => { pointer = { x: event.clientX, y: event.clientY }; if (!frame) frame = requestAnimationFrame(render); };
    const reset = () => {
      pointer = null;
      cancelAnimationFrame(frame); frame = 0;
      ['--network-rx', '--network-ry', '--network-x', '--network-y'].forEach(name => element.style.removeProperty(name));
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', reset);
    return () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', reset); reset(); };
  }, [enabled]);

  return <div className="home-network" ref={stage}>
    <div className="home-network-label"><span className="home-signal-dot" /> THE CIFTRON ECOSYSTEM<span>04 AGENTS / 01 PLATFORM</span></div>
    <div className="home-network-scene">
      <div className="home-network-orbits" aria-hidden="true"><i /><i /><i /><span className="home-orbit-particle" /><span className="home-orbit-particle home-orbit-particle-second" /></div>
      <svg className="home-network-lines" viewBox="0 0 600 500" fill="none" aria-hidden="true">
        {['M300 250 C205 250 215 120 130 120', 'M300 250 C395 250 385 120 470 120', 'M300 250 C205 250 215 380 130 380', 'M300 250 C395 250 385 380 470 380'].map((d, index) => <g key={d}><path d={d} stroke="#174942" strokeWidth="1" /><path d={d} pathLength="100" className="home-network-flow" style={{ animationDelay: `${index * -1.1}s` }} /></g>)}
      </svg>
      <div className="home-network-core"><span className="home-core-symbol"><Logo compact /></span><strong>Your business</strong><small>THE SHARED CONTEXT</small></div>
      {agents.map((agent, index) => <button key={agent.name} className={`home-network-node home-network-node-${index}`} onClick={() => onExplore(index)} aria-label={`Explore ${agent.name}`}><span className="home-network-node-icon"><Icon name={agent.icon} size={22} /></span><span><small>0{index + 1} / {['PLAN', 'CREATE', 'UNDERSTAND', 'CONNECT'][index]}</small><strong>{agent.short}</strong></span><span className="home-node-dot" /></button>)}
      <span className="home-network-coordinate home-coordinate-top" aria-hidden="true">+</span><span className="home-network-coordinate home-coordinate-bottom" aria-hidden="true">+</span>
    </div>
    <div className="home-network-caption"><Icon name="shield" size={13} /><span>One business context. Four specialist perspectives.</span><Icon name="sparkles" size={15} /></div>
  </div>;
}

export default function Home({ user }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState(0);
  const [motionPaused, setMotionPaused] = useState(false);
  const root = useRef(null);
  const reducedMotion = useReducedMotion();
  const motionEnabled = !motionPaused && !reducedMotion;
  const active = agents[activeAgent];
  const startPath = user ? '#overview' : '#register';
  useHomeMotion(root, motionEnabled);

  function explore(id) {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: motionEnabled ? 'smooth' : 'instant', block: 'start' });
  }
  function exploreAgent(index) { setActiveAgent(index); explore('home-agents'); }
  function changeAgent(event, index) {
    const next = event.key === 'ArrowRight' ? (index + 1) % agents.length : event.key === 'ArrowLeft' ? (index + agents.length - 1) % agents.length : event.key === 'Home' ? 0 : event.key === 'End' ? agents.length - 1 : null;
    if (next !== null) { event.preventDefault(); setActiveAgent(next); document.getElementById(`home-agent-${next}`)?.focus(); }
  }

  return <div className="home-page" ref={root} data-paused={motionEnabled ? 'false' : 'true'}>
    <a className="home-skip" href="#home-content" onClick={event => { event.preventDefault(); document.getElementById('home-content').focus(); }}>Skip to content</a>
    <header className="home-header"><div className="home-container home-header-inner">
      <a className="home-logo" href="#home" aria-label="Ciftron home"><Logo /></a>
      <nav className={`home-nav ${menuOpen ? 'home-nav-open' : ''}`} aria-label="Main navigation" id="home-navigation" onKeyDown={event => { if (event.key === 'Escape') { setMenuOpen(false); document.getElementById('home-menu-toggle')?.focus(); } }}>
        <button onClick={() => explore('home-platform')}>The platform</button><button onClick={() => explore('home-agents')}>Our AI agents</button><button onClick={() => explore('home-teams')}>For your team</button><button onClick={() => explore('home-faq')}>FAQs</button>
        <a className="home-mobile-signin" href={user ? '#overview' : '#sign-in'}>{user ? 'Open workspace' : 'Sign in'}<Icon name="arrow" size={16} /></a>
      </nav>
      <div className="home-header-actions"><button className="home-motion-toggle" onClick={() => setMotionPaused(paused => !paused)} aria-label={reducedMotion ? 'Reduced motion enabled' : motionPaused ? 'Resume animations' : 'Pause animations'} aria-pressed={motionPaused} disabled={reducedMotion} title={reducedMotion ? 'Reduced motion enabled' : motionPaused ? 'Resume animations' : 'Pause animations'}><Icon name={motionEnabled ? 'pause' : 'play'} size={15} /></button><a className="home-signin" href={user ? '#overview' : '#sign-in'}>{user ? 'My workspace' : 'Sign in'}</a><a className="home-button home-button-primary home-header-cta" href={startPath}>{user ? 'Open workspace' : 'Get started'}<Icon name="arrow" size={16} /></a><button className="home-menu-toggle" id="home-menu-toggle" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="home-navigation" onClick={() => setMenuOpen(open => !open)}><Icon name={menuOpen ? 'close' : 'menu'} size={23} /></button></div>
    </div><div className="home-reading-progress" aria-hidden="true" /></header>

    <main id="home-content" tabIndex={-1}>
      <section className="home-hero-wrap home-container" aria-labelledby="home-title"><div className="home-hero">
        <div className="home-hero-atmosphere" aria-hidden="true"><i /><i /><i /></div>
        <div className="home-hero-main"><div className="home-hero-copy">
          <div className="home-eyebrow home-hero-enter"><span className="home-signal-dot" /> YOUR AI DIGITAL MARKETING PLATFORM</div>
          <h1 id="home-title" className="home-hero-enter">One platform.<br />Four agents.<br /><span>Built for your growth.</span></h1>
          <p className="home-hero-description home-hero-enter">Connect strategy, content, lead intelligence, and email in one business-aware workspace. Bring your marketing together. Move your business forward.</p>
          <div className="home-hero-actions home-hero-enter"><a href={startPath} className="home-button home-button-primary">{user ? 'Open your workspace' : 'Discover your workspace'}<Icon name="arrow" size={18} /></a><button className="home-hero-explore" onClick={() => explore('home-agents')}><span><Icon name="play" size={12} /></span>Meet your AI team</button></div>
          <div className="home-hero-notes home-hero-enter"><span><Icon name="shield" size={14} /> Business-aware by design</span><span><Icon name="users" size={14} /> Built for your team</span></div>
        </div><AgentNetwork enabled={motionEnabled} onExplore={exploreAgent} /></div>
        <div className="home-hero-bottom"><span><Icon name="sparkles" size={16} /> SPECIALIZED INTELLIGENCE. SHARED AMBITION.</span><div>{agents.map(agent => <span key={agent.name}><Icon name={agent.icon} size={15} />{agent.short}</span>)}</div></div>
      </div></section>

      <section className="home-audience-strip home-container" aria-label="Designed for your business"><span>For the people<br /><strong>moving brands forward.</strong></span><div><Icon name="building" size={23} />Marketing agencies</div><div><Icon name="trend" size={23} />Growing businesses</div><div><Icon name="globe" size={23} />Independent consultants</div></section>

      <section className="home-agents-section home-container" id="home-agents" aria-labelledby="home-agents-title">
        <div className="home-section-split-heading" data-home-reveal><div><div className="home-eyebrow"><span className="home-section-line" /> FOUR SPECIALISTS. ONE BIGGER PICTURE.</div><h2 id="home-agents-title">Every side of marketing.<br /><span>Working toward your goals.</span></h2></div><p>A complete digital marketing perspective, shaped around your business. Explore the four agents at the heart of Ciftron.</p></div>
        <div className="home-agent-tabs" role="tablist" aria-label="Explore the four marketing agents" data-home-reveal>{agents.map((agent, index) => <button key={agent.name} role="tab" id={`home-agent-${index}`} aria-selected={activeAgent === index} aria-controls="home-agent-panel" tabIndex={activeAgent === index ? 0 : -1} className={`home-agent-tab ${activeAgent === index ? 'home-agent-selected' : ''}`} onClick={() => setActiveAgent(index)} onKeyDown={event => changeAgent(event, index)}><div className="home-agent-tab-top"><span className="home-agent-icon"><Icon name={agent.icon} size={24} /></span><span className="home-agent-index">0{index + 1}<Icon name="trend" size={15} /></span></div><h3>{agent.name}</h3><p>{agent.verb}</p><span className="home-agent-tab-line" /></button>)}</div>
        <div className="home-agent-panel" id="home-agent-panel" role="tabpanel" aria-labelledby={`home-agent-${activeAgent}`} tabIndex={0} data-home-reveal>
          <div className="home-agent-panel-copy" key={`copy-${activeAgent}`}><div className="home-eyebrow"><Icon name={active.icon} size={16} />{active.name.toUpperCase()}</div><h3>{active.title}</h3><p>{active.description}</p><ul>{active.items.map(item => <li key={item}><Icon name="check" size={15} />{item}</li>)}</ul><a className="home-text-link" href={startPath}>Explore the platform<Icon name="arrow" size={17} /></a></div>
          <div className="home-product-preview" key={`preview-${activeAgent}`}><div className="home-preview-top"><Logo /><span>ILLUSTRATIVE PREVIEW</span><span className="home-preview-avatar">C</span></div><div className="home-preview-body"><div className="home-preview-breadcrumb">Your workspace<Icon name="right" size={12} />{active.preview}</div><div className="home-preview-title"><span><Icon name={active.icon} size={22} /></span><div><small>YOUR BUSINESS. IN FOCUS.</small><h4>{active.preview}</h4></div><Icon name="more" size={20} /></div><p>{active.sample}</p><div className="home-preview-fields">{active.fields.map(([label, value], index) => <div key={label} style={{ '--field-order': index }}><span>{label}</span><strong>{value}</strong><Icon name="check" size={14} /></div>)}</div><div className="home-preview-context"><Icon name="book" size={17} /><div><strong>Grounded in your business context</strong><p>Your brand, audience, and goals shape the perspective.</p></div><span className="home-signal-dot" /></div></div><div className="home-preview-bottom"><span>{active.input}</span><Icon name="arrow" size={13} /><span>{active.output}</span></div></div>
        </div>
      </section>

      <section className="home-platform-section" id="home-platform" aria-labelledby="home-platform-title"><div className="home-container"><div className="home-section-heading" data-home-reveal><div className="home-eyebrow"><span className="home-section-line" /> INTELLIGENCE WITH CONTEXT</div><h2 id="home-platform-title">Your business is the starting point.<br /><span>Your ambition sets the direction.</span></h2><p>A connected approach to digital marketing, from the first brief to the next conversation.</p></div><div className="home-workflow">{workflow.map((item, index) => <article className="home-workflow-card" key={item.title} data-home-reveal><div className="home-workflow-visual" aria-hidden="true"><span className="home-workflow-step">0{index + 1}</span><div className={`home-workflow-symbol home-workflow-symbol-${index}`}><Icon name={item.icon} size={31} /><i /><i /></div><span className="home-workflow-label">{item.label}</span>{index < 2 && <span className="home-workflow-connector"><Icon name="arrow" size={16} /></span>}</div><h3>{item.title}</h3><p>{item.description}</p><div className="home-workflow-chips">{item.detail.map(detail => <span key={detail}>{detail}</span>)}</div></article>)}</div><div className="home-platform-note" data-home-reveal><Icon name="lock" size={16} /><span>Your knowledge, people, and marketing work. A shared foundation for all four agents.</span></div></div></section>

      <section className="home-teams-section home-container" id="home-teams" aria-labelledby="home-teams-title"><div className="home-team-grid"><div className="home-team-image-wrap" data-home-reveal><img src="/images/marketing-team.jpg" alt="Marketing professionals collaborating on a brand campaign around a laptop" width="1536" height="1024" loading="lazy" /><div className="home-team-image-overlay" /><div className="home-team-image-caption"><span className="home-team-caption-icon"><Icon name="users" size={21} /></span><div><small>PEOPLE AT THE CENTER</small><strong>Great marketing is a team effort.</strong></div><span className="home-signal-dot" /></div></div><div className="home-team-copy" data-home-reveal><div className="home-eyebrow"><span className="home-section-line" /> BUILT FOR THE WAY YOU WORK</div><h2 id="home-teams-title">More connected work.<br /><span>More room to create.</span></h2><p>Give your marketing a shared home. Keep your business knowledge, campaigns, and team connected as you build your next chapter.</p><div className="home-team-benefit"><Icon name="book" size={21} /><div><h3>Your brand stays in the picture.</h3><p>Keep business knowledge close to the work it informs, across all four agent perspectives.</p></div></div><div className="home-team-benefit"><Icon name="shield" size={21} /><div><h3>Clear roles. Confident collaboration.</h3><p>Bring administrators, marketers, and viewers together with workspace-based permissions.</p></div></div><div className="home-team-benefit"><Icon name="checks" size={21} /><div><h3>Intelligent assistance. Your judgment.</h3><p>Review ideas, refine the details, and keep your people in control of what comes next.</p></div></div></div></div></section>

      <section className="home-faq-section home-container" id="home-faq" aria-labelledby="home-faq-title"><div data-home-reveal><div className="home-eyebrow"><span className="home-section-line" /> GET TO KNOW CIFTRON</div><h2 id="home-faq-title">A clearer picture.<br /><span>Before you begin.</span></h2><p>A few things you might be wondering.</p><a className="home-text-link" href={user ? '#overview' : '#sign-in'}>{user ? 'Open your workspace' : 'Already part of Ciftron? Sign in'}<Icon name="arrow" size={16} /></a></div><div className="home-faq-list" data-home-reveal>{questions.map(([question, answer]) => <details key={question} name="ciftron-home-faq"><summary>{question}<Icon name="plus" size={19} /></summary><p>{answer}</p></details>)}</div></section>

      <section className="home-final-section home-container" aria-labelledby="home-final-title" data-home-reveal><div className="home-final-orbits" aria-hidden="true"><i /><i /><i /></div><div className="home-eyebrow"><Icon name="sparkles" size={16} /> FOUR AGENTS. ONE MARKETING ADVANTAGE.</div><h2 id="home-final-title">Your next chapter.<br /><span>Intelligently connected.</span></h2><p>A bigger perspective on digital marketing. A workspace built around your business.</p><a className="home-button home-button-primary" href={startPath}>{user ? 'Open your workspace' : 'Create your workspace'}<Icon name="arrow" size={18} /></a><div className="home-final-agent-icons" aria-label="Strategy, Content, Lead Intelligence, and Email">{agents.map(agent => <span key={agent.name} title={agent.name}><Icon name={agent.icon} size={17} /></span>)}</div></section>
    </main>

    <footer className="home-footer home-container"><div className="home-footer-top"><a href="#home" className="home-logo" aria-label="Ciftron home"><Logo /></a><p>Your business. Intelligently connected.</p><nav aria-label="Footer navigation"><button onClick={() => explore('home-platform')}>The platform</button><button onClick={() => explore('home-agents')}>Our AI agents</button><a href={user ? '#overview' : '#sign-in'}>{user ? 'Workspace' : 'Sign in'}</a></nav></div><div className="home-footer-bottom"><span>© {new Date().getFullYear()} Ciftron. All rights reserved.</span><button onClick={() => setMotionPaused(paused => !paused)} aria-pressed={motionPaused} disabled={reducedMotion}><Icon name={motionEnabled ? 'pause' : 'play'} size={12} />{reducedMotion ? 'Reduced motion enabled' : motionPaused ? 'Resume animations' : 'Pause animations'}</button><span>AI-powered digital marketing SaaS.</span></div></footer>
  </div>;
}
