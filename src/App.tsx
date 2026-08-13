import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronRight,
  ClipboardList,
  Crown,
  Eye,
  Layers,
  Menu,
  RotateCcw,
  Settings,
  Shuffle,
  Sparkles,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";

type Card = { id: string; value: number };
type Cell = { card: Card | null; revealed: boolean; cleared?: boolean };

type Player = {
  id: string;
  name: string;
  isHuman: boolean;
  grid: Cell[];
  total: number;
  rawRoundScore: number;
  roundScore: number;
  penalty: boolean;
  finalTurnTaken: boolean;
};

type Phase =
  | "setup"
  | "initialReveal"
  | "chooseSource"
  | "drawDecision"
  | "replaceChoice"
  | "revealChoice"
  | "roundOver"
  | "gameOver";

type RoundScore = {
  playerId: string;
  name: string;
  raw: number;
  applied: number;
  total: number;
  penalty: boolean;
};

type RoundRecord = { round: number; endingPlayerId: string | null; scores: RoundScore[] };
type PendingSource = "deck" | "discard" | null;
type SettingsState = { aiCount: number; targetScore: number };
type ClearEvent = { playerName: string; columns: { col: number; value: number }[] };
type Sfx = "draw" | "flip" | "replace" | "clear" | "win" | "lose" | "shuffle";

type GameState = {
  phase: Phase;
  players: Player[];
  deck: Card[];
  discard: Card[];
  currentPlayer: number;
  pendingCard: Card | null;
  pendingSource: PendingSource;
  targetScore: number;
  finalRound: boolean;
  endingPlayerId: string | null;
  roundNumber: number;
  roundHistory: RoundRecord[];
  message: string;
  clearPulse: number;
  roundEndPulse: number;
};

const FULL_COUNTS: Record<number, number> = {
  [-2]: 5,
  [-1]: 10,
  0: 15,
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  5: 10,
  6: 10,
  7: 10,
  8: 10,
  9: 10,
  10: 10,
  11: 10,
  12: 10,
};

const STARTING_MESSAGE =
  "Choose exactly two cards to reveal. Highest visible opening total takes the first turn.";

