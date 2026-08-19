export type Card = { id: string; value: number };
export type Cell = { card: Card | null; revealed: boolean; cleared?: boolean };

export type Player = {
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

export type Phase =
  | "setup"
  | "initialReveal"
  | "chooseSource"
  | "drawDecision"
  | "replaceChoice"
  | "revealChoice"
  | "roundOver"
  | "gameOver";

export type RoundScore = {
  playerId: string;
  name: string;
  raw: number;
  applied: number;
  total: number;
  penalty: boolean;
};

export type RoundRecord = { round: number; endingPlayerId: string | null; scores: RoundScore[] };
export type PendingSource = "deck" | "discard" | null;
export type ClearEvent = { playerName: string; columns: { col: number; value: number }[] };

export type GameState = {
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

export const FULL_COUNTS: Record<number, number> = {
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

export const STARTING_MESSAGE =
  "Choose exactly two cards to reveal. Highest visible opening total takes the first turn.";

export const emptyGame: GameState = {
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

export function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createDeck() {
  const cards: Card[] = [];
  Object.entries(FULL_COUNTS).forEach(([rawValue, count]) => {
    const value = Number(rawValue);
    for (let i = 0; i < count; i += 1) {
      cards.push({ id: `${value}-${i}-${Math.random().toString(36).slice(2)}`, value });
    }
  });
  return shuffle(cards);
}

export function makeGrid(deck: Card[]) {
  const grid: Cell[] = [];
  for (let i = 0; i < 12; i += 1) {
    const card = deck.pop();
    if (!card) throw new Error("Not enough cards to deal a GridClash 12 round.");
    grid.push({ card, revealed: false });
  }
  return grid;
}

export function revealRandomTwo(grid: Cell[]) {
  const next = grid.map((cell) => ({ ...cell }));
  shuffle(Array.from({ length: 12 }, (_, index) => index))
    .slice(0, 2)
    .forEach((index) => {
      next[index] = { ...next[index], revealed: true };
    });
  return next;
}

export function createRound(
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

export function getCardLabel(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

export function rowColumnIndexes(col: number) {
  return [col, col + 4, col + 8];
}

export function clonePlayers(players: Player[]) {
  return players.map((player) => ({
    ...player,
    grid: player.grid.map((cell) => ({ ...cell, card: cell.card ? { ...cell.card } : null })),
  }));
}

export function rawScore(player: Player) {
  return player.grid.reduce((total, cell) => total + (cell.card ? cell.card.value : 0), 0);
}

export function visibleScore(player: Player) {
  return player.grid.reduce(
    (total, cell) => total + (cell.revealed && cell.card ? cell.card.value : 0),
    0,
  );
}

export function unrevealedCount(player: Player) {
  return player.grid.filter((cell) => cell.card && !cell.revealed).length;
}

export function isFinished(player: Player) {
  return player.grid.every((cell) => !cell.card || cell.revealed);
}

export function revealAllGrid(grid: Cell[]) {
  return grid.map((cell) => (cell.card ? { ...cell, revealed: true } : { ...cell }));
}

export function clearCompletedColumns(player: Player) {
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

export function drawFromDeck(deck: Card[], discard: Card[]) {
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

export function countKnownCards(players: Player[], discard: Card[]) {
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

export function expectedDeckValue(players: Player[], discard: Card[]) {
  const remaining = countKnownCards(players, discard);
  let total = 0;
  let count = 0;
  Object.entries(remaining).forEach(([rawValue, amount]) => {
    total += Number(rawValue) * amount;
    count += amount;
  });
  return count === 0 ? 5 : total / count;
}

export function estimatedScore(player: Player, ev: number) {
  return player.grid.reduce((total, cell) => {
    if (!cell.card) return total;
    return total + (cell.revealed ? cell.card.value : ev);
  }, 0);
}

export function completionBonus(player: Player, index: number, value: number) {
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

export function nextPlayerIndex(players: Player[], currentPlayer: number, finalRound: boolean, endingPlayerId: string | null) {
  for (let offset = 1; offset <= players.length; offset += 1) {
    const index = (currentPlayer + offset) % players.length;
    const candidate = players[index];
    if (finalRound && (candidate.id === endingPlayerId || candidate.finalTurnTaken)) continue;
    return index;
  }
  return currentPlayer;
}

export function scoreRound(state: GameState, players: Player[], message: string): GameState {
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

export function completeTurn(
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

export function replaceGridCard(player: Player, index: number, card: Card) {
  const next: Player = { ...player, grid: player.grid.map((cell) => ({ ...cell })) };
  const oldCard = next.grid[index].card;
  next.grid[index] = { card, revealed: true };
  const cleared = clearCompletedColumns(next);
  return { player: cleared.player, oldCard, columns: cleared.columns };
}

export function revealGridCard(player: Player, index: number) {
  const next: Player = { ...player, grid: player.grid.map((cell) => ({ ...cell })) };
  next.grid[index] = { ...next.grid[index], revealed: true };
  const cleared = clearCompletedColumns(next);
  return { player: cleared.player, columns: cleared.columns };
}

export function determineStarter(players: Player[]) {
  const sums = players.map((player, index) => ({
    index,
    sum: player.grid.reduce((total, cell) => total + (cell.revealed && cell.card ? cell.card.value : 0), 0),
  }));
  const highest = Math.max(...sums.map((item) => item.sum));
  const tied = sums.filter((item) => item.sum === highest);
  return tied[Math.floor(Math.random() * tied.length)].index;
}

export function sortByTotal(players: Player[]) {
  return [...players].sort((a, b) => a.total - b.total);
}
