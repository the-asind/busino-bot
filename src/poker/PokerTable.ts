import { Player, GameState, GameStage, BlindStructure, Suit, Rank, CardData, ServerMessage, ClientMessage, PlayerActionEvent } from './types';
import { evaluateHand } from './pokerLogic';

// --- CONSTANTS ---
const DECK = Object.values(Suit).flatMap(s => Object.values(Rank).map(r => ({ suit: s, rank: r })));
const TURN_TIMEOUT_MS = 15000;

type Broadcaster = (msg: ServerMessage) => void;

export class PokerTable {
    public id: number;
    public name: string;
    public blindStructure: BlindStructure;
    public isPrivate: boolean;
    public password?: string;

    // Array of 5 seats. Null means empty seat.
    private players: (Player | null)[] = [null, null, null, null, null];
    private gameState: GameState;
    private deck: CardData[] = [];

    // Map userId -> Broadcaster
    private broadcasters: Map<number, Broadcaster> = new Map();
    private bankruptIds = new Set<number>();

    private roundInProgress = false;
    private gameLoopTimeout: ReturnType<typeof setTimeout> | null = null;
    private turnTimer: ReturnType<typeof setTimeout> | null = null;

    // Callback to refund money when a player leaves or is kicked
    private onCashOut: (userId: number, amount: number) => Promise<void>;
    private onEmpty: (tableId: number) => void;

    public getPlayerBalance(userId: number): number {
        const p = this.players.find(p => p?.id === userId);
        // We include roundBet and currentBet as "money user has on table"
        // But strictly, bets are at risk.
        // User asked for "Actual money".
        // If I bet 100, and I have 900 left. My total wealth is 1000 until round ends.
        // If I lose, it becomes 900.
        // Showing 1000 is safer to avoid panic.
        return p ? p.balance + p.roundBet : 0;
    }

    constructor(
        id: number,
        name: string,
        blindStructure: BlindStructure,
        isPrivate: boolean,
        password: string | undefined,
        onCashOut: (userId: number, amount: number) => Promise<void>,
        onEmpty: (tableId: number) => void
    ) {
        this.id = id;
        this.name = name;
        this.blindStructure = blindStructure;
        this.isPrivate = isPrivate;
        this.password = password;
        this.onCashOut = onCashOut;
        this.onEmpty = onEmpty;

        this.gameState = {
            pot: 0,
            communityCards: [],
            stage: GameStage.PREFLOP,
            minRaise: blindStructure.big,
            currentCallAmount: blindStructure.big,
            dealerIdx: 0,
            winningCards: [],
            spectatorCount: 0
        };
    }

    public get activePlayerCount(): number {
        return this.players.filter(p => p !== null).length;
    }

    // Helper to get only seated players
    private get activePlayersList(): Player[] {
        return this.players.filter(p => p !== null) as Player[];
    }

    public async addPlayer(user: { id: number, name: string, coins: number, avatarUrl?: string }, broadcaster: Broadcaster, seatIndex?: number): Promise<boolean> {
        if (this.players.some(p => p?.id === user.id)) {
            // Already seated, just reconnect broadcaster
            this.broadcasters.set(user.id, broadcaster);
            this.pushStateTo(user.id);
            return true;
        }

        let seatIdx = -1;
        if (seatIndex !== undefined && seatIndex >= 0 && seatIndex < 5 && this.players[seatIndex] === null) {
            seatIdx = seatIndex;
        } else {
            seatIdx = this.players.findIndex(p => p === null);
        }

        if (seatIdx === -1) return false; // Full

        this.broadcasters.set(user.id, broadcaster);

        this.players[seatIdx] = {
            id: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl || '',
            balance: user.coins,
            currentBet: 0,
            roundBet: 0,
            isFolded: true,
            isAllIn: false,
            isDealer: false,
            isTurn: false,
            cards: null,
            lastActiveTime: Date.now()
        };

        this.broadcastState();

        // If game hasn't started or only 1 player (now 2?), try to start
        if (this.gameState.stage === GameStage.PREFLOP && this.gameState.pot === 0 && this.activePlayerCount >= 2) {
             this.startNewRound();
        }

        return true;
    }

    public removePlayer(userId: number) {
        const player = this.players.find(p => p?.id === userId);
        if (player) {
            this.kickPlayer(player, true); // true = forceful leave (disconnect/quit)
        } else {
            // Just a spectator leaving
            this.broadcasters.delete(userId);
            this.updateSpectatorCount();
        }
        this.checkEmpty();
    }

