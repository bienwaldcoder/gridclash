import {
  type Card,
  type GameState,
  type Player,
  clonePlayers,
  completeTurn,
  completionBonus,
  countKnownCards,
  drawFromDeck,
  estimatedScore,
  expectedDeckValue,
  getCardLabel,
  replaceGridCard,
  revealGridCard,
  rowColumnIndexes,
  scoreRound,
  shuffle,
  unrevealedCount,
} from "../game";

export type AiLevel = "easy" | "medium" | "hard";

export type AiTurnPlan =
  | { source: "discard"; replaceIndex: number; reason: string }
  | { source: "deck"; useDrawn: true; replaceIndex: number; reason: string }
  | { source: "deck"; useDrawn: false; revealIndex: number; reason: string };

type ReplaceQuality = "smart" | "basic";
type RevealQuality = "smart" | "random";
type LevelConfig = {
  simulations: number;
  timeBudgetMs: number;
  noise: number;
  quality: { replace: ReplaceQuality; reveal: RevealQuality };
};

const LEVEL_CONFIG: Record<AiLevel, LevelConfig> = {
  easy: {
    simulations: 0,
    timeBudgetMs: 0,
    noise: 0.35,
    quality: { replace: "basic", reveal: "random" },
  },
  medium: {
    simulations: 80,
    timeBudgetMs: 40,
    noise: 0.08,
    quality: { replace: "smart", reveal: "smart" },
  },
  hard: {
    simulations: 900,
    timeBudgetMs: 90,
    noise: 0,
    quality: { replace: "smart", reveal: "smart" },
  },
};

// Reveal-choice tuning. Scouting spreads reveals across fresh columns early on to
// locate "problem zones" (columns that could still triple up / clear), then decays
// as the round shortens. Pair-probing is deliberately weak: it is only a fallback
// for genuinely problematic columns (very high revealed peers), not a goal in itself.
const REVEAL_TUNING = {
  scoutFresh: 6, // bonus for revealing into a column with no revealed peer
  pairProbe: 1, // low baseline for revealing a second card into a column (fallback only)
  probeHighCard: 0.6, // x revealed peer value, so only high problem cards attract probing
  twoUnequal: 12, // bonus for revealing the third card of a column with two different revealed cards
  avoidNegativeProbe: 20, // penalty for probing into a column holding a negative card
  scoutDecayThreshold: 7, // full scouting strength while this many cards stay hidden
  scoutDecayFloor: 2, // scouting switches off once this few cards stay hidden
  mcRevealCandidates: 3, // top-k reveal indices that hard evaluates via Monte Carlo
};

// Replacement / phase strategy tuning.
const STRATEGY_TUNING = {
  earlyRevealHidden: 3, // hidden >= this -> early phase: reveal instead of trading
  earlyReplaceThreshold: 2.0, // improvement required before trading early on
  lateGameHidden: 2, // hidden <= this -> late game: dismantle high cards
  lateGameHigh: 6, // revealed card at/above this counts as "high" late
  lateGameBonus: 1.5, // extra improvement for swapping high -> low in the late game
  hiddenReplacePenalty: 4, // avoid discarding a hidden card unseen unless only good cards are revealed
  goodRevealedMax: 3, // all revealed cards <= this counts as "only good cards revealed"
  nextPlayerTripletPenalty: 3.5, // avoid discarding a card that completes the next player's triplet
};

type TurnContext = {
  ev: number;
  ownEstimate: number;
  bestOpponentEstimate: number;
  finishing: boolean;
  finishIsSafe: boolean;
};

function contextOf(state: GameState, playerIndex: number): TurnContext {
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  const ev = expectedDeckValue(players, state.discard);
  const ownEstimate = estimatedScore(player, ev);
  const opponentEstimates = players
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => estimatedScore(candidate, ev));
  const bestOpponentEstimate = opponentEstimates.length ? Math.min(...opponentEstimates) : ownEstimate;
  const finishing = unrevealedCount(player) === 1;
  const finishIsSafe = ownEstimate < bestOpponentEstimate - 1;
  return { ev, ownEstimate, bestOpponentEstimate, finishing, finishIsSafe };
}

