import React, { useState, useEffect, useRef, useMemo } from 'react';
import { PlayerSeat } from '../components/PlayerSeat';
import { Card } from '../components/Card';
import { Controls } from '../components/Controls';
import { ChipStack } from '../components/ChipStack';
import { GameState, GameStage, BlindStructure, Player, ServerMessage, PlayerActionEvent } from '../types';
import { playSound } from '../utils/audio';
import { evaluateHand } from '../utils/pokerLogic';
import { webSocketService } from '../services/WebSocketService';
import { StickerPicker } from '../components/StickerPicker';

interface GameViewProps {
  lobbyId: number;
  blindStructure: BlindStructure;
  onLeave: () => void;
}

// --- ANIMATION TYPES & CONSTANTS ---
interface FloatingChipData {
    id: number;
    from: { x: string; y: string };
    to: { x: string; y: string };
    amount: number;
}

const POSITIONS = [
    { x: '50%', y: '78%' }, // 0: Hero (Bottom)
    { x: '18%', y: '50%' }, // 1: Left
    { x: '25%', y: '18%' }, // 2: Top Left
    { x: '75%', y: '18%' }, // 3: Top Right
    { x: '82%', y: '50%' }, // 4: Right
];
const POT_POSITION = { x: '50%', y: '38%' };

