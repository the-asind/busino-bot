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

    private gameLoopTimeout: ReturnType<typeof setTimeout> | null = null;
    private turnTimer: ReturnType<typeof setTimeout> | null = null;

    // Callback to refund money when a player leaves or is kicked
    private onCashOut: (userId: number, amount: number) => Promise<void>;

    constructor(
        id: number,
        name: string,
        blindStructure: BlindStructure,
        isPrivate: boolean,
        password: string | undefined,
        onCashOut: (userId: number, amount: number) => Promise<void>
    ) {
        this.id = id;
        this.name = name;
        this.blindStructure = blindStructure;
        this.isPrivate = isPrivate;
        this.password = password;
        this.onCashOut = onCashOut;

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

    public async addPlayer(user: { id: number, name: string, coins: number }, broadcaster: Broadcaster): Promise<boolean> {
        if (this.players.some(p => p?.id === user.id)) {
            // Already seated, just reconnect broadcaster
            this.broadcasters.set(user.id, broadcaster);
            this.pushStateTo(user.id);
            return true;
        }

        const seatIdx = this.players.findIndex(p => p === null);
        if (seatIdx === -1) return false; // Full

        this.broadcasters.set(user.id, broadcaster);

        this.players[seatIdx] = {
            id: user.id,
            name: user.name,
            avatarUrl: 'https://picsum.photos/100', // Placeholder
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
            this.kickPlayer(player);
        }
        this.broadcasters.delete(userId);
    }

    public handleMessage(userId: number, msg: ClientMessage) {
        if (msg.type === 'LEAVE') {
            this.removePlayer(userId);
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

    private kickPlayer(player: Player) {
        const idx = this.players.indexOf(player);
        if (idx !== -1) {
            console.log(`Kicking player ${player.name} (ID: ${player.id})`);

            // Refund money
            if (player.balance > 0) {
                this.onCashOut(player.id, player.balance).catch(console.error);
            }

            this.players[idx] = null;
            this.broadcastState();

            // If it was their turn, advance
            if (player.isTurn) {
                this.checkTurnEnd(idx); // Use old index
            } else {
                // If game in progress, check if we need to end round/stage because not enough players
                const active = this.activePlayersList.filter(p => !p.isFolded);
                 if (this.gameState.stage !== GameStage.PREFLOP || this.gameState.pot > 0) {
                     if (active.length === 1) {
                        this.handleWinByFold(active[0]);
                     }
                 }
            }
        }
    }

    // --- GAME LOGIC ---

    private startNewRound() {
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
        setTimeout(() => this.checkTurnEnd(currentPlayerIdx), 500);
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
            this.broadcastState();
            this.setActivePlayer(foundIdx);
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
