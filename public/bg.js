/* Majesty Pharma animated background: molecular canvas + CSS light/shape layers. */
(function () {
  'use strict';
  const mode = document.body.dataset.bg || 'full';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const layer = document.createElement('div');
  layer.className = 'bg-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `
    <div class="bg-blob bg-blob-red"></div>
    <div class="bg-blob bg-blob-gold"></div>
    <div class="bg-shape bg-hex"></div>
    <div class="bg-shape bg-ring"></div>
    <div class="bg-shape bg-square"></div>
    <div class="bg-shape bg-hex bg-hex-2"></div>
    <div class="bg-shape bg-dot"></div>
    <canvas class="bg-canvas"></canvas>`;
  document.body.prepend(layer);

  const canvas = layer.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let raf = null;
  let running = false;

  const COLORS = [
    [214, 180, 106], // champagne gold
    [240, 217, 155], // soft gold
    [150, 40, 65],   // burgundy rose
    [140, 120, 130], // muted mauve
  ];
  const count = mode === 'subtle' ? 22 : Math.min(55, Math.max(28, Math.floor((window.innerWidth * window.innerHeight) / 26000)));
  const alphaScale = mode === 'subtle' ? 0.55 : 1;
  const LINK_DIST = 120;
  let particles = [];

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    particles = Array.from({ length: count }, () => {
      const c = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: 1.4 + Math.random() * 1.8,
        c,
        a: (0.22 + Math.random() * 0.18) * alphaScale,
      };
    });
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -20) p.x = W + 20; else if (p.x > W + 20) p.x = -20;
      if (p.y < -20) p.y = H + 20; else if (p.y > H + 20) p.y = -20;
    }
    ctx.lineWidth = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < LINK_DIST * LINK_DIST) {
          const a = (1 - Math.sqrt(d2) / LINK_DIST) * 0.10 * alphaScale;
          ctx.strokeStyle = `rgba(214,180,106,${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      ctx.fillStyle = `rgba(${p.c[0]},${p.c[1]},${p.c[2]},${p.a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduced && running) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running || reduced) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  resize();
  seed();
  frame(); // reduced motion: renders one static frame and does not loop
  start();

  window.addEventListener('resize', () => { resize(); seed(); if (reduced) frame(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
})();