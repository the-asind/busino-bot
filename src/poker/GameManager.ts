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

        const joined = await table.addPlayer({ id: userId, name: userName, coins: coins }, broadcaster);

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
                if (tableId > 2 && table.activePlayerCount === 0) { // Keep first 2 tables
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
}