const emptyGame: GameState = {
  phase: "setup",
  players: [],
  deck: [],
  discard: [],
  currentPlayer: 0,
  pendingCard: null,
  pendingSource: null,
  targetScore: 100,
  finalRound: false,
  endingPlayerId: null,
  roundNumber: 1,
  roundHistory: [],
  message: "",
  clearPulse: 0,
  roundEndPulse: 0,
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createDeck() {
  const cards: Card[] = [];
  Object.entries(FULL_COUNTS).forEach(([rawValue, count]) => {
    const value = Number(rawValue);
    for (let i = 0; i < count; i += 1) {
      cards.push({ id: `${value}-${i}-${Math.random().toString(36).slice(2)}`, value });
    }
  });
  return shuffle(cards);
}

function makeGrid(deck: Card[]) {
  const grid: Cell[] = [];
  for (let i = 0; i < 12; i += 1) {
    const card = deck.pop();
    if (!card) throw new Error("Not enough cards to deal a GridClash 12 round.");
    grid.push({ card, revealed: false });
  }
  return grid;
}

function revealRandomTwo(grid: Cell[]) {
  const next = grid.map((cell) => ({ ...cell }));
  shuffle(Array.from({ length: 12 }, (_, index) => index))
    .slice(0, 2)
    .forEach((index) => {
      next[index] = { ...next[index], revealed: true };
    });
  return next;
}

function createRound(
  aiCount: number,
  targetScore: number,
  roundNumber: number,
  totals: Record<string, number> = {},
  roundHistory: RoundRecord[] = [],
): GameState {
  const deck = createDeck();
  const players: Player[] = [
    {
      id: "human",
      name: "You",
      isHuman: true,
      grid: makeGrid(deck),
      total: totals.human ?? 0,
      rawRoundScore: 0,
      roundScore: 0,
      penalty: false,
      finalTurnTaken: false,
    },
  ];

  for (let i = 1; i <= aiCount; i += 1) {
    const id = `ai-${i}`;
    players.push({
      id,
      name: `AI ${i}`,
      isHuman: false,
      grid: revealRandomTwo(makeGrid(deck)),
      total: totals[id] ?? 0,
      rawRoundScore: 0,
      roundScore: 0,
      penalty: false,
      finalTurnTaken: false,
    });
  }

  const firstDiscard = deck.pop();
  return {
    ...emptyGame,
    phase: "initialReveal",
    players,
    deck,
    discard: firstDiscard ? [firstDiscard] : [],
    targetScore,
    roundNumber,
    roundHistory,
    message: STARTING_MESSAGE,
  };
}

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

function getCardLabel(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function rowColumnIndexes(col: number) {
  return [col, col + 4, col + 8];
}

function clonePlayers(players: Player[]) {
  return players.map((player) => ({
    ...player,
    grid: player.grid.map((cell) => ({ ...cell, card: cell.card ? { ...cell.card } : null })),
  }));
}

function rawScore(player: Player) {
  return player.grid.reduce((total, cell) => total + (cell.card ? cell.card.value : 0), 0);
}

function visibleScore(player: Player) {
  return player.grid.reduce(
    (total, cell) => total + (cell.revealed && cell.card ? cell.card.value : 0),
    0,
  );
}

function unrevealedCount(player: Player) {
  return player.grid.filter((cell) => cell.card && !cell.revealed).length;
}

function isFinished(player: Player) {
  return player.grid.every((cell) => !cell.card || cell.revealed);
}

function revealAllGrid(grid: Cell[]) {
  return grid.map((cell) => (cell.card ? { ...cell, revealed: true } : { ...cell }));
}

function clearCompletedColumns(player: Player) {
  const next: Player = { ...player, grid: player.grid.map((cell) => ({ ...cell })) };
  const columns: { col: number; value: number }[] = [];

  for (let col = 0; col < 4; col += 1) {
    const indexes = rowColumnIndexes(col);
    const cells = indexes.map((index) => next.grid[index]);
    if (!cells.every((cell) => cell.card && cell.revealed)) continue;
    const value = cells[0].card?.value;
    if (value === undefined) continue;
    if (cells.every((cell) => cell.card?.value === value)) {
      indexes.forEach((index) => {
        next.grid[index] = { card: null, revealed: true, cleared: true };
      });
      columns.push({ col, value });
    }
  }
  return { player: next, columns };
}

function drawFromDeck(deck: Card[], discard: Card[]) {
  let nextDeck = [...deck];
  let nextDiscard = [...discard];
  if (nextDeck.length === 0 && nextDiscard.length > 1) {
    const topDiscard = nextDiscard[nextDiscard.length - 1];
    nextDeck = shuffle(nextDiscard.slice(0, -1));
    nextDiscard = [topDiscard];
  }
  const card = nextDeck.pop() ?? null;
  return { card, deck: nextDeck, discard: nextDiscard };
}

function countKnownCards(players: Player[], discard: Card[]) {
  const counts: Record<number, number> = { ...FULL_COUNTS };
  players.forEach((player) => {
    player.grid.forEach((cell) => {
      if (cell.revealed && cell.card) counts[cell.card.value] = Math.max(0, (counts[cell.card.value] ?? 0) - 1);
    });
  });
  discard.forEach((card) => {
    counts[card.value] = Math.max(0, (counts[card.value] ?? 0) - 1);
  });
  return counts;
}

function expectedDeckValue(players: Player[], discard: Card[]) {
  const remaining = countKnownCards(players, discard);
  let total = 0;
  let count = 0;
  Object.entries(remaining).forEach(([rawValue, amount]) => {
    total += Number(rawValue) * amount;
    count += amount;
  });
  return count === 0 ? 5 : total / count;
}

function estimatedScore(player: Player, ev: number) {
  return player.grid.reduce((total, cell) => {
    if (!cell.card) return total;
    return total + (cell.revealed ? cell.card.value : ev);
  }, 0);
}

function completionBonus(player: Player, index: number, value: number) {
  const col = index % 4;
  for (const cellIndex of rowColumnIndexes(col)) {
    if (cellIndex === index) continue;
    const cell = player.grid[cellIndex];
    if (!cell.card || !cell.revealed || cell.card.value !== value) return 0;
  }
  if (value > 0) return value * 3 + 6;
  if (value === 0) return 2;
  return -6;
}

function bestReplacement(player: Player, value: number, ev: number, allPlayers: Player[]) {
  const ownEstimate = estimatedScore(player, ev);
  const opponentEstimates = allPlayers
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => estimatedScore(candidate, ev));
  const bestOpponent = opponentEstimates.length ? Math.min(...opponentEstimates) : ownEstimate;
  const roundIsDangerous = unrevealedCount(player) <= 2 && ownEstimate > bestOpponent + 4;

  return player.grid.reduce(
    (best, cell, index) => {
      if (!cell.card) return best;
      const currentValue = cell.revealed ? cell.card.value : ev;
      let improvement = currentValue - value + completionBonus(player, index, value);
      if (roundIsDangerous && !cell.revealed) improvement -= 4.5;
      if (cell.revealed && cell.card.value >= 8 && value <= 4) improvement += 1.5;
      return improvement > best.improvement ? { index, improvement } : best;
    },
    { index: -1, improvement: Number.NEGATIVE_INFINITY },
  );
}

function chooseRevealIndex(player: Player) {
  const hidden = player.grid
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.card && !cell.revealed);
  if (hidden.length === 0) return -1;

  const opportunities = hidden
    .map(({ index }) => {
      const visibleValues = rowColumnIndexes(index % 4)
        .filter((cellIndex) => cellIndex !== index)
        .map((cellIndex) => player.grid[cellIndex])
        .filter((cell) => cell.card && cell.revealed)
        .map((cell) => cell.card?.value ?? 99);
      const hasPair = visibleValues.length === 2 && visibleValues[0] === visibleValues[1];
      const score = hasPair && visibleValues[0] > 0 ? visibleValues[0] * 2 + 8 : visibleValues.length;
      return { index, score };
    })
    .sort((a, b) => b.score - a.score);
  const bestScore = opportunities[0].score;
  const tied = opportunities.filter((item) => item.score === bestScore);
  return tied[Math.floor(Math.random() * tied.length)].index;
}