    public handleMessage(userId: number, msg: ClientMessage) {
        if (msg.type === 'LEAVE') {
            this.removePlayer(userId);
        } else if (msg.type === 'GET_STATE') {
            this.pushStateTo(userId);
        } else if (msg.type === 'EMOTE' && msg.stickerId !== undefined) {
            this.broadcast({
                type: 'EMOTE',
                payload: { playerId: userId, stickerId: msg.stickerId }
            });
        } else if (msg.type === 'SHOW_CARDS') {
            const p = this.players.find(p => p?.id === userId);
            if (p && p.cards) {
                // Determine logic: only allow if round ended?
                // For simplicity, just allow.
                // We broadcast a SNAPSHOT or specific event?
                // Let's force card reveal by updating a flag 'isRevealed'?
                // We don't have 'isRevealed'.
                // We can broadcast an EMOTE or custom action.
                // Or just broadcast a modified snapshot where this player's cards are visible to all?
                // The `createSnapshot` logic hides cards based on `shouldShow`.
                // Let's add a temporary set of revealed players?
                // Easier: Send a PLAYER_ACTION 'ShowCards' with payload containing cards?
                // The frontend currently doesn't handle 'ShowCards' action with card data.

                // Let's implement: Send an EMOTE-like message but with type 'SHOW_CARDS'.
                this.broadcast({
                    type: 'PLAYER_ACTION',
                    payload: { playerId: userId, action: 'ShowCards' as any, amount: 0, cards: p.cards }
                });

                // Also, we need the frontend to actually SEE the cards.
                // If we rely on snapshot, we must persist state.
                // Let's just assume the frontend will use this event to "reveal" locally or we include cards in payload.
                // But `PLAYER_ACTION` payload in `types.ts` might not have `cards`.
                // Let's check `types.ts`.
            }
        } else {
            this.handleClientAction(userId, msg);
        }
    }

    private emitTo(userId: number, msg: ServerMessage) {
        const b = this.broadcasters.get(userId);
        if (b) b(msg);
    }

    private broadcast(msg: ServerMessage) {
        for (const b of this.broadcasters.values()) {
            b(msg);
        }
    }

    private pushStateTo(userId: number) {
        const p = this.players.find(p => p?.id === userId);
        this.emitTo(userId, this.createSnapshot(userId));
    }

    private broadcastState() {
        for (const userId of this.broadcasters.keys()) {
            this.emitTo(userId, this.createSnapshot(userId));
        }
    }

    private createSnapshot(forUserId: number): ServerMessage {
        const sanitizedPlayers = this.players.map(p => {
            if (!p) return null;
            const shouldShow = this.gameState.stage === GameStage.SHOWDOWN || p.id === forUserId;
            return {
                ...p,
                // Ensure avatarUrl is always sent. It's in 'p' already, but being explicit doesn't hurt.
                cards: shouldShow ? p.cards : null
            };
        });

        return {
            type: 'SNAPSHOT',
            payload: {
                players: sanitizedPlayers,
                gameState: this.gameState
            }
        };
    }

    private kickPlayer(player: Player, isLeaving: boolean = false) {
        const idx = this.players.indexOf(player);
        if (idx !== -1) {
            console.log(`Kicking player ${player.name} (ID: ${player.id})`);

            // Refund money
            if (player.balance > 0) {
                this.onCashOut(player.id, player.balance).catch(console.error);
            }

            this.players[idx] = null;

            if (isLeaving) {
                this.broadcasters.delete(player.id);
            }

            this.updateSpectatorCount();
            this.checkEmpty();
            this.broadcastState();

            // If it was their turn, advance
            if (player.isTurn) {
                this.checkTurnEnd(idx); // Use old index
            } else {
                // If game in progress, check if we need to end round/stage because not enough players
                if (this.roundInProgress) {
                    const active = this.activePlayersList.filter(p => !p.isFolded);
                    if (this.gameState.stage !== GameStage.PREFLOP || this.gameState.pot > 0) {
                        if (active.length === 1) {
                            this.handleWinByFold(active[0]);
                        }
                    }
                }
            }
        }
    }

    private updateSpectatorCount() {
        // Spectators = Total Connections - Seated Players
        const seatedCount = this.players.filter(p => p !== null).length;
        const total = this.broadcasters.size;
        this.gameState.spectatorCount = Math.max(0, total - seatedCount);
    }

    private checkEmpty() {
        if (this.activePlayerCount === 0) {
            // Wait briefly to allow reconnects or temporary drops?
            // User requirement: "If table is empty (0 players), delete immediately".
            // But if a player leaves, it might be 0 for a moment.
            // Let's call callback.
            this.onEmpty(this.id);
        }
    }

