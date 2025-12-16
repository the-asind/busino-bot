import { Player, GameState, GameStage, BlindStructure, Suit, Rank, CardData, ServerMessage, ClientMessage, PlayerActionEvent } from '../types';
import { evaluateHand } from '../utils/pokerLogic';

// --- CONSTANTS ---
const DECK = Object.values(Suit).flatMap(s => Object.values(Rank).map(r => ({ suit: s, rank: r })));
const TURN_TIMEOUT_MS = 15000;

export class MockGameServer {
    // Array of 5 seats. Null means empty seat.
    private players: (Player | null)[] = [];
    private gameState: GameState;
    private deck: CardData[] = [];
    private blindStructure: BlindStructure;
    private listeners: ((msg: ServerMessage) => void)[] = [];
    private bankruptIds = new Set<number>();

    private gameLoopTimeout: number | null = null;
    private turnTimer: number | null = null;
    private myId: number = 1;

    constructor(blindStructure: BlindStructure) {
        this.blindStructure = blindStructure;
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

        // SETUP SCENARIO: Seats 1, 3, 5 only (Indices 0, 2, 4)
        this.players = [
            { id: 1, name: 'Вы', avatarUrl: 'https://picsum.photos/100', balance: 1000, currentBet: 0, roundBet: 0, isFolded: false, isDealer: false, isTurn: false, cards: null },
            null, // Empty Seat
            { id: 3, name: 'Mike', avatarUrl: 'https://picsum.photos/102', balance: 800, currentBet: 0, roundBet: 0, isFolded: false, isDealer: false, isTurn: false, cards: null },
            null, // Empty Seat
            { id: 5, name: 'John', avatarUrl: 'https://picsum.photos/104', balance: 1500, currentBet: 0, roundBet: 0, isFolded: false, isDealer: false, isTurn: false, cards: null },
        ];
    }

    // Helper to get only seated players
    private get activePlayersList(): Player[] {
        return this.players.filter(p => p !== null) as Player[];
    }

    public connect(onMessage: (msg: ServerMessage) => void) {
        this.listeners.push(onMessage);
        this.pushState();
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== onMessage);
        };
    }

    public send(msg: ClientMessage) {
        if (msg.type === 'JOIN') {
            // Check Bankruptcy
            if (this.bankruptIds.has(this.myId)) {
                this.emit({
                    type: 'ERROR',
                    payload: { error: 'Недостаточно средств для входа в игру!' }
                });
                return;
            }

            if (!this.players.some(p => p?.id === this.myId)) {
                // Determine seat: use requested index or find first empty
                let targetIdx = msg.seatIndex !== undefined && this.players[msg.seatIndex] === null
                    ? msg.seatIndex
                    : this.players.findIndex(p => p === null);

                if (targetIdx !== -1) {
                    this.players[targetIdx] = {
                        id: this.myId, name: 'Вы', avatarUrl: 'https://picsum.photos/100',
                        balance: 1000, currentBet: 0, roundBet: 0,
                        isFolded: true, isDealer: false, isTurn: false, cards: null
                    };
                    this.gameState.spectatorCount = Math.max(0, this.gameState.spectatorCount - 1);
                    this.pushState();
                }
            }

            // If game hasn't started or only 1 player, try to start
            if (this.gameState.stage === GameStage.PREFLOP && this.gameState.pot === 0) {
                 this.startNewRound();
            }
        } else {
            this.handleClientAction(this.myId, msg);
        }
    }

    private emit(msg: ServerMessage) {
        this.listeners.forEach(cb => cb(msg));
    }

    private pushState() {
        const sanitizedPlayers = this.players.map(p => {
            if (!p) return null;
            const shouldShow = this.gameState.stage === GameStage.SHOWDOWN || p.id === this.myId;
            return {
                ...p,
                cards: shouldShow ? p.cards : null
            };
        });

        this.emit({
            type: 'SNAPSHOT',
            payload: {
                players: sanitizedPlayers,
                gameState: this.gameState
            }
        });
    }

    private kickPlayer(player: Player) {
        const idx = this.players.indexOf(player);
        if (idx !== -1) {
            console.log(`Kicking player ${player.name} (ID: ${player.id})`);

            // If kicked due to bankruptcy, record it
            if (player.balance <= 0) {
                this.bankruptIds.add(player.id);
            }

            this.players[idx] = null;
            this.gameState.spectatorCount++;
            this.pushState();
        }
    }

    // --- GAME LOGIC ---

    private startNewRound() {
        this.clearTimers();
        const active = this.activePlayersList;
        // Check for active players with money
        if (active.filter(p => p.balance > 0).length < 2) return;

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

        this.emit({ type: 'GAME_STAGE', payload: { stage: 'PREFLOP' } });
        this.setActivePlayer(currentTurnIdx);
    }

    private setActivePlayer(index: number) {
        this.activePlayersList.forEach(p => p.isTurn = false);
        if (this.players[index]) {
            this.players[index]!.isTurn = true;
            this.pushState();
            this.startTurnTimer(this.players[index]!);
        }
    }

    private startTurnTimer(player: Player) {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);

        if (player.id !== this.myId) {
            this.gameLoopTimeout = window.setTimeout(() => {
                this.botMove(player);
            }, 1000 + Math.random() * 2000);
        }

        this.turnTimer = window.setTimeout(() => {
            console.log(`Player ${player.id} timed out.`);
            // Timeout Action
            const canCheck = player.roundBet === this.gameState.currentCallAmount;
            this.processAction(player, canCheck ? 'Check' : 'Fold');

            // KICK POLICY: Timeout leads to removal
            this.kickPlayer(player);
        }, TURN_TIMEOUT_MS);
    }

    private clearTimers() {
        if (this.turnTimer) clearTimeout(this.turnTimer);
        if (this.gameLoopTimeout) clearTimeout(this.gameLoopTimeout);
        this.turnTimer = null;
        this.gameLoopTimeout = null;
    }

    private botMove(p: Player) {
        const call = this.gameState.currentCallAmount - p.roundBet;
        if(call > 0) {
             this.processAction(p, Math.random() > 0.1 ? 'Call' : 'Fold');
        } else {
             if(Math.random() > 0.8) this.processAction(p, 'Raise', this.gameState.currentCallAmount + this.gameState.minRaise);
             else this.processAction(p, 'Check');
        }
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

        const event: PlayerActionEvent = {
            playerId: p.id,
            action: p.action as any,
            amount: actionType === 'Raise' ? amount : undefined
        };
        this.emit({ type: 'PLAYER_ACTION', payload: event });
        this.pushState();

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
        // Simple modulo advancement.
        // If lastPlayerIdx was kicked (is -1/invalid), it starts searching from 0.
        // If lastPlayerIdx was valid (e.g., 2), it starts from 3.
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

        this.emit({ type: 'GAME_STAGE', payload: { stage: nextStage } });

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
            this.pushState();
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
        this.emit({ type: 'PLAYER_ACTION', payload: event });
        this.pushState();

        // Kick bankrupt players
        this.players.forEach(p => {
            if (p && p.balance <= 0) {
                this.kickPlayer(p);
            }
        });

        setTimeout(() => this.startNewRound(), 6000);
    }
}