function completionBonusAt(player: Player, index: number, value: number) {
  return completionBonus(player, index, value);
}

// True if the given player could complete a column triplet (clear) with a card of
// the given value, i.e. a discard of that value would hand them a clear.
function helpsNextPlayerTriplet(player: Player, value: number): boolean {
  for (let column = 0; column < 4; column += 1) {
    const cells = rowColumnIndexes(column).map((index) => player.grid[index]);
    if (cells.some((cell) => !cell.card)) continue; // cleared cell rules out a triplet
    const matching = cells.filter((cell) => cell.card && cell.revealed && cell.card.value === value);
    if (matching.length >= 2) return true;
  }
  return false;
}

export function bestReplacement(player: Player, value: number, ev: number, allPlayers: Player[]) {
  const ownEstimate = estimatedScore(player, ev);
  const opponentEstimates = allPlayers
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => estimatedScore(candidate, ev));
  const bestOpponent = opponentEstimates.length ? Math.min(...opponentEstimates) : ownEstimate;
  const roundIsDangerous = unrevealedCount(player) <= 2 && ownEstimate > bestOpponent + 4;
  const hiddenCount = unrevealedCount(player);
  const lateGame = hiddenCount <= STRATEGY_TUNING.lateGameHidden;
  const allRevealedGood = player.grid.every(
    (cell) => !cell.card || !cell.revealed || cell.card.value <= STRATEGY_TUNING.goodRevealedMax,
  );
  const playerIndex = allPlayers.findIndex((candidate) => candidate.id === player.id);
  const nextPlayer = allPlayers[(playerIndex + 1) % allPlayers.length];

  return player.grid.reduce(
    (best, cell, index) => {
      if (!cell.card) return best;
      const currentValue = cell.revealed ? cell.card.value : ev;
      let improvement = currentValue - value + completionBonusAt(player, index, value);
      if (roundIsDangerous && !cell.revealed) improvement -= 4.5;
      if (cell.revealed && cell.card.value >= 8 && value <= 4) improvement += 1.5;
      if (lateGame && cell.revealed && cell.card.value >= STRATEGY_TUNING.lateGameHigh && value <= 4) {
        improvement += STRATEGY_TUNING.lateGameBonus;
      }
      if (!cell.revealed && !allRevealedGood) improvement -= STRATEGY_TUNING.hiddenReplacePenalty;
      if (cell.card && helpsNextPlayerTriplet(nextPlayer, cell.card.value)) {
        improvement -= STRATEGY_TUNING.nextPlayerTripletPenalty;
      }
      const peers = rowColumnIndexes(index % 4)
        .filter((cellIndex) => cellIndex !== index)
        .map((cellIndex) => player.grid[cellIndex])
        .filter((cell) => cell.card && cell.revealed)
        .map((cell) => cell.card?.value ?? 99);
      if (peers.length === 2 && peers[0] === peers[1] && peers[0] > 0 && value !== peers[0]) {
        improvement -= 5;
      }
      return improvement > best.improvement ? { index, improvement } : best;
    },
    { index: -1, improvement: Number.NEGATIVE_INFINITY },
  );
}

function basicBestReplacement(player: Player, value: number, ev: number) {
  let best = { index: -1, improvement: Number.NEGATIVE_INFINITY };
  player.grid.forEach((cell, index) => {
    if (!cell.card) return;
    const current = cell.revealed ? cell.card.value : ev;
    const improvement = current - value + (Math.random() * 2 - 1);
    if (improvement > best.improvement) best = { index, improvement };
  });
  return best;
}