function nextPlayerIndex(players: Player[], currentPlayer: number, finalRound: boolean, endingPlayerId: string | null) {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (currentPlayer + offset) % players.length;
    const candidate = players[index];
    if (finalRound && (candidate.id === endingPlayerId || candidate.finalTurnTaken)) continue;
    return index;
  }
  return currentPlayer;
}

function scoreRound(state: GameState, players: Player[], message: string): GameState {
  const revealedPlayers = players.map((player) => ({ ...player, grid: revealAllGrid(player.grid) }));
  const rawScores = revealedPlayers.map((player) => ({ id: player.id, score: rawScore(player) }));
  const endingRaw = rawScores.find((item) => item.id === state.endingPlayerId)?.score ?? 0;
  const endingWasStrictlyLowest =
    state.endingPlayerId !== null && rawScores.every((item) => item.id === state.endingPlayerId || endingRaw < item.score);

  const scoredPlayers = revealedPlayers.map((player) => {
    const raw = rawScores.find((item) => item.id === player.id)?.score ?? 0;
    const penalty = player.id === state.endingPlayerId && !endingWasStrictlyLowest && raw > 0;
    const applied = penalty ? raw * 2 : raw;
    return {
      ...player,
      rawRoundScore: raw,
      roundScore: applied,
      penalty,
      total: player.total + applied,
      finalTurnTaken: false,
    };
  });

  const record: RoundRecord = {
    round: state.roundNumber,
    endingPlayerId: state.endingPlayerId,
    scores: scoredPlayers.map((player) => ({
      playerId: player.id,
      name: player.name,
      raw: player.rawRoundScore,
      applied: player.roundScore,
      total: player.total,
      penalty: player.penalty,
    })),
  };

  const reachedTarget = scoredPlayers.some((player) => player.total >= state.targetScore);
  return {
    ...state,
    phase: reachedTarget ? "gameOver" : "roundOver",
    players: scoredPlayers,
    pendingCard: null,
    pendingSource: null,
    finalRound: false,
    roundHistory: [...state.roundHistory, record],
    message: reachedTarget
      ? "Target score reached. Lowest total wins the match."
      : `${message} Round ${state.roundNumber} is complete. Review scores, then deal again.`,
    roundEndPulse: state.roundEndPulse + 1,
  };
}

