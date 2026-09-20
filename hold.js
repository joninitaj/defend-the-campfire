(() => {
  const CV = document.getElementById("g");
  const CTX = CV.getContext("2d");
  let VW = 1920, VH = 1080, MAP = 3200;
  const TILE = 32;
  const CAMP = { x: 1600, y: 1600, r: 240 };
  const MAX_Z = 40, MAX_SHOTS = 90, MAX_PARTS = 140, TREE_CELL = 192;
  const KEY = Object.create(null);
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const ang = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const lerp = (a, b, t) => a + (b - a) * t;
  const snap = (v) => (v * 0.5 | 0) * 2;

  const audio = {
    ctx: null, userMuted: false, sdkMute: false, adMute: false,
    silenced() { return this.userMuted || this.sdkMute || this.adMute; },
    unlock() {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    tone(freq, dur, type, vol, slide) {
      if (this.silenced() || !this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || "square";
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
      g.gain.setValueAtTime(vol || 0.07, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur);
    },
    noise(dur, vol) {
      if (this.silenced() || !this.ctx) return;
      if (!this._noise) {
        const n = this.ctx.sampleRate * 0.12;
        const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        this._noise = buf;
      }
      const s = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      s.buffer = this._noise; g.gain.value = vol || 0.1;
      g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + (dur || 0.08));
      s.connect(g); g.connect(this.ctx.destination); s.start();
    }
  };

  const cg = {
    ready: false,
    playing: false,
    video: false,
    rails: false,
    bannerAt: 0,
    lastPct: 0,
    demoTimer: 0,
    demoDone: null,
    sdk() { return window.CrazyGames && window.CrazyGames.SDK; },
    env() {
      const s = this.sdk();
      return (s && s.environment) || "";
    },
    ok() {
      if (!this.ready) return false;
      const e = this.env();
      return e !== "disabled";
    },
    call(fn) {
      if (!this.ok()) return;
      try { fn(this.sdk()); } catch (e) {}
    },
    applySettings(settings) {
      audio.sdkMute = !!(settings && settings.muteAudio);
      syncHudBars();
    },
    gameplayStart() {
      if (this.playing) return;
      this.playing = true;
      this.call((s) => s.game.gameplayStart());
    },
    gameplayStop() {
      if (!this.playing) return;
      this.playing = false;
      this.call((s) => s.game.gameplayStop());
    },
    happy() { this.call((s) => s.game.happytime()); },
    context() {
      if (!S) return;
      this.call((s) => {
        if (!s.game.setGameContext) return;
        s.game.setGameContext({
          wave: String(S.wave),
          kills: String(S.kills),
          fire: S.fire.dead ? "out" : "lit",
          state: S.state
        });
      });
    },
    clearContext() { this.call((s) => { if (s.game.clearGameContext) s.game.clearGameContext(); }); },
    progress(n) {
      n = clamp(n | 0, 0, 100);
      if (n <= this.lastPct && n !== 100) return;
      this.lastPct = n;
      this.call((s) => {
        if (s.game.reportGameCompletedPercentage) s.game.reportGameCompletedPercentage(n);
      });
    },
    layoutRails() {
      const w = window.innerWidth | 0, h = window.innerHeight | 0;
      const wide = w >= 1800 && h >= 620;
      const show = w >= 1100 && h >= 600;
      const left = $("adLeft"), right = $("adRight");
      [left, right].forEach((el) => {
        if (!el) return;
        el.classList.toggle("show", show);
        el.classList.toggle("wide", wide);
        el.setAttribute("aria-hidden", show ? "false" : "true");
      });
      this.rails = show;
      if (show) setTimeout(() => this.requestBanners(), 80);
      else this.clearBanners();
      return show;
    },
    async requestBanners() {
      if (this.video || !this.rails) return;
      if (!this.ok()) return;
      if (Date.now() - this.bannerAt < 31000) return;
      const s = this.sdk();
      if (!s || !s.banner || !s.banner.requestResponsiveBanner) return;
      const ids = ["adLeftInner", "adRightInner"];
      let filled = false;
      for (const id of ids) {
        try {
          await s.banner.requestResponsiveBanner(id);
          filled = true;
        } catch (e) {}
      }
      if (filled) this.bannerAt = Date.now();
    },
    clearBanners() {
      this.call((s) => {
        if (!s.banner) return;
        if (s.banner.clearBanner) {
          s.banner.clearBanner("adLeftInner");
          s.banner.clearBanner("adRightInner");
        } else if (s.banner.clearAllBanners) s.banner.clearAllBanners();
      });
    },
    closeDemo() {
      if (this.demoTimer) { clearTimeout(this.demoTimer); this.demoTimer = 0; }
      hide("adBreak");
      const fn = this.demoDone;
      this.demoDone = null;
      this.video = false;
      audio.adMute = false;
      syncHudBars();
      this.requestBanners();
      if (fn) fn();
    },
    demoVideo(kind, done) {
      this.video = true;
      audio.adMute = true;
      syncHudBars();
      $("adBreakTitle").textContent = "Advertisement";
      $("adBreakKind").textContent = kind === "rewarded" ? "Watch to respawn" : "Wave break";
      show("adBreak");
      this.demoDone = done;
      this.demoTimer = setTimeout(() => this.closeDemo(), kind === "rewarded" ? 2800 : 2200);
    },
    midgame(done) {
      const finish = () => {
        this.video = false;
        audio.adMute = false;
        syncHudBars();
        this.requestBanners();
        done();
      };
      this.video = true;
      this.clearBanners();
      if (!this.ok() || !this.sdk().ad) { this.demoVideo("midgame", done); return; }
      let closed = false;
      const end = (err) => {
        if (closed) return;
        closed = true;
        const local = this.env() === "local";
        if (local && err && err.code !== "adCooldown") this.demoVideo("midgame", done);
        else finish();
      };
      try {
        this.sdk().ad.requestAd("midgame", {
          adStarted() { audio.adMute = true; syncHudBars(); },
          adFinished() { end(null); },
          adError(error) { end(error || { code: "other" }); }
        });
      } catch (e) { end({ code: "other" }); }
    },
    rewarded(onReward, onFail) {
      const fail = () => {
        this.video = false;
        audio.adMute = false;
        syncHudBars();
        this.requestBanners();
        if (onFail) onFail();
      };
      this.video = true;
      this.clearBanners();
      if (!this.ok() || !this.sdk().ad) {
        this.demoVideo("rewarded", onReward);
        return;
      }
      let closed = false;
      try {
        this.sdk().ad.requestAd("rewarded", {
          adStarted() { audio.adMute = true; syncHudBars(); },
          adFinished() {
            if (closed) return;
            closed = true;
            cg.video = false;
            audio.adMute = false;
            syncHudBars();
            cg.requestBanners();
            onReward();
          },
          adError() {
            if (closed) return;
            closed = true;
            if (cg.env() === "local") cg.demoVideo("rewarded", onReward);
            else fail();
          }
        });
      } catch (e) { fail(); }
    }
  };

  const POWERS = {
    embers: { kind: "wep", name: "Ember Bolts", max: 5, blurb: "Auto-fire sparks at the nearest ghoul." },
    boomerang: { kind: "wep", name: "Bone Boomerang", max: 5, blurb: "Throws a returning blade that cuts both ways." },
    rockets: { kind: "wep", name: "Rocket Launcher", max: 5, blurb: "Fat homing warheads that burst on impact." },
    orbit: { kind: "wep", name: "Fire Orbs", max: 5, blurb: "Burning spheres circle you and scorch anything close." },
    storm: { kind: "wep", name: "Storm Latch", max: 5, blurb: "Lightning leaps between nearby enemies." },
    frost: { kind: "wep", name: "Hoarfrost", max: 5, blurb: "Ice shards that slow whatever they hit." },
    blades: { kind: "wep", name: "Whirling Hatchets", max: 5, blurb: "Close-range spinning steel around your body." },
    halo: { kind: "wep", name: "Smoke Halo", max: 5, blurb: "A burning ring that cooks anything that steps in." },
    spear: { kind: "wep", name: "Bone Spear", max: 5, blurb: "A long piercing throw that punches through a line." },
    crows: { kind: "wep", name: "Night Crows", max: 5, blurb: "Black birds that hunt ghouls on their own." },
    pots: { kind: "wep", name: "Pitch Pots", max: 5, blurb: "Lobs tar that puddles and burns the ground." },
    bell: { kind: "wep", name: "Grave Bell", max: 5, blurb: "A shockwave rings out around you." },
    lash: { kind: "wep", name: "Camp Lash", max: 5, blurb: "A heavy whip crack in the direction you aim." },
    hammer: { kind: "wep", name: "Mjolnir", max: 5, blurb: "Thor's hammer. Flies out, smites, and returns with lightning." },
    aegis: { kind: "wep", name: "Thrown Aegis", max: 5, blurb: "A bouncing shield that ricochets through the horde." },
    heatvis: { kind: "wep", name: "Heat Vision", max: 5, blurb: "A burning beam cuts a line through whatever is in front." },
    smash: { kind: "wep", name: "Thunder Clap", max: 5, blurb: "You slam the ground. Nearby ghouls eat the shockwave." },
    web: { kind: "wep", name: "Web Bind", max: 5, blurb: "Sticky strands pin ghouls in place." },
    repulse: { kind: "wep", name: "Repulsors", max: 5, blurb: "Twin energy blasts, Iron Man style." },
    icebreath: { kind: "wep", name: "Freeze Breath", max: 5, blurb: "A cone of ice that slows everything in front of you." },
    lasso: { kind: "wep", name: "Truth Lasso", max: 5, blurb: "A golden lasso yanks a ghoul in and burns it." },
    efield: { kind: "wep", name: "Electric Field", max: 5, blurb: "A crackling cage around you. Anything inside gets cooked." },
    haste: { kind: "pas", name: "Swift Boots", max: 5, blurb: "Move faster. Dodging is the real weapon." },
    vit: { kind: "pas", name: "Iron Hide", max: 5, blurb: "More health, and a small heal right now." },
    fury: { kind: "pas", name: "Kindling Rage", max: 5, blurb: "Every weapon hits harder." },
    cdr: { kind: "pas", name: "Rapid Fire", max: 5, blurb: "Weapons cycle quicker." },
    extra: { kind: "pas", name: "Split Shot", max: 5, blurb: "Extra projectiles on bolts, frost, rockets, spears, and crows." },
    magnet: { kind: "pas", name: "Cinder Magnet", max: 5, blurb: "Pickups fly to you from farther away." },
    ward: { kind: "pas", name: "Camp Blessing", max: 5, blurb: "The fire takes less damage and heals you faster." },
    dashp: { kind: "pas", name: "Afterimage", max: 3, blurb: "Dash farther, more often." },
    knock: { kind: "pas", name: "Siege", max: 5, blurb: "Hits shove enemies back harder." },
    pierce: { kind: "pas", name: "Throughshot", max: 5, blurb: "Projectiles keep going through bodies." },
    thorns: { kind: "pas", name: "Briar Hide", max: 5, blurb: "Anything that bites you gets bitten back." },
    regen: { kind: "pas", name: "Second Wind", max: 5, blurb: "Slow health regen, even away from the fire." },
    reach: { kind: "pas", name: "Longshot", max: 5, blurb: "Weapons lock on from farther away." },
    luck: { kind: "pas", name: "Lucky Charm", max: 5, blurb: "Hearts drop more often." },
    corner: { kind: "pas", name: "Cornered", max: 5, blurb: "Hit harder when your health is low." },
    brazier: { kind: "camp", name: "Brazier", max: 5, blurb: "The fire grows. Relights it if it went out." },
    palisade: { kind: "camp", name: "Palisade", max: 5, blurb: "Stake wall around camp. The fire takes less damage." },
    beacon: { kind: "camp", name: "Heal Beacon", max: 5, blurb: "Warmth reaches farther and knits you faster." },
    turret: { kind: "camp", name: "Watchpost", max: 5, blurb: "A camp turret auto-fires embers at ghouls." },
    stakes: { kind: "camp", name: "Spike Ring", max: 5, blurb: "Stakes inside the ring chew anything that walks in." },
    kindling: { kind: "camp", name: "Kindling", max: 5, blurb: "The fire slowly mends itself between hits." }
  };

  function drawIcon(ctx, id, size) {
    const k = size / 16;
    const p = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect((x * k) | 0, (y * k) | 0, Math.max(1, (w * k) | 0), Math.max(1, (h * k) | 0)); };
    p(0, 0, 16, 16, "#0c0b09");
    if (id === "embers") {
      p(7, 1, 2, 3, "#fff3c8"); p(6, 4, 4, 4, "#ffb020"); p(5, 8, 6, 4, "#ff6a1a"); p(7, 12, 2, 3, "#c45a00");
    } else if (id === "boomerang") {
      p(3, 3, 10, 2, "#d8c8a0"); p(11, 4, 2, 8, "#d8c8a0"); p(4, 10, 8, 2, "#c8b890"); p(3, 5, 2, 6, "#e8d8b0"); p(5, 4, 2, 2, "#fff3c8");
    } else if (id === "rockets") {
      p(6, 1, 4, 4, "#fff3c8"); p(5, 4, 6, 8, "#c23a2a"); p(6, 5, 4, 6, "#ffb020"); p(7, 6, 2, 4, "#fff3c8");
      p(4, 11, 8, 2, "#3a3020"); p(3, 13, 3, 2, "#ff6a1a"); p(10, 13, 3, 2, "#ffb020"); p(6, 13, 4, 2, "#ff9030");
    } else if (id === "orbit") {
      p(7, 7, 2, 2, "#ffe27a"); p(3, 4, 3, 3, "#ff6a1a"); p(10, 4, 3, 3, "#ffb020"); p(6, 11, 3, 3, "#c45a00");
    } else if (id === "storm") {
      p(8, 1, 3, 2, "#d8e8ff"); p(6, 3, 4, 2, "#9fd"); p(5, 5, 5, 2, "#c8e8ff"); p(7, 7, 3, 2, "#9fd"); p(4, 9, 5, 2, "#fff"); p(6, 11, 3, 2, "#9fd"); p(7, 13, 2, 2, "#d8e8ff");
    } else if (id === "frost") {
      p(7, 2, 2, 12, "#a8d8ff"); p(3, 7, 10, 2, "#c8e8ff"); p(5, 4, 2, 2, "#fff"); p(9, 4, 2, 2, "#fff"); p(5, 10, 2, 2, "#9fd"); p(9, 10, 2, 2, "#9fd"); p(7, 7, 2, 2, "#fff");
    } else if (id === "blades") {
      p(2, 3, 5, 2, "#c8c0b0"); p(2, 4, 2, 8, "#8a8070"); p(9, 5, 5, 2, "#c8c0b0"); p(12, 6, 2, 8, "#8a8070"); p(4, 11, 3, 2, "#6b4a26"); p(9, 3, 3, 2, "#6b4a26");
    } else if (id === "haste") {
      p(4, 6, 8, 6, "#6b3a22"); p(3, 8, 3, 5, "#3a1e10"); p(10, 10, 4, 3, "#2a2018"); p(5, 4, 6, 3, "#8a5a28");
    } else if (id === "vit") {
      p(4, 3, 8, 2, "#8a8a8a"); p(3, 5, 10, 7, "#6a6a6a"); p(5, 12, 6, 2, "#8a8a8a"); p(6, 7, 4, 4, "#c23a2a");
    } else if (id === "fury") {
      p(7, 2, 2, 3, "#fff3c8"); p(5, 5, 6, 5, "#ff6a1a"); p(6, 10, 4, 4, "#c23a2a"); p(7, 7, 2, 3, "#ffb020");
    } else if (id === "cdr") {
      p(2, 4, 5, 2, "#ffe27a"); p(5, 3, 2, 4, "#ffe27a"); p(9, 8, 5, 2, "#ffb020"); p(12, 7, 2, 4, "#ffb020"); p(3, 10, 4, 2, "#a89880"); p(9, 4, 4, 2, "#a89880");
    } else if (id === "extra") {
      p(2, 7, 5, 2, "#ffe27a"); p(7, 6, 2, 4, "#ffe27a"); p(9, 3, 5, 2, "#ffb020"); p(9, 11, 5, 2, "#ff6a1a");
    } else if (id === "magnet") {
      p(4, 4, 3, 8, "#c23a2a"); p(9, 4, 3, 8, "#3a6aaa"); p(4, 11, 8, 3, "#8a8a8a"); p(5, 3, 2, 2, "#fff3c8"); p(9, 3, 2, 2, "#fff3c8");
    } else if (id === "ward") {
      p(5, 11, 6, 3, "#3a2210"); p(6, 5, 4, 7, "#ff6a1a"); p(7, 3, 2, 4, "#ffb020"); p(4, 8, 2, 2, "#c45a00"); p(10, 8, 2, 2, "#c45a00");
    } else if (id === "dashp") {
      p(3, 5, 3, 7, "#3a2a18"); p(7, 4, 3, 8, "#6b3a22"); p(11, 5, 3, 7, "#c4a06a");
    } else if (id === "knock") {
      p(7, 6, 2, 2, "#fff3c8"); p(4, 5, 2, 4, "#ffb020"); p(10, 5, 2, 4, "#ffb020"); p(6, 3, 4, 2, "#ff6a1a"); p(6, 11, 4, 2, "#ff6a1a"); p(2, 7, 2, 2, "#c45a00"); p(12, 7, 2, 2, "#c45a00");
    } else if (id === "pierce") {
      p(1, 7, 12, 2, "#c8c0b0"); p(12, 6, 3, 4, "#ffe27a"); p(3, 6, 2, 4, "#6b4a26"); p(8, 5, 2, 2, "#fff"); p(8, 9, 2, 2, "#fff");
    } else if (id === "brazier") {
      p(4, 11, 8, 3, "#3a2210"); p(5, 6, 6, 6, "#ff6a1a"); p(6, 3, 4, 5, "#ffb020"); p(7, 1, 2, 3, "#fff3c8"); p(3, 9, 2, 2, "#c45a00"); p(11, 9, 2, 2, "#c45a00");
    } else if (id === "palisade") {
      p(2, 4, 3, 11, "#6b4a26"); p(7, 3, 3, 12, "#5a3a18"); p(12, 5, 3, 10, "#6b4a26"); p(2, 3, 3, 2, "#3a2410"); p(7, 2, 3, 2, "#3a2410"); p(12, 4, 3, 2, "#3a2410");
    } else if (id === "beacon") {
      p(6, 6, 4, 8, "#ffb020"); p(7, 4, 2, 3, "#fff3c8"); p(3, 7, 2, 2, "#ffe27a"); p(11, 7, 2, 2, "#ffe27a"); p(5, 13, 6, 2, "#3a2210"); p(1, 8, 2, 1, "#c45a00"); p(13, 8, 2, 1, "#c45a00");
    } else if (id === "turret") {
      p(6, 10, 4, 5, "#4a3018"); p(7, 4, 2, 7, "#6b4a26"); p(5, 3, 6, 3, "#3a2410"); p(7, 1, 2, 3, "#ffb020"); p(4, 12, 8, 2, "#2a1808");
    } else if (id === "stakes") {
      p(3, 8, 2, 7, "#8a8a8a"); p(7, 5, 2, 10, "#c8c0b0"); p(11, 8, 2, 7, "#8a8a8a"); p(3, 6, 2, 3, "#fff3c8"); p(7, 3, 2, 3, "#fff"); p(11, 6, 2, 3, "#fff3c8");
    } else if (id === "kindling") {
      p(3, 9, 10, 4, "#5a3a18"); p(4, 11, 10, 3, "#4a2e12"); p(6, 4, 4, 6, "#ff6a1a"); p(7, 2, 2, 4, "#ffb020"); p(2, 10, 2, 2, "#2a1808"); p(12, 12, 2, 2, "#2a1808");
    } else if (id === "halo") {
      p(6, 6, 4, 4, "#ffe27a"); p(3, 3, 3, 3, "#ff6a1a"); p(10, 3, 3, 3, "#ffb020"); p(3, 10, 3, 3, "#c45a00"); p(10, 10, 3, 3, "#ff6a1a"); p(1, 7, 2, 2, "#c45a00"); p(13, 7, 2, 2, "#ffb020");
    } else if (id === "spear") {
      p(2, 7, 11, 2, "#d8c8a0"); p(12, 6, 3, 4, "#fff3c8"); p(3, 6, 2, 4, "#6b4a26"); p(7, 5, 2, 2, "#8a8070"); p(7, 9, 2, 2, "#8a8070");
    } else if (id === "crows") {
      p(3, 6, 5, 3, "#2a2430"); p(9, 5, 5, 3, "#3a3048"); p(4, 8, 3, 2, "#1a1420"); p(10, 7, 3, 2, "#1a1420"); p(6, 5, 2, 2, "#e8c070"); p(12, 4, 2, 2, "#e8c070");
    } else if (id === "pots") {
      p(5, 4, 6, 8, "#6a3a18"); p(6, 5, 4, 5, "#3a2010"); p(7, 2, 2, 3, "#5a3a18"); p(6, 11, 4, 3, "#ff6a1a"); p(7, 13, 2, 2, "#ffb020");
    } else if (id === "bell") {
      p(5, 3, 6, 8, "#c9a24a"); p(6, 4, 4, 6, "#ffe27a"); p(4, 10, 8, 2, "#8a6a28"); p(7, 12, 2, 3, "#6b4a26"); p(3, 6, 2, 2, "#fff3c8"); p(11, 6, 2, 2, "#fff3c8");
    } else if (id === "lash") {
      p(2, 8, 10, 2, "#6b3a22"); p(11, 6, 3, 6, "#8a4a28"); p(3, 7, 2, 4, "#3a1e10"); p(12, 4, 2, 3, "#c8c0b0"); p(13, 3, 2, 2, "#fff3c8");
    } else if (id === "thorns") {
      p(6, 6, 4, 4, "#4e7a3c"); p(7, 2, 2, 4, "#7a9a62"); p(7, 10, 2, 4, "#7a9a62"); p(2, 7, 4, 2, "#3a5a28"); p(10, 7, 4, 2, "#3a5a28");
    } else if (id === "regen") {
      p(6, 3, 4, 10, "#c23a2a"); p(3, 6, 10, 4, "#c23a2a"); p(7, 4, 2, 8, "#fff3c8"); p(5, 7, 6, 2, "#fff3c8");
    } else if (id === "reach") {
      p(2, 7, 12, 2, "#c8c0b0"); p(12, 5, 3, 6, "#ffe27a"); p(4, 5, 2, 6, "#6b4a26"); p(8, 4, 2, 2, "#fff");
    } else if (id === "luck") {
      p(5, 3, 6, 8, "#c9a24a"); p(6, 5, 4, 4, "#ffe27a"); p(4, 10, 8, 3, "#8a6a28"); p(7, 6, 2, 2, "#fff");
    } else if (id === "corner") {
      p(5, 4, 6, 8, "#c23a2a"); p(6, 6, 4, 4, "#ff6a1a"); p(3, 7, 2, 2, "#fff3c8"); p(11, 7, 2, 2, "#fff3c8"); p(7, 2, 2, 3, "#6b3a22");
    } else if (id === "hammer") {
      p(3, 1, 10, 6, "#c8c0b0"); p(2, 2, 12, 4, "#e8e0d0"); p(4, 3, 8, 2, "#ffe27a");
      p(7, 6, 2, 8, "#6b4a26"); p(6, 7, 4, 2, "#8a5a28"); p(1, 1, 2, 2, "#9fd"); p(13, 1, 2, 2, "#9fd"); p(7, 0, 2, 2, "#fff");
    } else if (id === "aegis") {
      p(3, 1, 10, 14, "#c23a2a"); p(4, 2, 8, 12, "#fff3c8"); p(5, 3, 6, 10, "#3a6aaa"); p(6, 5, 4, 6, "#1a3a6a"); p(7, 7, 2, 2, "#fff"); p(2, 6, 1, 4, "#8a2a22"); p(13, 6, 1, 4, "#8a2a22");
    } else if (id === "heatvis") {
      p(2, 5, 4, 6, "#e2b889"); p(3, 4, 2, 2, "#1a120c"); p(3, 10, 2, 2, "#1a120c"); p(6, 6, 8, 4, "#ff6a1a"); p(9, 5, 6, 6, "#ffb020"); p(12, 6, 3, 4, "#fff3c8");
    } else if (id === "smash") {
      p(5, 8, 6, 4, "#6b3a22"); p(4, 10, 8, 3, "#3a1e10"); p(6, 2, 4, 6, "#ffb020"); p(3, 5, 2, 2, "#ffe27a"); p(11, 5, 2, 2, "#ffe27a"); p(7, 0, 2, 3, "#fff"); p(2, 12, 12, 2, "#c8e8ff");
    } else if (id === "web") {
      p(2, 2, 2, 2, "#d8c8a0"); p(12, 2, 2, 2, "#d8c8a0"); p(2, 12, 2, 2, "#d8c8a0"); p(12, 12, 2, 2, "#d8c8a0"); p(3, 3, 10, 1, "#c8b890"); p(3, 12, 10, 1, "#c8b890"); p(3, 3, 1, 10, "#c8b890"); p(12, 3, 1, 10, "#c8b890"); p(7, 7, 2, 2, "#fff3c8"); p(5, 5, 6, 1, "#e8d8b0"); p(5, 10, 6, 1, "#e8d8b0");
    } else if (id === "repulse") {
      p(1, 4, 6, 8, "#c23a2a"); p(9, 4, 6, 8, "#c23a2a"); p(2, 6, 4, 4, "#ffe27a"); p(10, 6, 4, 4, "#ffe27a"); p(3, 7, 2, 2, "#fff"); p(11, 7, 2, 2, "#fff"); p(0, 7, 2, 2, "#ff6a1a"); p(14, 7, 2, 2, "#ff6a1a");
    } else if (id === "icebreath") {
      p(2, 5, 5, 6, "#e2b889"); p(3, 4, 2, 2, "#1a120c"); p(3, 10, 2, 2, "#1a120c"); p(7, 5, 8, 6, "#9fd"); p(10, 6, 5, 4, "#fff"); p(13, 7, 2, 2, "#c8e8ff");
    } else if (id === "lasso") {
      p(3, 3, 10, 2, "#c9a24a"); p(11, 4, 2, 8, "#ffe27a"); p(4, 11, 8, 2, "#c9a24a"); p(3, 5, 2, 7, "#8a6a28"); p(7, 7, 2, 2, "#fff3c8"); p(12, 2, 2, 2, "#fff3c8");
    } else if (id === "efield") {
      p(4, 4, 8, 8, "#1a3048"); p(6, 6, 4, 4, "#9fd"); p(7, 7, 2, 2, "#fff"); p(2, 7, 2, 2, "#c8e8ff"); p(12, 7, 2, 2, "#c8e8ff"); p(7, 2, 2, 2, "#fff"); p(7, 12, 2, 2, "#9fd"); p(3, 3, 2, 2, "#c8e8ff"); p(11, 11, 2, 2, "#9fd");
    } else {
      p(4, 4, 8, 8, "#ffe27a"); p(6, 6, 4, 4, "#fff3c8");
    }
  }
  const ICO = Object.create(null);
  function makeIcon(id, size) {
    const key = id + ":" + size;
    let src = ICO[key];
    if (!src) {
      src = document.createElement("canvas");
      src.width = size; src.height = size;
      const c = src.getContext("2d");
      c.imageSmoothingEnabled = false;
      drawIcon(c, id, size);
      ICO[key] = src;
    }
    const cv = document.createElement("canvas");
    cv.width = size; cv.height = size; cv.className = size > 24 ? "ico" : "";
    cv.getContext("2d").drawImage(src, 0, 0);
    return cv;
  }

  const ENEMIES = {
    walker: { hp: 72, spd: 44, dmg: 9, r: 18, worth: 8, col: "#4e7a3c", eye: "#1a1208", agr: 0.35 },
    runner: { hp: 38, spd: 108, dmg: 7, r: 15, worth: 12, col: "#8a3a32", eye: "#3a0808", agr: 0.75 },
    crawler: { hp: 22, spd: 80, dmg: 6, r: 12, worth: 6, col: "#3a5a28", eye: "#0a0a08", agr: 0.2 },
    tank: { hp: 200, spd: 30, dmg: 18, r: 26, worth: 28, col: "#3a4a2a", eye: "#201808", agr: 0.15 },
    spitter: { hp: 48, spd: 40, dmg: 8, r: 17, worth: 16, col: "#6a7a28", eye: "#243008", agr: 0.55, spit: true },
    bomber: { hp: 42, spd: 68, dmg: 10, r: 16, worth: 18, col: "#6a4a18", eye: "#3a2008", agr: 0.9, bomb: true },
    bat: { hp: 26, spd: 96, dmg: 6, r: 14, worth: 10, col: "#3a3048", eye: "#e8c070", agr: 1, fly: true },
    shaman: { hp: 70, spd: 36, dmg: 8, r: 18, worth: 22, col: "#4a3a68", eye: "#c8a0ff", agr: 0.1 },
    brute: { hp: 420, spd: 38, dmg: 24, r: 34, worth: 80, col: "#2a2218", eye: "#ff5030", agr: 0.5, elite: true }
  };

  let S;
  function fresh() {
    S = {
      state: "title", t: 0, hitstop: 0, shake: 0, flash: 0, camX: 0, camY: 0,
      player: { x: 1600, y: 1688, vx: 0, vy: 0, hp: 100, max: 100, r: 18, ifr: 0, dash: 0, dashCd: 0, facing: -1.57, aim: -1.57, flip: false, flash: 0 },
      fire: { x: 1600, y: 1600, hp: 220, max: 220, dead: false },
      loadout: [{ id: "embers", lv: 1, cd: 0, ang: 0 }],
      pas: { haste: 0, vit: 0, fury: 0, cdr: 0, extra: 0, magnet: 0, ward: 0, dashp: 0, knock: 0, pierce: 0, thorns: 0, regen: 0, reach: 0, luck: 0, corner: 0 },
      camp: { brazier: 0, palisade: 0, beacon: 0, turret: 0, stakes: 0, kindling: 0 },
      turretCd: 0, hudSig: "",
      wave: 0, waveRest: 1.4, incoming: 0, kills: 0, held: false,
      zombies: [], shots: [], goo: [], parts: [], floaters: [], fx: [], pools: [],
      trees: [], tGrid: new Map(), crates: [], pickups: [], litter: [], picks: [], campPicks: [],
      msg: "", msgT: 0
    };
    buildWorld();
    S.camX = clamp(S.player.x - VW / 2, 0, Math.max(0, MAP - VW));
    S.camY = clamp(S.player.y - VH / 2, 0, Math.max(0, MAP - VH));
    syncHud(true);
    show("title"); hide("pause"); hide("dead"); hide("pick"); hide("campPick"); hide("adBreak");
    const rb = $("reviveBtn");
    if (rb) rb.hidden = false;
    cg.lastPct = 0;
    cg.clearContext();
  }

  function buildWorld() {
    S.trees.length = 0;
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(CAMP.r + 40, MAP * 0.46);
      const x = CAMP.x + Math.cos(a) * d;
      const y = CAMP.y + Math.sin(a) * d;
      if (x < 40 || y < 40 || x > MAP - 40 || y > MAP - 40) continue;
      S.trees.push({ x, y, r: rand(22, 36), h: irand(48, 78), shade: irand(0, 2) });
    }
    S.tGrid = new Map();
    for (const t of S.trees) {
      const k = (t.x / TREE_CELL | 0) + ((t.y / TREE_CELL | 0) * 4096);
      let bucket = S.tGrid.get(k);
      if (!bucket) { bucket = []; S.tGrid.set(k, bucket); }
      bucket.push(t);
    }
    S.litter = [
      { x: 1510, y: 1710, k: "tent" }, { x: 1690, y: 1700, k: "logs" },
      { x: 1548, y: 1520, k: "crate" }, { x: 1660, y: 1510, k: "skull" },
      { x: 1488, y: 1588, k: "stump" }, { x: 1724, y: 1596, k: "fence" },
      { x: 1580, y: 1740, k: "logs" }, { x: 1440, y: 1660, k: "stump" },
      { x: 1740, y: 1680, k: "skull" }
    ];
    S.crates = [
      { x: 1528, y: 1720, hp: 3 }, { x: 1676, y: 1712, hp: 3 }, { x: 1460, y: 1608, hp: 4 }
    ];
  }

  function stats() {
    const P = S.pas, C = S.camp;
    return {
      spd: 168 * (1 + P.haste * 0.12),
      dmg: 1 + P.fury * 0.18,
      cdr: 1 / (1 + P.cdr * 0.12),
      extra: P.extra,
      pierce: P.pierce,
      knock: 90 + P.knock * 28,
      magnet: 70 + P.magnet * 40,
      heal: 10 + P.ward * 6 + C.beacon * 8,
      healR: 70 + C.beacon * 28,
      ward: 1 / (1 + P.ward * 0.16 + C.palisade * 0.22),
      dashT: 0.18 + P.dashp * 0.05,
      dashCd: Math.max(0.35, 0.72 - P.dashp * 0.12),
      range: 1 + P.reach * 0.16,
      thorns: P.thorns * 8,
      regen: P.regen * 3.2,
      luck: 0.18 + P.luck * 0.07,
      corner: (S.player.hp / S.player.max) < 0.4 ? 1 + P.corner * 0.22 : 1
    };
  }

  function wepLv(id) {
    const w = S.loadout.find((x) => x.id === id);
    return w ? w.lv : 0;
  }
  function say(t, n) { S.msg = t; S.msgT = n || 2; $("banner").textContent = t; $("banner").style.opacity = "1"; }
  function addPart(x, y, vx, vy, life, col, s, grav) {
    if (S.parts.length >= MAX_PARTS) S.parts.shift();
    S.parts.push({ x, y, vx, vy, life, max: life, col, s: s || 3, grav: grav == null ? 150 : grav });
  }
  function sparks(x, y, n, cols, spd, life, grav) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(spd * 0.25, spd);
      addPart(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(life * 0.45, life), cols[i % cols.length], irand(2, 6), grav);
    }
  }
  function pushFx(o) {
    o.max = o.life;
    o.seed = (Math.random() * 9999) | 0;
    if (S.fx.length >= 56) S.fx.shift();
    S.fx.push(o);
  }
  function gibs(x, y, col) {
    sparks(x, y, 10, [col, "#2a1810", "#fff3c8"], 240, 0.5, 180);
    sparks(x, y, 5, ["#c23a2a", "#ff6a1a"], 140, 0.35, 40);
  }
  function floater(x, y, text, col) { S.floaters.push({ x, y, text, col, life: 0.8 }); }
  function shake(n) { S.shake = Math.max(S.shake, n); }
  function boomFlash(n) { S.flash = Math.max(S.flash, n); }
  function stop(n) { S.hitstop = Math.max(S.hitstop, n); }

  function nearest(x, y, range, skip) {
    let best = null, bd = range;
    for (const z of S.zombies) {
      if (z.dead || z.hp <= 0 || (skip && skip.indexOf(z) >= 0)) continue;
      const d = dist(x, y, z.x, z.y);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  function spawnZ(type) {
    if (S.zombies.length >= MAX_Z) return false;
    const a = Math.random() * Math.PI * 2;
    const d = CAMP.r + rand(80, 260);
    const x = clamp(CAMP.x + Math.cos(a) * d, 48, MAP - 48);
    const y = clamp(CAMP.y + Math.sin(a) * d, 48, MAP - 48);
    const e = ENEMIES[type];
    const w = S.wave;
    const hpMul = w <= 1 ? 0.34 : w === 2 ? 0.46 : w === 3 ? 0.6 : w === 4 ? 0.82 : 0.95 + (w - 4) * 0.2;
    S.zombies.push({
      x, y, vx: 0, vy: 0, type,
      hp: e.hp * hpMul, max: e.hp * hpMul,
      spd: e.spd * (w <= 3 ? 0.78 : 1 + Math.max(0, w - 4) * 0.04),
      dmg: e.dmg * (w <= 3 ? 0.55 : 1 + (w - 3) * 0.14),
      r: e.r, col: e.col, eye: e.eye, worth: e.worth, agr: e.agr,
      spit: 0, hit: 0, atk: 0, fly: !!e.fly, bomb: !!e.bomb, elite: !!e.elite, shaman: type === "shaman",
      dead: false, stakeT: 0, buffT: 0
    });
    return true;
  }

  function pickType() {
    const w = S.wave;
    const bag = ["walker", "walker", "walker"];
    if (w >= 2) bag.push("runner", "runner", "crawler");
    if (w >= 3) bag.push("crawler", "bat");
    if (w >= 4) bag.push("tank", "spitter");
    if (w >= 5) bag.push("spitter", "bomber", "bat");
    if (w >= 6) bag.push("shaman", "bomber");
    if (w >= 8) bag.push("tank", "runner");
    return bag[irand(0, bag.length - 1)];
  }

  function beginWave() {
    S.wave++;
    if (S.wave <= 3) S.incoming = 10 + S.wave * 3;
    else S.incoming = 10 + S.wave * 4;
    if (S.wave % 5 === 0) { spawnZ("brute"); S.incoming += 3; say("A BRUTE SMELLS THE FIRE", 2.4); }
    else say("WAVE " + S.wave, 1.5);
    const burst = S.wave <= 3 ? 2 : Math.min(4, 2 + (S.wave / 3 | 0));
    for (let i = 0; i < burst && S.incoming > 0; i++) {
      if (spawnZ(pickType())) S.incoming--;
    }
    syncHudBars();
    audio.tone(130, 0.16, "sawtooth", 0.07, 70);
    audio.tone(240, 0.2, "square", 0.05);
    if (S.wave === 10) { S.held = true; say("YOU HELD THE CAMP — ENDLESS", 3.5); cg.happy(); }
    cg.context();
    cg.progress(S.wave >= 10 ? 100 : S.wave >= 7 ? 70 : S.wave >= 5 ? 50 : S.wave >= 3 ? 30 : 10);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = irand(0, i); const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function eligiblePowers() {
    const list = [];
    Object.keys(POWERS).forEach((id) => {
      const p = POWERS[id];
      if (p.kind === "camp") return;
      if (p.kind === "wep") {
        const lv = wepLv(id);
        if (lv >= p.max) return;
        if (lv === 0 && S.loadout.length >= 8 && id !== "embers") return;
        list.push(id);
      } else if (S.pas[id] < p.max) list.push(id);
    });
    return list;
  }

  function eligibleCamp() {
    if (S.fire.dead) return [];
    const list = [];
    Object.keys(POWERS).forEach((id) => {
      const p = POWERS[id];
      if (p.kind === "camp" && (S.camp[id] || 0) < p.max) list.push(id);
    });
    return list;
  }

  function shouldOfferCamp() {
    return !S.fire.dead && S.wave > 0 && S.wave % 3 === 0 && eligibleCamp().length > 0;
  }

  function fillCards(boxId, picks, kindLabel, onPick) {
    const box = $(boxId);
    box.innerHTML = "";
    picks.forEach((id, i) => {
      const def = POWERS[id];
      const lv = def.kind === "wep" ? wepLv(id) : def.kind === "camp" ? S.camp[id] : S.pas[id];
      const b = document.createElement("button");
      b.className = "card";
      b.appendChild(Object.assign(document.createElement("div"), { className: "key", textContent: "[" + (i + 1) + "]" }));
      const ico = makeIcon(id, 52);
      ico.className = "ico";
      b.appendChild(ico);
      const h = document.createElement("h3"); h.textContent = def.name; b.appendChild(h);
      const lvEl = document.createElement("div"); lvEl.className = "lvl";
      lvEl.textContent = kindLabel(def) + " · " + (lv ? "LEVEL " + (lv + 1) : "NEW");
      b.appendChild(lvEl);
      const p = document.createElement("p"); p.textContent = def.blurb; b.appendChild(p);
      b.addEventListener("click", () => onPick(i));
      box.appendChild(b);
    });
  }

  function offerPowers() {
    const pool = shuffle(eligiblePowers());
    if (pool.length === 0) {
      if (shouldOfferCamp()) offerCamp();
    else { S.state = "play"; S.waveRest = 2.2; cg.gameplayStart(); }
      return;
    }
    S.picks = pool.slice(0, 3);
    while (S.picks.length < 3) S.picks.push(S.picks[0] || "vit");
    S.state = "pick";
    fillCards("cards", S.picks, (def) => def.kind === "wep" ? "WEAPON" : "PASSIVE", choose);
    show("pick");
    audio.tone(360, 0.1, "square", 0.05);
    audio.tone(520, 0.14, "triangle", 0.05);
  }

  function offerCamp() {
    if (!shouldOfferCamp()) {
      S.state = "play";
      S.waveRest = 2.2;
      cg.gameplayStart();
      return;
    }
    const pool = shuffle(eligibleCamp());
    if (pool.length === 0) {
      S.state = "play";
      S.waveRest = 2.2;
      cg.gameplayStart();
      return;
    }
    S.campPicks = pool.slice(0, 3);
    S.state = "campPick";
    fillCards("campCards", S.campPicks, () => "CAMP", chooseCamp);
    show("campPick");
    audio.tone(220, 0.1, "triangle", 0.05);
    audio.tone(280, 0.14, "square", 0.04);
  }

  function resumeWave(name) {
    hide("pick"); hide("campPick");
    S.state = "play";
    S.waveRest = 2.4;
    say(name.toUpperCase(), 1.6);
    audio.tone(480, 0.1, "square", 0.07);
    syncHud(true);
    cg.gameplayStart();
  }

  function choose(i) {
    if (S.state !== "pick") return;
    const id = S.picks[i];
    if (!id) return;
    const def = POWERS[id];
    if (def.kind === "wep") {
      const w = S.loadout.find((x) => x.id === id);
      if (w) w.lv++;
      else S.loadout.push({ id, lv: 1, cd: 0, ang: rand(0, 6) });
    } else {
      S.pas[id]++;
      if (id === "vit") {
        S.player.max += 18;
        S.player.hp = Math.min(S.player.max, S.player.hp + 28);
      }
    }
    hide("pick");
    if (shouldOfferCamp()) {
      offerCamp();
      if (S.state === "campPick") say(def.name.toUpperCase(), 1.2);
      else resumeWave(def.name);
    } else resumeWave(def.name);
  }

  function chooseCamp(i) {
    if (S.state !== "campPick") return;
    const id = S.campPicks[i];
    if (!id) return;
    const def = POWERS[id];
    S.camp[id]++;
    if (id === "brazier") {
      S.fire.max += 70;
      S.fire.hp = S.fire.max;
      S.fire.dead = false;
    }
    resumeWave(def.name);
  }

  function collideTrees(e, nx, ny) {
    if (!e.fly) {
      const cx = nx / TREE_CELL | 0, cy = ny / TREE_CELL | 0;
      for (let iy = -1; iy <= 1; iy++) {
        for (let ix = -1; ix <= 1; ix++) {
          const bucket = S.tGrid.get((cx + ix) + ((cy + iy) * 4096));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const t = bucket[i];
            const dx = nx - t.x, dy = ny - t.y;
            const lim = e.r + t.r - 6;
            if (dx * dx + dy * dy < lim * lim) {
              const a = Math.atan2(dy, dx) || 0;
              nx = t.x + Math.cos(a) * lim;
              ny = t.y + Math.sin(a) * lim;
            }
          }
        }
      }
    }
    e.x = clamp(nx, 24, MAP - 24);
    e.y = clamp(ny, 24, MAP - 24);
  }

  function hurtPlayer(n, from) {
    const p = S.player;
    if (p.ifr > 0 || p.dash > 0 || S.state !== "play") return;
    p.hp -= n;
    p.ifr = 0.42; p.flash = 0.12;
    stop(0.05); shake(9); boomFlash(0.2);
    sparks(p.x, p.y, 8, ["#fff", "#c23a2a", "#ffb020"], 180, 0.28, 60);
    audio.tone(100, 0.12, "sawtooth", 0.09, 48);
    audio.noise(0.07, 0.07);
    if (from) {
      const a = ang(from.x, from.y, p.x, p.y);
      p.vx += Math.cos(a) * 110; p.vy += Math.sin(a) * 110;
    }
    if (p.hp <= 0) { p.hp = 0; die("You were eaten"); }
    syncHudBars();
  }

  function die(reason) {
    cg.gameplayStop();
    S.state = "dead";
    $("deadTitle").textContent = reason;
    $("deadStats").textContent = "Wave " + S.wave + "   ·   " + S.kills + " kills   ·   " + Math.floor(S.t) + "s";
    show("dead");
    const rb = $("reviveBtn");
    if (rb) rb.hidden = false;
    cg.context();
    audio.tone(80, 0.45, "triangle", 0.1, 36);
  }

  function snuffFire() {
    if (S.fire.dead) return;
    S.fire.dead = true;
    S.fire.hp = 0;
    say("THE FIRE WENT OUT — KEEP FIGHTING", 3);
    shake(14); boomFlash(0.35);
    sparks(S.fire.x, S.fire.y, 22, ["#3a2a20", "#6a4a30", "#c45a00", "#fff3c8"], 220, 0.7, 80);
    pushFx({ x1: S.fire.x - 90, y1: S.fire.y, x2: S.fire.x + 90, y2: S.fire.y, life: 0.35, bell: true, r: 90, boom: true });
    audio.tone(70, 0.4, "triangle", 0.1, 30);
    syncHudBars();
  }

  function killZ(z, knockA, force) {
    if (z.dead) return;
    z.dead = true;
    z.hp = 0;
    S.kills++;
    gibs(z.x, z.y, z.col);
    if (z.elite) { stop(0.08); shake(12); boomFlash(0.18); cg.happy(); }
    else shake(4);
    audio.tone(64, 0.08, "square", 0.05, 36);
    floater(z.x, z.y - 16, "+" + z.worth, "#ffe27a");
    const wasBomb = z.bomb;
    z.bomb = false;
    if (wasBomb) explode(z.x, z.y, 54, 16, true);
    if (Math.random() < (0.18 + S.pas.luck * 0.07)) S.pickups.push({ x: z.x, y: z.y, kind: "heart", t: 0 });
    if (knockA != null) {
      for (let i = 0; i < 3; i++) {
        const a = knockA + rand(-0.4, 0.4);
        addPart(z.x, z.y, Math.cos(a) * (force || 140), Math.sin(a) * (force || 140), 0.25, "#c44", 4);
      }
    }
    $("killVal").textContent = String(S.kills);
  }

  function damageZ(z, dmg, a, force) {
    if (!z || z.dead || z.hp <= 0) return;
    z.hp -= dmg;
    z.hit = 0.1;
    z.vx += Math.cos(a) * (force || 30);
    z.vy += Math.sin(a) * (force || 30);
    if (S.parts.length < MAX_PARTS - 8) {
      addPart(z.x, z.y, Math.cos(a) * 90, Math.sin(a) * 90, 0.2, "#fff3c8", 4, 20);
      addPart(z.x, z.y, Math.cos(a + 0.6) * 70, Math.sin(a + 0.6) * 70, 0.16, "#ff6a1a", 3, 30);
    }
    if (z.hp <= 0) killZ(z, a, force);
  }

  function explode(x, y, r, dmg, hurtSelf) {
    shake(8);
    boomFlash(0.16);
    pushFx({ x1: x - r, y1: y, x2: x + r, y2: y, life: 0.22, bell: true, r, boom: true });
    sparks(x, y, 16, ["#fff", "#fff3c8", "#ffb020", "#ff6a1a", "#c45a00"], 260, 0.42, 50);
    for (const z of S.zombies) {
      if (!z.dead && z.hp > 0 && dist(x, y, z.x, z.y) < r + z.r) damageZ(z, dmg, ang(x, y, z.x, z.y), 70);
    }
    if (hurtSelf && dist(x, y, S.player.x, S.player.y) < r) hurtPlayer(12, { x, y });
  }

  function fireShot(opt) {
    if (S.shots.length >= MAX_SHOTS) S.shots.shift();
    S.shots.push(opt);
  }

  function tickWeapons(dt) {
    const p = S.player, st = stats();
    const dmgMul = st.dmg * st.corner;
    const rng = st.range;
    for (const w of S.loadout) {
      w.cd -= dt;
      const lv = w.lv;
      if (w.id === "halo") {
        const rad = 54 + lv * 10;
        const dmg = 7 * dmgMul * (0.7 + lv * 0.14);
        for (const z of S.zombies) {
          if (z.hp > 0 && !z.dead && dist(p.x, p.y, z.x, z.y) < z.r + rad) {
            if (!z._haloHit || z._haloHit < S.t) {
              damageZ(z, dmg * dt * 7, ang(p.x, p.y, z.x, z.y), st.knock * 0.15);
              z._haloHit = S.t + 0.14;
            }
          }
        }
        continue;
      }
      if (w.id === "efield") {
        const rad = 92 + lv * 16;
        const dmg = 9 * dmgMul * (0.7 + lv * 0.14);
        for (const z of S.zombies) {
          if (z.hp > 0 && !z.dead && dist(p.x, p.y, z.x, z.y) < z.r + rad) {
            if (!z._efHit || z._efHit < S.t) {
              damageZ(z, dmg * dt * 8, ang(p.x, p.y, z.x, z.y), st.knock * 0.2);
              z._efHit = S.t + 0.16;
              if (Math.random() < 0.18) pushFx({ x1: p.x, y1: p.y, x2: z.x, y2: z.y, life: 0.1, bolt: true });
            }
          }
        }
        continue;
      }
      if (w.id === "orbit" || w.id === "blades") {
        w.ang = (w.ang || 0) + dt * (2.2 + lv * 0.35);
        const n = w.id === "orbit" ? 2 + lv : 3 + lv;
        const rad = w.id === "orbit" ? 58 + lv * 10 : 42 + lv * 6;
        const dmg = (w.id === "orbit" ? 8 : 7) * dmgMul * (0.7 + lv * 0.15);
        for (let i = 0; i < n; i++) {
          const a = w.ang + (Math.PI * 2 * i) / n;
          const x = p.x + Math.cos(a) * rad;
          const y = p.y + Math.sin(a) * rad;
          for (const z of S.zombies) {
            if (z.hp > 0 && dist(x, y, z.x, z.y) < z.r + 10) {
              if (!z._orbHit || z._orbHit < S.t) {
                damageZ(z, dmg * dt * 8, a, st.knock * 0.25);
                z._orbHit = S.t + 0.12;
              }
            }
          }
        }
        continue;
      }
      if (w.cd > 0) continue;
      if (w.id === "embers") {
        const t = nearest(p.x, p.y, 420 * rng);
        if (!t) { w.cd = 0.08; continue; }
        w.cd = (0.38 - lv * 0.04) * st.cdr;
        const shots = 1 + Math.min(2, st.extra) + (lv >= 4 ? 1 : 0);
        const base = ang(p.x, p.y, t.x, t.y);
        p.aim = base;
        for (let i = 0; i < shots; i++) {
          const a = base + (i - (shots - 1) / 2) * 0.12;
          fireShot({ typ: "bolt", x: p.x, y: p.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, dmg: 14 * dmgMul * (1 + lv * 0.12), life: 0.7, pierce: st.pierce, col: "#ffb24a", r: 3, knock: st.knock });
        }
        audio.tone(340, 0.05, "square", 0.045, 90);
      } else if (w.id === "boomerang") {
        const t = nearest(p.x, p.y, 520 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (1.15 - lv * 0.1) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        fireShot({ typ: "boom", x: p.x, y: p.y, vx: Math.cos(a) * (280 + lv * 20), vy: Math.sin(a) * (280 + lv * 20), dmg: 18 * dmgMul * (1 + lv * 0.14), life: 1.15, ret: 0.42, pierce: 99, col: "#d8c8a0", r: 8 + lv, knock: st.knock, hit: [] });
        audio.tone(190, 0.08, "sawtooth", 0.06, 80);
      } else if (w.id === "rockets") {
        const t = nearest(p.x, p.y, 640 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (1.35 - lv * 0.12) * st.cdr;
        const n = 1 + (lv >= 3 ? 1 : 0) + Math.min(1, st.extra);
        for (let i = 0; i < n; i++) {
          const a = ang(p.x, p.y, t.x, t.y) + rand(-0.2, 0.2);
          fireShot({ typ: "rocket", x: p.x, y: p.y, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, dmg: 22 * dmgMul * (1 + lv * 0.12), life: 1.6, hom: 4 + lv, col: "#ff6a1a", r: 12, knock: st.knock, blast: 52 + lv * 10 });
        }
        audio.tone(90, 0.1, "sawtooth", 0.07, 40);
      } else if (w.id === "storm") {
        const t = nearest(p.x, p.y, (380 + lv * 30) * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.95 - lv * 0.08) * st.cdr;
        const jumps = 2 + Math.floor(lv / 2);
        const skip = [];
        let cx = p.x, cy = p.y, dmg = 16 * dmgMul * (1 + lv * 0.12);
        for (let j = 0; j < jumps; j++) {
          const n = nearest(cx, cy, 260, skip);
          if (!n) break;
          skip.push(n);
          pushFx({ x1: cx, y1: cy, x2: n.x, y2: n.y, life: 0.2, bolt: true });
          sparks(n.x, n.y, 7, ["#fff", "#9fd", "#c8e8ff"], 180, 0.28, 0);
          damageZ(n, dmg, ang(cx, cy, n.x, n.y), st.knock * 0.4);
          cx = n.x; cy = n.y; dmg *= 0.85;
        }
        audio.tone(720, 0.06, "square", 0.05, 200);
      } else if (w.id === "frost") {
        const t = nearest(p.x, p.y, 400 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.7 - lv * 0.05) * st.cdr;
        const shots = 1 + Math.min(2, st.extra) + (lv >= 3 ? 1 : 0);
        const base = ang(p.x, p.y, t.x, t.y);
        for (let i = 0; i < shots; i++) {
          const a = base + (i - (shots - 1) / 2) * 0.16;
          fireShot({ typ: "bolt", x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, dmg: 9 * dmgMul * (1 + lv * 0.1), life: 0.65, pierce: st.pierce, col: "#a8d8ff", r: 5, knock: st.knock * 0.5, slow: 0.45 });
        }
        audio.tone(560, 0.05, "triangle", 0.04);
      } else if (w.id === "spear") {
        const t = nearest(p.x, p.y, 560 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.85 - lv * 0.07) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        const n = 1 + Math.min(1, st.extra);
        for (let i = 0; i < n; i++) {
          const sa = a + (i - (n - 1) / 2) * 0.1;
          fireShot({ typ: "bolt", x: p.x, y: p.y, vx: Math.cos(sa) * 520, vy: Math.sin(sa) * 520, dmg: 16 * dmgMul * (1 + lv * 0.14), life: 0.7, pierce: 2 + lv + st.pierce, col: "#e8d8b0", r: 6, knock: st.knock * 1.1 });
        }
        audio.tone(210, 0.07, "sawtooth", 0.05, 90);
      } else if (w.id === "crows") {
        const t = nearest(p.x, p.y, 580 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (1.05 - lv * 0.08) * st.cdr;
        const n = 1 + Math.floor(lv / 2) + Math.min(1, st.extra);
        for (let i = 0; i < n; i++) {
          const a = ang(p.x, p.y, t.x, t.y) + rand(-0.5, 0.5);
          fireShot({ typ: "crow", x: p.x, y: p.y, vx: Math.cos(a) * 180, vy: Math.sin(a) * 180, dmg: 11 * dmgMul * (1 + lv * 0.12), life: 1.5, hom: 5 + lv, col: "#3a3048", r: 7, knock: st.knock * 0.4 });
        }
        audio.tone(420, 0.05, "triangle", 0.04, 180);
      } else if (w.id === "pots") {
        const t = nearest(p.x, p.y, 480 * rng);
        if (!t) { w.cd = 0.12; continue; }
        w.cd = (1.2 - lv * 0.1) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        fireShot({ typ: "pot", x: p.x, y: p.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, dmg: 10 * dmgMul * (1 + lv * 0.1), life: 0.55, pierce: 0, col: "#6a3a18", r: 8, knock: 20, pool: 38 + lv * 6 });
        audio.tone(110, 0.08, "square", 0.05, 50);
      } else if (w.id === "bell") {
        const t = nearest(p.x, p.y, 200 * rng);
        if (!t) { w.cd = 0.12; continue; }
        w.cd = (1.35 - lv * 0.1) * st.cdr;
        const rad = 86 + lv * 14;
        pushFx({ x1: p.x - rad, y1: p.y, x2: p.x + rad, y2: p.y, life: 0.2, bell: true, r: rad });
        sparks(p.x, p.y, 10, ["#ffe27a", "#fff3c8", "#c9a24a"], 160, 0.3, 20);
        for (const z of S.zombies) {
          if (!z.dead && z.hp > 0 && dist(p.x, p.y, z.x, z.y) < rad + z.r) {
            damageZ(z, 14 * dmgMul * (1 + lv * 0.12), ang(p.x, p.y, z.x, z.y), st.knock);
          }
        }
        audio.tone(280, 0.12, "triangle", 0.07, 90);
      } else if (w.id === "lash") {
        const t = nearest(p.x, p.y, 210 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.55 - lv * 0.04) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        const reach = 92 + lv * 10;
        pushFx({ x1: p.x, y1: p.y, x2: p.x + Math.cos(a) * reach, y2: p.y + Math.sin(a) * reach, life: 0.14, lash: true });
        for (const z of S.zombies) {
          if (z.dead || z.hp <= 0) continue;
          const d = dist(p.x, p.y, z.x, z.y);
          if (d > reach + z.r) continue;
          const da = Math.abs(Math.atan2(z.y - p.y, z.x - p.x) - a);
          const wrap = Math.min(da, Math.PI * 2 - da);
          if (wrap < 0.55) damageZ(z, 13 * dmgMul * (1 + lv * 0.12), a, st.knock * 1.2);
        }
        audio.tone(160, 0.06, "sawtooth", 0.05, 70);
      } else if (w.id === "hammer") {
        const t = nearest(p.x, p.y, 540 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (1.25 - lv * 0.1) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        fireShot({
          typ: "hammer", x: p.x, y: p.y,
          vx: Math.cos(a) * (320 + lv * 20), vy: Math.sin(a) * (320 + lv * 20),
          dmg: 26 * dmgMul * (1 + lv * 0.14), life: 1.2, ret: 0.48, pierce: 99,
          col: "#c8c0b0", r: 18 + lv, knock: st.knock * 1.4, hit: [], zap: 42 + lv * 8
        });
        sparks(p.x, p.y, 8, ["#9fd", "#fff", "#c8c0b0"], 110, 0.22, 0);
        audio.tone(90, 0.12, "sawtooth", 0.08, 40);
      } else if (w.id === "aegis") {
        const t = nearest(p.x, p.y, 500 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (1.05 - lv * 0.08) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        fireShot({
          typ: "aegis", x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
          dmg: 15 * dmgMul * (1 + lv * 0.12), life: 1.1, pierce: 3 + lv, col: "#c23a2a", r: 16, knock: st.knock, hit: []
        });
        audio.tone(240, 0.06, "square", 0.05);
      } else if (w.id === "heatvis") {
        const t = nearest(p.x, p.y, 460 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.8 - lv * 0.06) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        const reach = 280 + lv * 30;
        pushFx({ x1: p.x, y1: p.y, x2: p.x + Math.cos(a) * reach, y2: p.y + Math.sin(a) * reach, life: 0.18, heat: true, ang: a, reach });
        sparks(p.x + Math.cos(a) * reach * 0.7, p.y + Math.sin(a) * reach * 0.7, 8, ["#fff3c8", "#ff6a1a", "#ffb020"], 90, 0.22, -10);
        for (const z of S.zombies) {
          if (z.dead || z.hp <= 0) continue;
          const d = dist(p.x, p.y, z.x, z.y);
          if (d > reach + z.r) continue;
          const da = Math.abs(Math.atan2(z.y - p.y, z.x - p.x) - a);
          const wrap = Math.min(da, Math.PI * 2 - da);
          if (wrap < 0.22) damageZ(z, 18 * dmgMul * (1 + lv * 0.12), a, st.knock * 0.4);
        }
        audio.tone(880, 0.08, "sawtooth", 0.05, 200);
      } else if (w.id === "smash") {
        const t = nearest(p.x, p.y, 160 * rng);
        if (!t) { w.cd = 0.12; continue; }
        w.cd = (1.45 - lv * 0.12) * st.cdr;
        const rad = 96 + lv * 16;
        pushFx({ x1: p.x - rad, y1: p.y, x2: p.x + rad, y2: p.y, life: 0.24, bell: true, r: rad, boom: true });
        shake(10); boomFlash(0.14);
        sparks(p.x, p.y, 14, ["#fff", "#ffe27a", "#c8e8ff"], 220, 0.32, 30);
        for (const z of S.zombies) {
          if (!z.dead && z.hp > 0 && dist(p.x, p.y, z.x, z.y) < rad + z.r) {
            damageZ(z, 20 * dmgMul * (1 + lv * 0.14), ang(p.x, p.y, z.x, z.y), st.knock * 1.6);
          }
        }
        audio.tone(70, 0.16, "sawtooth", 0.09, 36);
      } else if (w.id === "web") {
        const t = nearest(p.x, p.y, 430 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.75 - lv * 0.05) * st.cdr;
        const shots = 1 + Math.min(1, st.extra) + (lv >= 4 ? 1 : 0);
        const base = ang(p.x, p.y, t.x, t.y);
        for (let i = 0; i < shots; i++) {
          const a = base + (i - (shots - 1) / 2) * 0.14;
          fireShot({ typ: "web", x: p.x, y: p.y, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, dmg: 8 * dmgMul * (1 + lv * 0.1), life: 0.7, pierce: st.pierce, col: "#e8d8b0", r: 5, knock: 20, slow: 0.72 });
        }
        audio.tone(500, 0.05, "triangle", 0.04);
      } else if (w.id === "repulse") {
        const t = nearest(p.x, p.y, 520 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.42 - lv * 0.03) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        const n = 2 + (lv >= 4 ? 1 : 0) + Math.min(1, st.extra);
        for (let i = 0; i < n; i++) {
          const off = (i - (n - 1) / 2) * 0.18;
          fireShot({
            typ: "repulse", x: p.x, y: p.y,
            vx: Math.cos(a + off) * 520, vy: Math.sin(a + off) * 520,
            dmg: 12 * dmgMul * (1 + lv * 0.12), life: 0.7, pierce: st.pierce,
            col: "#ffe27a", r: 6, knock: st.knock * 0.8
          });
        }
        audio.tone(620, 0.05, "square", 0.05, 180);
      } else if (w.id === "icebreath") {
        const t = nearest(p.x, p.y, 280 * rng);
        if (!t) { w.cd = 0.1; continue; }
        w.cd = (0.9 - lv * 0.07) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        const reach = 170 + lv * 18;
        pushFx({ x1: p.x, y1: p.y, x2: p.x + Math.cos(a) * reach, y2: p.y + Math.sin(a) * reach, life: 0.2, ice: true, ang: a, reach });
        sparks(p.x + Math.cos(a) * 40, p.y + Math.sin(a) * 40, 8, ["#fff", "#9fd", "#c8e8ff"], 70, 0.28, 10);
        for (const z of S.zombies) {
          if (z.dead || z.hp <= 0) continue;
          const d = dist(p.x, p.y, z.x, z.y);
          if (d > reach + z.r) continue;
          const da = Math.abs(Math.atan2(z.y - p.y, z.x - p.x) - a);
          const wrap = Math.min(da, Math.PI * 2 - da);
          if (wrap < 0.42) {
            damageZ(z, 11 * dmgMul * (1 + lv * 0.12), a, st.knock * 0.3);
            z.spd = Math.min(z.spd, ENEMIES[z.type].spd * 0.45);
          }
        }
        audio.tone(240, 0.1, "triangle", 0.05, 80);
      } else if (w.id === "lasso") {
        const t = nearest(p.x, p.y, 360 * rng);
        if (!t) { w.cd = 0.12; continue; }
        w.cd = (1.05 - lv * 0.08) * st.cdr;
        const a = ang(p.x, p.y, t.x, t.y);
        p.aim = a;
        pushFx({ x1: p.x, y1: p.y, x2: t.x, y2: t.y, life: 0.22, gold: true });
        sparks(t.x, t.y, 6, ["#ffe27a", "#fff3c8"], 90, 0.22, 20);
        damageZ(t, 16 * dmgMul * (1 + lv * 0.14), a, 0);
        t.x = lerp(t.x, p.x, 0.35 + lv * 0.04);
        t.y = lerp(t.y, p.y, 0.35 + lv * 0.04);
        audio.tone(340, 0.08, "square", 0.05, 120);
      }
    }
  }

  function tickCamp(dt) {
    const C = S.camp;
    if (C.kindling && !S.fire.dead) {
      S.fire.hp = Math.min(S.fire.max, S.fire.hp + C.kindling * 4 * dt);
    }
    if (C.stakes) {
      for (const z of S.zombies) {
        if (z.dead || z.hp <= 0 || dist(z.x, z.y, CAMP.x, CAMP.y) > CAMP.r - 18) continue;
        z.stakeT -= dt;
        if (z.stakeT <= 0) {
          z.stakeT = 0.32;
          damageZ(z, 5 + C.stakes * 4, ang(CAMP.x, CAMP.y, z.x, z.y), 24);
        }
      }
    }
    if (C.turret && !S.fire.dead) {
      S.turretCd -= dt;
      if (S.turretCd <= 0) {
        const t = nearest(S.fire.x, S.fire.y, 260 + C.turret * 50);
        if (t) {
          S.turretCd = Math.max(0.26, 0.72 - C.turret * 0.08);
          const a = ang(S.fire.x + 46, S.fire.y - 20, t.x, t.y);
          fireShot({
            typ: "bolt", x: S.fire.x + 46, y: S.fire.y - 28,
            vx: Math.cos(a) * 420, vy: Math.sin(a) * 420,
            dmg: 8 + C.turret * 5, life: 0.7, pierce: 0, col: "#ffb020", r: 7, knock: 40
          });
        } else S.turretCd = 0.12;
      }
    }
  }

  function update(dt) {
    if (S.state !== "play") return;
    S.t += dt;
    S.msgT -= dt;
    if (S.msgT <= 0) $("banner").style.opacity = "0";
    const p = S.player, st = stats();
    p.ifr -= dt; p.dash -= dt; p.dashCd -= dt; p.flash -= dt;
    S.flash = Math.max(0, S.flash - dt * 2.4);
    if (!S.fire.dead && Math.random() < dt * 11) {
      addPart(S.fire.x + rand(-16, 16), S.fire.y - 20, rand(-18, 18), rand(-110, -36), 0.75, Math.random() < 0.45 ? "#fff3c8" : "#ffb020", irand(2, 5), -40);
    }
    if (p.dash > 0) {
      addPart(p.x + rand(-8, 8), p.y + rand(-6, 6), -p.vx * 0.18, -p.vy * 0.18, 0.22, Math.random() < 0.5 ? "#fff3c8" : "#c4a06a", 4, 0);
    }

    if (S.waveRest > 0) {
      S.waveRest -= dt;
      if (S.waveRest <= 0) beginWave();
    } else if (S.incoming > 0) {
      if (Math.random() < dt * (S.wave <= 3 ? 0.42 + S.wave * 0.08 : 1.05 + S.wave * 0.2)) {
        const pack = pickType() === "crawler" ? irand(2, 4) : 1;
        for (let i = 0; i < pack && S.incoming > 0; i++) {
          if (spawnZ(i ? "crawler" : pickType())) S.incoming--;
          else break;
        }
      }
    } else if (S.zombies.length === 0) {
      S.state = "break";
      cg.gameplayStop();
      cg.midgame(() => offerPowers());
      return;
    }

    let ix = 0, iy = 0;
    if (KEY.moveU || KEY["arrowup"]) iy -= 1;
    if (KEY.moveD || KEY["arrowdown"]) iy += 1;
    if (KEY.moveL || KEY["arrowleft"]) ix -= 1;
    if (KEY.moveR || KEY["arrowright"]) ix += 1;
    const len = Math.hypot(ix, iy) || 1;
    const moving = ix || iy;
    if (moving) {
      p.facing = Math.atan2(iy, ix);
      if (ix) p.flip = ix < 0;
    }
    const spd = p.dash > 0 ? st.spd * 2.35 : st.spd;
    p.vx += (ix / len) * spd * 10 * dt;
    p.vy += (iy / len) * spd * 10 * dt;
    p.vx *= Math.pow(0.0004, dt);
    p.vy *= Math.pow(0.0004, dt);
    collideTrees(p, p.x + p.vx * dt, p.y + p.vy * dt);

    if (dist(p.x, p.y, S.fire.x, S.fire.y) < st.healR && !S.fire.dead && p.hp < p.max) {
      p.hp = Math.min(p.max, p.hp + st.heal * dt);
    }
    if (st.regen && p.hp < p.max) p.hp = Math.min(p.max, p.hp + st.regen * dt);

    tickWeapons(dt);
    tickCamp(dt);

    for (let i = S.crates.length - 1; i >= 0; i--) {
      const cr = S.crates[i];
      if (cr.hp <= 0) { S.crates.splice(i, 1); continue; }
      for (const b of S.shots) {
        if (dist(b.x, b.y, cr.x, cr.y) < 16) {
          cr.hp--; gibs(cr.x, cr.y, "#6b4a2a"); b.life = 0;
          if (cr.hp <= 0) S.pickups.push({ x: cr.x, y: cr.y, kind: "heart", t: 0 });
        }
      }
    }

    for (let i = S.pickups.length - 1; i >= 0; i--) {
      const pk = S.pickups[i];
      pk.t += dt;
      const d = dist(p.x, p.y, pk.x, pk.y);
      if (d < st.magnet) {
        pk.x = lerp(pk.x, p.x, dt * 7); pk.y = lerp(pk.y, p.y, dt * 7);
      }
      if (d < 22) {
        p.hp = Math.min(p.max, p.hp + 18);
        audio.tone(520, 0.07, "square", 0.05);
        S.pickups.splice(i, 1);
        syncHudBars();
      }
    }

    for (let i = S.shots.length - 1; i >= 0; i--) {
      const b = S.shots[i];
      if (b.typ === "boom" || b.typ === "hammer") {
        b.life -= dt;
        if (b.life < b.ret) {
          const a = ang(b.x, b.y, p.x, p.y);
          b.vx = Math.cos(a) * (b.typ === "hammer" ? 400 : 340);
          b.vy = Math.sin(a) * (b.typ === "hammer" ? 400 : 340);
          if (dist(b.x, b.y, p.x, p.y) < 18) { S.shots.splice(i, 1); continue; }
        }
      } else if (b.typ === "rocket" || b.typ === "crow") {
        const t = nearest(b.x, b.y, 300);
        if (t) {
          const a = ang(b.x, b.y, t.x, t.y);
          const spd = b.typ === "crow" ? 260 : 240;
          b.vx = lerp(b.vx, Math.cos(a) * spd, dt * b.hom);
          b.vy = lerp(b.vy, Math.sin(a) * spd, dt * b.hom);
        }
        b.life -= dt;
      } else {
        b.life -= dt;
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      let dead = b.life <= 0 || b.x < 0 || b.y < 0 || b.x > MAP || b.y > MAP;
      for (const z of S.zombies) {
        if (z.dead || z.hp <= 0) continue;
        if (b.hit && b.hit.indexOf(z) >= 0) continue;
        if (dist(b.x, b.y, z.x, z.y) < z.r + b.r) {
          damageZ(z, b.dmg, Math.atan2(b.vy, b.vx), b.knock);
          if (b.slow) z.spd = Math.min(z.spd, ENEMIES[z.type].spd * (1 - b.slow));
          if (b.typ === "rocket") { explode(b.x, b.y, b.blast, b.dmg, false); dead = true; break; }
          if (b.typ === "pot") { dead = true; break; }
          if (b.typ === "hammer") {
            pushFx({ x1: b.x, y1: b.y - 70, x2: b.x, y2: b.y + 16, life: 0.2, bolt: true });
            pushFx({ x1: b.x - 40, y1: b.y - 20, x2: b.x + 40, y2: b.y + 10, life: 0.16, bolt: true });
            boomFlash(0.12);
            explode(b.x, b.y, b.zap || 40, b.dmg * 0.45, false);
          }
          if (b.typ === "aegis") {
            sparks(b.x, b.y, 4, ["#fff3c8", "#3a6aaa", "#c23a2a"], 120, 0.18, 0);
            if (b.hit) b.hit.push(z);
            const nxt = nearest(b.x, b.y, 300, b.hit);
            if (nxt && b.pierce > 0) {
              const na = ang(b.x, b.y, nxt.x, nxt.y);
              b.vx = Math.cos(na) * 400; b.vy = Math.sin(na) * 400;
              b.pierce--;
            } else dead = true;
            break;
          }
          if (b.hit) b.hit.push(z);
          if (!b.pierce) { dead = true; break; }
          b.pierce--;
          if (b.pierce < 0) { dead = true; break; }
        }
      }
      if (dead) {
        if (b.typ === "pot") {
          if (S.pools.length > 18) S.pools.shift();
          S.pools.push({ x: b.x, y: b.y, r: b.pool || 40, life: 2.6, dmg: b.dmg * 0.4 });
        }
        S.shots.splice(i, 1);
      }
    }

    for (let i = S.pools.length - 1; i >= 0; i--) {
      const pl = S.pools[i];
      pl.life -= dt;
      if (pl.life <= 0) { S.pools.splice(i, 1); continue; }
      for (const z of S.zombies) {
        if (z.dead || z.hp <= 0) continue;
        if (dist(pl.x, pl.y, z.x, z.y) < pl.r + z.r) {
          if (!z._poolHit || z._poolHit < S.t) {
            damageZ(z, pl.dmg, ang(pl.x, pl.y, z.x, z.y), 12);
            z._poolHit = S.t + 0.2;
          }
        }
      }
    }

    for (let i = S.zombies.length - 1; i >= 0; i--) {
      const z = S.zombies[i];
      if (z.hp <= 0 || z.dead) { S.zombies.splice(i, 1); continue; }
      z.hit -= dt; z.atk -= dt; z.spit -= dt;
      const toP = dist(z.x, z.y, p.x, p.y);
      const toF = S.fire.dead ? 1e9 : dist(z.x, z.y, S.fire.x, S.fire.y);
      const huntPlayer = toP <= toF;
      const tx = huntPlayer ? p.x : S.fire.x;
      const ty = huntPlayer ? p.y : S.fire.y;
      const a = ang(z.x, z.y, tx, ty);
      if (ENEMIES[z.type].spit && toP < 220 && z.spit <= 0) {
        z.spit = 1.7;
        const sa = ang(z.x, z.y, p.x, p.y);
        S.goo.push({ x: z.x, y: z.y, vx: Math.cos(sa) * 130, vy: Math.sin(sa) * 130, life: 1.5 });
      } else if (z.shaman) {
        z.vx += Math.cos(a) * z.spd * 2.2 * dt;
        z.vy += Math.sin(a) * z.spd * 2.2 * dt;
        z.buffT -= dt;
        if (z.buffT <= 0) {
          z.buffT = 0.4;
          for (const o of S.zombies) if (o !== z && !o.dead && dist(z.x, z.y, o.x, o.y) < 90) o.spd = Math.max(o.spd, ENEMIES[o.type].spd * 1.18);
        }
      } else {
        z.vx += Math.cos(a) * z.spd * 4.4 * dt;
        z.vy += Math.sin(a) * z.spd * 4.4 * dt;
      }
      z.vx *= Math.pow(0.05, dt);
      z.vy *= Math.pow(0.05, dt);
      collideTrees(z, z.x + z.vx * dt, z.y + z.vy * dt);
      if (toP < z.r + p.r && z.atk <= 0) {
        z.atk = 0.65;
        hurtPlayer(z.dmg, z);
        if (st.thorns) damageZ(z, st.thorns, ang(p.x, p.y, z.x, z.y), 50);
      }
      if (!S.fire.dead && toF < z.r + 18 && z.atk <= 0) {
        z.atk = 0.85;
        S.fire.hp -= z.dmg * 0.65 * st.ward;
        shake(3);
        syncHudBars();
        if (S.fire.hp <= 0) snuffFire();
      }
    }

    for (let i = S.goo.length - 1; i >= 0; i--) {
      const g = S.goo[i];
      g.x += g.vx * dt; g.y += g.vy * dt; g.life -= dt;
      if (dist(g.x, g.y, p.x, p.y) < 16) { hurtPlayer(11, g); S.goo.splice(i, 1); continue; }
      if (g.life <= 0) S.goo.splice(i, 1);
    }

    for (let i = S.fx.length - 1; i >= 0; i--) {
      S.fx[i].life -= dt;
      if (S.fx[i].life <= 0) S.fx.splice(i, 1);
    }
    for (let i = S.parts.length - 1; i >= 0; i--) {
      const q = S.parts[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += (q.grav == null ? 140 : q.grav) * dt; q.life -= dt;
      if (q.life <= 0) S.parts.splice(i, 1);
    }
    for (let i = S.floaters.length - 1; i >= 0; i--) {
      S.floaters[i].life -= dt; S.floaters[i].y -= 28 * dt;
      if (S.floaters[i].life <= 0) S.floaters.splice(i, 1);
    }

    S.camX = lerp(S.camX, p.x - VW / 2, 1 - Math.pow(0.0008, dt));
    S.camY = lerp(S.camY, p.y - VH / 2, 1 - Math.pow(0.0008, dt));
    S.camX = clamp(S.camX, 0, Math.max(0, MAP - VW));
    S.camY = clamp(S.camY, 0, Math.max(0, MAP - VH));
    S.shake *= Math.pow(0.04, dt);
  }

  function px(x, y, w, h, col) { CTX.fillStyle = col; CTX.fillRect(snap(x), snap(y), w, h); }
  function w2s(x, y) { return { x: x - S.camX, y: y - S.camY }; }
  function fade(ln) { return Math.max(0, Math.min(1, ln.life / (ln.max || 0.16))); }
  function jagPts(ln, amp, segs) {
    let s = (ln.seed || 1) + 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s % 1000) / 1000; };
    const pts = [];
    const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ox = -dy / len, oy = dx / len;
    segs = segs || 7;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = (i === 0 || i === segs) ? 0 : (rnd() * 2 - 1) * amp;
      pts.push(w2s(ln.x1 + dx * t + ox * j, ln.y1 + dy * t + oy * j));
    }
    return pts;
  }
  function strokePts(pts, col, w, a) {
    CTX.globalAlpha = a;
    CTX.strokeStyle = col;
    CTX.lineWidth = w;
    CTX.lineJoin = "round";
    CTX.lineCap = "round";
    CTX.beginPath();
    CTX.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) CTX.lineTo(pts[i].x, pts[i].y);
    CTX.stroke();
    CTX.globalAlpha = 1;
  }
  function wavePts(ln, amp) {
    const pts = [];
    const dx = ln.x2 - ln.x1, dy = ln.y2 - ln.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ox = -dy / len, oy = dx / len;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const j = Math.sin(t * 10 + S.t * 22) * amp * (t > 0 && t < 1 ? 1 : 0);
      pts.push(w2s(ln.x1 + dx * t + ox * j, ln.y1 + dy * t + oy * j));
    }
    return pts;
  }
  function blit(ox, oy, flip, W, rects) {
    const k = 2;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      const x = flip ? ox + ((W * k) >> 1) - r[0] * k - r[2] * k : ox - ((W * k) >> 1) + r[0] * k;
      px(x, oy + r[1] * k, r[2] * k, r[3] * k, r[4]);
    }
  }

  function drawTree(t) {
    const s = w2s(t.x, t.y);
    if (s.x < -80 || s.y < -100 || s.x > VW + 80 || s.y > VH + 100) return;
    px(s.x - 8, s.y - 6, 16, 22, "#3a2414");
    px(s.x - 5, s.y - 4, 5, 20, "#2a180c");
    px(s.x + 2, s.y + 8, 6, 8, "#4a3018");
    const g1 = t.shade === 0 ? "#163616" : t.shade === 1 ? "#1a4018" : "#102810";
    px(s.x - t.r, s.y - t.h, t.r * 2, t.r + 12, g1);
    px(s.x - t.r + 6, s.y - t.h - 8, t.r + 4, t.r - 2, "#1e4a1c");
    px(s.x - t.r + 10, s.y - t.h + 8, t.r - 4, t.r, "#245824");
    px(s.x - 8, s.y - t.h + 6, 12, 10, "#2e6a2a");
    px(s.x + 4, s.y - t.h + 14, 8, 6, "#3a7a32");
    px(s.x - t.r + 4, s.y - 8, 6, 4, "#0d280d");
  }

  function drawFire() {
    const s = w2s(S.fire.x, S.fire.y);
    const br = S.camp.brazier;
    const g = br * 8;
    px(s.x - 36 - g * 0.4, s.y + 14, 72 + g * 0.8, 10, "#2a1a0c");
    px(s.x - 32 - g * 0.3, s.y + 10, 64 + g * 0.6, 10, "#3a2210");
    px(s.x - 26, s.y + 4, 16, 16, "#5a3a18");
    px(s.x + 10, s.y + 4, 16, 16, "#4a2e12");
    px(s.x - 8, s.y + 6, 16, 12, "#2a1808");
    if (S.fire.dead) {
      px(s.x - 18, s.y - 4, 36, 10, "#3a2a20");
      px(s.x - 10, s.y - 10, 8, 8, "#4a3a28");
      px(s.x + 6, s.y - 8, 6, 6, "#2a2018");
      px(s.x - 4, s.y - 2, 4, 4, "#6a4a30");
      return;
    }
    const flick = Math.sin(S.t * 14) * (6 + br);
    const flick2 = Math.sin(S.t * 19 + 1) * (4 + br * 0.6);
    CTX.globalAlpha = 0.22 + Math.sin(S.t * 9) * 0.06;
    CTX.fillStyle = "#ff6a1a";
    CTX.beginPath(); CTX.arc(s.x, s.y - 8, 52 + g + flick, 0, Math.PI * 2); CTX.fill();
    CTX.globalAlpha = 0.16;
    CTX.fillStyle = "#ffb020";
    CTX.beginPath(); CTX.arc(s.x, s.y - 18, 28 + g * 0.5, 0, Math.PI * 2); CTX.fill();
    CTX.globalAlpha = 1;
    px(s.x - 22 - g * 0.2, s.y - 24 - flick - g, 44 + g * 0.4, 36 + g, "#ff6a1a");
    px(s.x - 14 - g * 0.1, s.y - 40 - flick2 - g, 28 + g * 0.2, 28 + g * 0.6, "#ffb020");
    px(s.x - 8, s.y - 54 - flick * 0.7 - g, 16, 18 + g * 0.4, "#fff3c0");
    px(s.x - 4, s.y - 64 - flick - g, 8, 12 + br * 2, "#fff");
    px(s.x - 28 - flick * 0.3, s.y - 12, 10, 10, "#c45a00");
    px(s.x + 18 + flick2 * 0.3, s.y - 10, 10, 10, "#ff9030");
    px(s.x - 10, s.y - 28 - flick2, 6, 6, "#fff3c8");
    px(s.x - 16, s.y + 2, 8, 8, "#1a1208");
    px(s.x + 8, s.y + 2, 7, 7, "#1a1208");
  }

  function drawCampExtras() {
    const pal = S.camp.palisade;
    if (pal) {
      const n = 12 + pal * 3;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + 0.08;
        const s = w2s(CAMP.x + Math.cos(a) * (CAMP.r - 10), CAMP.y + Math.sin(a) * (CAMP.r - 10));
        px(s.x - 5, s.y - 16 - pal * 2, 10, 22 + pal * 2, "#5a3a18");
        px(s.x - 4, s.y - 20 - pal * 2, 8, 6, "#3a2410");
        px(s.x - 3, s.y - 6, 6, 10, "#4a3014");
      }
    }
    if (S.camp.stakes) {
      const n = 10 + S.camp.stakes * 3;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + 0.2;
        const s = w2s(CAMP.x + Math.cos(a) * (CAMP.r - 40), CAMP.y + Math.sin(a) * (CAMP.r - 40));
        px(s.x - 3, s.y - 8 - S.camp.stakes, 6, 14 + S.camp.stakes, "#8a8a8a");
        px(s.x - 2, s.y - 12 - S.camp.stakes, 4, 6, "#c8c0b0");
      }
    }
    if (S.camp.beacon && !S.fire.dead) {
      const s = w2s(S.fire.x, S.fire.y);
      const pulse = 70 + S.camp.beacon * 28 + Math.sin(S.t * 5) * 6;
      CTX.strokeStyle = "rgba(255,176,32,0.22)";
      CTX.lineWidth = 6;
      CTX.beginPath(); CTX.arc(s.x, s.y, pulse, 0, Math.PI * 2); CTX.stroke();
      CTX.strokeStyle = "rgba(255,226,122,0.45)";
      CTX.lineWidth = 2;
      CTX.beginPath(); CTX.arc(s.x, s.y, pulse * 0.72, 0, Math.PI * 2); CTX.stroke();
    }
    if (S.camp.turret) {
      const s = w2s(S.fire.x + 48, S.fire.y + 10);
      px(s.x - 10, s.y - 4, 20, 12, "#3a2410");
      px(s.x - 7, s.y - 26, 14, 24, "#6b4a26");
      px(s.x - 11, s.y - 32, 22, 10, "#4a3018");
      px(s.x - 4, s.y - 40, 8, 10, S.t % 0.4 < 0.2 ? "#ffb020" : "#ff6a1a");
      px(s.x - 3, s.y - 8, 6, 8, "#2a1808");
    }
  }

  function drawPlayer() {
    const p = S.player;
    const s = w2s(p.x, p.y);
    const moving = Math.hypot(p.vx, p.vy) > 18;
    const ca = Math.cos(p.facing), sa = Math.sin(p.facing);
    const view = Math.abs(sa) > Math.abs(ca) * 1.15 ? (sa > 0 ? "front" : "back") : "side";
    const flip = !!p.flip;
    const bob = moving ? (Math.sin(S.t * 16) > 0 ? 2 : 0) : 0;
    const step = Math.sin(S.t * 16);
    const lStep = moving ? (step > 0 ? 2 : -2) : 0;
    const rStep = moving ? (step > 0 ? -2 : 2) : 0;
    const flash = p.flash > 0;
    const skin = flash ? "#fff7e8" : "#e8c49a";
    const skinD = flash ? "#f0d0b0" : "#c49868";
    const coat = flash ? "#c48a60" : "#6b3a22";
    const coatD = flash ? "#a06040" : "#4a2414";
    const coatL = flash ? "#d4a070" : "#8a4a28";
    const hat = "#24180e";
    const hatL = "#3a2a18";
    const pant = "#2a2018";
    const boot = "#16100a";
    const band = "#c23a2a";
    const W = 36;
    const ox = s.x;
    const oy = s.y - 96 + (p.dash > 0 ? -8 : 0);
    px(s.x - 18, s.y + 10, 36, 10, "#00000066");
    const B = bob;
    let body;
    if (view === "back") {
      body = [
        [10, 0 + B, 16, 7, hat],
        [8, 5 + B, 20, 6, hatL],
        [10, 9 + B, 16, 10, "#3a2418"],
        [8, 17 + B, 20, 5, band],
        [6, 20 + B, 24, 18, coat],
        [10, 24 + B, 16, 8, coatD],
        [22, 14 + B, 10, 16, "#5a3a18"],
        [24, 10 + B, 8, 8, "#c9a24a"],
        [26, 12 + B, 4, 4, "#ffe27a"],
        [8, 36 + lStep, 8, 12, pant],
        [20, 36 + rStep, 8, 12, pant],
        [7, 46 + lStep, 10, 5, boot],
        [19, 46 + rStep, 10, 5, boot]
      ];
    } else if (view === "front") {
      body = [
        [10, 0 + B, 16, 6, hat],
        [8, 4 + B, 20, 5, hatL],
        [10, 7 + B, 16, 14, skin],
        [12, 9 + B, 4, 3, "#3a2418"],
        [20, 9 + B, 4, 3, "#3a2418"],
        [13, 12 + B, 3, 3, "#1a120c"],
        [20, 12 + B, 3, 3, "#1a120c"],
        [16, 15 + B, 4, 3, skinD],
        [13, 18 + B, 10, 3, "#a07048"],
        [14, 20 + B, 8, 2, "#7a3020"],
        [9, 20 + B, 18, 5, band],
        [6, 23 + B, 24, 16, coat],
        [10, 27 + B, 16, 6, coatL],
        [14, 29 + B, 3, 3, "#c45a18"],
        [19, 29 + B, 3, 3, "#c45a18"],
        [8, 35 + B, 20, 4, "#c45a18"],
        [13, 36 + B, 10, 2, "#ffe27a"],
        [4, 25 + B, 6, 14, coatD],
        [26, 25 + B, 6, 14, coatD],
        [28, 18 + B, 4, 16, "#5a3a18"],
        [26, 14 + B, 10, 8, "#c9a24a"],
        [28, 16 + B, 6, 4, "#ffe27a"],
        [8, 38 + lStep, 8, 10, pant],
        [20, 38 + rStep, 8, 10, pant],
        [7, 46 + lStep, 10, 5, boot],
        [19, 46 + rStep, 10, 5, boot]
      ];
    } else {
      body = [
        [10, 0 + B, 17, 6, hat],
        [8, 4 + B, 18, 5, hatL],
        [10, 7 + B, 16, 14, skin],
        [21, 12 + B, 3, 3, "#1a120c"],
        [23, 13 + B, 4, 3, skinD],
        [18, 16 + B, 6, 3, "#a07048"],
        [16, 18 + B, 7, 2, "#7a3020"],
        [10, 19 + B, 16, 5, band],
        [8, 22 + B, 20, 16, coat],
        [11, 26 + B, 14, 6, coatL],
        [14, 28 + B, 3, 3, "#c45a18"],
        [10, 34 + B, 16, 4, "#c45a18"],
        [13, 35 + B, 10, 2, "#ffe27a"],
        [4, 24 + B, 6, 12, coatD],
        [24, 24 + B, 8, 12, coat],
        [28, 16 + B, 4, 18, "#5a3a18"],
        [26, 12 + B, 12, 8, "#c9a24a"],
        [28, 14 + B, 8, 4, "#ffe27a"],
        [8, 38 + lStep, 8, 10, pant],
        [18, 38 + rStep, 8, 10, pant],
        [7, 46 + lStep, 10, 5, boot],
        [17, 46 + rStep, 10, 5, boot]
      ];
    }
    blit(ox, oy, flip, W, body);
    if (p.dash > 0) {
      CTX.globalAlpha = 0.28;
      blit(ox - p.vx * 0.05, oy - p.vy * 0.05, flip, W, body);
      CTX.globalAlpha = 0.14;
      blit(ox - p.vx * 0.1, oy - p.vy * 0.1, flip, W, body);
      CTX.globalAlpha = 1;
    }
  }

  function drawZombie(z) {
    const s = w2s(z.x, z.y);
    if (s.x < -50 || s.y < -60 || s.x > VW + 50 || s.y > VH + 40) return;
    const col = z.hit > 0 ? "#fff" : z.col;
    const h = z.r * 2;
    if (z.type === "bat") {
      const flap = Math.sin(S.t * 16 + z.x) * 4;
      px(s.x - 24, s.y - 4 - flap, 16, 10, col);
      px(s.x + 8, s.y - 4 + flap, 16, 10, col);
      px(s.x - 8, s.y - 8, 16, 16, col);
      px(s.x - 6, s.y - 4, 4, 4, "#2a1830");
      px(s.x - 4, s.y - 2, 4, 4, z.eye);
      px(s.x + 4, s.y - 2, 4, 4, z.eye);
      px(s.x - 2, s.y + 4, 4, 3, "#1a0a10");
    } else if (z.type === "crawler") {
      px(s.x - 20, s.y + 2, 40, 12, col);
      px(s.x - 24, s.y + 8, 8, 8, col);
      px(s.x + 16, s.y + 8, 8, 8, col);
      px(s.x - 10, s.y + 8, 8, 6, "#2a3a18");
      px(s.x + 4, s.y + 8, 8, 6, "#2a3a18");
      px(s.x - 8, s.y - 8, 16, 14, col);
      px(s.x - 4, s.y - 4, 3, 3, z.eye);
      px(s.x + 3, s.y - 4, 3, 3, z.eye);
      px(s.x - 2, s.y + 2, 6, 3, "#1a0808");
    } else if (z.type === "tank" || z.elite) {
      px(s.x - z.r, s.y - z.r + 6, h, h - 6, col);
      px(s.x - z.r + 8, s.y - z.r, h - 16, 14, "#2a2010");
      px(s.x - z.r + 4, s.y - 4, h - 8, 10, "#4a3a22");
      px(s.x - 10, s.y - 16, 8, 8, z.eye);
      px(s.x + 4, s.y - 16, 8, 8, z.eye);
      px(s.x - 8, s.y + 2, 16, 6, "#1a0808");
      px(s.x - z.r + 6, s.y + z.r - 10, 10, 10, "#2a1a10");
      px(s.x + z.r - 16, s.y + z.r - 10, 10, 10, "#2a1a10");
      if (z.elite) { px(s.x - 8, s.y - z.r - 12, 6, 12, "#ff5030"); px(s.x + 2, s.y - z.r - 12, 6, 12, "#ff5030"); }
    } else if (z.type === "spitter") {
      px(s.x - 16, s.y - 10, 32, 28, col);
      px(s.x - 18, s.y + 6, 36, 16, "#5a6a18");
      px(s.x - 8, s.y + 10, 16, 10, "#7a8a20");
      px(s.x - 6, s.y - 6, 5, 5, z.eye);
      px(s.x + 4, s.y - 6, 5, 5, z.eye);
      px(s.x - 4, s.y + 2, 10, 5, "#3a4a10");
    } else if (z.type === "bomber") {
      px(s.x - 14, s.y - 12, 28, 28, col);
      px(s.x - 12, s.y - 26, 24, 16, "#6a2010");
      px(s.x - 8, s.y - 22, 16, 10, "#8a3018");
      px(s.x - 2, s.y - 34, 6, 12, S.t % 0.3 < 0.15 ? "#ffb020" : "#ff6a1a");
      px(s.x - 5, s.y - 6, 4, 4, z.eye);
      px(s.x + 4, s.y - 6, 4, 4, z.eye);
    } else if (z.type === "shaman") {
      px(s.x - 14, s.y - 14, 28, 32, col);
      px(s.x - 18, s.y - 28, 36, 14, "#2a1838");
      px(s.x - 10, s.y - 32, 20, 6, "#4a3a68");
      px(s.x + 14, s.y - 42, 6, 44, "#c8a0ff");
      px(s.x + 12, s.y - 48, 10, 8, "#e8d0ff");
      px(s.x - 5, s.y - 8, 4, 4, z.eye);
      px(s.x + 4, s.y - 8, 4, 4, z.eye);
    } else if (z.type === "runner") {
      px(s.x - 12, s.y - 20, 22, 20, col);
      px(s.x - 10, s.y - 2, 18, 16, "#6a2a24");
      px(s.x - 16, s.y - 2, 8, 22, col);
      px(s.x + 8, s.y + 2, 8, 20, col);
      px(s.x - 4, s.y - 12, 4, 4, z.eye);
      px(s.x + 4, s.y - 12, 4, 4, z.eye);
      px(s.x - 8, s.y + 18, 8, 8, "#2a100c");
      px(s.x + 4, s.y + 16, 8, 10, "#2a100c");
    } else {
      px(s.x - 14, s.y - 18, 28, 20, col);
      px(s.x - 12, s.y, 24, 16, "#3a4a28");
      px(s.x - 16, s.y + 2, 8, 16, col);
      px(s.x + 8, s.y + 4, 8, 14, col);
      px(s.x - 6, s.y - 10, 5, 5, z.eye);
      px(s.x + 4, s.y - 10, 5, 5, z.eye);
      px(s.x - 4, s.y + 4, 12, 4, "#2a100c");
      px(s.x - 10, s.y + 18, 10, 8, "#2a1a10");
      px(s.x + 2, s.y + 18, 10, 8, "#2a1a10");
    }
    px(s.x - z.r, s.y - z.r - 10, Math.max(2, (z.hp / z.max) * h), 4, "#c23a2a");
    px(s.x - z.r, s.y - z.r - 10, Math.max(2, (z.hp / z.max) * h), 2, "#e8d8b0");
  }

  function drawLitter(L) {
    const s = w2s(L.x, L.y);
    if (L.k === "tent") {
      px(s.x - 28, s.y + 4, 56, 14, "#4a2810");
      px(s.x - 24, s.y - 8, 48, 16, "#6a3a18");
      px(s.x - 20, s.y - 22, 40, 18, "#8a4a20");
      px(s.x - 4, s.y - 28, 8, 32, "#3a2410");
      px(s.x - 8, s.y + 2, 16, 10, "#2a180c");
    } else if (L.k === "logs") {
      px(s.x - 24, s.y, 48, 10, "#5a3a18");
      px(s.x - 20, s.y + 8, 44, 10, "#4a2e12");
      px(s.x - 22, s.y + 2, 6, 6, "#2a1808");
      px(s.x + 14, s.y + 10, 6, 6, "#2a1808");
    } else if (L.k === "crate") {
      px(s.x - 16, s.y - 16, 32, 32, "#6b4a26");
      px(s.x - 16, s.y, 32, 4, "#2a1a10");
      px(s.x - 2, s.y - 12, 4, 24, "#3a2410");
      px(s.x - 12, s.y - 12, 8, 8, "#8a5a30");
    } else if (L.k === "skull") {
      px(s.x - 8, s.y - 8, 16, 12, "#d8c8a0");
      px(s.x - 8, s.y + 2, 16, 6, "#c8b890");
      px(s.x - 4, s.y - 4, 3, 3, "#111"); px(s.x + 3, s.y - 4, 3, 3, "#111");
      px(s.x - 2, s.y + 4, 2, 3, "#111"); px(s.x + 2, s.y + 4, 2, 3, "#111");
    } else if (L.k === "stump") {
      px(s.x - 14, s.y - 6, 28, 16, "#4a3018");
      px(s.x - 10, s.y - 12, 20, 8, "#6a4a22");
      px(s.x - 6, s.y - 10, 4, 4, "#8a6a32");
      px(s.x + 4, s.y + 6, 8, 6, "#3a2410");
    } else {
      px(s.x - 22, s.y - 8, 10, 20, "#5a3a18");
      px(s.x - 6, s.y - 8, 10, 20, "#4a3014");
      px(s.x + 10, s.y - 8, 10, 20, "#5a3a18");
      px(s.x - 24, s.y + 10, 48, 6, "#3a2410");
    }
  }

  function draw() {
    const ox = (Math.random() * 2 - 1) * S.shake;
    const oy = (Math.random() * 2 - 1) * S.shake;
    CTX.setTransform(1, 0, 0, 1, ox, oy);
    CTX.imageSmoothingEnabled = false;
    CTX.fillStyle = "#081008";
    CTX.fillRect(-10, -10, VW + 20, VH + 20);

    const x0 = Math.max(0, (S.camX / TILE | 0) - 1);
    const y0 = Math.max(0, (S.camY / TILE | 0) - 1);
    const x1 = Math.min(MAP / TILE, x0 + (VW / TILE | 0) + 3);
    const y1 = Math.min(MAP / TILE, y0 + (VH / TILE | 0) + 3);
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const wx = tx * TILE + 16, wy = ty * TILE + 16;
        const inCamp = dist(wx, wy, CAMP.x, CAMP.y) < CAMP.r;
        const flick = Math.sin(S.t * 8 + tx * 0.5 + ty) * 0.5 + 0.5;
        const lit = !S.fire.dead && dist(wx, wy, S.fire.x, S.fire.y) < 160 + flick * 18;
        CTX.fillStyle = inCamp ? (lit ? "#4a5e32" : "#334422") : (lit ? "#1c3a18" : "#0a120a");
        CTX.fillRect(tx * TILE - S.camX, ty * TILE - S.camY, TILE, TILE);
        if (inCamp && ((tx + ty) & 3) === 0) {
          CTX.fillStyle = "#2c2818";
          CTX.fillRect(tx * TILE - S.camX + 8, ty * TILE - S.camY + 10, 6, 4);
        }
        if (((tx * 7 + ty * 13) % 5) === 0) {
          CTX.fillStyle = inCamp ? "#5a7038" : "#142414";
          CTX.fillRect(tx * TILE - S.camX + 10, ty * TILE - S.camY + 18, 4, 6);
          CTX.fillRect(tx * TILE - S.camX + 16, ty * TILE - S.camY + 14, 3, 5);
        }
      }
    }

    S.litter.forEach(drawLitter);
    S.crates.forEach((cr) => {
      const s = w2s(cr.x, cr.y);
      px(s.x - 14, s.y - 14, 28, 28, "#6b4a26");
      px(s.x - 14, s.y, 28, 4, "#2a1a10");
      px(s.x - 2, s.y - 8, 4, 16, "#3a2410");
    });
    drawFire();
    drawCampExtras();
    S.trees.forEach(drawTree);

    for (const pk of S.pickups) {
      const s = w2s(pk.x, pk.y + Math.sin(S.t * 6 + pk.x) * 4);
      px(s.x - 7, s.y - 6, 14, 12, "#d44");
      px(s.x - 3, s.y - 10, 6, 6, "#d44");
    }
    for (const g of S.goo) {
      const s = w2s(g.x, g.y);
      px(s.x - 8, s.y - 6, 16, 12, "#6a8a20");
      px(s.x - 4, s.y - 10, 8, 8, "#8aaa28");
      px(s.x - 2, s.y + 4, 4, 6, "#4a6a18");
    }
    for (const pl of S.pools) {
      const s = w2s(pl.x, pl.y);
      const a = Math.max(0.25, pl.life / 2.6);
      CTX.globalAlpha = 0.35 * a;
      CTX.fillStyle = "#ff6a1a";
      CTX.beginPath(); CTX.ellipse(s.x, s.y, pl.r, 10, 0, 0, Math.PI * 2); CTX.fill();
      CTX.globalAlpha = 1;
      px(s.x - pl.r * 0.7, s.y - 6, pl.r * 1.4, 12, "#4a2410");
      px(s.x - pl.r * 0.45, s.y - 10, pl.r * 0.9, 8, "#ff6a1a");
      px(s.x - 6, s.y - 18 - Math.sin(S.t * 12 + pl.x) * 3, 4, 8, "#fff3c8");
      px(s.x + 8, s.y - 14 - Math.sin(S.t * 9 + pl.y) * 2, 4, 6, "#ffb020");
    }
    for (const b of S.shots) {
      const s = w2s(b.x, b.y);
      const spd = Math.hypot(b.vx, b.vy) || 1;
      const isBolt = b.typ === "bolt";
      CTX.globalAlpha = isBolt ? 0.55 : 0.45;
      CTX.strokeStyle = b.col;
      CTX.lineWidth = isBolt ? 2 : Math.max(3, b.r * 0.45);
      CTX.lineCap = "round";
      CTX.beginPath();
      CTX.moveTo(s.x - (b.vx / spd) * (isBolt ? 8 : 22), s.y - (b.vy / spd) * (isBolt ? 8 : 22));
      CTX.lineTo(s.x, s.y);
      CTX.stroke();
      CTX.globalAlpha = 1;
      if (b.typ === "rocket") {
        px(s.x - 8, s.y - 16, 16, 28, "#c23a2a");
        px(s.x - 6, s.y - 14, 12, 18, "#ff6a1a");
        px(s.x - 4, s.y - 18, 8, 8, "#fff3c0");
        px(s.x - 3, s.y - 8, 6, 10, "#ffb020");
        px(s.x - 10, s.y + 8, 8, 8, "#3a2410");
        px(s.x + 2, s.y + 8, 8, 8, "#3a2410");
        px(s.x - 6, s.y + 12, 5, 10, "#ff6a1a");
        px(s.x + 1, s.y + 12, 5, 10, "#ffb020");
        px(s.x - 2, s.y + 16, 4, 8, "#fff3c8");
      } else if (b.typ === "crow") {
        px(s.x - 6, s.y - 3, 14, 5, "#2a1830");
        px(s.x + 4, s.y - 6, 6, 4, "#3a3048");
        px(s.x - 2, s.y - 2, 3, 3, "#e8c070");
      } else if (b.typ === "hammer") {
        px(s.x - 18, s.y - 22, 36, 22, "#c8c0b0");
        px(s.x - 20, s.y - 18, 40, 10, "#e8e0d0");
        px(s.x - 14, s.y - 16, 28, 6, "#ffe27a");
        px(s.x - 6, s.y - 2, 12, 28, "#6b4a26");
        px(s.x - 8, s.y + 4, 16, 6, "#8a5a28");
        px(s.x - 8, s.y - 26, 8, 8, "#9fd");
        px(s.x + 6, s.y - 28, 8, 8, "#c8e8ff");
        px(s.x - 2, s.y - 30, 6, 6, "#fff");
      } else if (b.typ === "aegis") {
        px(s.x - 20, s.y - 22, 40, 44, "#c23a2a");
        px(s.x - 16, s.y - 18, 32, 36, "#fff3c8");
        px(s.x - 12, s.y - 14, 24, 28, "#3a6aaa");
        px(s.x - 8, s.y - 8, 16, 16, "#1a3a6a");
        px(s.x - 4, s.y - 4, 8, 8, "#fff");
        px(s.x - 22, s.y - 4, 6, 12, "#8a2a22");
        px(s.x + 16, s.y - 4, 6, 12, "#8a2a22");
      } else if (b.typ === "web") {
        px(s.x - 8, s.y - 1, 16, 2, "#e8d8b0");
        px(s.x - 1, s.y - 8, 2, 16, "#d8c8a0");
        px(s.x - 6, s.y - 6, 12, 2, "#c8b890");
      } else if (b.typ === "repulse") {
        CTX.globalAlpha = 0.35;
        CTX.fillStyle = "#ffe27a";
        CTX.beginPath(); CTX.arc(s.x, s.y, 12, 0, Math.PI * 2); CTX.fill();
        CTX.globalAlpha = 1;
        px(s.x - 6, s.y - 6, 12, 12, "#ffe27a");
        px(s.x - 3, s.y - 3, 6, 6, "#fff");
      } else {
        px(s.x - b.r, s.y - b.r, b.r * 2, b.r * 2, b.col);
        if (isBolt) px(s.x - 1, s.y - 1, 2, 2, "#fff3c8");
      }
    }
    for (const ln of S.fx) {
      const a = fade(ln);
      const p1 = w2s(ln.x1, ln.y1), p2 = w2s(ln.x2, ln.y2);
      if (ln.bell) {
        const c = w2s((ln.x1 + ln.x2) / 2, ln.y1);
        const grow = ln.boom ? (1.15 - a * 0.35) : (0.7 + (1 - a) * 0.45);
        const rad = (ln.r || 80) * grow;
        CTX.globalAlpha = 0.18 * a;
        CTX.fillStyle = ln.boom ? "#ffb020" : "#ffe27a";
        CTX.beginPath(); CTX.arc(c.x, c.y, rad, 0, Math.PI * 2); CTX.fill();
        CTX.globalAlpha = 0.85 * a;
        CTX.strokeStyle = ln.boom ? "#fff3c8" : "rgba(255,226,122,0.95)";
        CTX.lineWidth = ln.boom ? 6 : 4;
        CTX.beginPath(); CTX.arc(c.x, c.y, rad, 0, Math.PI * 2); CTX.stroke();
        CTX.strokeStyle = "#fff";
        CTX.lineWidth = 2;
        CTX.beginPath(); CTX.arc(c.x, c.y, rad * 0.72, 0, Math.PI * 2); CTX.stroke();
        CTX.globalAlpha = 1;
        continue;
      }
      if (ln.heat) {
        const ang0 = ln.ang != null ? ln.ang : Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1);
        const reach = ln.reach || dist(ln.x1, ln.y1, ln.x2, ln.y2);
        for (const off of [-0.12, 0, 0.12]) {
          const q2 = w2s(ln.x1 + Math.cos(ang0 + off) * reach, ln.y1 + Math.sin(ang0 + off) * reach);
          strokePts([p1, q2], "#ff6a1a", off ? 7 : 12, a * (off ? 0.35 : 0.7));
          strokePts([p1, q2], "#fff3c8", off ? 2 : 4, a);
        }
        continue;
      }
      if (ln.ice) {
        const ang0 = ln.ang != null ? ln.ang : Math.atan2(ln.y2 - ln.y1, ln.x2 - ln.x1);
        const reach = ln.reach || dist(ln.x1, ln.y1, ln.x2, ln.y2);
        for (const off of [-0.28, -0.14, 0, 0.14, 0.28]) {
          const q2 = w2s(ln.x1 + Math.cos(ang0 + off) * reach, ln.y1 + Math.sin(ang0 + off) * reach);
          strokePts([p1, q2], "#9fd", 8, a * 0.45);
          strokePts([p1, q2], "#fff", 2, a * 0.9);
        }
        continue;
      }
      if (ln.gold) {
        const pts = wavePts(ln, 10);
        strokePts(pts, "#8a6a28", 8, a * 0.5);
        strokePts(pts, "#ffe27a", 4, a);
        strokePts(pts, "#fff3c8", 2, a);
        continue;
      }
      if (ln.lash) {
        strokePts([p1, p2], "#6b3a22", 8, a * 0.7);
        strokePts([p1, p2], "#c8c0b0", 3, a);
        continue;
      }
      const bolts = jagPts(ln, 16, 8);
      strokePts(bolts, "#3a6aaa", 10, a * 0.35);
      strokePts(bolts, "#9fd", 5, a * 0.85);
      strokePts(bolts, "#fff", 2, a);
    }
    const orbitW = S.loadout.find((w) => w.id === "orbit");
    const bladeW = S.loadout.find((w) => w.id === "blades");
    if (orbitW) {
      const n = 2 + orbitW.lv, rad = 58 + orbitW.lv * 10;
      for (let i = 0; i < n; i++) {
        const a = orbitW.ang + (Math.PI * 2 * i) / n;
        const s = w2s(S.player.x + Math.cos(a) * rad, S.player.y + Math.sin(a) * rad);
        CTX.globalAlpha = 0.35;
        CTX.fillStyle = "#ff6a1a";
        CTX.beginPath(); CTX.arc(s.x, s.y, 12, 0, Math.PI * 2); CTX.fill();
        CTX.globalAlpha = 1;
        px(s.x - 8, s.y - 8, 16, 16, "#ff6a1a");
        px(s.x - 4, s.y - 4, 8, 8, "#ffe080");
        px(s.x - 2, s.y - 6, 4, 4, "#fff");
      }
    }
    if (bladeW) {
      const n = 3 + bladeW.lv, rad = 42 + bladeW.lv * 6;
      for (let i = 0; i < n; i++) {
        const a = bladeW.ang + (Math.PI * 2 * i) / n;
        const s = w2s(S.player.x + Math.cos(a) * rad, S.player.y + Math.sin(a) * rad);
        px(s.x - 10, s.y - 3, 20, 6, "#c8c0b0");
        px(s.x + 6, s.y - 5, 6, 4, "#fff");
        px(s.x - 12, s.y - 1, 4, 4, "#8a8070");
      }
    }
    const haloW = S.loadout.find((w) => w.id === "halo");
    if (haloW) {
      const s = w2s(S.player.x, S.player.y);
      const rad = 54 + haloW.lv * 10;
      CTX.globalAlpha = 0.12 + Math.sin(S.t * 8) * 0.04;
      CTX.fillStyle = "#ff6a1a";
      CTX.beginPath(); CTX.arc(s.x, s.y, rad, 0, Math.PI * 2); CTX.fill();
      CTX.globalAlpha = 0.55;
      CTX.strokeStyle = "#ff6a1a";
      CTX.lineWidth = 6;
      CTX.beginPath(); CTX.arc(s.x, s.y, rad, 0, Math.PI * 2); CTX.stroke();
      CTX.strokeStyle = "#fff3c8";
      CTX.lineWidth = 2;
      CTX.beginPath(); CTX.arc(s.x, s.y, rad - 6, 0, Math.PI * 2); CTX.stroke();
      CTX.globalAlpha = 1;
    }
    const efW = S.loadout.find((w) => w.id === "efield");
    if (efW) {
      const s = w2s(S.player.x, S.player.y);
      const rad = 92 + efW.lv * 16;
      const pulse = rad + Math.sin(S.t * 10) * 6;
      CTX.globalAlpha = 0.1 + Math.sin(S.t * 7) * 0.04;
      CTX.fillStyle = "#6ab0ff";
      CTX.beginPath(); CTX.arc(s.x, s.y, pulse, 0, Math.PI * 2); CTX.fill();
      CTX.globalAlpha = 0.7;
      CTX.strokeStyle = "#9fd";
      CTX.lineWidth = 3;
      CTX.beginPath(); CTX.arc(s.x, s.y, pulse, 0, Math.PI * 2); CTX.stroke();
      CTX.strokeStyle = "#fff";
      CTX.lineWidth = 1.5;
      CTX.beginPath(); CTX.arc(s.x, s.y, pulse * 0.78, 0, Math.PI * 2); CTX.stroke();
      CTX.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const a = S.t * 3 + i * 1.05;
        px(s.x + Math.cos(a) * pulse - 2, s.y + Math.sin(a) * pulse - 2, 4, 4, i & 1 ? "#fff" : "#9fd");
      }
    }

    S.zombies.forEach(drawZombie);
    drawPlayer();
    for (const q of S.parts) {
      const s = w2s(q.x, q.y);
      CTX.globalAlpha = Math.max(0.15, q.life / (q.max || 0.3));
      px(s.x, s.y, q.s, q.s, q.col);
      if (q.s > 3) px(s.x + 1, s.y + 1, Math.max(1, q.s - 2), Math.max(1, q.s - 2), "#fff3c8");
      CTX.globalAlpha = 1;
    }
    CTX.font = "14px Courier New, monospace";
    CTX.textAlign = "center";
    for (const f of S.floaters) {
      const s = w2s(f.x, f.y);
      CTX.globalAlpha = Math.max(0, f.life / 0.8);
      CTX.fillStyle = f.col;
      CTX.fillText(f.text, s.x, s.y);
      CTX.globalAlpha = 1;
    }
    CTX.setTransform(1, 0, 0, 1, 0, 0);
    if (S.flash > 0.01) {
      CTX.fillStyle = "rgba(255,230,180," + Math.min(0.38, S.flash) + ")";
      CTX.fillRect(0, 0, VW, VH);
    }
  }

  function syncHudBars() {
    $("hpFill").style.width = (100 * S.player.hp / S.player.max) + "%";
    $("fireFill").style.width = (100 * Math.max(0, S.fire.hp) / S.fire.max) + "%";
    $("waveVal").textContent = String(S.wave);
    $("killVal").textContent = String(S.kills);
    $("fireLabel").textContent = S.fire.dead ? "Ember pit" : "Campfire";
    $("fireLabel").classList.toggle("warn", !!S.fire.dead);
    $("fireBar").classList.toggle("out", !!S.fire.dead);
    $("muteTag").style.display = audio.silenced() ? "block" : "none";
  }

  function syncHudChips() {
    const sig = S.loadout.map((w) => w.id + w.lv).join(",") + "|" + Object.keys(S.pas).map((id) => id + S.pas[id]).join(",") + "|" + Object.keys(S.camp).map((id) => id + S.camp[id]).join(",");
    if (sig === S.hudSig) return;
    S.hudSig = sig;
    $("chips").innerHTML = "";
    S.loadout.forEach((w) => {
      const span = document.createElement("span");
      span.className = "chip";
      span.appendChild(makeIcon(w.id, 16));
      span.appendChild(document.createTextNode(POWERS[w.id].name.toUpperCase() + " " + w.lv));
      $("chips").appendChild(span);
    });
    Object.keys(S.pas).forEach((id) => {
      if (!S.pas[id]) return;
      const span = document.createElement("span");
      span.className = "chip";
      span.appendChild(makeIcon(id, 16));
      span.appendChild(document.createTextNode(POWERS[id].name.toUpperCase() + " " + S.pas[id]));
      $("chips").appendChild(span);
    });
    $("campChips").innerHTML = "";
    Object.keys(S.camp).forEach((id) => {
      if (!S.camp[id]) return;
      const span = document.createElement("span");
      span.className = "chip camp";
      span.appendChild(makeIcon(id, 16));
      span.appendChild(document.createTextNode(POWERS[id].name.toUpperCase() + " " + S.camp[id]));
      $("campChips").appendChild(span);
    });
  }

  function syncHud(force) {
    if (force) S.hudSig = "";
    syncHudBars();
    syncHudChips();
  }

  function show(id) { $(id).classList.add("show"); }
  function hide(id) { $(id).classList.remove("show"); }

  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    if (req) req.call(el).catch(() => {});
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) ex.call(document);
    } else goFullscreen();
  }

  function fitScreen() {
    cg.layoutRails();
    const stage = $("stage");
    const vv = window.visualViewport;
    const w = (stage && stage.clientWidth) || (vv && vv.width) || window.innerWidth;
    const h = (stage && stage.clientHeight) || (vv && vv.height) || window.innerHeight;
    VW = Math.max(640, w | 0);
    VH = Math.max(360, h | 0);
    CV.width = VW;
    CV.height = VH;
    CTX.imageSmoothingEnabled = false;
    MAP = Math.max(3200, VW + 240, VH + 240);
    if (S && S.player) {
      S.camX = clamp(S.player.x - VW / 2, 0, Math.max(0, MAP - VW));
      S.camY = clamp(S.player.y - VH / 2, 0, Math.max(0, MAP - VH));
    }
  }

  function startGame() {
    if (S.state !== "title") return;
    hide("title");
    S.state = "play";
    say("KEEP THE FIRE", 1.8);
    goFullscreen();
    fitScreen();
    cg.gameplayStart();
    cg.context();
  }

  function inFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function labelMoveKeys() {
    const el = $("moveKeys");
    const kb = navigator.keyboard;
    if (!el) return;
    if (!kb || !kb.getLayoutMap) {
      el.textContent = "WASD";
      return;
    }
    kb.getLayoutMap().then((map) => {
      const g = (code, fb) => {
        const v = map.get(code);
        return v ? String(v).toUpperCase() : fb;
      };
      el.textContent = g("KeyW", "W") + g("KeyA", "A") + g("KeyS", "S") + g("KeyD", "D");
    }).catch(() => { el.textContent = "WASD"; });
  }

  window.addEventListener("keydown", (e) => {
    audio.unlock();
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyW" && inFullscreen()) e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyW") KEY.moveU = true;
    if (e.code === "KeyS") KEY.moveD = true;
    if (e.code === "KeyA") KEY.moveL = true;
    if (e.code === "KeyD") KEY.moveR = true;
    KEY[e.code.toLowerCase()] = true;
    const k = e.code;
    if (k === "Enter") startGame();
    if (k === "KeyF") { e.preventDefault(); toggleFullscreen(); }
    if (k === "KeyP" && S.state === "play") { S.state = "pause"; show("pause"); cg.gameplayStop(); }
    else if (k === "KeyP" && S.state === "pause") { S.state = "play"; hide("pause"); cg.gameplayStart(); }
    if (k === "KeyM") {
      if (!audio.sdkMute) audio.userMuted = !audio.userMuted;
      syncHudBars();
    }
    if (k === "KeyR") {
      cg.gameplayStop();
      fresh(); hide("title"); hide("dead"); S.state = "play";
      cg.gameplayStart();
      cg.context();
    }
    if (S.state === "pick") {
      if (k === "Digit1" || k === "Numpad1") choose(0);
      if (k === "Digit2" || k === "Numpad2") choose(1);
      if (k === "Digit3" || k === "Numpad3") choose(2);
    }
    if (S.state === "campPick") {
      if (k === "Digit1" || k === "Numpad1") chooseCamp(0);
      if (k === "Digit2" || k === "Numpad2") chooseCamp(1);
      if (k === "Digit3" || k === "Numpad3") chooseCamp(2);
    }
    if (k === "Space") {
      e.preventDefault();
      if (S.state === "play") {
        const st = stats();
        if (S.player.dashCd <= 0) {
          S.player.dash = st.dashT; S.player.dashCd = st.dashCd; S.player.ifr = st.dashT;
          S.player.vx += Math.cos(S.player.facing) * 260;
          S.player.vy += Math.sin(S.player.facing) * 260;
          audio.tone(210, 0.08, "triangle", 0.05);
        }
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyW") KEY.moveU = false;
    if (e.code === "KeyS") KEY.moveD = false;
    if (e.code === "KeyA") KEY.moveL = false;
    if (e.code === "KeyD") KEY.moveR = false;
    KEY[e.code.toLowerCase()] = false;
  });
  $("title").addEventListener("click", () => { audio.unlock(); startGame(); });
  const reviveBtn = $("reviveBtn");
  const adBreakSkip = $("adBreakSkip");
  if (adBreakSkip) adBreakSkip.addEventListener("click", (e) => { e.stopPropagation(); cg.closeDemo(); });
  if (reviveBtn) {
    reviveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (S.state !== "dead") return;
      reviveBtn.hidden = true;
      cg.rewarded(() => {
        S.player.hp = Math.max(40, S.player.max * 0.45);
        S.player.ifr = 1.6;
        S.player.flash = 0.4;
        hide("dead");
        S.state = "play";
        say("BACK ON YOUR FEET", 1.8);
        syncHudBars();
        cg.gameplayStart();
        cg.context();
      }, () => {
        if (S.state === "dead") reviveBtn.hidden = false;
        say("NO AD AVAILABLE", 1.4);
      });
    });
  }

  let last = performance.now();
  function loop(now) {
    let dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (S.hitstop > 0) { S.hitstop -= dt; dt *= 0.18; }
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }
  window.addEventListener("resize", fitScreen);
  window.addEventListener("fullscreenchange", fitScreen);
  window.addEventListener("webkitfullscreenchange", fitScreen);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", fitScreen);
  if (navigator.keyboard && navigator.keyboard.addEventListener) {
    navigator.keyboard.addEventListener("layoutchange", labelMoveKeys);
  }
  labelMoveKeys();

  async function boot() {
    const sdk = cg.sdk();
    try {
      if (sdk && sdk.init) await sdk.init();
      cg.ready = !!sdk && cg.env() !== "disabled";
    } catch (e) {
      cg.ready = false;
    }
    cg.call((s) => s.game.loadingStart());
    fitScreen();
    fresh();
    cg.call((s) => {
      s.game.loadingStop();
      cg.applySettings(s.game.settings);
      if (s.game.addSettingsChangeListener) s.game.addSettingsChangeListener((st) => cg.applySettings(st));
    });
    cg.layoutRails();
    requestAnimationFrame(() => setTimeout(() => cg.requestBanners(), 160));
    requestAnimationFrame(loop);
  }
  boot();
})();