function revealOptionScores(player: Player, ev: number, allPlayers: Player[]) {
  const hidden = player.grid
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.card && !cell.revealed);
  if (hidden.length === 0) return [];

  const ownEstimate = estimatedScore(player, ev);
  const opponentEstimates = allPlayers
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => estimatedScore(candidate, ev));
  const bestOpponent = opponentEstimates.length ? Math.min(...opponentEstimates) : ownEstimate;
  const finishing = hidden.length === 1;
  const finishIsSafe = ownEstimate < bestOpponent - 1;
  const scoutStrength = Math.min(
    1,
    Math.max(
      0,
      (hidden.length - REVEAL_TUNING.scoutDecayFloor) /
        (REVEAL_TUNING.scoutDecayThreshold - REVEAL_TUNING.scoutDecayFloor),
    ),
  );

  return hidden
    .map(({ index }) => {
      const peers = rowColumnIndexes(index % 4)
        .filter((cellIndex) => cellIndex !== index)
        .map((cellIndex) => player.grid[cellIndex])
        .filter((cell) => cell.card && cell.revealed)
        .map((cell) => cell.card?.value ?? 99);
      let score = 0;
      if (peers.length === 2) {
        if (peers[0] === peers[1]) {
          if (peers[0] > 0) score = 60 + peers[0] * 3;
          else if (peers[0] === 0) score = 25;
          else score = -60;
        } else {
          score = REVEAL_TUNING.twoUnequal;
        }
      } else if (peers.length === 1) {
        const peer = peers[0];
        if (peer < 0) {
          score = -REVEAL_TUNING.avoidNegativeProbe;
        } else {
          score = REVEAL_TUNING.pairProbe + REVEAL_TUNING.probeHighCard * peer;
        }
      } else {
        score = REVEAL_TUNING.scoutFresh * scoutStrength;
      }
      if (finishing && finishIsSafe) score += 30;
      if (finishing && !finishIsSafe) score -= 40;
      score += Math.random() * 0.5;
      return { index, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function chooseRevealIndex(player: Player, ev: number, allPlayers: Player[]) {
  const options = revealOptionScores(player, ev, allPlayers);
  return options.length ? options[0].index : -1;
}

function topRevealIndices(player: Player, ev: number, allPlayers: Player[], k: number) {
  return revealOptionScores(player, ev, allPlayers)
    .slice(0, k)
    .map((item) => item.index);
}

function randomHiddenIndex(player: Player) {
  const hidden = player.grid
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => cell.card && !cell.revealed);
  if (hidden.length === 0) return -1;
  return hidden[Math.floor(Math.random() * hidden.length)].index;
}

function discardReason(
  state: GameState,
  playerIndex: number,
  top: Card,
  plan: { index: number; improvement: number },
  ctx: TurnContext,
  bonus: number,
) {
  const name = state.players[playerIndex].name;
  const label = getCardLabel(top.value);
  if (bonus > 0) return `${name} took the discard ${label} to chase a column clear.`;
  if (top.value <= 0) return `${name} grabbed the discard ${label} to keep the grid low.`;
  if (plan.improvement > Math.max(1.2, ctx.ev - top.value + 0.5)) {
    return `${name} took the discard ${label} because it beats the deck value.`;
  }
  return `${name} took the discard ${label} to improve the grid.`;
}

function replaceReason(
  state: GameState,
  playerIndex: number,
  card: Card,
  plan: { index: number; improvement: number },
  _ctx: TurnContext,
  bonus: number,
) {
  const name = state.players[playerIndex].name;
  const label = getCardLabel(card.value);
  if (bonus > 0) return `${name} drew ${label} and completed a column clear.`;
  if (card.value <= 0) return `${name} drew ${label} and used it to lower the grid.`;
  if (plan.improvement > 1.25) return `${name} drew ${label} and upgraded the grid.`;
  return `${name} drew ${label} and swapped it into the grid.`;
}

function revealReason(
  state: GameState,
  playerIndex: number,
  card: Card,
  ctx: TurnContext,
  revealIndex: number,
  player: Player,
) {
  const name = state.players[playerIndex].name;
  const label = getCardLabel(card.value);
  const peers = rowColumnIndexes(revealIndex % 4)
    .filter((cellIndex) => cellIndex !== revealIndex)
    .map((cellIndex) => player.grid[cellIndex])
    .filter((cell) => cell.card && cell.revealed)
    .map((cell) => cell.card?.value ?? 99);
  const clearChase = peers.length === 2 && peers[0] === peers[1] && peers[0] >= 0;
  if (ctx.finishing && !ctx.finishIsSafe) {
    return `${name} declined ${label} to avoid finishing the round too early.`;
  }
  if (clearChase) return `${name} declined ${label} and revealed a card to chase a column clear.`;
  if (peers.length === 0) {
    return `${name} declined ${label} and revealed a card to scout the grid for column clears.`;
  }
  return `${name} declined ${label} and revealed a hidden card instead.`;
}

function buildCandidates(state: GameState, playerIndex: number, quality: LevelConfig["quality"]): AiTurnPlan[] {
  const ctx = contextOf(state, playerIndex);
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  const discardTop = state.discard[state.discard.length - 1] ?? null;
  const drawn = drawFromDeck(state.deck, state.discard);
  const candidates: AiTurnPlan[] = [];

  if (discardTop) {
    const plan =
      quality.replace === "smart"
        ? bestReplacement(player, discardTop.value, ctx.ev, players)
        : basicBestReplacement(player, discardTop.value, ctx.ev);
    const bonus = plan.index >= 0 ? completionBonusAt(player, plan.index, discardTop.value) : 0;
    candidates.push({
      source: "discard",
      replaceIndex: plan.index === -1 ? 0 : plan.index,
      reason: discardReason(state, playerIndex, discardTop, plan, ctx, bonus),
    });
  }

  if (drawn.card) {
    const rp =
      quality.replace === "smart"
        ? bestReplacement(player, drawn.card.value, ctx.ev, players)
        : basicBestReplacement(player, drawn.card.value, ctx.ev);
    const bonus = rp.index >= 0 ? completionBonusAt(player, rp.index, drawn.card.value) : 0;
    candidates.push({
      source: "deck",
      useDrawn: true,
      replaceIndex: rp.index === -1 ? 0 : rp.index,
      reason: replaceReason(state, playerIndex, drawn.card, rp, ctx, bonus),
    });

    const revealIndex =
      quality.reveal === "smart" ? chooseRevealIndex(player, ctx.ev, players) : randomHiddenIndex(player);
    if (revealIndex !== -1) {
      candidates.push({
        source: "deck",
        useDrawn: false,
        revealIndex,
        reason: revealReason(state, playerIndex, drawn.card, ctx, revealIndex, player),
      });
    }
  }
  return candidates;
}

export function heuristicPlan(state: GameState, playerIndex: number, quality: LevelConfig["quality"]): AiTurnPlan {
  const ctx = contextOf(state, playerIndex);
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  const discardTop = state.discard[state.discard.length - 1] ?? null;
  const hiddenCount = unrevealedCount(player);
  const earlyGame = hiddenCount >= STRATEGY_TUNING.earlyRevealHidden;
  const nextPlayer = players[(playerIndex + 1) % players.length];

  if (discardTop) {
    const dp =
      quality.replace === "smart"
        ? bestReplacement(player, discardTop.value, ctx.ev, players)
        : basicBestReplacement(player, discardTop.value, ctx.ev);
    const bonus = dp.index >= 0 ? completionBonusAt(player, dp.index, discardTop.value) : 0;
    const dpTargetHidden = dp.index >= 0 && !player.grid[dp.index].revealed;
    const earlyDiscardHidden = earlyGame && dpTargetHidden;
    const useDiscard =
      discardTop.value <= 0 ||
      bonus > 0 ||
      (state.deck.length === 0 && state.discard.length === 1) ||
      (!earlyDiscardHidden &&
        ((discardTop.value <= 4 && dp.improvement > (earlyGame ? 0.8 : -0.4)) ||
          dp.improvement > Math.max(earlyGame ? 2.2 : 1.2, ctx.ev - discardTop.value + (earlyGame ? 1.5 : 0.5))));
    if (useDiscard) {
      return {
        source: "discard",
        replaceIndex: dp.index === -1 ? 0 : dp.index,
        reason: discardReason(state, playerIndex, discardTop, dp, ctx, bonus),
      };
    }
  }

  const drawn = drawFromDeck(state.deck, state.discard);
  if (!drawn.card) {
    if (discardTop) {
      return { source: "discard", replaceIndex: 0, reason: `${state.players[playerIndex].name} had no cards left to draw.` };
    }
    return { source: "deck", useDrawn: true, replaceIndex: 0, reason: `${state.players[playerIndex].name} had no move available.` };
  }

  const rp =
    quality.replace === "smart"
      ? bestReplacement(player, drawn.card.value, ctx.ev, players)
      : basicBestReplacement(player, drawn.card.value, ctx.ev);
  const bonus = rp.index >= 0 ? completionBonusAt(player, rp.index, drawn.card.value) : 0;
  const drawnHelpsNext = helpsNextPlayerTriplet(nextPlayer, drawn.card.value);
  const rpTargetHidden = rp.index >= 0 && !player.grid[rp.index].revealed;
  const earlyHiddenTrade = earlyGame && rpTargetHidden;
  const shouldReplace =
    hiddenCount === 0 ||
    drawn.card.value <= 0 ||
    bonus > 0 ||
    (!earlyHiddenTrade && rp.improvement > (earlyGame ? STRATEGY_TUNING.earlyReplaceThreshold : 1.25)) ||
    (!earlyGame && drawn.card.value <= 4 && rp.improvement > -0.8) ||
    (drawnHelpsNext && rp.improvement > -4);

  if (shouldReplace && rp.index >= 0) {
    return {
      source: "deck",
      useDrawn: true,
      replaceIndex: rp.index,
      reason: replaceReason(state, playerIndex, drawn.card, rp, ctx, bonus),
    };
  }

  const revealIndex = quality.reveal === "smart" ? chooseRevealIndex(player, ctx.ev, players) : randomHiddenIndex(player);
  if (revealIndex === -1) {
    return {
      source: "deck",
      useDrawn: true,
      replaceIndex: rp.index === -1 ? 0 : rp.index,
      reason: `${state.players[playerIndex].name} had no hidden cards and replaced a grid card.`,
    };
  }
  return {
    source: "deck",
    useDrawn: false,
    revealIndex,
    reason: revealReason(state, playerIndex, drawn.card, ctx, revealIndex, player),
  };
}

const POLICY_QUALITY: LevelConfig["quality"] = { replace: "smart", reveal: "smart" };

function policyPlan(state: GameState, playerIndex: number): AiTurnPlan {
  return heuristicPlan(state, playerIndex, POLICY_QUALITY);
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    players: clonePlayers(state.players),
    deck: state.deck.map((card) => ({ ...card })),
    discard: state.discard.map((card) => ({ ...card })),
  };
}

function sampleHidden(state: GameState) {
  const counts: Record<number, number> = { ...countKnownCards(state.players, state.discard) };
  const pickValue = () => {
    const entries = Object.entries(counts).filter(([, amount]) => amount > 0);
    if (entries.length === 0) return 5;
    const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
    let roll = Math.random() * total;
    for (const [rawValue, amount] of entries) {
      roll -= amount;
      if (roll <= 0) {
        counts[Number(rawValue)] = amount - 1;
        return Number(rawValue);
      }
    }
    const last = entries[entries.length - 1];
    counts[Number(last[0])] = last[1] - 1;
    return Number(last[0]);
  };

  state.players.forEach((player) => {
    player.grid.forEach((cell) => {
      if (cell.card && !cell.revealed) cell.card = { ...cell.card, value: pickValue() };
    });
  });

  const deckLength = state.deck.length;
  const rebuilt: Card[] = [];
  Object.entries(counts).forEach(([rawValue, amount]) => {
    const value = Number(rawValue);
    for (let i = 0; i < amount; i += 1) {
      rebuilt.push({ id: `${value}-sim-${i}-${Math.random().toString(36).slice(2)}`, value });
    }
  });
  state.deck = shuffle(rebuilt).slice(0, deckLength);
}

function applyPlan(state: GameState, playerIndex: number, plan: AiTurnPlan): GameState {
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  if (plan.source === "discard") {
    const top = state.discard[state.discard.length - 1];
    if (!top) return state;
    const discard = state.discard.slice(0, -1);
    const replaced = replaceGridCard(player, plan.replaceIndex, top);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...discard, replaced.oldCard] : discard;
    return completeTurn(state, players, state.deck, nextDiscard, playerIndex, "");
  }
  const drawn = drawFromDeck(state.deck, state.discard);
  if (!drawn.card) return state;
  if (plan.useDrawn) {
    const replaced = replaceGridCard(player, plan.replaceIndex, drawn.card);
    players[playerIndex] = replaced.player;
    const nextDiscard = replaced.oldCard ? [...drawn.discard, replaced.oldCard] : drawn.discard;
    return completeTurn(state, players, drawn.deck, nextDiscard, playerIndex, "");
  }
  const revealed = revealGridCard(player, plan.revealIndex);
  players[playerIndex] = revealed.player;
  return completeTurn(state, players, drawn.deck, [...drawn.discard, drawn.card], playerIndex, "");
}