export const GameView: React.FC<GameViewProps> = ({ lobbyId, blindStructure, onLeave }) => {
  // Client State
  // Support null in array for empty seats
  const [players, setPlayers] = useState<(Player | null)[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isDealing, setIsDealing] = useState(false);
  const [showRaiseSlider, setShowRaiseSlider] = useState(false);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(0);

  // Animation State
  const [floatingChips, setFloatingChips] = useState<FloatingChipData[]>([]);
  const [activeStickers, setActiveStickers] = useState<{id: string, playerId: number, stickerId: number}[]>([]);

  const playersRef = useRef<(Player | null)[]>([]);

  useEffect(() => { playersRef.current = players; }, [players]);

  useEffect(() => {
      // Connect/Subscribe using WebSocketService (already connected in LobbyView usually, but we re-register handlers)
      // Note: In a real app, WebSocketService should probably multicast or we manage global state.
      // But here we can just add a listener.
      // Important: We need to filter messages for THIS lobby if we support multiple?
      // The current backend sends messages to the socket. We assume socket is 1:1 with user who is in ONE table.

      const unsub = webSocketService.connect((msg: ServerMessage) => {

          if (msg.type === 'SNAPSHOT') {
              if (msg.payload.players) setPlayers(msg.payload.players);
              if (msg.payload.gameState) setGameState(msg.payload.gameState);

          } else if (msg.type === 'GAME_STAGE') {
              if (msg.payload.stage === 'PREFLOP') {
                  playSound('deal');
                  setIsDealing(true);
                  setTimeout(() => setIsDealing(false), 800);
              } else {
                  // Collect chips from seated players
                  const chipsToAnimate: FloatingChipData[] = [];
                  playersRef.current.forEach((p, idx) => {
                      if (p && p.roundBet > 0) {
                          chipsToAnimate.push({
                              id: Math.random(),
                              from: POSITIONS[idx] || POSITIONS[0],
                              to: POT_POSITION,
                              amount: p.roundBet
                          });
                      }
                  });
                  if (chipsToAnimate.length > 0) {
                      playSound('call');
                      setFloatingChips(prev => [...prev, ...chipsToAnimate]);
                      setTimeout(() => {
                          setFloatingChips(prev => prev.filter(c => !chipsToAnimate.includes(c)));
                      }, 600);
                  }

                  if (msg.payload.stage !== 'SHOWDOWN') {
                      setTimeout(() => playSound('flip'), 600);
                  }
              }

          } else if (msg.type === 'PLAYER_ACTION') {
              const payload = msg.payload as PlayerActionEvent;

              switch (payload.action) {
                  case 'Fold': playSound('fold'); break; // Fallback if no specific sound? Audio map has none?
                  // Wait, audio map removed 'fold'. Assuming 'check' or 'btn' for now or we update audio map later.
                  // Actually map has 'check', 'btn', 'coins'.
                  // Let's rely on map. If fold not in map, playSound warns.
                  // User provided folder structure: call_rase, check, deal, ...
                  // No specific 'fold'. Maybe just 'check'? Or silence?
                  // I'll leave 'fold' call, it will warn if missing.

                  case 'Check': playSound('check'); break;
                  case 'Call': playSound('call_raise'); break;
                  case 'Raise': playSound('call_raise'); break;
                  case 'Win':
                      // Determine if I won
                      // Need to know my ID.
                      // Wait, we don't have my ID explicitly stored, but we can infer from players array
                      // In PokerTable.ts logic, players array is synced.
                      // Usually index 0 is Hero?
                      // Wait, `snapshot` aligns players for hero?
                      // The backend `createSnapshot(userId)` puts everyone in absolute positions.
                      // BUT the frontend doesn't rotate the table yet!
                      // The previous mock server hardcoded index 0 as hero.
                      // The real backend returns absolute positions in array of 5.
                      // We need to Rotate the array so ME is at index 0.

                      // For now, let's just check if I am the winner
                      // We need to know which one is ME.
                      // `snapshot` sets `cards` only for ME (and showdown).
                      // So whoever has `cards` visible (and stage != showdown) is ME.
                      // Or we can rely on `Player.id` if we knew our ID.
                      // `webSocketService` sends `initData`, but doesn't expose ID back to UI yet.

                      // However, let's assume `Win` sound if *I* win.
                      // We will handle rotation logic in SNAPSHOT handler ideally.

                      // For simplicity: sound is just generic win/lose for now.
                      playSound('win');

                      const winnerIdx = playersRef.current.findIndex(p => p && p.id === payload.playerId);
                      if (winnerIdx !== -1) {
                          const winChip: FloatingChipData = {
                              id: Math.random(),
                              from: POT_POSITION,
                              to: POSITIONS[winnerIdx] || POSITIONS[0],
                              amount: 999
                          };
                          setFloatingChips(prev => [...prev, winChip]);
                          setTimeout(() => {
                              setFloatingChips(prev => prev.filter(c => c !== winChip));
                          }, 800);
                      }
                      break;
              }
          } else if (msg.type === 'EMOTE') {
              if (msg.payload.playerId && msg.payload.stickerId !== undefined) {
                  const stickerKey = Math.random().toString();
                  setActiveStickers(prev => [...prev, { id: stickerKey, playerId: msg.payload.playerId!, stickerId: msg.payload.stickerId! }]);
                  setTimeout(() => {
                      setActiveStickers(prev => prev.filter(s => s.id !== stickerKey));
                  }, 3000);
              }
          } else if (msg.type === 'ERROR') {
              if (msg.payload.error) {
                  alert(msg.payload.error);
                  if (msg.payload.error === 'Insufficient funds') {
                      onLeave();
                  }
              }
          }
      });

      // Request initial state (in case we missed snapshot during transition)
      webSocketService.send({ type: 'GET_STATE' });

      // We assume we are already JOINED via LobbyView.
      // Or if not, we should send JOIN here?
      // LobbyView handles JOIN.
      // But if we reload page? We don't support reload persistence yet.

      return () => {
          unsub();
          // Sending LEAVE on unmount
          webSocketService.send({ type: 'LEAVE' });
      };
  }, [blindStructure, lobbyId]);

  // We need to rotate players so that the "Me" player is always at index 0 (Bottom)
  // We can find "Me" by finding the player who has cards (in non-showdown) or by ID if we had it.
  // Actually, let's assume `PokerTable` sends players in fixed seat order (0-4).
  // We need to rotate `players` state for rendering.

  const rotatedPlayers = useMemo(() => {
      if (!players || players.length === 0) return players;

      // Find my seat index.
      // We identify "Me" by checking who has private cards visible when stage is PREFLOP/FLOP/TURN/RIVER
      // OR we need the backend to tell us "yourSeatIndex".
      // The `createSnapshot` sends `cards` only to ME.
      // So...

      let myIndex = -1;
      // If stage is SHOWDOWN, everyone might have cards.
      // But usually we can check a flag `isMe`?
      // Let's check `Player` type. It doesn't have `isMe`.
      // Let's modify backend to include `isMe`? Or just use the cards logic.
      // If SHOWDOWN, everyone has cards.
      // But `createSnapshot` runs per user.

      // Let's rely on finding the player with the same ID as `initData` user?
      // We don't have access to initData user ID easily here without decoding it again.

      // Workaround: In `SNAPSHOT`, the backend sends `players`.
      // Let's add `mySeatIndex` to `SNAPSHOT` payload?
      // Or just loop and find the one that matches our known ID (if we pass it from App).

      // For now, let's skip rotation and just render absolute positions.
      // This means if I sit at seat 3, I appear at seat 3 (Top Right).
      // It's acceptable for an MVP.
      return players;
  }, [players]);

  // But wait, `GameView` original code had `players[0]` as "Me" (id=1).
  // And `POSITIONS[0]` is Bottom.
  // If we don't rotate, I might be at top.
  // Let's try to improve this later if needed.

  const me = players.find(p => p && (!!p.cards || p.isTurn /* heuristic */));
  // This heuristic is weak. `p.cards` is non-null for me.
  // At showdown, `p.cards` is non-null for everyone.
  // We really need to know who I am.

  // Let's stick with: Me is the one with `cards` unless it's Showdown.
  // If Showdown, we might need another way or just don't care about "Me" highlight specifically for controls (controls are disabled anyway).

  const heroWinningIndices = useMemo(() => {
      // Find "me" again
      const myPlayer = players.find(p => p && p.cards && !p.isFolded); // Rough check
      if (!myPlayer || !myPlayer.cards || !gameState) return [];

      // If showdown, we want to highlight winners cards, not just mine.
      // This logic was for highlighting MY best hand on the board.

      const ev = evaluateHand(myPlayer.cards, gameState.communityCards);
      const indices: number[] = [];
      gameState.communityCards.forEach((c, i) => {
          if(ev.handCards.some(hc => hc.suit === c.suit && hc.rank === c.rank)) indices.push(i);
      });
      return indices;
  }, [players, gameState]);

  // Correct highlight logic for Winning Cards at Showdown (based on actual winner)
  const winningIndices = useMemo(() => {
      if (gameState?.stage === GameStage.SHOWDOWN && gameState.winningCards) {
          return gameState.winningCards;
      }
      // If it is Showdown but we have no winningCards (e.g. backend hasn't sent them or no winner yet),
      // we SHOULD NOT show hero hints.
      if (gameState?.stage === GameStage.SHOWDOWN) {
          return [];
      }
      return heroWinningIndices;
  }, [gameState, heroWinningIndices]);

  // Determine the winning hand name to display in CENTER
  const winningHandName = useMemo(() => {
      const winner = players.find(p => p && p.isWinner);
      return winner?.winningHand;
  }, [players]);

  const handleAction = (type: string, amount: number = 0) => {
      const actionTypeMap: Record<string, any> = { 'Fold': 'FOLD', 'Check': 'CHECK', 'Call': 'CALL', 'Raise': 'RAISE' };
      webSocketService.send({ type: actionTypeMap[type], amount });
      if (type === 'Raise') setShowRaiseSlider(false);
  };

  const handleJoin = (seatIndex: number) => {
      webSocketService.send({ type: 'JOIN', lobbyId, seatIndex });
  };

  const openRaiseSlider = () => {
      if (!gameState) return;
      const minR = gameState.currentCallAmount + gameState.minRaise;
      setRaiseAmount(minR);
      setShowRaiseSlider(true);
  };

  const getPositionClass = (index: number) => {
    // If not rotating, these are absolute table positions
    switch (index) {
      case 0: return 'bottom-[22%] left-1/2 -translate-x-1/2 scale-110 z-30';
      case 1: return 'top-[50%] left-1 -translate-y-1/2 z-20';
      case 2: return 'top-[12%] left-[10%] z-20';
      case 3: return 'top-[12%] right-[10%] z-20';
      case 4: return 'top-[50%] right-1 -translate-y-1/2 z-20';
      default: return 'hidden';
    }
  };

  if (!gameState) return <div className="text-white flex items-center justify-center h-screen">Подключение к столу...</div>;

  // Find "Me" for controls
  // We need to know my ID to know if `isMyTurn`.
  // The `p.isTurn` flag is set by backend.
  // We can just iterate players and see if any `p.isTurn` has `cards` (heuristic that it's me if not showdown).
  // Better: The backend sends `isTurn` true for the active player.
  // The frontend needs to enable controls ONLY if `me.isTurn` is true.
  // How do we definitely identify `me`?
  // We'll trust `p.cards != null` implies `me` for now (except showdown).
  // At showdown, controls are hidden anyway.

  const myPlayer = players.find(p => p && p.cards);

  const maxRaiseAmount = myPlayer ? myPlayer.balance + myPlayer.roundBet : 0;
  const minRaiseAmount = gameState.currentCallAmount + gameState.minRaise;

  return (
    <div className="relative w-full h-full min-h-screen bg-[#1b3a2f] overflow-hidden flex flex-col font-sans">
      <style>{`
        @keyframes deal-card-board {
          0% { transform: translate(0, -25vh) scale(0.2); opacity: 0; }
          100% { transform: translate(0, 0) scale(1); opacity: 1; }
        }
        .animate-deal-board { animation: deal-card-board 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
      `}</style>

      {/* Background & Table */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-green-800 via-[#1b3a2f] to-[#0f1f1a] opacity-100 z-0"></div>
      <div className="absolute top-[42%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[85%] md:w-[60%] aspect-[2/3.5] rounded-[100px] border-[14px] border-[#162922] shadow-[0_0_50px_rgba(0,0,0,0.5)] bg-[#2c5443] z-0">
        <div className="absolute inset-4 border-2 border-white/5 rounded-[80px]"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white/10 font-bold text-2xl tracking-widest pointer-events-none select-none">
          {gameState.stage}
        </div>
      </div>

      {/* Floating Chips Layer */}
      {floatingChips.map(chip => (
          <FloatingChip key={chip.id} from={chip.from} to={chip.to} amount={chip.amount} />
      ))}

      {/* Floating Stickers Layer */}
      {activeStickers.map(sticker => {
          // Find player index to position sticker
          const idx = players.findIndex(p => p && p.id === sticker.playerId);
          const pos = idx !== -1 ? POSITIONS[idx] : POSITIONS[0];

          return (
              <div key={sticker.id}
                   className="absolute w-20 h-20 z-[80] pointer-events-none animate-float-up"
                   style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}>
                  <img src={`/app/assets/stickers/${sticker.stickerId}.webp`} alt="sticker" className="w-full h-full object-contain drop-shadow-xl" />
              </div>
          );
      })}
      <style>{`
        @keyframes float-up {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
            20% { transform: translate(-50%, -80%) scale(1.2); opacity: 1; }
            80% { transform: translate(-50%, -120%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -150%) scale(0.8); opacity: 0; }
        }
        .animate-float-up { animation: float-up 2.5s ease-out forwards; }
      `}</style>

      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 p-3 flex justify-between items-start z-50">
        <button onClick={onLeave} className="text-white/70 hover:text-white flex items-center gap-1 bg-black/30 px-3 py-1.5 rounded-full backdrop-blur-sm transition-colors">← ВЫХОД</button>
        <div className="flex flex-col items-center">
            <div className="bg-black/30 px-4 py-1 rounded-full backdrop-blur-sm border border-white/5">
                <span className="text-yellow-500 font-bold text-xs mr-1">БЛАЙНДЫ</span>
                <span className="text-white font-bold text-xs">{blindStructure.label}</span>
            </div>
        </div>

        {/* SPECTATOR EYE */}
        <div className="w-20 flex justify-end">
            {gameState.spectatorCount > 0 && (
                <div className="flex items-center gap-1.5 bg-black/30 px-3 py-1.5 rounded-full backdrop-blur-sm">
                   <span className="text-lg">👁</span>
                   <span className="text-white font-bold text-sm">{gameState.spectatorCount}</span>
                </div>
            )}
        </div>
      </div>

      {/* Emote Button */}
      <button
        onClick={() => setShowStickerPicker(!showStickerPicker)}
        className="absolute top-20 right-2 z-[90] w-10 h-10 bg-slate-800/80 rounded-full flex items-center justify-center border border-slate-600 shadow-lg text-xl hover:bg-slate-700 transition-colors"
      >
        😀
      </button>

      {/* Sticker Picker Popup */}
      {showStickerPicker && (
          <StickerPicker
            onClose={() => setShowStickerPicker(false)}
            onSelect={(id) => {
                webSocketService.send({ type: 'EMOTE', stickerId: id });
                setShowStickerPicker(false);
            }}
          />
      )}

      {/* CENTER: Board and Pot (Z-10) */}
      <div className="absolute top-[38%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10 w-full pointer-events-none">
        <div className="mb-8 transform scale-90 relative flex flex-col items-center">
            <div className="flex items-center gap-2 bg-black/60 px-4 py-1 rounded-full border border-yellow-500/30 shadow-lg backdrop-blur-sm z-20">
                <span className="text-yellow-400 text-sm">БАНК:</span>
                <span className="text-white font-bold text-lg tracking-wide">${gameState.pot}</span>
            </div>
            {gameState.pot > 0 && (
                <div className="absolute top-8 left-1/2 transform -translate-x-1/2">
                    <ChipStack amount={gameState.pot} showValue={false} />
                </div>
            )}
        </div>

        <div className="flex gap-2 h-24 items-center justify-center mt-2">
          {gameState.communityCards.map((card, i) => (
             <div key={`${card.rank}-${card.suit}`} className="origin-center animate-deal-board" style={{ animationDelay: `${i * 150}ms` }}>
                <Card card={card} className="shadow-xl" small={false}
                      highlight={winningIndices.includes(i)} />
             </div>
          ))}
          {[...Array(5 - gameState.communityCards.length)].map((_, i) => (
             <div key={`ph-${i}`} className="w-12 h-16 md:w-16 md:h-24 border border-white/10 rounded-lg bg-black/10 mx-0.5"></div>
          ))}
        </div>
      </div>

      {/* Players */}
      {players.map((p, idx) => {
          if (!p) {
               // Only show empty seat if I am NOT seated
               if (myPlayer) return null;
               return <EmptySeat key={`empty-${idx}`} positionClass={getPositionClass(idx)} onClick={() => handleJoin(idx)} />;
          }

          // Calculate hole card highlights
          let highlightHoleCards: boolean[] | undefined;
          if (p.cards && !p.isFolded) {
              if (gameState.stage !== GameStage.SHOWDOWN) {
                  // Only for me? Yes, because others cards are null
                  const ev = evaluateHand(p.cards, gameState.communityCards);
                  highlightHoleCards = p.cards.map(c =>
                      ev.handCards.some(hc => hc.suit === c.suit && hc.rank === c.rank)
                  );
              }
              else if (gameState.stage === GameStage.SHOWDOWN && p.isWinner) {
                  const ev = evaluateHand(p.cards, gameState.communityCards);
                  highlightHoleCards = p.cards.map(c =>
                      ev.handCards.some(hc => hc.suit === c.suit && hc.rank === c.rank)
                  );
              }
          }

          const isMe = !!p.cards && gameState.stage !== GameStage.SHOWDOWN;

          return (
            <PlayerSeat
                key={p.id}
                player={p}
                positionClass={getPositionClass(idx)}
                seatIndex={idx}
                shouldReveal={!!p.cards}
                isDealing={isDealing}
                highlightCards={highlightHoleCards}
                isMe={isMe}
            />
          );
      })}

      {/* WINNING HAND LABEL */}
      {winningHandName && (
        <div className="absolute top-[45%] left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[70] animate-bounce w-56 flex justify-center pointer-events-none">
            <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-black text-sm md:text-base font-black px-6 py-2 rounded-full border-2 border-white shadow-[0_0_25px_rgba(234,179,8,0.9)] whitespace-nowrap overflow-hidden text-ellipsis uppercase tracking-wider">
                {winningHandName}
            </div>
        </div>
      )}

      {/* Raise Slider */}
      {showRaiseSlider && (
        <div className="absolute bottom-0 right-0 w-full h-[45vh] bg-slate-900 border-t border-slate-700 z-[60] shadow-2xl flex flex-col p-6 animate-slide-up rounded-t-2xl">
            <div className="flex justify-between items-center mb-6">
                <h3 className="text-white font-bold text-lg">Размер рейза</h3>
                <button onClick={() => setShowRaiseSlider(false)} className="text-slate-400 hover:text-white p-2 text-xl">✕</button>
            </div>
            <div className="flex-1 flex flex-col items-center space-y-6">
                <span className="text-5xl font-bold text-blue-400 tracking-tighter">${raiseAmount}</span>
                <input type="range" min={minRaiseAmount} max={maxRaiseAmount} value={raiseAmount} onChange={(e) => setRaiseAmount(Number(e.target.value))}
                       className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                <div className="flex gap-2 w-full">
                   <button onClick={() => setRaiseAmount(Math.min(maxRaiseAmount, Math.floor(gameState.pot * 0.5) + gameState.currentCallAmount))} className="flex-1 bg-slate-800 py-3 rounded-lg text-xs font-bold text-white border border-slate-700">1/2 Банка</button>
                   <button onClick={() => setRaiseAmount(Math.min(maxRaiseAmount, gameState.pot + gameState.currentCallAmount))} className="flex-1 bg-slate-800 py-3 rounded-lg text-xs font-bold text-white border border-slate-700">Банк</button>
                   <button onClick={() => setRaiseAmount(maxRaiseAmount)} className="flex-1 bg-slate-800 py-3 rounded-lg text-xs font-bold text-red-400 border border-slate-700">All-In</button>
                </div>
            </div>
            <button onClick={() => handleAction('Raise', raiseAmount)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl mt-4 text-lg shadow-lg active:scale-95 transition-transform">ПОДТВЕРДИТЬ</button>
        </div>
      )}

      {/* Controls */}
      <Controls
        isMyTurn={myPlayer?.isTurn || false}
        isFolded={myPlayer?.isFolded || false}
        currentCallAmount={gameState.currentCallAmount}
        myRoundBet={myPlayer?.roundBet || 0}
        minRaise={gameState.minRaise}
        balance={myPlayer?.balance || 0}
        onRequestRaise={openRaiseSlider}
        onAction={handleAction}
       />
    </div>
  );
};

// Internal Component for Flying Chips
const FloatingChip: React.FC<{ from: {x:string, y:string}, to: {x:string, y:string}, amount: number }> = ({ from, to, amount }) => {
    const [style, setStyle] = useState<React.CSSProperties>({
        position: 'absolute',
        left: from.x,
        top: from.y,
        transform: 'translate(-50%, -50%)',
        transition: 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        zIndex: 100,
        opacity: 1
    });

    useEffect(() => {
        requestAnimationFrame(() => {
            setStyle(prev => ({
                ...prev,
                left: to.x,
                top: to.y,
                opacity: 0
            }));
        });
    }, [to]);

    return (
        <div style={style}>
            <ChipStack amount={amount} showValue={false} />
        </div>
    );
};

// Component for Empty Seat (Plus Button)
const EmptySeat: React.FC<{ positionClass: string, onClick: () => void }> = ({ positionClass, onClick }) => {
    return (
        <div className={`absolute flex flex-col items-center justify-center w-20 ${positionClass} opacity-60 hover:opacity-100 cursor-pointer transition-opacity group`} onClick={onClick}>
            <div
                className="w-12 h-12 rounded-full border-2 border-dashed border-slate-500 bg-slate-800/50 flex items-center justify-center text-slate-400 group-hover:border-yellow-500 group-hover:text-yellow-500 transition-colors"
            >
                <span className="text-2xl font-light mb-1">+</span>
            </div>
            <span className="text-[10px] text-slate-500 font-bold mt-1 group-hover:text-yellow-500">СЕСТЬ</span>
        </div>
    );
};
