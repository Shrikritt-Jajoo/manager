'use strict';
const Starfield = (() => {
  let canvas, ctx, W, H, drift = 0, lastT = null, raf = null;
  let layers = [], specks = [];
  const SPEED_MAP   = { slow: .060, medium: .120, fast: .220 };
  const DENSITY_MAP = { low: 1.7, medium: 1.0, high: 0.65 };
  const LAYER_DEF   = [
    { divBase: 1200, rMin:.26, rMax:.80, spd:.006, aMin:.10, aMax:.34, hotPct:.03 },
    { divBase: 2150, rMin:.50, rMax:1.35, spd:.013, aMin:.18, aMax:.56, hotPct:.05 },
    { divBase: 4450, rMin:.90, rMax:2.05, spd:.028, aMin:.28, aMax:.80, hotPct:.10 }
  ];

  function cfg() {
    const s = (typeof AppState !== 'undefined') ? AppState.getSettings() : {};
    return {
      speedK:     SPEED_MAP[s.starSpeed]    || SPEED_MAP.slow,
      densityK:   DENSITY_MAP[s.starDensity]|| DENSITY_MAP.medium,
      bodyColors: s.starBodyColors || ['#e6e2ff','#ffeae0','#f4defc','#eeeeee'],
      glowColors: s.starGlowColors || ['#486eff','#a848ff','#ff4894','#48c4da','#ff9448','#82ffaa']
    };
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rndInt(a,b){ return Math.floor(rnd(a,b+1)); }

  function buildStar(ld, bodyRgbs, glowRgbs, isHot) {
    const r   = rnd(ld.rMin, ld.rMax);
    const bRgb= bodyRgbs[rndInt(0, bodyRgbs.length-1)];
    const v   = rndInt(-14, 14);
    const col = [Math.min(255,bRgb[0]+v), Math.min(255,bRgb[1]+v), Math.min(255,bRgb[2]+v)];
    return {
      x: rnd(0, W), y: rnd(0, H),
      r, spd: ld.spd,
      alpha: rnd(ld.aMin, ld.aMax),
      tSpeed: rnd(.08, .24),
      phase: rnd(0, Math.PI*2),
      col,
      isHot,
      glowRgb: isHot ? glowRgbs[rndInt(0, glowRgbs.length-1)] : null
    };
  }

  function build() {
    const c   = cfg();
    const bRgbs = c.bodyColors.map(h => Utils.hexToRgb(h));
    const gRgbs = c.glowColors.map(h => Utils.hexToRgb(h));
    layers = LAYER_DEF.map(ld => {
      const count = Math.floor((W * H) / (ld.divBase * c.densityK));
      return Array.from({ length: count }, () => {
        const isHot = Math.random() < ld.hotPct;
        return buildStar(ld, bRgbs, gRgbs, isHot);
      });
    });
    specks = Array.from({ length: 1690 }, () => ({
      x: rnd(0,W), y: rnd(0,H), a: rnd(.012,.034)
    }));
  }

  function drawStar(s, t, k) {
    const tw  = .90 + .10 * Math.sin(t * s.tSpeed + s.phase);
    const a   = s.alpha * tw;
    const sx  = ((s.x - drift * s.spd * k) % (W + 60) + W + 60) % (W + 60);
    if (s.isHot && s.glowRgb) {
      ctx.globalCompositeOperation = 'screen';
      const g2 = ctx.createRadialGradient(sx, s.y, s.r*.3, sx, s.y, s.r*12);
      g2.addColorStop(0, `rgba(${s.col},${a*.9})`);
      g2.addColorStop(.4,`rgba(${s.glowRgb},${ a*.35})`);
      g2.addColorStop(1, `rgba(${s.glowRgb},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(sx, s.y, s.r*12, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const g  = ctx.createRadialGradient(sx, s.y, 0, sx, s.y, s.r*2);
    g.addColorStop(0,    `rgba(${s.col},${a})`);
    g.addColorStop(.52,  `rgba(${s.col},${a*.65})`);
    g.addColorStop(1,    `rgba(${s.col},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, s.y, s.r*2, 0, Math.PI*2); ctx.fill();
  }

  function frame(ts) {
    if (lastT === null) lastT = ts;
    const dt  = Math.min(ts - lastT, 50);
    lastT = ts;
    const c   = cfg();
    drift += dt * c.speedK;

    ctx.clearRect(0, 0, W, H);

    // specks
    ctx.globalCompositeOperation = 'source-over';
    specks.forEach(sp => {
      ctx.fillStyle = `rgba(238,238,238,${sp.a})`;
      ctx.fillRect(sp.x, sp.y, 1, 1);
    });

    const t = ts / 1000;
    layers.forEach((layer, li) => {
      layer.forEach(s => drawStar(s, t, li + 1));
    });

    raf = requestAnimationFrame(frame);
  }

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    build();
    drift = 0; lastT = null;
  }

  return {
    init() {
      canvas = document.getElementById('starCanvas');
      if (!canvas) return;
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', () => resize());
      if (typeof AppState !== 'undefined') {
        AppState.onMeta('settings', () => { build(); });
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      raf = requestAnimationFrame(frame);
    },
    rebuild() { build(); }
  };
})();
