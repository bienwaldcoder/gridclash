import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronRight,
  ClipboardList,
  Crown,
  Eye,
  HelpCircle,
  Layers,
  Menu,
  RotateCcw,
  Settings,
  Shuffle,
  Sparkles,
  Trophy,
  Undo2,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import {
  type Cell,
  type GameState,
  clonePlayers,
  completeTurn,
  createRound,
  determineStarter,
  drawFromDeck,
  emptyGame,
  getCardLabel,
  replaceGridCard,
  revealGridCard,
  sortByTotal,
  unrevealedCount,
  visibleScore,
} from "./game";
import { type AiLevel, type AiTurnPlan, think } from "./ai/engine";

type SettingsState = { aiCount: number; targetScore: number; difficulty: AiLevel };
type Sfx = "draw" | "flip" | "replace" | "clear" | "win" | "lose" | "shuffle";

type CardPalette = { from: string; via: string; to: string; text: string };

// GridClash 12 modern color palette. Each numeric band gets a distinct,
// original gradient so the game does not visually copy any physical card set.
function getCardPalette(value: number): CardPalette {
  if (value < 0) return { from: "#FB7185", via: "#EF4444", to: "#DC2626", text: "#ffffff" }; // warm coral / soft red
  if (value === 0) return { from: "#94A3B8", via: "#64748B", to: "#475569", text: "#ffffff" }; // neutral slate / cool grey
  if (value <= 4) return { from: "#34D399", via: "#10B981", to: "#059669", text: "#04231d" }; // emerald / bright mint
  if (value <= 8) return { from: "#FCD34D", via: "#F59E0B", to: "#D97706", text: "#3a2400" }; // amber / warm gold
  return { from: "#A5B4FC", via: "#6366F1", to: "#4338CA", text: "#ffffff" }; // deep indigo / purple
}

function cardGradientStyle(value: number) {
  const palette = getCardPalette(value);
  return {
    backgroundImage: `linear-gradient(135deg, ${palette.from} 0%, ${palette.via} 55%, ${palette.to} 100%)`,
    color: palette.text,
  } as const;
}

function applyAiPlan(state: GameState, playerIndex: number, plan: AiTurnPlan): GameState {
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  if (plan.source === "discard") {
    const top = state.discard[state.discard.length - 1];
    if (!top) return state;
    const discard = state.discard.slice(0, -1);
    const replaced = replaceGridCard(player, plan.replaceIndex, top);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...discard, replaced.oldCard] : discard;
    return completeTurn(
      state,
      players,
      state.deck,
      nextDiscard,
      playerIndex,
      plan.reason,
      replaced.columns.length ? { playerName: player.name, columns: replaced.columns } : undefined,
    );
  }
  const drawn = drawFromDeck(state.deck, state.discard);
  if (!drawn.card) return { ...state, message: "The deck and discard pile are both empty. No action was taken." };
  if (plan.useDrawn) {
    const replaced = replaceGridCard(player, plan.replaceIndex, drawn.card);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...drawn.discard, replaced.oldCard] : drawn.discard;
    return completeTurn(
      state,
      players,
      drawn.deck,
      nextDiscard,
      playerIndex,
      plan.reason,
      replaced.columns.length ? { playerName: player.name, columns: replaced.columns } : undefined,
    );
  }
  const revealed = revealGridCard(player, plan.revealIndex);
  players[playerIndex] = revealed.player;
  return completeTurn(
    state,
    players,
    drawn.deck,
    [...drawn.discard, drawn.card],
    playerIndex,
    plan.reason,
    revealed.columns.length ? { playerName: player.name, columns: revealed.columns } : undefined,
  );
}

function runAiTurn(state: GameState, level: AiLevel): GameState {
  const plan = think(state, state.currentPlayer, level);
  return applyAiPlan(state, state.currentPlayer, plan);
}