function completeTurn(
  state: GameState,
  nextPlayers: Player[],
  deck: Card[],
  discard: Card[],
  playerIndex: number,
  message: string,
  clearEvent?: ClearEvent,
): GameState {
  let finalRound = state.finalRound;
  let endingPlayerId = state.endingPlayerId;
  let nextMessage = message;

  if (finalRound) nextPlayers[playerIndex] = { ...nextPlayers[playerIndex], finalTurnTaken: true };
  if (!finalRound && isFinished(nextPlayers[playerIndex])) {
    finalRound = true;
    endingPlayerId = nextPlayers[playerIndex].id;
    nextPlayers[playerIndex] = { ...nextPlayers[playerIndex], finalTurnTaken: true };
    nextMessage = `${nextPlayers[playerIndex].name} revealed every remaining card. Each opponent gets one final turn.`;
  }

  const allFinalTurnsDone =
    finalRound && nextPlayers.every((candidate) => candidate.id === endingPlayerId || candidate.finalTurnTaken);
  const clearText = clearEvent
    ? `${clearEvent.playerName} cleared column ${clearEvent.columns
        .map((item) => `${item.col + 1} (${getCardLabel(item.value)})`)
        .join(", ")}. `
    : "";

  const nextState: GameState = {
    ...state,
    phase: "chooseSource",
    players: nextPlayers,
    deck,
    discard,
    pendingCard: null,
    pendingSource: null,
    finalRound,
    endingPlayerId,
    message: `${clearText}${nextMessage}`,
    clearPulse: clearEvent ? state.clearPulse + 1 : state.clearPulse,
  };

  if (allFinalTurnsDone) return scoreRound(nextState, nextPlayers, nextMessage);
  return { ...nextState, currentPlayer: nextPlayerIndex(nextPlayers, playerIndex, finalRound, endingPlayerId) };
}

function replaceGridCard(player: Player, index: number, card: Card) {
  const next: Player = { ...player, grid: player.grid.map((cell) => ({ ...cell })) };
  const oldCard = next.grid[index].card;
  next.grid[index] = { card, revealed: true };
  const cleared = clearCompletedColumns(next);
  return { player: cleared.player, oldCard, columns: cleared.columns };
}

function revealGridCard(player: Player, index: number) {
  const next: Player = { ...player, grid: player.grid.map((cell) => ({ ...cell })) };
  next.grid[index] = { ...next.grid[index], revealed: true };
  const cleared = clearCompletedColumns(next);
  return { player: cleared.player, columns: cleared.columns };
}

function determineStarter(players: Player[]) {
  const sums = players.map((player, index) => ({
    index,
    sum: player.grid.reduce((total, cell) => total + (cell.revealed && cell.card ? cell.card.value : 0), 0),
  }));
  const highest = Math.max(...sums.map((item) => item.sum));
  const tied = sums.filter((item) => item.sum === highest);
  return tied[Math.floor(Math.random() * tied.length)].index;
}