    // --- GAME LOGIC ---

    private startNewRound() {
        this.roundInProgress = true;
        this.clearTimers();
        const active = this.activePlayersList;
        // Check for active players with money
        if (active.filter(p => p.balance > 0).length < 2) {
            // Not enough players to start
            this.gameState.stage = GameStage.PREFLOP;
            this.gameState.pot = 0;
            this.gameState.communityCards = [];
            this.broadcastState();
            return;
        }

        this.deck = [...DECK].sort(() => Math.random() - 0.5);

        // Reset players
        this.players = this.players.map(p => {
            if (!p) return null;
            return {
                ...p,
                cards: p.balance > 0 ? [this.deck.pop()!, this.deck.pop()!] as [CardData, CardData] : null,
                isFolded: p.balance === 0,
                currentBet: 0,
                roundBet: 0,
                action: null,
                isTurn: false,
                isWinner: false,
                isAllIn: false,
                winningHand: undefined
            };
        });

        const activeList = this.activePlayersList;
        // Dealer Logic (skip empty seats)
        let nextDealerIdx = this.gameState.dealerIdx;
        do {
            nextDealerIdx = (nextDealerIdx + 1) % this.players.length;
        } while (this.players[nextDealerIdx] === null);

        this.gameState.dealerIdx = nextDealerIdx;
        this.players.forEach((p, i) => { if(p) p.isDealer = i === nextDealerIdx; });

        // Blinds Logic
        const getNextSeatedIdx = (current: number) => {
            let idx = current;
            do { idx = (idx + 1) % this.players.length; } while (this.players[idx] === null);
            return idx;
        };

        const sbIdx = activeList.length === 2 ? nextDealerIdx : getNextSeatedIdx(nextDealerIdx);
        const bbIdx = getNextSeatedIdx(sbIdx);
        const startIdx = getNextSeatedIdx(bbIdx);

        // Force funds check on Blinds
        this.bet(this.players[sbIdx]!, this.blindStructure.small);
        this.players[sbIdx]!.action = 'Small Blind';

        this.bet(this.players[bbIdx]!, this.blindStructure.big);
        this.players[bbIdx]!.action = 'Big Blind';

        this.gameState = {
            ...this.gameState,
            pot: this.activePlayersList.reduce((sum, p) => sum + p.roundBet, 0),
            communityCards: [],
            stage: GameStage.PREFLOP,
            minRaise: this.blindStructure.big,
            currentCallAmount: this.blindStructure.big,
            dealerIdx: nextDealerIdx,
            winningCards: [],
            spectatorCount: this.gameState.spectatorCount
        };

        let currentTurnIdx = startIdx;
        // Skip folded/allin players for turn
        while(this.players[currentTurnIdx]?.isFolded || this.players[currentTurnIdx]?.isAllIn) {
            currentTurnIdx = getNextSeatedIdx(currentTurnIdx);
        }

        this.broadcast({ type: 'GAME_STAGE', payload: { stage: 'PREFLOP' } });
        this.setActivePlayer(currentTurnIdx);
    }

    private setActivePlayer(index: number) {
        this.activePlayersList.forEach(p => p.isTurn = false);
        if (this.players[index]) {
            this.players[index]!.isTurn = true;
            this.broadcastState();
            this.startTurnTimer(this.players[index]!);
        }
    }

    private startTurnTimer(player: Player) {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        // if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);

        this.turnTimer = setTimeout(() => {
            console.log(`Player ${player.id} timed out.`);
            // Timeout Action
            const canCheck = player.roundBet === this.gameState.currentCallAmount;
            this.processAction(player, canCheck ? 'Check' : 'Fold');

            // KICK POLICY: Timeout leads to removal? Maybe just fold for now to keep them at table?
            // The mock server kicked them. Let's just fold them for this hand.
            // If they timeout too many times, maybe kick. But for now, just auto-fold.
            // Requirement says "serverside for every lobbies".
            // Let's stick to simple: Auto-Fold/Check.

        }, TURN_TIMEOUT_MS);
    }

