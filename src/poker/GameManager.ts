import { PokerTable } from './PokerTable';
import { BlindStructure, ClientMessage, Lobby, ServerMessage } from './types';
import { kv } from '../kv';
import { UserState } from '../types';
import { CURRENT_KEY } from '../../constants';
import { validateWebAppData } from '../helpers/telegram';
import { bot } from '../bot';

const BLIND_STRUCTURES: BlindStructure[] = [
    { id: 1, small: 10, big: 20, label: '10/20' },
    { id: 2, small: 25, big: 50, label: '25/50' },
    { id: 3, small: 50, big: 100, label: '50/100' },
    { id: 4, small: 100, big: 200, label: '100/200' },
    { id: 5, small: 500, big: 1000, label: '500/1K' },
];

export class GameManager {
    private tables: Map<number, PokerTable> = new Map();
    private nextTableId = 1;
    private userTableMap: Map<number, number> = new Map(); // userId -> tableId

    constructor() {
        // Create some default lobbies
        this.createLobbyInternal('Casual Table 1', BLIND_STRUCTURES[0], false);
        this.createLobbyInternal('High Rollers', BLIND_STRUCTURES[4], false);
    }

    public async handleConnection(ws: any) {
        // Wait for authentication message first?
        // Or we can expect the first message to be auth or join with auth.
        // For simplicity, let's assume we handle raw WS messages and expect a specific flow.
        // BUT, we need to know who the user is.
        // The standard way is sending initData as a query param or first message.
        // Let's assume the client sends initData in the URL query params.
    }

    public async processMessage(ws: any, message: any, user: { id: number, first_name: string }) {
        try {
            const msg = JSON.parse(message) as ClientMessage;
            const userId = user.id;

            if (msg.type === 'LIST_LOBBIES') {
                const lobbies: Lobby[] = Array.from(this.tables.values()).map(t => ({
                    id: t.id,
                    name: t.name,
                    playersCount: t.activePlayerCount,
                    maxPlayers: 5,
                    blinds: t.blindStructure,
                    isPrivate: t.isPrivate
                }));
                ws.send(JSON.stringify({ type: 'LOBBY_LIST', payload: lobbies }));
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
                await this.joinLobby(ws, userId, user.first_name, msg.lobbyId, msg.password);
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

    private createLobbyInternal(name: string, blinds: BlindStructure, isPrivate: boolean, password?: string): number {
        const id = this.nextTableId++;
        const table = new PokerTable(id, name, blinds, isPrivate, password, this.returnFunds.bind(this));
        this.tables.set(id, table);
        return id;
    }

    private async joinLobby(ws: any, userId: number, userName: string, lobbyId: number, password?: string) {
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

        // Deduct funds (Buy-in)
        // For simplicity, let's say buy-in is 100 * Big Blind or user's full balance if less?
        // Actually, the previous logic was "bring all balance".
        // Let's check user balance.

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

        // TRANSACTION: Move funds from KV to Game
        // We set coins to 0 in KV while they are in game to prevent double spend.
        // We'll restore it when they leave.
        // Optimistic locking with atomic check
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

        const joined = await table.addPlayer({ id: userId, name: userName, coins: coins }, broadcaster);

        if (joined) {
            this.userTableMap.set(userId, lobbyId);
            ws.send(JSON.stringify({ type: 'JOIN_SUCCESS', payload: { lobbyId } }));
        } else {
            // Refund immediately if join failed (full table)
            await this.returnFunds(userId, coins);
            ws.send(JSON.stringify({ type: 'ERROR', payload: { error: 'Table full' } }));
        }
    }

    public handleDisconnect(userId: number) {
        // If user disconnects, we might want to keep them at the table for a bit (timeout),
        // or remove them immediately.
        // The PokerTable handles timeouts.
        // If the socket closes, we just lose the broadcaster.
        // But the PokerTable logic will eventually kick them on timeout.

        // However, if we want to support reconnect, we shouldn't remove them here.
        // But if they just closed the app, they expect to leave.
        // Let's rely on the PokerTable's `removePlayer` which is called explicitly by LEAVE
        // or by timeout.
        // If connection drops, we do nothing. The player will timeout in game logic if they don't reconnect.
        // But wait, if they reconnect, they get a new WS.
        // addPlayer handles reconnect if ID matches.
    }

    private async returnFunds(userId: number, amount: number) {
        const key = [CURRENT_KEY, userId.toString()];
        let retries = 5;
        while (retries > 0) {
            const userRes = await kv.get<UserState>(key);
            if (!userRes.value) {
                // Should not happen
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
                return;
            }
            retries--;
        }
        console.error(`Failed to refund ${amount} to user ${userId} after retries!`);
    }
}