function runAiTurn(state: GameState) {
  const playerIndex = state.currentPlayer;
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  const ev = expectedDeckValue(players, state.discard);
  const discardTop = state.discard[state.discard.length - 1] ?? null;
  let useDiscard = false;
  let reason = "";

  if (discardTop) {
    const discardPlan = bestReplacement(player, discardTop.value, ev, players);
    const bonus = discardPlan.index >= 0 ? completionBonus(player, discardPlan.index, discardTop.value) : 0;
    useDiscard =
      discardTop.value <= 0 ||
      bonus > 0 ||
      (state.deck.length === 0 && state.discard.length === 1) ||
      (discardTop.value <= 4 && discardPlan.improvement > -0.4) ||
      discardPlan.improvement > Math.max(1.2, ev - discardTop.value + 0.5);
    if (useDiscard) reason = bonus > 0 ? "to chase a column clear" : `because ${getCardLabel(discardTop.value)} beats the deck EV`;
  }

  if (useDiscard && discardTop) {
    const card = discardTop;
    const discard = state.discard.slice(0, -1);
    const plan = bestReplacement(player, card.value, ev, players);
    const replaced = replaceGridCard(player, plan.index === -1 ? 0 : plan.index, card);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...discard, replaced.oldCard] : discard;
    return completeTurn(
      state,
      players,
      state.deck,
      nextDiscard,
      playerIndex,
      `${player.name} took the discard ${getCardLabel(card.value)} ${reason}.`,
      replaced.columns.length ? { playerName: player.name, columns: replaced.columns } : undefined,
    );
  }

  const drawn = drawFromDeck(state.deck, state.discard);
  if (!drawn.card) return { ...state, message: "The deck and discard pile are both empty. No action was taken." };

  const card = drawn.card;
  const plan = bestReplacement(player, card.value, ev, players);
  const bonus = plan.index >= 0 ? completionBonus(player, plan.index, card.value) : 0;
  const shouldReplace =
    unrevealedCount(player) === 0 ||
    card.value <= 0 ||
    bonus > 0 ||
    plan.improvement > 1.25 ||
    (card.value <= 4 && plan.improvement > -0.8);

  if (shouldReplace && plan.index >= 0) {
    const replaced = replaceGridCard(player, plan.index, card);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...drawn.discard, replaced.oldCard] : drawn.discard;
    return completeTurn(
      state,
      players,
      drawn.deck,
      nextDiscard,
      playerIndex,
      `${player.name} drew ${getCardLabel(card.value)} and used it to improve the grid.`,
      replaced.columns.length ? { playerName: player.name, columns: replaced.columns } : undefined,
    );
  }

  const revealIndex = chooseRevealIndex(player);
  if (revealIndex === -1) {
    const replaced = replaceGridCard(player, plan.index === -1 ? 0 : plan.index, card);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...drawn.discard, replaced.oldCard] : drawn.discard;
    return completeTurn(
      state,
      players,
      drawn.deck,
      nextDiscard,
      playerIndex,
      `${player.name} had no hidden cards and replaced a grid card.`,
      replaced.columns.length ? { playerName: player.name, columns: replaced.columns } : undefined,
    );
  }

  const revealed = revealGridCard(player, revealIndex);
  players[playerIndex] = revealed.player;
  return completeTurn(
    state,
    players,
    drawn.deck,
    [...drawn.discard, card],
    playerIndex,
    `${player.name} declined ${getCardLabel(card.value)} and revealed a hidden card instead.`,
    revealed.columns.length ? { playerName: player.name, columns: revealed.columns } : undefined,
  );
}

