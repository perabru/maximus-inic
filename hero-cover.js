'use strict';

(() => {
  const cover = document.querySelector('[data-hero-carousel]');
  if (!cover) return;
  const slides = [...cover.querySelectorAll('[data-cover-slide]')];
  if (slides.length < 2) return;

  const controls = cover.querySelector('[data-cover-controls]');
  const caption = cover.querySelector('[data-cover-caption]');
  const counter = cover.querySelector('[data-cover-counter]');
  const playButton = cover.querySelector('[data-cover-play]');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let playing = !reducedMotion.matches;
  let hovered = false;
  let focused = false;
  let inView = true;
  let explicitPlay = false;
  let timer;

  function paintPlay() {
    playButton.hidden = reducedMotion.matches;
    playButton.textContent = playing ? 'Pausar' : 'Reproduzir';
    playButton.setAttribute('aria-label', playing ? 'Pausar troca automática das capas' : 'Reproduzir troca automática das capas');
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing || reducedMotion.matches || document.hidden || !inView || ((hovered || focused) && !explicitPlay)) return;
    timer = setTimeout(() => {
      show(current + 1);
      schedule();
    }, 6000);
  }

  function show(index, manual = false) {
    current = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach((slide, index) => {
      slide.hidden = index !== current;
      slide.setAttribute('aria-hidden', String(index !== current));
    });
    caption.textContent = slides[current].dataset.caption;
    counter.setAttribute('aria-live', manual ? 'polite' : 'off');
    counter.textContent = `${current + 1} de ${slides.length}`;
    if (manual) {
      playing = false;
      explicitPlay = false;
      paintPlay();
      schedule();
    }
  }

  cover.querySelector('[data-cover-previous]').addEventListener('click', () => show(current - 1, true));
  cover.querySelector('[data-cover-next]').addEventListener('click', () => show(current + 1, true));
  playButton.addEventListener('click', () => {
    playing = !playing;
    explicitPlay = playing;
    paintPlay();
    schedule();
  });
  cover.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    show(current + (event.key === 'ArrowRight' ? 1 : -1), true);
  });
  cover.addEventListener('mouseenter', () => { hovered = true; explicitPlay = false; schedule(); });
  cover.addEventListener('mouseleave', () => { hovered = false; schedule(); });
  cover.addEventListener('focusin', event => {
    focused = true;
    if (event.target !== playButton) explicitPlay = false;
    schedule();
  });
  cover.addEventListener('focusout', event => {
    focused = cover.contains(event.relatedTarget);
    if (!focused) explicitPlay = false;
    schedule();
  });
  document.addEventListener('visibilitychange', () => { explicitPlay = false; schedule(); });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) playing = false;
    explicitPlay = false;
    paintPlay();
    schedule();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      schedule();
    }, { threshold: .25 }).observe(cover);
  }

  controls.hidden = false;
  paintPlay();
  schedule();
})();