function simulateOnce(state: GameState, playerIndex: number, plan: AiTurnPlan): number {
  let s = cloneGameState(state);
  s = applyPlan(s, playerIndex, plan);
  if (s.phase === "roundOver" || s.phase === "gameOver") return s.players[playerIndex].roundScore;
  sampleHidden(s);
  let guard = 0;
  while (s.phase === "chooseSource" && guard < 300) {
    guard += 1;
    s = applyPlan(s, s.currentPlayer, policyPlan(s, s.currentPlayer));
  }
  if (s.phase !== "roundOver" && s.phase !== "gameOver") s = scoreRound(s, s.players, "");
  return s.players[playerIndex].roundScore;
}

function monteCarloScore(state: GameState, playerIndex: number, plan: AiTurnPlan, budgetMs: number, maxSimulations: number) {
  const start = performance.now();
  let total = 0;
  let count = 0;
  while (count < maxSimulations) {
    if (performance.now() - start >= budgetMs) break;
    total += simulateOnce(state, playerIndex, plan);
    count += 1;
  }
  return count > 0 ? total / count : Number.POSITIVE_INFINITY;
}

function refineRevealIndex(
  state: GameState,
  playerIndex: number,
  plan: Extract<AiTurnPlan, { source: "deck"; useDrawn: false }>,
  budgetMs: number,
  cfg: LevelConfig,
): AiTurnPlan {
  const players = clonePlayers(state.players);
  const player = players[playerIndex];
  const ctx = contextOf(state, playerIndex);
  const indices = topRevealIndices(player, ctx.ev, players, REVEAL_TUNING.mcRevealCandidates);
  const drawnCard = drawFromDeck(state.deck, state.discard).card;
  if (!drawnCard) return plan;

  const perIndexBudget = Math.max(1, Math.floor(budgetMs / indices.length));
  let best = plan;
  let bestValue = Number.POSITIVE_INFINITY;
  indices.forEach((revealIndex) => {
    const candidate: AiTurnPlan = {
      source: "deck",
      useDrawn: false,
      revealIndex,
      reason: revealReason(state, playerIndex, drawnCard, ctx, revealIndex, player),
    };
    const value = monteCarloScore(state, playerIndex, candidate, perIndexBudget, cfg.simulations);
    if (value < bestValue) {
      bestValue = value;
      best = candidate;
    }
  });
  return best;
}

