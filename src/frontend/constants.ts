import { BlindStructure, Lobby } from './types';

export const BLIND_STRUCTURES: BlindStructure[] = [
    { id: 1, small: 1, big: 2, label: '1/2' },
    { id: 2, small: 2, big: 4, label: '2/4' },
    { id: 3, small: 5, big: 10, label: '5/10' },
    { id: 4, small: 10, big: 20, label: '10/20' },
    { id: 5, small: 20, big: 40, label: '20/40' },
    { id: 6, small: 50, big: 100, label: '50/100' },
];

export const MOCK_LOBBIES: Lobby[] = [];
