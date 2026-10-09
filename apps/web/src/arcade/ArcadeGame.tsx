// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createGame, step, type GameState, type GameInput, type FighterStyle } from './engine';
import { loadAvatar, saveAvatar, normalizeAvatar, type AvatarConfig, DEFAULT_AVATAR } from './avatar';
import { sfx } from './audio';

export const ArcadeGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [game, setGame] = useState<GameState>(() => createGame('balanced'));
  const [avatar, setAvatar] = useState<AvatarConfig>(() => loadAvatar());
  const [style, setStyle] = useState<FighterStyle>('balanced');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showCustomizer, setShowCustomizer] = useState(false);

  const gameRef = useRef<GameState>(game);
  const avatarRef = useRef<AvatarConfig>(avatar);
  const activeInputRef = useRef<GameInput>({});
  const isPlayingRef = useRef(isPlaying);
  const isPausedRef = useRef(isPaused);
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    avatarRef.current = avatar;
    saveAvatar(avatar);
  }, [avatar]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
    isPausedRef.current = isPaused;
    soundEnabledRef.current = soundEnabled;
  }, [isPlaying, isPaused, soundEnabled]);

  const triggerInput = useCallback((key: keyof GameInput, pressed: boolean) => {
    activeInputRef.current[key] = pressed;
    if (pressed && soundEnabledRef.current) {
      if (key === 'jump') sfx.jump();
      else if (key === 'punch') sfx.punch();
      else if (key === 'blast') sfx.blast();
      else if (key === 'charge') sfx.charge();
      else if (key === 'transform') sfx.transform();
    }
  }, []);

  const handleStart = () => {
    const newGame = createGame(style);
    setGame(newGame);
    gameRef.current = newGame;
    setIsPlaying(true);
    setIsPaused(false);
  };

  const handlePause = () => {
    setIsPaused(prev => !prev);
  };

  // Keyboard controls listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'q' || key === 'a') {
        e.preventDefault();
        triggerInput('left', true);
      } else if (key === 'arrowright' || key === 'd') {
        e.preventDefault();
        triggerInput('right', true);
      } else if (key === ' ' || key === 'arrowup' || key === 'w') {
        e.preventDefault();
        triggerInput('jump', true);
      } else if (key === 'j') {
        e.preventDefault();
        triggerInput('punch', true);
      } else if (key === 'k') {
        e.preventDefault();
        triggerInput('blast', true);
      } else if (key === 'l') {
        e.preventDefault();
        triggerInput('charge', true);
      } else if (key === 't') {
        e.preventDefault();
        triggerInput('transform', true);
      } else if (key === 'p' && isPlayingRef.current) {
        e.preventDefault();
        handlePause();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'q' || key === 'a') triggerInput('left', false);
      else if (key === 'arrowright' || key === 'd') triggerInput('right', false);
      else if (key === ' ' || key === 'arrowup' || key === 'w') triggerInput('jump', false);
      else if (key === 'j') triggerInput('punch', false);
      else if (key === 'k') triggerInput('blast', false);
      else if (key === 'l') triggerInput('charge', false);
      else if (key === 't') triggerInput('transform', false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [triggerInput]);

  // Main Game Loop
  useEffect(() => {
    let animId: number;
    let lastTime = performance.now();

    const renderFighter = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      outfitColor: string,
      transformed: boolean,
      facing: number,
      cfg: AvatarConfig,
      isEnemy = false
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(facing * cfg.height, cfg.height);

      // Super aura when transformed
      if (transformed) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 235, 59, 0.25)';
        ctx.beginPath();
        ctx.ellipse(0, -32, 28 + Math.sin(Date.now() / 80) * 4, 46, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.ellipse(0, -32, 18, 38, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 2, 18, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body / Torso
      ctx.fillStyle = isEnemy ? '#e91e63' : outfitColor;
      ctx.beginPath();
      ctx.roundRect(-12, -44, 24, 28, 4);
      ctx.fill();

      // Belt
      ctx.fillStyle = '#212121';
      ctx.fillRect(-12, -22, 24, 4);

      // Head
      ctx.fillStyle = cfg.skin;
      ctx.beginPath();
      ctx.arc(0, -56, 12, 0, Math.PI * 2);
      ctx.fill();

      // Eye
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(4, -56, 2, 0, Math.PI * 2);
      ctx.fill();

      // Hair
      ctx.fillStyle = transformed ? '#ffeb3b' : cfg.hair;
      if (cfg.hairstyle === 'spiky') {
        ctx.beginPath();
        ctx.moveTo(-12, -60);
        ctx.lineTo(-18, -78);
        ctx.lineTo(-6, -68);
        ctx.lineTo(2, -84);
        ctx.lineTo(8, -68);
        ctx.lineTo(18, -76);
        ctx.lineTo(12, -58);
        ctx.fill();
      } else if (cfg.hairstyle === 'short') {
        ctx.beginPath();
        ctx.arc(0, -60, 13, Math.PI, 0);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(-6, -58);
        ctx.lineTo(0, -78);
        ctx.lineTo(6, -58);
        ctx.fill();
      }

      // Legs
      ctx.fillStyle = '#263238';
      ctx.fillRect(-10, -16, 8, 16);
      ctx.fillRect(2, -16, 8, 16);

      ctx.restore();
    };

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const g = gameRef.current;
      const cvs = canvasRef.current;

      if (cvs) {
        const ctx = cvs.getContext('2d');
        if (ctx) {
          if (isPlayingRef.current && !isPausedRef.current) {
            step(g, activeInputRef.current, dt);
            setGame({ ...g });
            if (g.status !== 'playing') {
              setIsPlaying(false);
            }
          }

          // Render 2D Scene
          ctx.clearRect(0, 0, 960, 400);

          // Sky gradient
          const skyGrad = ctx.createLinearGradient(0, 0, 0, 400);
          skyGrad.addColorStop(0, '#0d1b2a');
          skyGrad.addColorStop(0.6, '#1b263b');
          skyGrad.addColorStop(1, '#415a77');
          ctx.fillStyle = skyGrad;
          ctx.fillRect(0, 0, 960, 400);

          // Sun / Celestial Orb
          ctx.fillStyle = '#ffe082';
          ctx.beginPath();
          ctx.arc(800, 80, 36, 0, Math.PI * 2);
          ctx.fill();

          // Mountains
          ctx.fillStyle = '#102030';
          for (let i = 0; i < 9; i++) {
            ctx.beginPath();
            ctx.moveTo(i * 130 - 40, 320);
            ctx.lineTo(i * 130 + 50, 160 + (i % 3) * 35);
            ctx.lineTo(i * 130 + 160, 320);
            ctx.fill();
          }

          // Arena Platform
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(0, 320, 960, 80);
          ctx.fillStyle = '#38bdf8';
          ctx.fillRect(0, 320, 960, 4);

          // Player
          const p = g.player;
          renderFighter(
            ctx,
            p.x,
            p.y,
            avatarRef.current.outfit,
            p.transformed > 0,
            p.facing,
            avatarRef.current
          );

          // Enemies
          for (const e of g.enemies) {
            renderFighter(
              ctx,
              e.x,
              e.y,
              '#e11d48',
              false,
              Math.sign(p.x - e.x) || -1,
              { ...DEFAULT_AVATAR, skin: '#a855f7', height: 1.05 },
              true
            );

            // Enemy HP bar
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(e.x - 22, e.y - 75, 44, 6);
            ctx.fillStyle = '#ef4444';
            const maxHp = 35 + g.wave * 12;
            ctx.fillRect(e.x - 20, e.y - 74, Math.max(0, (40 * e.hp) / maxHp), 4);
          }

          // Projectiles
          for (const s of g.shots) {
            ctx.save();
            ctx.fillStyle = '#38bdf8';
            ctx.shadowColor = '#0ea5e9';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.ellipse(s.x, s.y, 14, 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-3xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline-variant)]">
        <div>
          <span className="text-xs font-bold tracking-wider uppercase text-[var(--md-sys-color-primary)]">
            Fused Monorepo Arcade & Web Engine
          </span>
          <h2 className="text-2xl font-black text-[var(--md-sys-color-on-surface)] flex items-center gap-2">
            <span>Dragon Pixel</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
              Age 1000 Edition
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2 rounded-full hover:bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] transition-colors"
            title={soundEnabled ? 'Mute SFX' : 'Enable SFX'}
          >
            {soundEnabled ? '🔊 Sound On' : '🔇 Muted'}
          </button>
          <button
            onClick={() => setShowCustomizer(!showCustomizer)}
            className="px-4 py-2 rounded-full border border-[var(--md-sys-color-outline)] text-[var(--md-sys-color-primary)] text-sm font-semibold hover:bg-[var(--md-sys-color-surface-container-highest)]"
          >
            {showCustomizer ? 'Close Studio' : 'Avatar Studio'}
          </button>
        </div>
      </div>

      {/* Avatar Studio Drawer */}
      {showCustomizer && (
        <div className="p-6 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in duration-200">
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Fighter Name
            </label>
            <input
              type="text"
              value={avatar.name}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, name: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Race
            </label>
            <select
              value={avatar.race}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, race: e.target.value as AvatarConfig['race'] }))}
              className="w-full px-3 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-sm"
            >
              <option value="saiyan">Saiyan</option>
              <option value="earthling">Earthling</option>
              <option value="namekian">Namekian</option>
              <option value="majin">Majin</option>
              <option value="frieza">Frieza</option>
              <option value="android">Android</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Hairstyle
            </label>
            <select
              value={avatar.hairstyle}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, hairstyle: e.target.value as AvatarConfig['hairstyle'] }))}
              className="w-full px-3 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-sm"
            >
              <option value="spiky">Spiky (Super)</option>
              <option value="short">Short</option>
              <option value="crest">Crest</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Combat Style
            </label>
            <select
              value={style}
              onChange={e => setStyle(e.target.value as FighterStyle)}
              className="w-full px-3 py-2 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)] text-sm"
            >
              <option value="balanced">Balanced (Equilibré)</option>
              <option value="speed">Speed (+30% Vitesse)</option>
              <option value="power">Power (+50% Dégâts)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Outfit Color
            </label>
            <input
              type="color"
              value={avatar.outfit}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, outfit: e.target.value }))}
              className="w-full h-10 rounded-xl cursor-pointer bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Hair Color
            </label>
            <input
              type="color"
              value={avatar.hair}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, hair: e.target.value }))}
              className="w-full h-10 rounded-xl cursor-pointer bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Skin Color
            </label>
            <input
              type="color"
              value={avatar.skin}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, skin: e.target.value }))}
              className="w-full h-10 rounded-xl cursor-pointer bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline)]"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-1">
              Height Ratio
            </label>
            <input
              type="range"
              min="80"
              max="120"
              value={Math.round(avatar.height * 100)}
              onChange={e => setAvatar(normalizeAvatar({ ...avatar, height: Number(e.target.value) / 100 }))}
              className="w-full mt-2"
            />
          </div>
        </div>
      )}

      {/* Main Arcade Viewport & HUD */}
      <div className="relative rounded-3xl overflow-hidden border-2 border-[var(--md-sys-color-outline)] shadow-2xl bg-black">
        {/* Top HUD */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center justify-between pointer-events-none z-10 bg-gradient-to-b from-black/80 to-transparent">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-white/70">{avatar.name}</span>
              <div className="w-36 h-3.5 bg-black/60 rounded-full border border-white/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-150"
                  style={{ width: `${game.player.hp}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-bold text-cyan-300">Energy (Ki)</span>
              <div className="w-36 h-3.5 bg-black/60 rounded-full border border-white/20 overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-all duration-150"
                  style={{ width: `${game.player.energy}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-white text-sm font-bold">
            <span className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10">
              Wave {game.wave} / 5
            </span>
            <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              Score: {game.score.toLocaleString()}
            </span>
            {game.player.transformed > 0 && (
              <span className="px-3 py-1 rounded-full bg-yellow-400 text-black font-extrabold animate-pulse">
                SUPER {Math.ceil(game.player.transformed)}s
              </span>
            )}
          </div>
        </div>

        {/* Canvas Arena */}
        <canvas
          ref={canvasRef}
          width={960}
          height={400}
          className="w-full h-auto block aspect-[960/400]"
        />

        {/* Overlay when game over or not started */}
        {(!isPlaying || isPaused) && (
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 text-white p-6 z-20">
            {game.status === 'won' ? (
              <div className="text-center">
                <h3 className="text-4xl font-black text-amber-400 mb-2">VICTOIRE !</h3>
                <p className="text-lg text-white/80">
                  Les 5 vagues sont repoussées. Score final : <span className="font-bold text-cyan-300">{game.score}</span>
                </p>
              </div>
            ) : game.status === 'lost' ? (
              <div className="text-center">
                <h3 className="text-4xl font-black text-rose-500 mb-2">DÉFAITE</h3>
                <p className="text-lg text-white/80">
                  Tu es tombé au combat. Score : <span className="font-bold text-cyan-300">{game.score}</span>
                </p>
              </div>
            ) : isPaused ? (
              <div className="text-center">
                <h3 className="text-3xl font-black text-cyan-300 mb-2">PARTIE EN PAUSE</h3>
                <p className="text-sm text-white/70">Appuie sur P ou clique sur Reprendre.</p>
              </div>
            ) : (
              <div className="text-center">
                <h3 className="text-3xl font-black mb-2">ARÈNE DRAGON PIXEL</h3>
                <p className="text-sm text-white/70 max-w-md">
                  Combats 5 vagues d'adversaires, charge ton énergie, déclenche ta transformation Super et enchaîne les combos.
                </p>
              </div>
            )}

            <div className="flex gap-4">
              {isPaused ? (
                <button
                  onClick={handlePause}
                  className="px-6 py-3 rounded-full bg-cyan-500 hover:bg-cyan-400 text-black font-extrabold text-base transition-transform active:scale-95"
                >
                  Reprendre
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  className="px-8 py-3 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-black font-black text-lg transition-transform active:scale-95 shadow-lg"
                >
                  {game.status !== 'playing' && game.wave > 0 ? 'Rejouer' : 'Combattre'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* On-Screen Touch / Button Controls & Keyboard Guide */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Interactive Virtual Controls */}
        <div className="p-4 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]">
          <span className="text-xs font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase block mb-3">
            Touch & Click Controls
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <button
                onMouseDown={() => triggerInput('left', true)}
                onMouseUp={() => triggerInput('left', false)}
                onTouchStart={() => triggerInput('left', true)}
                onTouchEnd={() => triggerInput('left', false)}
                className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline)] font-black text-lg active:bg-[var(--md-sys-color-primary)] active:text-[var(--md-sys-color-on-primary)]"
              >
                ◀
              </button>
              <button
                onMouseDown={() => triggerInput('right', true)}
                onMouseUp={() => triggerInput('right', false)}
                onTouchStart={() => triggerInput('right', true)}
                onTouchEnd={() => triggerInput('right', false)}
                className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline)] font-black text-lg active:bg-[var(--md-sys-color-primary)] active:text-[var(--md-sys-color-on-primary)]"
              >
                ▶
              </button>
              <button
                onMouseDown={() => triggerInput('jump', true)}
                onMouseUp={() => triggerInput('jump', false)}
                onTouchStart={() => triggerInput('jump', true)}
                onTouchEnd={() => triggerInput('jump', false)}
                className="w-12 h-12 rounded-2xl bg-[var(--md-sys-color-surface-container-high)] border border-[var(--md-sys-color-outline)] font-black text-sm active:bg-[var(--md-sys-color-primary)] active:text-[var(--md-sys-color-on-primary)]"
              >
                Jump
              </button>
            </div>

            <div className="flex gap-2">
              <button
                onMouseDown={() => triggerInput('punch', true)}
                onMouseUp={() => triggerInput('punch', false)}
                onTouchStart={() => triggerInput('punch', true)}
                onTouchEnd={() => triggerInput('punch', false)}
                className="px-4 h-12 rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-sm active:bg-amber-500 active:text-black"
              >
                Punch (J)
              </button>
              <button
                onMouseDown={() => triggerInput('blast', true)}
                onMouseUp={() => triggerInput('blast', false)}
                onTouchStart={() => triggerInput('blast', true)}
                onTouchEnd={() => triggerInput('blast', false)}
                className="px-4 h-12 rounded-2xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold text-sm active:bg-cyan-500 active:text-black"
              >
                Blast (K)
              </button>
              <button
                onMouseDown={() => triggerInput('charge', true)}
                onMouseUp={() => triggerInput('charge', false)}
                onTouchStart={() => triggerInput('charge', true)}
                onTouchEnd={() => triggerInput('charge', false)}
                className="px-4 h-12 rounded-2xl bg-blue-500/20 text-blue-300 border border-blue-500/40 font-bold text-sm active:bg-blue-500 active:text-black"
              >
                Charge (L)
              </button>
              <button
                onMouseDown={() => triggerInput('transform', true)}
                onMouseUp={() => triggerInput('transform', false)}
                onTouchStart={() => triggerInput('transform', true)}
                onTouchEnd={() => triggerInput('transform', false)}
                className="px-4 h-12 rounded-2xl bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 font-bold text-sm active:bg-yellow-400 active:text-black"
              >
                Super (T)
              </button>
            </div>
          </div>
        </div>

        {/* Keyboard and Gamepad Map */}
        <div className="p-4 rounded-3xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] flex flex-col justify-center text-xs text-[var(--md-sys-color-on-surface-variant)] space-y-1.5">
          <span className="font-bold text-[var(--md-sys-color-on-surface)] uppercase">
            Clavier & Manette
          </span>
          <div className="flex justify-between">
            <span>Déplacement :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">◀ ▶ / Q D / Stick Gauche</span>
          </div>
          <div className="flex justify-between">
            <span>Sauter :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">Espace / Bouton A</span>
          </div>
          <div className="flex justify-between">
            <span>Attaque Poing :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">J / Bouton X</span>
          </div>
          <div className="flex justify-between">
            <span>Projectile Kikoha :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">K / Bouton B</span>
          </div>
          <div className="flex justify-between">
            <span>Charge d'énergie :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">L / Bouton Y</span>
          </div>
          <div className="flex justify-between">
            <span>Transformation (80 Ki) :</span>
            <span className="font-mono font-semibold text-[var(--md-sys-color-on-surface)]">T / Gâchette LB</span>
          </div>
        </div>
      </div>
    </div>
  );
};