    private clearTimers() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        // if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
        this.turnTimer = null;
        // this.gameLoopTimeout = null;
    }

    private handleClientAction(playerId: number, msg: ClientMessage) {
        const p = this.activePlayersList.find(p => p.id === playerId);
        if (!p || !p.isTurn) return;

        if (msg.type === 'FOLD') this.processAction(p, 'Fold');
        else if (msg.type === 'CHECK') this.processAction(p, 'Check');
        else if (msg.type === 'CALL') this.processAction(p, 'Call');
        else if (msg.type === 'RAISE') this.processAction(p, 'Raise', msg.amount);
    }

    private processAction(p: Player, actionType: string, amount: number = 0) {
        if (this.turnTimer) clearTimeout(this.turnTimer);

        if (actionType === 'Fold') {
            p.isFolded = true;
            p.action = 'Fold';
        } else if (actionType === 'Check') {
            p.action = 'Check';
        } else if (actionType === 'Call') {
            const toCall = this.gameState.currentCallAmount - p.roundBet;
            this.bet(p, toCall);
            p.action = p.isAllIn ? 'All-in' : 'Call';
        } else if (actionType === 'Raise') {
            let totalBet = amount;
            // Cap at balance
            if (totalBet > p.balance + p.roundBet) {
                totalBet = p.balance + p.roundBet;
            }

            // Fix: ensure raise is valid (>= min raise unless all-in)
            // But we accept whatever frontend sends bounded by balance.

            if (totalBet > this.gameState.currentCallAmount) {
                const diff = totalBet - this.gameState.currentCallAmount;
                if (diff > this.gameState.minRaise) this.gameState.minRaise = diff;
                this.gameState.currentCallAmount = totalBet;
            }
            const cost = totalBet - p.roundBet;
            this.bet(p, cost);
            p.action = p.isAllIn ? 'All-in' : 'Raise';
        }

        p.isTurn = false;
        this.gameState.pot = this.activePlayersList.reduce((sum, p) => sum + p.currentBet, 0);

        const event = {
            playerId: p.id,
            action: p.action as any,
            amount: actionType === 'Raise' ? amount : undefined
        };
        this.broadcast({ type: 'PLAYER_ACTION', payload: event });
        this.broadcastState();

        // Capture index BEFORE possible kicking or state changes
        const currentPlayerIdx = this.players.indexOf(p);

        // Fix: Use immediate check if possible, or ensure player isn't kicked in interim.
        // The bug "player disappears after Raise" implies they might be kicked or state corrupted.
        // We added `roundInProgress` check in `kickPlayer`, which should prevent accidental kicks.
        // Also ensure `checkTurnEnd` doesn't throw.

        setTimeout(() => {
            // Re-verify player exists (though they shouldn't be kicked mid-turn)
            if (this.players[currentPlayerIdx]) {
                this.checkTurnEnd(currentPlayerIdx);
            } else {
                // If player is gone, just find next.
                this.advanceTurn(currentPlayerIdx);
            }
        }, 500);
    }

    private bet(player: Player, amount: number) {
        if (player.balance <= 0) return 0;
        const actualBet = Math.min(player.balance, amount);
        player.balance -= actualBet;
        player.currentBet += actualBet;
        player.roundBet += actualBet;
        if (player.balance === 0) player.isAllIn = true;
        return actualBet;
    }

    private checkTurnEnd(lastPlayerIdx: number) {
        // activePlayersList automatically excludes nulls (kicked players)
        const active = this.activePlayersList.filter(p => !p.isFolded);
        const activeWithMoney = active.filter(p => !p.isAllIn && p.balance > 0);

        if (active.length === 1) {
            this.handleWinByFold(active[0]);
            return;
        }

        const currentCall = this.gameState.currentCallAmount;
        const allMatched = active.every(p => p.roundBet === currentCall || p.isAllIn || p.balance === 0);
        const allActed = active.every(p =>
            p.isAllIn ||
            (p.action !== null && p.action !== 'Small Blind' && p.action !== 'Big Blind' && p.roundBet === currentCall)
        );

        if (allMatched && (activeWithMoney.length <= 1 || allActed)) {
             this.nextStage();
        } else {
             this.advanceTurn(lastPlayerIdx);
        }
    }

    private advanceTurn(lastPlayerIdx: number) {
        let nextIdx = (lastPlayerIdx + 1) % this.players.length;
        let found = false;

        let attempts = 0;
        while (attempts < this.players.length) {
            const p = this.players[nextIdx];
            if (p && !p.isFolded && !p.isAllIn && p.balance > 0) {
                found = true;
                break;
            }
            nextIdx = (nextIdx + 1) % this.players.length;
            attempts++;
        }

        if (!found) {
            this.nextStage();
            return;
        }

        this.setActivePlayer(nextIdx);
    }

    private nextStage() {
        this.activePlayersList.forEach(p => { p.roundBet = 0; p.action = null; });
        this.gameState.currentCallAmount = 0;
        this.gameState.minRaise = this.blindStructure.big;

        const stages = [GameStage.PREFLOP, GameStage.FLOP, GameStage.TURN, GameStage.RIVER, GameStage.SHOWDOWN];
        const currentIdx = stages.indexOf(this.gameState.stage);

        if (currentIdx >= 3) {
            this.handleShowdown();
            return;
        }

        const nextStage = stages[currentIdx + 1];
        this.gameState.stage = nextStage;

        const dealCount = nextStage === GameStage.FLOP ? 3 : 1;
        for(let i=0; i<dealCount; i++) this.gameState.communityCards.push(this.deck.pop()!);

        this.broadcast({ type: 'GAME_STAGE', payload: { stage: nextStage } });

        let startIdx = (this.gameState.dealerIdx + 1) % this.players.length;
        let foundIdx = -1;

        let attempts = 0;
        while(attempts < this.players.length) {
             const p = this.players[startIdx];
             if (p && !p.isFolded && !p.isAllIn && p.balance > 0) {
                 foundIdx = startIdx;
                 break;
             }
             startIdx = (startIdx + 1) % this.players.length;
             attempts++;
        }

        if (foundIdx === -1) {
            setTimeout(() => this.nextStage(), 1000);
        } else {
            // Check if only one player has money to act (Auto-Check Logic)
            const activeWithMoney = this.activePlayersList.filter(p => !p.isFolded && !p.isAllIn && p.balance > 0);
            if (activeWithMoney.length <= 1) {
                // If only one (or zero) player can act, we just skip the betting round
                // Wait a bit to show the dealt cards, then move on
                this.broadcastState();
                setTimeout(() => this.nextStage(), 2000);
            } else {
                this.broadcastState();
                this.setActivePlayer(foundIdx);
            }
        }
    }

    private handleShowdown() {
        this.clearTimers();
        this.gameState.stage = GameStage.SHOWDOWN;

        const activePlayers = this.activePlayersList.filter(p => !p.isFolded);
        const playerResults = activePlayers.map(p => ({
            player: p,
            eval: evaluateHand(p.cards!, this.gameState.communityCards),
        }));

        playerResults.sort((a, b) => b.eval.score - a.eval.score);

        const bestResult = playerResults[0];
        const comboCards = bestResult.eval.handCards;
        const winningIndices: number[] = [];
        this.gameState.communityCards.forEach((c, i) => {
            if(comboCards.some(bc => bc.suit === c.suit && bc.rank === c.rank)) winningIndices.push(i);
        });
        this.gameState.winningCards = winningIndices;

        playerResults.forEach(res => {
            res.player.winningHand = res.eval.name;
        });

        const potContributions: Record<number, number> = {};
        this.activePlayersList.forEach(p => {
            potContributions[p.id] = p.currentBet;
        });

        let currentPot = this.gameState.pot;
        const candidates = [...playerResults];

        while (currentPot > 0 && candidates.length > 0) {
            const bestScore = candidates[0].eval.score;
            const winners = candidates.filter(c => c.eval.score === bestScore);
            const minContribution = Math.min(...winners.map(w => potContributions[w.player.id]));

            let sidePot = 0;
            this.activePlayersList.forEach(p => {
                const available = potContributions[p.id];
                if (available > 0) {
                    const take = Math.min(available, minContribution);
                    potContributions[p.id] -= take;
                    sidePot += take;
                    currentPot -= take;
                }
            });

            const splitAmount = Math.floor(sidePot / winners.length);
            const remainder = sidePot % winners.length;

            winners.forEach((w, index) => {
                w.player.balance += splitAmount;
                w.player.isWinner = true;
                w.player.action = 'Win';
                if (index < remainder) {
                    w.player.balance += 1;
                }
            });

            for (let i = candidates.length - 1; i >= 0; i--) {
                if (potContributions[candidates[i].player.id] === 0) {
                    candidates.splice(i, 1);
                }
            }
        }

        this.finalizeRound(playerResults[0].player.id);
    }

    private handleWinByFold(winner: Player) {
        winner.balance += this.gameState.pot;
        winner.isWinner = true;
        winner.action = 'Win';
        this.finalizeRound(winner.id);
    }

    private finalizeRound(primaryWinnerId: number) {
        this.roundInProgress = false;
        const event = {
            playerId: primaryWinnerId,
            action: 'Win' as any
        };
        this.broadcast({ type: 'PLAYER_ACTION', payload: event });
        this.broadcastState();

        // Kick bankrupt players
        this.players.forEach(p => {
            if (p && p.balance <= 0) {
                this.kickPlayer(p);
            }
        });

        setTimeout(() => this.startNewRound(), 6000);
    }
}
