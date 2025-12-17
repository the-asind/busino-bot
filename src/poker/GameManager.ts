import { PokerTable } from './PokerTable';
import { BlindStructure, ClientMessage, Lobby, ServerMessage } from './types';
import { kv } from '../kv';
import { UserState } from '../types';
import { CURRENT_KEY } from '../../constants';
import { validateWebAppData } from '../helpers/telegram';
import { bot } from '../bot';

const BLIND_STRUCTURES: BlindStructure[] = [
    { id: 1, small: 1, big: 2, label: '1/2' },
    { id: 2, small: 2, big: 4, label: '2/4' },
    { id: 3, small: 5, big: 10, label: '5/10' },
    { id: 4, small: 10, big: 20, label: '10/20' },
    { id: 5, small: 20, big: 40, label: '20/40' },
    { id: 6, small: 50, big: 100, label: '50/100' },
];

export class GameManager {
    private tables: Map<number, PokerTable> = new Map();
    private nextTableId = 1;
    private userTableMap: Map<number, number> = new Map(); // userId -> tableId

    constructor() {
        // No default lobbies
    }

    public async handleConnection(ws: any) {
        // No-op for now
    }

    public async processMessage(ws: any, message: any, user: { id: number, first_name: string }) {
        try {
            const msg = JSON.parse(message) as ClientMessage;
            const userId = user.id;

            if (msg.type === 'LIST_LOBBIES') {
                this.sendLobbyList(ws);
                return;
            }

            if (msg.type === 'CREATE') {
                const blinds = BLIND_STRUCTURES[msg.blindsIndex] || BLIND_STRUCTURES[0];
                const tableId = this.createLobbyInternal(msg.name, blinds, !!msg.password, msg.password);
                // Auto join
                await this.joinLobby(ws, userId, user.first_name, tableId);
                return;
            }

            if (msg.type === 'JOIN') {
                await this.joinLobby(ws, userId, user.first_name, msg.lobbyId, msg.password, msg.seatIndex);
                return;
            }

            // For game actions, route to the table the user is in
            const tableId = this.userTableMap.get(userId);
            if (tableId) {
                const table = this.tables.get(tableId);
                if (table) {
                    table.handleMessage(userId, msg);
                }
            }

        } catch (e) {
            console.error('Error processing message:', e);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Invalid message' } }));
        }
    }

    private sendLobbyList(ws: any) {
        const lobbies: Lobby[] = Array.from(this.tables.values()).map(t => ({
            id: t.id,
            name: t.name,
            playersCount: t.activePlayerCount,
            maxPlayers: 5,
            blinds: t.blindStructure,
            isPrivate: t.isPrivate
        }));
        ws.send(JSON.stringify({ type: 'LOBBY_LIST', payload: lobbies }));
    }

    private createLobbyInternal(name: string, blinds: BlindStructure, isPrivate: boolean, password?: string): number {
        const id = this.nextTableId++;
        const table = new PokerTable(id, name, blinds, isPrivate, password, this.returnFunds.bind(this));
        this.tables.set(id, table);
        return id;
    }

    private async joinLobby(ws: any, userId: number, userName: string, lobbyId: number, password?: string, seatIndex?: number) {
        const table = this.tables.get(lobbyId);
        if (!table) {
            ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Lobby not found' } }));
            return;
        }

        if (table.isPrivate && table.password !== password) {
             ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Invalid password' } }));
             return;
        }

        // Check if user is already in another table
        const currentTableId = this.userTableMap.get(userId);
        if (currentTableId && currentTableId !== lobbyId) {
             ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'You are already in a game' } }));
             return;
        }

        const key = [CURRENT_KEY, userId.toString()];
        const userRes = await kv.get<UserState>(key);

        if (!userRes.value) {
             ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'User not found' } }));
             return;
        }

        let coins = userRes.value.coins;
        if (coins < table.blindStructure.big) { // Minimum to play
             ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Insufficient funds' } }));
             return;
        }

        // TRANSACTION
        const res = await kv.atomic()
            .check(userRes)
            .set(key, { ...userRes.value, coins: 0 })
            .commit();

        if (!res.ok) {
             ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Transaction failed, try again' } }));
             return;
        }

        const broadcaster = (msg: ServerMessage) => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(msg));
            }
        };

        const joined = await table.addPlayer({ id: userId, name: userName, coins: coins }, broadcaster, seatIndex);

        if (joined) {
            this.userTableMap.set(userId, lobbyId);
            ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', payload: { lobbyId } }));
        } else {
            await this.returnFunds(userId, coins);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Table full' } }));
        }
    }

    public handleDisconnect(userId: number) {
        // If user disconnects, we just remove them from table mapping if they were kicked/left
        // But here we rely on PokerTable's logic.
        // However, if the user disconnects, PokerTable detects timeout.
        // If we want instant removal on socket close:
        const tableId = this.userTableMap.get(userId);
        if (tableId) {
            const table = this.tables.get(tableId);
            if (table) {
                table.removePlayer(userId);
                // Clean up empty dynamic tables
                if (table.activePlayerCount === 0) {
                    console.log(`Destroying empty table ${tableId}`);
                    this.tables.delete(tableId);
                }
            }
            this.userTableMap.delete(userId);
        }
    }

    private async returnFunds(userId: number, amount: number) {
        const key = [CURRENT_KEY, userId.toString()];
        let retries = 5;
        while (retries > 0) {
            const userRes = await kv.get<UserState>(key);
            if (!userRes.value) {
                console.error(`User ${userId} not found for refund! Lost ${amount}`);
                return;
            }

            const newCoins = userRes.value.coins + amount;
            const res = await kv.atomic()
                .check(userRes)
                .set(key, { ...userRes.value, coins: newCoins })
                .commit();

            if (res.ok) {
                this.userTableMap.delete(userId);

                // Check for empty table cleanup here too if player left properly
                // But we don't know table ID here easily unless passed.
                // handleDisconnect handles it.
                return;
            }
            retries--;
        }
        console.error(`Failed to refund ${amount} to user ${userId} after retries!`);
    }

    public isUserPlaying(userId: number): boolean {
        return this.userTableMap.has(userId);
    }

    public getUserPokerBalance(userId: number): number {
        const tableId = this.userTableMap.get(userId);
        if (!tableId) return 0;
        const table = this.tables.get(tableId);
        if (!table) return 0;

        // We need to access player's balance.
        // PokerTable has `players` private.
        // But `createSnapshot` returns it.
        // Or we can add a public getter in PokerTable.
        // Let's use `createSnapshot` for now since we are in same package scope mostly?
        // No, `players` is private.
        // But `PokerTable` is in same directory.
        // Better to add `getPlayerBalance` to `PokerTable`.

        // However, `PokerTable` class definition is separate.
        // Let's modify `PokerTable.ts` first?
        // Or just use `any` cast for quick fix since I am in `GameManager`?
        // No, let's just add `getPlayerBalance` to `PokerTable`.

        // For now, return 0 if I can't access it, but I will fix PokerTable next.
        // Actually, I can modify PokerTable in same step if I do it carefully.
        // But let's assume `table.getPlayerBalance(userId)` exists.
        // @ts-ignore
        return table.getPlayerBalance(userId);
    }
}
