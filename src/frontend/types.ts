export enum Suit {
  HEARTS = '♥',
  DIAMONDS = '♦',
  CLUBS = '♣',
  SPADES = '♠'
}

export enum Rank {
  TWO = '2', THREE = '3', FOUR = '4', FIVE = '5', SIX = '6',
  SEVEN = '7', EIGHT = '8', NINE = '9', TEN = '10',
  JACK = 'J', QUEEN = 'Q', KING = 'K', ACE = 'A'
}

export interface CardData {
  suit: Suit;
  rank: Rank;
}

export enum GameStage {
  PREFLOP = 'Префлоп',
  FLOP = 'Флоп',
  TURN = 'Тёрн',
  RIVER = 'Ривер',
  SHOWDOWN = 'Вскрытие'
}

export interface Player {
  id: number;
  name: string;
  avatarUrl: string;
  balance: number;
  currentBet: number;
  roundBet: number;
  isFolded: boolean;
  isDealer: boolean;
  isTurn: boolean;
  isAllIn?: boolean;
  cards?: [CardData, CardData] | null; // Null for opponents until showdown
  action?: 'Check' | 'Call' | 'Raise' | 'Fold' | 'All-in' | 'Win' | 'Small Blind' | 'Big Blind' | null;
  winningHand?: string;
  isWinner?: boolean;
}

export interface BlindStructure {
  small: number;
  big: number;
  label: string;
}

export interface Lobby {
  id: number;
  name: string;
  isPrivate: boolean;
  playersCount: number;
  maxPlayers: number;
  blinds: BlindStructure;
  status: 'waiting' | 'playing';
}

export interface GameState {
  pot: number;
  communityCards: CardData[];
  stage: GameStage;
  minRaise: number;
  currentCallAmount: number;
  dealerIdx: number;
  winningCards?: number[];
  spectatorCount: number;
  blinds?: BlindStructure;
}

// --- PROTOCOL DEFINITIONS ---

// 1. Client -> Server Actions
export type ClientActionType = 'JOIN' | 'FOLD' | 'CHECK' | 'CALL' | 'RAISE';

export interface ClientMessage {
  type: ClientActionType;
  amount?: number; // For Raise
  lobbyId?: number; // For Join
  seatIndex?: number; // For Join specific seat
}

// 2. Server -> Client Events
export type ServerEventType =
  | 'SNAPSHOT'       // Full state update (heavy)
  | 'PLAYER_ACTION'  // Someone did something (for logs/sounds)
  | 'GAME_STAGE'     // Flop/Turn/River dealt
  | 'GAME_OVER'      // Round ended
  | 'ERROR';         // Operation failed

export interface ServerMessage {
  type: ServerEventType | 'EMOTE';
  payload: {
    players?: (Player | null)[]; // Changed to allow nulls for empty seats
    gameState?: GameState;
    stage?: string;
    action?: any;
    playerId?: number;
    amount?: number;
    error?: string;
    stickerId?: number; // For EMOTE
    cards?: [CardData, CardData];
  };
}

export interface PlayerActionEvent {
  playerId: number;
  action: 'Fold' | 'Check' | 'Call' | 'Raise' | 'Win';
  amount?: number;
  cards?: [CardData, CardData];
}