export function think(state: GameState, playerIndex: number, level: AiLevel): AiTurnPlan {
  const cfg = LEVEL_CONFIG[level];
  const candidates = buildCandidates(state, playerIndex, cfg.quality);
  if (candidates.length === 0) {
    return {
      source: "deck",
      useDrawn: true,
      replaceIndex: 0,
      reason: `${state.players[playerIndex]?.name ?? "Player"} had no move available.`,
    };
  }

  if (cfg.simulations <= 0) {
    if (Math.random() < cfg.noise) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return heuristicPlan(state, playerIndex, cfg.quality);
  }

  const start = performance.now();
  const perCandidateBudget = Math.max(1, Math.floor(cfg.timeBudgetMs / candidates.length));
  let best = candidates[0];
  let bestValue = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate) => {
    const value = monteCarloScore(state, playerIndex, candidate, perCandidateBudget, cfg.simulations);
    if (value < bestValue) {
      bestValue = value;
      best = candidate;
    }
  });
  if (Math.random() < cfg.noise) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  if (level === "hard" && best.source === "deck" && !best.useDrawn && cfg.quality.reveal === "smart") {
    const remaining = cfg.timeBudgetMs - (performance.now() - start);
    if (remaining > 5) {
      return refineRevealIndex(state, playerIndex, best, remaining, cfg);
    }
  }
  return best;
}
