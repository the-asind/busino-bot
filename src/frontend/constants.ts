import { BlindStructure, Lobby } from './types';

export const BLIND_STRUCTURES: BlindStructure[] = [
  { small: 1, big: 2, label: '1 / 2' },
  { small: 3, big: 6, label: '3 / 6' },
  { small: 5, big: 10, label: '5 / 10' },
  { small: 10, big: 20, label: '10 / 20' },
  { small: 25, big: 50, label: '25 / 50' },
];

export const MOCK_LOBBIES: Lobby[] = [
  { id: 1, name: "Пятничный покер", isPrivate: false, playersCount: 4, maxPlayers: 6, blinds: BLIND_STRUCTURES[0], status: 'playing' },
  { id: 2, name: "Хайроллеры", isPrivate: true, playersCount: 2, maxPlayers: 6, blinds: BLIND_STRUCTURES[4], status: 'waiting' },
  { id: 3, name: "Тестовый стол", isPrivate: false, playersCount: 1, maxPlayers: 6, blinds: BLIND_STRUCTURES[2], status: 'waiting' },
];