function CardTile({
  cell,
  valueOverride,
  active,
  selected,
  compact = false,
  onClick,
}: {
  cell?: Cell;
  valueOverride?: number;
  active?: boolean;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const card = valueOverride !== undefined ? { value: valueOverride } : cell?.card;
  const isFaceUp = valueOverride !== undefined || Boolean(cell?.revealed);
  const isCleared = cell?.cleared || (!card && cell);
  const sizeClass = compact
    ? "h-10 w-7 text-xs sm:h-12 sm:w-9"
    : "h-[clamp(4.5rem,15vh,7.5rem)] w-[clamp(3rem,9vw,5rem)] text-3xl sm:text-4xl";

  if (isCleared) {
    return (
      <div className={`${sizeClass} rounded-xl border border-dashed border-white/20 bg-white/5 text-white/20`} aria-label="Cleared card slot" />
    );
  }

  const aura = active
    ? "absolute -inset-1 rounded-2xl bg-cyan-300/70 blur-md"
    : selected
      ? "absolute -inset-1.5 rounded-2xl bg-amber-300/90 blur-none animate-pulse shadow-[0_0_24px_rgba(252,211,77,0.9)]"
      : "";

  const fancy = !compact;

  const frontFace = (
    <span
      style={card ? cardGradientStyle(card.value) : undefined}
      className={`absolute inset-0 flex items-center justify-center rounded-xl border font-black tracking-tight shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)] ${selected ? "border-amber-200 ring-2 ring-amber-300" : "border-white/40"} ${card ? "" : "bg-slate-700 text-white"}`}
    >
      <span className="absolute inset-1 rounded-lg border border-white/20" />
      {fancy && card ? (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl" style={{ background: "linear-gradient(115deg, transparent 16%, rgba(255,255,255,0.28) 19.5%, transparent 26%, transparent 74%, rgba(255,255,255,0.15) 78.5%, transparent 85%)" }} />
      ) : null}
      <span style={fancy && card ? { textShadow: "0 1px 0 rgba(0,0,0,0.22), 0 2px 2px rgba(0,0,0,0.25), 0 4px 6px rgba(0,0,0,0.28), 0 8px 16px rgba(0,0,0,0.35)" } : undefined}>{card ? getCardLabel(card.value) : ""}</span>
    </span>
  );

  const backFace = (
    <span className={`absolute inset-0 flex items-center justify-center rounded-xl border border-sky-200/30 bg-gradient-to-br from-slate-950 via-sky-950 to-indigo-900 shadow-lg shadow-black/25 [backface-visibility:hidden] ${selected ? "ring-2 ring-amber-300" : ""}`}>
      <span className="absolute inset-1 rounded-lg border border-white/10" />
      {selected ? <Eye className="h-5 w-5 text-amber-200" /> : <Sparkles className="h-5 w-5 text-cyan-200/80" />}
    </span>
  );

  const body = (
    <>
      {aura ? <span className={aura} /> : null}
      <span
        className={`relative block h-full w-full rounded-xl transition-transform duration-500 [transform-style:preserve-3d] ${isFaceUp ? "[transform:rotateY(180deg)]" : "[transform:rotateY(0deg)]"} ${onClick ? "group-hover:-translate-y-1" : ""}`}
      >
        {backFace}
        {frontFace}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div
        className={`${sizeClass} group relative shrink-0 [perspective:900px] cursor-default`}
        aria-label={isFaceUp && card ? `Card ${getCardLabel(card.value)}` : "Face-down card"}
      >
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${sizeClass} group relative shrink-0 cursor-pointer [perspective:900px]`}
      aria-label={isFaceUp && card ? `Card ${getCardLabel(card.value)}` : "Face-down card"}
    >
      {body}
    </button>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const rows = [
    {
      icon: <Crown className="h-4 w-4" />,
      title: "Goal",
      text: "Keep your grid score as low as possible. The match ends when a player reaches the target score — the lowest total wins.",
    },
    {
      icon: <Layers className="h-4 w-4" />,
      title: "Opening",
      text: "Each player gets 12 face-down cards in a 4×3 grid. Reveal exactly two cards of your choice; the highest visible total takes the first turn.",
    },
    {
      icon: <Zap className="h-4 w-4" />,
      title: "Your turn",
      text: "Draw from the deck or take the top card of the discard pile. The discard pile forces you to replace a grid card. Drawing lets you replace a grid card — or discard the drawn card and reveal one face-down card instead.",
    },
    {
      icon: <Sparkles className="h-4 w-4" />,
      title: "Discards feed opponents",
      text: "The card you replace lands face-up on top of the discard pile — the next player may take it. Be careful not to hand them the card that completes one of their columns.",
    },
    {
      icon: <Eye className="h-4 w-4" />,
      title: "Column clears",
      text: "When all three cards in a column are face-up and equal, the column is removed. Positive clears shrink your score; negative clears remove negative points.",
    },
    {
      icon: <ClipboardList className="h-4 w-4" />,
      title: "End of round",
      text: "A round ends as soon as a player has revealed every card. Every other player gets one final turn, then scores are applied. If the player who ended the round is not the strictly lowest score and their raw score is positive, it is doubled.",
    },
    {
      icon: <Trophy className="h-4 w-4" />,
      title: "Scoring",
      text: "Your score is the sum of your grid values — negative cards subtract. Low score wins.",
    },
    {
      icon: <Undo2 className="h-4 w-4" />,
      title: "Undo",
      text: "Undo takes back your last move — but only while you have not gained an information advantage. Once you have revealed a face-down card (or replaced a face-down one), the move is locked in.",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="How to play"
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-[2rem] border border-white/10 bg-slate-950 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-3 text-2xl font-black"><HelpCircle className="h-6 w-6 text-cyan-300" /> How to play</h2>
          <button type="button" onClick={onClose} className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close instructions">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-5 space-y-4">
          {rows.map((row) => (
            <div key={row.title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <span className="mt-0.5 shrink-0 text-cyan-200">{row.icon}</span>
              <div>
                <p className="font-black">{row.title}</p>
                <p className="mt-1 text-sm leading-6 text-white/65">{row.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function GridClash12() {
  const [settings, setSettings] = useState<SettingsState>({ aiCount: 3, targetScore: 100, difficulty: "hard" });
  const [game, setGame] = useState<GameState>(emptyGame);
  const [initialPicks, setInitialPicks] = useState<number[]>([]);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Snapshot of the state at the start of the human's current turn. Used for undo,
  // which is only offered while the turn has not revealed any face-down card
  // (peeking would be an information advantage).
  const [history, setHistory] = useState<{ state: GameState; revealInfo: boolean } | null>(null);
  const skipHistoryRef = useRef(false);
  const audioRef = useRef<AudioContext | null>(null);

  const currentPlayer = game.players[game.currentPlayer];
  const human = game.players[0];
  const discardTop = game.discard[game.discard.length - 1] ?? null;
  const winner = useMemo(() => (game.players.length ? sortByTotal(game.players)[0] : null), [game.players]);

  const playSound = useCallback(
    (kind: Sfx) => {
      if (!soundEnabled || typeof window === "undefined") return;
      const audioWindow = window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
      const AudioCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
      if (!AudioCtor) return;

      const context = audioRef.current ?? new AudioCtor();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();
      const now = context.currentTime;
      const sequences: Record<Sfx, { freq: number; start: number; length: number; type: OscillatorType; gain: number }[]> = {
        draw: [{ freq: 280, start: 0, length: 0.08, type: "triangle", gain: 0.05 }],
        flip: [{ freq: 520, start: 0, length: 0.09, type: "sine", gain: 0.045 }],
        replace: [
          { freq: 220, start: 0, length: 0.07, type: "square", gain: 0.035 },
          { freq: 440, start: 0.06, length: 0.09, type: "triangle", gain: 0.04 },
        ],
        clear: [
          { freq: 620, start: 0, length: 0.08, type: "sine", gain: 0.05 },
          { freq: 780, start: 0.07, length: 0.1, type: "sine", gain: 0.045 },
          { freq: 980, start: 0.15, length: 0.14, type: "sine", gain: 0.035 },
        ],
        win: [
          { freq: 392, start: 0, length: 0.12, type: "triangle", gain: 0.05 },
          { freq: 523, start: 0.11, length: 0.14, type: "triangle", gain: 0.05 },
          { freq: 659, start: 0.24, length: 0.22, type: "triangle", gain: 0.045 },
        ],
        lose: [
          { freq: 300, start: 0, length: 0.12, type: "sawtooth", gain: 0.035 },
          { freq: 220, start: 0.13, length: 0.2, type: "sawtooth", gain: 0.03 },
        ],
        shuffle: [
          { freq: 180, start: 0, length: 0.05, type: "triangle", gain: 0.03 },
          { freq: 260, start: 0.05, length: 0.06, type: "triangle", gain: 0.035 },
          { freq: 340, start: 0.1, length: 0.08, type: "triangle", gain: 0.04 },
        ],
      };

      sequences[kind].forEach((note) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = note.type;
        oscillator.frequency.setValueAtTime(note.freq, now + note.start);
        gain.gain.setValueAtTime(0.0001, now + note.start);
        gain.gain.exponentialRampToValueAtTime(note.gain, now + note.start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.start + note.length);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now + note.start);
        oscillator.stop(now + note.start + note.length + 0.03);
      });
    },
    [soundEnabled],
  );

  useEffect(() => {
    if (game.phase !== "chooseSource" || !currentPlayer || currentPlayer.isHuman) return;
    const timer = window.setTimeout(() => {
      playSound("draw");
      setGame((previous) => {
        const active = previous.players[previous.currentPlayer];
        if (previous.phase !== "chooseSource" || !active || active.isHuman) return previous;
        return runAiTurn(previous, settings.difficulty);
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [currentPlayer, game.phase, playSound, settings.difficulty]);

  // Snapshot the start of every human turn so a move that peeked at no face-down
  // card can be undone. A restored state must never be re-snapshotted.
  useEffect(() => {
    const isHumanTurn = game.phase === "chooseSource" && game.players[game.currentPlayer]?.isHuman;
    if (!isHumanTurn) {
      skipHistoryRef.current = false;
      return;
    }
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      return;
    }
    setHistory({ state: game, revealInfo: false });
  }, [game.phase, game.currentPlayer]);

  useEffect(() => {
    if (game.clearPulse > 0) playSound("clear");
  }, [game.clearPulse, playSound]);

  useEffect(() => {
    if (game.roundEndPulse === 0) return;
    if (game.phase === "gameOver") {
      playSound(winner?.isHuman ? "win" : "lose");
      return;
    }
    const bestRound = Math.min(...game.players.map((player) => player.roundScore));
    playSound(human?.roundScore === bestRound ? "win" : "lose");
  }, [game.roundEndPulse, game.phase, game.players, human?.roundScore, playSound, winner?.isHuman]);

  const startGame = () => {
    setInitialPicks([]);
    setScoreOpen(false);
    setHistory(null);
    setGame(createRound(settings.aiCount, settings.targetScore, 1));
    playSound("shuffle");
  };

  const startNextRound = () => {
    const totals = Object.fromEntries(game.players.map((player) => [player.id, player.total]));
    setInitialPicks([]);
    setHistory(null);
    setGame(createRound(game.players.length - 1, game.targetScore, game.roundNumber + 1, totals, game.roundHistory));
    playSound("draw");
  };

  const resetToSetup = () => {
    setInitialPicks([]);
    setScoreOpen(false);
    setHelpOpen(false);
    setHistory(null);
    setGame(emptyGame);
  };

  const toggleInitialPick = (index: number) => {
    if (game.phase !== "initialReveal") return;
    playSound("flip");
    setInitialPicks((picks) => {
      if (picks.includes(index)) return picks.filter((item) => item !== index);
      if (picks.length >= 2) return picks;
      return [...picks, index];
    });
  };

  const confirmInitialReveal = () => {
    if (initialPicks.length !== 2) return;
    setGame((previous) => {
      if (previous.phase !== "initialReveal") return previous;
      const players = clonePlayers(previous.players);
      initialPicks.forEach((index) => {
        players[0].grid[index] = { ...players[0].grid[index], revealed: true };
      });
      const starter = determineStarter(players);
      return {
        ...previous,
        phase: "chooseSource",
        players,
        currentPlayer: starter,
        message: `${players[starter].name} has the highest opening total and starts the round.`,
      };
    });
    setInitialPicks([]);
    playSound("flip");
  };

  const undoTurnDecision = () => {
    if (!history || history.revealInfo) return;
    skipHistoryRef.current = true;
    setGame(history.state);
    setHistory(null);
    playSound("flip");
  };

  const drawSource = (source: "deck" | "discard") => {
    if (game.phase !== "chooseSource" || !currentPlayer?.isHuman) return;
    if (source === "discard") {
      if (!discardTop) return;
      setGame((previous) => ({
        ...previous,
        phase: "replaceChoice",
        discard: previous.discard.slice(0, -1),
        pendingCard: previous.discard[previous.discard.length - 1],
        pendingSource: "discard",
        message: `You took ${getCardLabel(previous.discard[previous.discard.length - 1].value)} from discard. Replace any grid card.`,
      }));
      playSound("draw");
      return;
    }
    setGame((previous) => {
      const drawn = drawFromDeck(previous.deck, previous.discard);
      if (!drawn.card) return { ...previous, message: "No cards are available to draw." };
      return {
        ...previous,
        phase: "drawDecision",
        deck: drawn.deck,
        discard: drawn.discard,
        pendingCard: drawn.card,
        pendingSource: "deck",
        message: `You drew ${getCardLabel(drawn.card.value)}. Replace a grid card, or discard it and reveal one hidden card.`,
      };
    });
    playSound("draw");
  };

  const chooseReplaceAfterDeckDraw = () => {
    if (game.phase !== "drawDecision" || !game.pendingCard) return;
    setGame((previous) => ({ ...previous, phase: "replaceChoice", message: "Choose the grid card to replace." }));
  };

  const discardDrawnAndReveal = () => {
    if (game.phase !== "drawDecision" || !game.pendingCard) return;
    setGame((previous) => ({
      ...previous,
      phase: "revealChoice",
      discard: previous.pendingCard ? [...previous.discard, previous.pendingCard] : previous.discard,
      pendingCard: null,
      pendingSource: null,
      message: "Choose one face-down card to reveal.",
    }));
    playSound("draw");
  };

  const markRevealInfo = () => {
    setHistory((previous) => (previous ? { ...previous, revealInfo: true } : previous));
  };

  const handleHumanCellClick = (index: number) => {
    if (!human) return;
    if (game.phase === "initialReveal") {
      toggleInitialPick(index);
      return;
    }
    if (!currentPlayer?.isHuman || game.currentPlayer !== 0) return;

    if (game.phase === "replaceChoice" && game.pendingCard && human.grid[index].card) {
      const replacedHidden = human.grid[index].card ? !human.grid[index].revealed : false;
      setGame((previous) => {
        const players = clonePlayers(previous.players);
        const card = previous.pendingCard;
        if (!card) return previous;
        const replaced = replaceGridCard(players[0], index, card);
        players[0] = replaced.player;
        const discard = replaced.oldCard ? [...previous.discard, replaced.oldCard] : previous.discard;
        return completeTurn(
          previous,
          players,
          previous.deck,
          discard,
          0,
          `You replaced a card with ${getCardLabel(card.value)}.`,
          replaced.columns.length ? { playerName: "You", columns: replaced.columns } : undefined,
        );
      });
      if (replacedHidden) markRevealInfo();
      playSound("replace");
      return;
    }

    if (game.phase === "revealChoice" && human.grid[index].card && !human.grid[index].revealed) {
      setGame((previous) => {
        const players = clonePlayers(previous.players);
        const revealed = revealGridCard(players[0], index);
        players[0] = revealed.player;
        return completeTurn(
          previous,
          players,
          previous.deck,
          previous.discard,
          0,
          "You revealed a hidden card.",
          revealed.columns.length ? { playerName: "You", columns: revealed.columns } : undefined,
        );
      });
      markRevealInfo();
      playSound("flip");
    }
  };

  const humanCanTarget = (index: number) => {
    if (!human) return false;
    if (game.phase === "initialReveal") return Boolean(human.grid[index].card);
    if (!currentPlayer?.isHuman || game.currentPlayer !== 0) return false;
    if (game.phase === "replaceChoice") return Boolean(human.grid[index].card);
    if (game.phase === "revealChoice") return Boolean(human.grid[index].card && !human.grid[index].revealed);
    return false;
  };

  const renderScorePanel = (modal = false) => (
    <aside className={`${modal ? "fixed inset-y-0 right-0 z-50 w-full max-w-sm" : "hidden w-72 shrink-0 xl:block"} border-l border-white/10 bg-slate-950/95 p-5 text-white shadow-2xl backdrop-blur-xl`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-cyan-300">Permanent scoreboard</p>
          <h2 className="mt-1 text-2xl font-black">Race to {game.targetScore || settings.targetScore}</h2>
        </div>
        {modal ? (
          <button type="button" onClick={() => setScoreOpen(false)} className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white" aria-label="Close scoreboard">
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {sortByTotal(game.players).map((player, index) => (
          <div key={player.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-black ${index === 0 ? "bg-amber-300 text-slate-950" : "bg-white/10 text-white"}`}>{index + 1}</span>
                <div>
                  <p className="font-bold">{player.name}</p>
                  <p className="text-xs text-white/50">Round {player.roundScore ? `${player.roundScore} pts` : "pending"}{player.penalty ? " with penalty" : ""}</p>
                </div>
              </div>
              <p className="text-2xl font-black tabular-nums">{player.total}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.25em] text-white/50"><ClipboardList className="h-4 w-4" /> History</h3>
        <div className="max-h-64 space-y-3 overflow-auto pr-1">
          {game.roundHistory.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/55">Completed rounds will stay here for the whole match.</p>
          ) : (
            [...game.roundHistory].reverse().map((record) => (
              <div key={record.round} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="mb-3 text-sm font-bold text-cyan-200">Round {record.round}</p>
                <div className="space-y-2 text-sm text-white/70">
                  {record.scores.map((score) => (
                    <div key={score.playerId} className="flex items-center justify-between gap-3">
                      <span>{score.name}</span>
                      <span className="font-semibold tabular-nums text-white">{score.applied} / {score.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );

  if (game.phase === "setup") {
    return (
      <>
        <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.22),transparent_26%),linear-gradient(135deg,#07111f,#0f172a_45%,#020617)]" />
        <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-5 py-6 sm:px-8">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-200/10 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-lg shadow-cyan-950/20"><Sparkles className="h-4 w-4" /> Strategic browser edition</div>
            <h1 className="text-5xl font-black tracking-tight sm:text-7xl">GridClash <span className="text-cyan-300">12</span></h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">Race to keep your face-up grid as low as possible. Flip, swap, and clear matching columns across multiple rounds while a thinking AI table weighs the odds against you. Lowest total when someone hits the target loses the least — and wins the match.</p>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-5">
              <div className="flex items-center gap-3 text-cyan-100"><Settings className="h-5 w-5" /><h2 className="text-lg font-black uppercase tracking-[0.25em]">Game setup</h2></div>
              <div className="mt-5 space-y-5">
                <label className="block">
                  <span className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-200"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> AI opponents</span><span className="text-cyan-200">{settings.aiCount}</span></span>
                  <input type="range" min={1} max={7} value={settings.aiCount} onChange={(event) => setSettings((current) => ({ ...current, aiCount: Number(event.target.value) }))} className="h-2 w-full accent-cyan-300" />
                </label>

                <div>
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Trophy className="h-4 w-4" /> Target score</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[50, 100, 150].map((target) => (
                      <button key={target} type="button" onClick={() => setSettings((current) => ({ ...current, targetScore: target }))} className={`rounded-2xl border px-4 py-3 text-lg font-black transition ${settings.targetScore === target ? "border-cyan-200 bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-950/25" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}>{target}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Brain className="h-4 w-4" /> AI difficulty</p>
                  <div className="grid grid-cols-3 gap-3">
                    {(["easy", "medium", "hard"] as const).map((difficulty) => (
                      <button key={difficulty} type="button" onClick={() => setSettings((current) => ({ ...current, difficulty }))} className={`rounded-2xl border px-4 py-3 text-lg font-black transition ${settings.difficulty === difficulty ? "border-cyan-200 bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-950/25" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}>{difficulty === "easy" ? "Easy" : difficulty === "medium" ? "Medium" : "Hard"}</button>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={startGame} className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-6 py-4 text-lg font-black text-slate-950 shadow-2xl shadow-cyan-950/30 transition hover:scale-[1.02]">Deal round 1 <ChevronRight className="h-5 w-5 transition group-hover:translate-x-1" /></button>
                <button type="button" onClick={() => setHelpOpen(true)} className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-3 text-base font-black text-white transition hover:bg-white/10"><HelpCircle className="h-5 w-5 text-cyan-200" /> How to play</button>
              </div>
            </div>

            <div className="relative min-h-72 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-violet-500/20 p-6 shadow-2xl shadow-black/20">
              <div className="absolute inset-x-10 top-8 grid grid-cols-4 gap-3 opacity-80 rotate-[-8deg]">
                {[-2, 0, 4, 9, -1, 2, 7, 12].map((value, index) => <CardTile key={`${value}-${index}`} valueOverride={value} compact />)}
              </div>
              <div className="absolute bottom-6 left-6 right-6 rounded-3xl border border-white/10 bg-slate-950/70 p-5 backdrop-blur-md">
                <div className="flex items-center gap-3 text-emerald-200"><Brain className="h-5 w-5" /><p className="font-black">AI strategy engine</p></div>
                <p className="mt-2 text-sm leading-6 text-slate-300">Opponents count the deck, chase column clears, avoid risky finishes, and run Monte-Carlo simulations to weigh every move. Hard plays a much deeper game than Easy.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      {helpOpen ? <HelpModal onClose={() => setHelpOpen(false)} /> : null}
      </>
    );
  }

  const isHumanTurn = currentPlayer?.isHuman && game.currentPlayer === 0;
  const canChoosePile = game.phase === "chooseSource" && isHumanTurn;
  const canDrawFromDeck = canChoosePile && (game.deck.length > 0 || game.discard.length > 1);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(34,211,238,0.25),transparent_28%),radial-gradient(circle_at_20%_90%,rgba(16,185,129,0.18),transparent_24%),linear-gradient(135deg,#020617,#0f172a_45%,#052e2b)]" />
      <div className="relative flex min-h-screen">
        <section className="flex min-w-0 flex-1 flex-col px-3 py-3 sm:px-5 lg:px-6">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.05] px-4 py-2.5 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-950/20"><Sparkles className="h-6 w-6" /></div>
              <div><p className="text-xl font-black tracking-tight">GridClash <span className="text-cyan-300">12</span></p><p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Round {game.roundNumber}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {history && !history.revealInfo ? (
                <button type="button" onClick={undoTurnDecision} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white" aria-label="Undo your last move">
                  <Undo2 className="h-4 w-4" /> Undo
                </button>
              ) : null}
              <button type="button" onClick={() => setSoundEnabled((enabled) => !enabled)} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white/75 transition hover:bg-white/10 hover:text-white" aria-label="Toggle sound">{soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
              <button type="button" onClick={() => setHelpOpen(true)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white"><HelpCircle className="h-4 w-4" /> How to play</button>
              <button type="button" onClick={() => setScoreOpen(true)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white xl:hidden"><Menu className="h-4 w-4" /> Scores</button>
              <button type="button" onClick={resetToSetup} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white"><RotateCcw className="h-4 w-4" /> New game</button>
            </div>
          </header>

          <div className="mt-3 grid flex-1 min-h-0 gap-3 xl:grid-cols-[1.5fr_1fr]">
            <div className="order-1 flex min-h-0 flex-col gap-3">
              <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-3 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="flex items-center gap-2 text-lg font-black">You {game.endingPlayerId === "human" ? <Crown className="h-4 w-4 text-amber-300" /> : null}</p><p className="text-xs text-white/55">Visible {human ? visibleScore(human) : 0} | Hidden {human ? unrevealedCount(human) : 0} | Match total {human?.total ?? 0}</p></div>
                  {game.phase === "initialReveal" ? <button type="button" onClick={confirmInitialReveal} disabled={initialPicks.length !== 2} className="rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition enabled:hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">Reveal {initialPicks.length}/2 and start</button> : null}
                  {game.phase === "roundOver" ? <button type="button" onClick={startNextRound} className="rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100">Deal next round</button> : null}
                  {game.phase === "gameOver" ? <div className="flex items-center gap-3 rounded-2xl bg-amber-300 px-5 py-3 font-black text-slate-950"><Trophy className="h-5 w-5" /> {winner?.name} wins</div> : null}
                </div>

                {game.phase === "initialReveal" ? (
                  <div className="mx-auto mb-3 flex max-w-[22rem] items-center gap-3 rounded-2xl border border-amber-200/40 bg-amber-200/10 px-4 py-2.5 text-sm font-bold text-amber-100 sm:max-w-[28rem]">
                    <Eye className="h-5 w-5 shrink-0" /> Choose exactly two face-down cards to reveal. The highest visible total takes the first turn.
                  </div>
                ) : null}

                <div className="mx-auto grid max-w-[26rem] grid-cols-4 justify-center gap-2 sm:max-w-[36rem] sm:gap-3">
                  {human?.grid.map((cell, index) => (
                    <CardTile key={`human-${index}-${cell.card?.id ?? "clear"}`} cell={cell} active={humanCanTarget(index)} selected={game.phase === "initialReveal" && initialPicks.includes(index)} onClick={humanCanTarget(index) ? () => handleHumanCellClick(index) : undefined} />
                  ))}
                </div>
              </section>

              <section className="grid min-h-0 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]">
                <div className="order-2 rounded-3xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur-xl lg:order-1">
                  <div className="flex items-start gap-3"><div className="rounded-2xl bg-cyan-200/10 p-2 text-cyan-200">{game.finalRound ? <Zap className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</div><div><p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Table status</p><p className="mt-1 text-lg font-black">{game.phase === "initialReveal" ? "Opening reveal" : game.phase === "roundOver" ? "Round complete" : game.phase === "gameOver" ? "Match complete" : `${currentPlayer?.name ?? "Player"}'s turn`}</p><p className="mt-1 text-sm leading-5 text-slate-300">{game.message}</p></div></div>
                </div>

                <div className="order-1 flex items-center justify-center gap-3 lg:order-2">
                  <button type="button" onClick={() => drawSource("deck")} disabled={!canDrawFromDeck} className={`group relative flex h-24 w-20 flex-col items-center justify-center rounded-2xl border transition sm:h-28 sm:w-24 ${canDrawFromDeck ? "border-cyan-200 bg-cyan-200/10 shadow-2xl shadow-cyan-950/40 hover:-translate-y-1" : "border-white/10 bg-white/[0.05] opacity-80"}`}>
                    <span className="absolute inset-2 rounded-xl border border-white/10 bg-gradient-to-br from-slate-950 via-sky-950 to-indigo-950" /><Layers className="relative h-7 w-7 text-cyan-200" /><span className="relative mt-1.5 text-xs font-bold uppercase tracking-[0.2em] text-white/70">Draw</span><span className="relative text-sm text-white/45">{game.deck.length} cards</span>
                  </button>
                  <button type="button" onClick={() => drawSource("discard")} disabled={!canChoosePile || !discardTop} className={`relative flex h-24 w-20 flex-col items-center justify-center rounded-2xl border transition sm:h-28 sm:w-24 ${canChoosePile && discardTop ? "border-amber-200 bg-amber-200/10 shadow-2xl shadow-amber-950/30 hover:-translate-y-1" : "border-white/10 bg-white/[0.05] opacity-80"}`}>
                    {discardTop ? <CardTile valueOverride={discardTop.value} /> : <Shuffle className="h-7 w-7 text-white/40" />}<span className="absolute bottom-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70">Discard</span>
                  </button>
                </div>

                <div className="order-3 rounded-3xl border border-white/10 bg-white/[0.05] p-3 backdrop-blur-xl">
                  {game.pendingCard ? (
                    <div className="flex items-center gap-3">
                      {game.phase === "drawDecision" ? (
                        <button type="button" onClick={chooseReplaceAfterDeckDraw} className="shrink-0 transition hover:-translate-y-1" aria-label="Use this card to replace a grid card">
                          <CardTile valueOverride={game.pendingCard.value} />
                        </button>
                      ) : (
                        <CardTile valueOverride={game.pendingCard.value} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs uppercase tracking-[0.25em] text-amber-200">Drawn card</p>
                        <p className="mt-0.5 text-xl font-black">{getCardLabel(game.pendingCard.value)}</p>
                        {game.phase === "drawDecision" ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                            <button type="button" onClick={chooseReplaceAfterDeckDraw} className="rounded-2xl bg-cyan-200 px-3 py-2 text-sm font-black text-slate-950 transition hover:bg-cyan-100">Replace</button>
                            <button type="button" onClick={discardDrawnAndReveal} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-black text-white transition hover:bg-white/15">Discard & reveal</button>
                          </div>
                        ) : (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <p className="text-sm text-white/60">Select a target in your grid.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 text-sm text-white/60"><Sparkles className="h-5 w-5 text-cyan-200" /> Draw pile gives you a choice. Discard pile forces a replacement.</div>
                  )}
                </div>
              </section>
            </div>

            <section className="order-2 grid min-h-0 content-start gap-3 sm:grid-cols-2">
              {game.players.slice(1).map((player) => (
                <div key={player.id} className={`rounded-3xl border p-2.5 transition ${currentPlayer?.id === player.id && game.phase === "chooseSource" ? "border-cyan-200/70 bg-cyan-200/10 shadow-lg shadow-cyan-950/30" : "border-white/10 bg-white/[0.04]"}`}>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <div><p className="flex items-center gap-2 text-xs font-black"><Brain className="h-3.5 w-3.5 text-cyan-200" /> {player.name}</p><p className="text-[11px] text-white/50">Visible {visibleScore(player)} | Hidden {unrevealedCount(player)} | Total {player.total}</p></div>
                    {game.endingPlayerId === player.id ? <Crown className="h-4 w-4 text-amber-300" /> : null}
                  </div>
                  <div className="grid grid-cols-4 gap-1">{player.grid.map((cell, index) => <CardTile key={`${player.id}-${index}-${cell.card?.id ?? "clear"}`} cell={cell} compact />)}</div>
                </div>
              ))}
            </section>
          </div>
        </section>
        {renderScorePanel(false)}
        {scoreOpen ? renderScorePanel(true) : null}
      </div>
      {helpOpen ? <HelpModal onClose={() => setHelpOpen(false)} /> : null}
    </main>
  );
}
