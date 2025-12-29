import { CardData, Rank, Suit } from './types';

// Numeric values for ranks
const RANK_VALUE: Record<Rank, number> = {
  [Rank.TWO]: 2, [Rank.THREE]: 3, [Rank.FOUR]: 4, [Rank.FIVE]: 5,
  [Rank.SIX]: 6, [Rank.SEVEN]: 7, [Rank.EIGHT]: 8, [Rank.NINE]: 9,
  [Rank.TEN]: 10, [Rank.JACK]: 11, [Rank.QUEEN]: 12, [Rank.KING]: 13, [Rank.ACE]: 14
};

export interface HandEvaluation {
  score: number;
  name: string;
  bestCards: CardData[]; // All 5 cards (including kickers) used for comparison
  handCards: CardData[]; // Only the cards that form the specific combination (for UI highlighting)
}

// Helper to sort cards by Rank descending
const sortByRank = (cards: CardData[]) => {
  return [...cards].sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank]);
};

// Check for Flush
const getFlush = (cards: CardData[]): CardData[] | null => {
  const suits: Record<string, CardData[]> = {};
  for (const card of cards) {
    if (!suits[card.suit]) suits[card.suit] = [];
    suits[card.suit].push(card);
  }
  for (const suit in suits) {
    if (suits[suit].length >= 5) {
      return sortByRank(suits[suit]).slice(0, 5);
    }
  }
  return null;
};

// Check for Straight
const getStraight = (cards: CardData[]): CardData[] | null => {
  const uniqueRankCards: CardData[] = [];
  const seenRanks = new Set<number>();

  const sorted = sortByRank(cards);

  for (const card of sorted) {
    const val = RANK_VALUE[card.rank];
    if (!seenRanks.has(val)) {
      seenRanks.add(val);
      uniqueRankCards.push(card);
    }
  }

  if (uniqueRankCards.length < 5) return null;

  for (let i = 0; i <= uniqueRankCards.length - 5; i++) {
    const currentVal = RANK_VALUE[uniqueRankCards[i].rank];
    const fifthVal = RANK_VALUE[uniqueRankCards[i + 4].rank];
    if (currentVal - fifthVal === 4) {
      return uniqueRankCards.slice(i, i + 5);
    }
  }

  // Wheel (A-2-3-4-5)
  const hasAce = seenRanks.has(14);
  const has5432 = [5, 4, 3, 2].every(r => seenRanks.has(r));

  if (hasAce && has5432) {
    const wheelCards = uniqueRankCards.filter(c => [5, 4, 3, 2].includes(RANK_VALUE[c.rank]));
    const ace = uniqueRankCards.find(c => RANK_VALUE[c.rank] === 14)!;
    return [ ...wheelCards, ace ];
  }

  return null;
};

// Group by Rank
const getGroups = (cards: CardData[]) => {
  const groups: Record<number, CardData[]> = {};
  for (const card of cards) {
    const val = RANK_VALUE[card.rank];
    if (!groups[val]) groups[val] = [];
    groups[val].push(card);
  }
  return Object.values(groups).sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return RANK_VALUE[b[0].rank] - RANK_VALUE[a[0].rank];
  });
};

export const evaluateHand = (holeCards: CardData[], communityCards: CardData[]): HandEvaluation => {
  const allCards = [...holeCards, ...communityCards];
  const validCards = allCards.filter(c => c !== null && c !== undefined);

  if (validCards.length < 5) {
      // Preflop or early stage: Check for Pair or High Card
      const groups = getGroups(validCards);
      if (groups[0].length === 2) {
          const pair = groups[0];
          return {
              score: 2000000 + RANK_VALUE[pair[0].rank],
              name: 'Пара',
              bestCards: pair,
              handCards: pair // Highlight both cards of the pair
          };
      }

      const best = sortByRank(validCards).slice(0, 5);
      return {
          score: 0,
          name: 'High Card',
          bestCards: best,
          handCards: [best[0]] // Highlight only the highest card
      };
  }

  const flush = getFlush(validCards);
  const straight = getStraight(validCards);
  const groups = getGroups(validCards);

  // 1. Straight Flush
  if (flush) {
     const straightFlush = getStraight(flush);
     if (straightFlush) {
        return {
            score: 9000000 + RANK_VALUE[straightFlush[0].rank],
            name: 'Стрит-флеш',
            bestCards: straightFlush,
            handCards: straightFlush
        };
     }
  }

  // 2. Four of a Kind
  if (groups[0].length === 4) {
    const main = groups[0];
    const remaining = validCards.filter(c => !main.includes(c));
    const kicker = sortByRank(remaining)[0];
    return {
        score: 8000000 + RANK_VALUE[main[0].rank] * 100 + (kicker ? RANK_VALUE[kicker.rank] : 0),
        name: 'Каре',
        bestCards: [...main, kicker].filter(Boolean),
        handCards: main // Highlight only the Quads
    };
  }

  // 3. Full House
  if (groups[0].length === 3 && groups.length > 1 && groups[1].length >= 2) {
    const bestHouse = [...groups[0], ...groups[1].slice(0, 2)];
    return {
        score: 7000000 + RANK_VALUE[groups[0][0].rank] * 100 + RANK_VALUE[groups[1][0].rank],
        name: 'Фулл-хаус',
        bestCards: bestHouse,
        handCards: bestHouse
    };
  }

  // 4. Flush
  if (flush) {
    return {
        score: 6000000 + RANK_VALUE[flush[0].rank],
        name: 'Флеш',
        bestCards: flush,
        handCards: flush
    };
  }

  // 5. Straight
  if (straight) {
    return {
        score: 5000000 + RANK_VALUE[straight[0].rank],
        name: 'Стрит',
        bestCards: straight,
        handCards: straight
    };
  }

  // 6. Three of a Kind
  if (groups[0].length === 3) {
    const main = groups[0];
    const remaining = validCards.filter(c => !main.includes(c));
    const kickers = sortByRank(remaining).slice(0, 2);
    return {
        score: 4000000 + RANK_VALUE[main[0].rank],
        name: 'Тройка',
        bestCards: [...main, ...kickers],
        handCards: main // Highlight only the Trips
    };
  }

  // 7. Two Pair
  if (groups[0].length === 2 && groups[1].length === 2) {
    const main = [...groups[0], ...groups[1]];
    const remaining = validCards.filter(c => !main.includes(c));
    const kicker = sortByRank(remaining)[0];
    return {
        score: 3000000 + RANK_VALUE[groups[0][0].rank] * 100 + RANK_VALUE[groups[1][0].rank],
        name: 'Две пары',
        bestCards: [...main, kicker].filter(Boolean),
        handCards: main // Highlight both pairs, no kicker
    };
  }

  // 8. Pair
  if (groups[0].length === 2) {
    const main = groups[0];
    const remaining = validCards.filter(c => !main.includes(c));
    const kickers = sortByRank(remaining).slice(0, 3);
    return {
        score: 2000000 + RANK_VALUE[main[0].rank],
        name: 'Пара',
        bestCards: [...main, ...kickers],
        handCards: main // Highlight only the Pair
    };
  }

  // 9. High Card
  const best5 = sortByRank(validCards).slice(0, 5);
  return {
      score: 1000000 + RANK_VALUE[best5[0].rank],
      name: 'Старшая карта',
      bestCards: best5,
      handCards: [best5[0]] // Highlight only the single highest card
  };
};