function sortByTotal(players: Player[]) {
  return [...players].sort((a, b) => a.total - b.total);
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
    ? "h-12 w-8 text-sm sm:h-14 sm:w-10"
    : "h-[clamp(4.4rem,16vw,6.8rem)] w-[clamp(3rem,11vw,4.7rem)] text-2xl sm:text-3xl";

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

  const frontFace = (
    <span
      style={card ? cardGradientStyle(card.value) : undefined}
      className={`absolute inset-0 flex items-center justify-center rounded-xl border font-black tracking-tight shadow-lg [backface-visibility:hidden] [transform:rotateY(180deg)] ${selected ? "border-amber-200 ring-2 ring-amber-300" : "border-white/40"} ${card ? "" : "bg-slate-700 text-white"}`}
    >
      <span className="absolute inset-1 rounded-lg border border-white/20" />
      {card ? getCardLabel(card.value) : ""}
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

export default function GridClash12() {
  const [settings, setSettings] = useState<SettingsState>({ aiCount: 3, targetScore: 100 });
  const [game, setGame] = useState<GameState>(emptyGame);
  const [initialPicks, setInitialPicks] = useState<number[]>([]);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Snapshot saved right before the player commits to a draw/discard action,
  // so a mis-click can be undone before any grid card is revealed.
  const [undoSnapshot, setUndoSnapshot] = useState<GameState | null>(null);
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
        return runAiTurn(previous);
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [currentPlayer, game.phase, playSound]);

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
    setGame(createRound(settings.aiCount, settings.targetScore, 1));
    playSound("shuffle");
  };

  const startNextRound = () => {
    const totals = Object.fromEntries(game.players.map((player) => [player.id, player.total]));
    setInitialPicks([]);
    setGame(createRound(game.players.length - 1, game.targetScore, game.roundNumber + 1, totals, game.roundHistory));
    playSound("draw");
  };

  const resetToSetup = () => {
    setInitialPicks([]);
    setScoreOpen(false);
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
    setGame((previous) => {
      if (!undoSnapshot || previous.players[previous.currentPlayer]?.isHuman === false) return previous;
      return undoSnapshot;
    });
    setUndoSnapshot(null);
    playSound("flip");
  };

  const drawSource = (source: "deck" | "discard") => {
    if (game.phase !== "chooseSource" || !currentPlayer?.isHuman) return;
    if (source === "discard") {
      if (!discardTop) return;
      // Commit to taking the discard: no undo after this action.
      setUndoSnapshot(null);
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
    setUndoSnapshot(game);
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
    setUndoSnapshot(game);
    setGame((previous) => ({ ...previous, phase: "replaceChoice", message: "Choose the grid card to replace." }));
  };

  const discardDrawnAndReveal = () => {
    if (game.phase !== "drawDecision" || !game.pendingCard) return;
    // Once the card is discarded to reveal a grid card, undo is no longer allowed.
    setUndoSnapshot(null);
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

  const handleHumanCellClick = (index: number) => {
    if (!human) return;
    if (game.phase === "initialReveal") {
      toggleInitialPick(index);
      return;
    }
    if (!currentPlayer?.isHuman || game.currentPlayer !== 0) return;

    if (game.phase === "replaceChoice" && game.pendingCard && human.grid[index].card) {
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
      setUndoSnapshot(null);
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
    <aside className={`${modal ? "fixed inset-y-0 right-0 z-50 w-full max-w-sm" : "hidden w-80 shrink-0 xl:block"} border-l border-white/10 bg-slate-950/95 p-5 text-white shadow-2xl backdrop-blur-xl`}>
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
      <main className="min-h-screen overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(34,211,238,0.22),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(168,85,247,0.22),transparent_26%),linear-gradient(135deg,#07111f,#0f172a_45%,#020617)]" />
        <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-5 py-10 sm:px-8">
          <div className="max-w-3xl">
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-cyan-200/20 bg-cyan-200/10 px-4 py-2 text-sm font-semibold text-cyan-100 shadow-lg shadow-cyan-950/20"><Sparkles className="h-4 w-4" /> Strategic browser edition</div>
            <h1 className="text-6xl font-black tracking-tight sm:text-8xl">GridClash <span className="text-cyan-300">12</span></h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">Race to keep your face-up grid as low as possible. Flip, swap, and clear matching columns across multiple rounds while a thinking AI table weighs the odds against you. Lowest total when someone hits the target loses the least — and wins the match.</p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-5 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-7">
              <div className="flex items-center gap-3 text-cyan-100"><Settings className="h-5 w-5" /><h2 className="text-lg font-black uppercase tracking-[0.25em]">Game setup</h2></div>
              <div className="mt-7 space-y-7">
                <label className="block">
                  <span className="mb-3 flex items-center justify-between text-sm font-semibold text-slate-200"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> AI opponents</span><span className="text-cyan-200">{settings.aiCount}</span></span>
                  <input type="range" min={1} max={7} value={settings.aiCount} onChange={(event) => setSettings((current) => ({ ...current, aiCount: Number(event.target.value) }))} className="h-2 w-full accent-cyan-300" />
                </label>

                <div>
                  <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Trophy className="h-4 w-4" /> Target score</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[50, 100, 150].map((target) => (
                      <button key={target} type="button" onClick={() => setSettings((current) => ({ ...current, targetScore: target }))} className={`rounded-2xl border px-4 py-4 text-lg font-black transition ${settings.targetScore === target ? "border-cyan-200 bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-950/25" : "border-white/10 bg-white/5 text-white hover:bg-white/10"}`}>{target}</button>
                    ))}
                  </div>
                </div>

                <button type="button" onClick={startGame} className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-cyan-300 to-emerald-300 px-6 py-5 text-lg font-black text-slate-950 shadow-2xl shadow-cyan-950/30 transition hover:scale-[1.02]">Deal round 1 <ChevronRight className="h-5 w-5 transition group-hover:translate-x-1" /></button>
              </div>
            </div>

            <div className="relative min-h-80 overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-violet-500/20 p-6 shadow-2xl shadow-black/20">
              <div className="absolute inset-x-10 top-8 grid grid-cols-4 gap-3 opacity-80 rotate-[-8deg]">
                {[-2, 0, 4, 9, -1, 2, 7, 12].map((value, index) => <CardTile key={`${value}-${index}`} valueOverride={value} compact />)}
              </div>
              <div className="absolute bottom-6 left-6 right-6 rounded-3xl border border-white/10 bg-slate-950/70 p-5 backdrop-blur-md">
                <div className="flex items-center gap-3 text-emerald-200"><Brain className="h-5 w-5" /><p className="font-black">AI heuristic engine</p></div>
                <p className="mt-2 text-sm leading-6 text-slate-300">Opponents take low discards fast, target high revealed cards, estimate the unseen deck, pursue column clears, and avoid risky early finishes.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  const isHumanTurn = currentPlayer?.isHuman && game.currentPlayer === 0;
  const canChoosePile = game.phase === "chooseSource" && isHumanTurn;
  const canDrawFromDeck = canChoosePile && (game.deck.length > 0 || game.discard.length > 1);

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(34,211,238,0.25),transparent_28%),radial-gradient(circle_at_20%_90%,rgba(16,185,129,0.18),transparent_24%),linear-gradient(135deg,#020617,#0f172a_45%,#052e2b)]" />
      <div className="relative flex min-h-screen">
        <section className="flex min-w-0 flex-1 flex-col px-3 py-4 sm:px-5 lg:px-8">
          <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-200 text-slate-950 shadow-lg shadow-cyan-950/20"><Sparkles className="h-6 w-6" /></div>
              <div><p className="text-xl font-black tracking-tight">GridClash <span className="text-cyan-300">12</span></p><p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Round {game.roundNumber}</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setSoundEnabled((enabled) => !enabled)} className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white/75 transition hover:bg-white/10 hover:text-white" aria-label="Toggle sound">{soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}</button>
              <button type="button" onClick={() => setScoreOpen(true)} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white xl:hidden"><Menu className="h-4 w-4" /> Scores</button>
              <button type="button" onClick={resetToSetup} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white"><RotateCcw className="h-4 w-4" /> New game</button>
            </div>
          </header>

          <div className="mt-4 grid flex-1 gap-4 xl:grid-rows-[auto_1fr_auto]">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {game.players.slice(1).map((player) => (
                <div key={player.id} className={`rounded-3xl border p-3 transition ${currentPlayer?.id === player.id && game.phase === "chooseSource" ? "border-cyan-200/70 bg-cyan-200/10 shadow-lg shadow-cyan-950/30" : "border-white/10 bg-white/[0.04]"}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div><p className="flex items-center gap-2 text-sm font-black"><Brain className="h-4 w-4 text-cyan-200" /> {player.name}</p><p className="text-xs text-white/50">Visible {visibleScore(player)} | Hidden {unrevealedCount(player)} | Total {player.total}</p></div>
                    {game.endingPlayerId === player.id ? <Crown className="h-5 w-5 text-amber-300" /> : null}
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">{player.grid.map((cell, index) => <CardTile key={`${player.id}-${index}-${cell.card?.id ?? "clear"}`} cell={cell} compact />)}</div>
                </div>
              ))}
            </section>

            <section className="grid min-h-[18rem] items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
              <div className="order-2 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl lg:order-1">
                <div className="flex items-start gap-3"><div className="rounded-2xl bg-cyan-200/10 p-3 text-cyan-200">{game.finalRound ? <Zap className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</div><div><p className="text-xs uppercase tracking-[0.25em] text-cyan-200">Table status</p><p className="mt-2 text-lg font-black">{game.phase === "initialReveal" ? "Opening reveal" : game.phase === "roundOver" ? "Round complete" : game.phase === "gameOver" ? "Match complete" : `${currentPlayer?.name ?? "Player"}'s turn`}</p><p className="mt-2 text-sm leading-6 text-slate-300">{game.message}</p></div></div>
              </div>

              <div className="order-1 flex items-center justify-center gap-4 lg:order-2">
                <button type="button" onClick={() => drawSource("deck")} disabled={!canDrawFromDeck} className={`group relative flex h-32 w-24 flex-col items-center justify-center rounded-2xl border transition sm:h-40 sm:w-28 ${canDrawFromDeck ? "border-cyan-200 bg-cyan-200/10 shadow-2xl shadow-cyan-950/40 hover:-translate-y-1" : "border-white/10 bg-white/[0.05] opacity-80"}`}>
                  <span className="absolute inset-2 rounded-xl border border-white/10 bg-gradient-to-br from-slate-950 via-sky-950 to-indigo-950" /><Layers className="relative h-8 w-8 text-cyan-200" /><span className="relative mt-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70">Draw</span><span className="relative text-sm text-white/45">{game.deck.length} cards</span>
                </button>
                <button type="button" onClick={() => drawSource("discard")} disabled={!canChoosePile || !discardTop} className={`relative flex h-32 w-24 flex-col items-center justify-center rounded-2xl border transition sm:h-40 sm:w-28 ${canChoosePile && discardTop ? "border-amber-200 bg-amber-200/10 shadow-2xl shadow-amber-950/30 hover:-translate-y-1" : "border-white/10 bg-white/[0.05] opacity-80"}`}>
                  {discardTop ? <CardTile valueOverride={discardTop.value} /> : <Shuffle className="h-8 w-8 text-white/40" />}<span className="absolute bottom-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70">Discard</span>
                </button>
              </div>

              <div className="order-3 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-xl">
                {game.pendingCard ? (
                  <div className="flex items-center gap-4">
                    {game.phase === "drawDecision" ? (
                      <button type="button" onClick={chooseReplaceAfterDeckDraw} className="shrink-0 transition hover:-translate-y-1" aria-label="Use this card to replace a grid card">
                        <CardTile valueOverride={game.pendingCard.value} />
                      </button>
                    ) : (
                      <CardTile valueOverride={game.pendingCard.value} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs uppercase tracking-[0.25em] text-amber-200">Drawn card</p>
                      <p className="mt-1 text-2xl font-black">{getCardLabel(game.pendingCard.value)}</p>
                      {game.phase === "drawDecision" ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
                          <button type="button" onClick={chooseReplaceAfterDeckDraw} className="rounded-2xl bg-cyan-200 px-4 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100">Replace</button>
                          <button type="button" onClick={discardDrawnAndReveal} className="rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-black text-white transition hover:bg-white/15">Discard and reveal</button>
                        </div>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm text-white/60">Select a target in your grid.</p>
                          {undoSnapshot && game.pendingSource === "deck" ? (
                            <button type="button" onClick={undoTurnDecision} className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/15">
                              <RotateCcw className="h-3.5 w-3.5" /> Undo
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm text-white/60"><Sparkles className="h-5 w-5 text-cyan-200" /> Draw pile gives you a choice. Discard pile forces a replacement.</div>
                )}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><p className="flex items-center gap-2 text-xl font-black">You {game.endingPlayerId === "human" ? <Crown className="h-5 w-5 text-amber-300" /> : null}</p><p className="text-sm text-white/55">Visible {human ? visibleScore(human) : 0} | Hidden {human ? unrevealedCount(human) : 0} | Match total {human?.total ?? 0}</p></div>
                {game.phase === "initialReveal" ? <button type="button" onClick={confirmInitialReveal} disabled={initialPicks.length !== 2} className="rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition enabled:hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">Reveal {initialPicks.length}/2 and start</button> : null}
                {game.phase === "roundOver" ? <button type="button" onClick={startNextRound} className="rounded-2xl bg-cyan-200 px-5 py-3 text-sm font-black text-slate-950 transition hover:bg-cyan-100">Deal next round</button> : null}
                {game.phase === "gameOver" ? <div className="flex items-center gap-3 rounded-2xl bg-amber-300 px-5 py-3 font-black text-slate-950"><Trophy className="h-5 w-5" /> {winner?.name} wins</div> : null}
              </div>

              <div className="mx-auto grid max-w-[22rem] grid-cols-4 justify-center gap-2 sm:max-w-[28rem] sm:gap-3">
                {human?.grid.map((cell, index) => (
                  <CardTile key={`human-${index}-${cell.card?.id ?? "clear"}`} cell={cell} active={humanCanTarget(index)} selected={game.phase === "initialReveal" && initialPicks.includes(index)} onClick={humanCanTarget(index) ? () => handleHumanCellClick(index) : undefined} />
                ))}
              </div>
            </section>
          </div>
        </section>
        {renderScorePanel(false)}
        {scoreOpen ? renderScorePanel(true) : null}
      </div>
    </main>
  );
}