// src/poker/types.ts

export enum Suit {
    HEARTS = 'hearts',
    DIAMONDS = 'diamonds',
    CLUBS = 'clubs',
    SPADES = 'spades'
}

export enum Rank {
    TWO = 2, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, JACK, QUEEN, KING, ACE
}

export interface CardData {
    suit: Suit;
    rank: Rank;
}

export interface BlindStructure {
    id: number;
    small: number;
    big: number;
    label: string;
}

export enum GameStage {
    PREFLOP = 'PREFLOP',
    FLOP = 'FLOP',
    TURN = 'TURN',
    RIVER = 'RIVER',
    SHOWDOWN = 'SHOWDOWN'
}

export interface Player {
    id: number;
    name: string;
    avatarUrl: string;
    balance: number;
    currentBet: number;
    roundBet: number;
    isFolded: boolean;
    isAllIn: boolean;
    isDealer: boolean;
    isTurn: boolean;
    cards: [CardData, CardData] | null;
    action?: string | null;
    isWinner?: boolean;
    winningHand?: string;
    lastActiveTime?: number;
}

export interface GameState {
    pot: number;
    communityCards: CardData[];
    stage: GameStage;
    minRaise: number;
    currentCallAmount: number;
    dealerIdx: number;
    winningCards: number[];
    spectatorCount: number;
}

export interface Lobby {
    id: number;
    name: string;
    playersCount: number;
    maxPlayers: number;
    blinds: BlindStructure;
    isPrivate: boolean;
}

export type ServerMessage =
    | { type: 'SNAPSHOT', payload: { players: (Player | null)[], gameState: GameState } }
    | { type: 'GAME_STAGE', payload: { stage: string } }
    | { type: 'PLAYER_ACTION', payload: { playerId: number, action: string, amount?: number } }
    | { type: 'ERROR', payload: { error: string } }
    | { type: 'LOBBY_LIST', payload: Lobby[] }
    | { type: 'JOIN_SUCCESS', payload: { lobbyId: number } };

export type ClientMessage =
    | { type: 'JOIN', lobbyId: number, password?: string }
    | { type: 'CREATE', name: string, blindsIndex: number, password?: string }
    | { type: 'LEAVE' }
    | { type: 'FOLD' }
    | { type: 'CHECK' }
    | { type: 'CALL' }
    | { type: 'RAISE', amount: number }
    | { type: 'LIST_LOBBIES' };
