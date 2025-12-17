import React from 'react';
import { Player } from '../types';
import { Card } from './Card';
import { ChipStack } from './ChipStack';

interface PlayerSeatProps {
  player: Player;
  positionClass: string;
  seatIndex: number;
  shouldReveal: boolean;
  isDealing?: boolean;
  highlightCards?: boolean[];
}

export const PlayerSeat: React.FC<PlayerSeatProps> = ({ player, positionClass, seatIndex, shouldReveal, isDealing, highlightCards }) => {

  const getDealerPosition = (idx: number) => {
    switch(idx) {
      case 0: return '-top-8 right-0';
      case 1: return 'top-1/2 -right-8 -translate-y-1/2';
      case 2: return '-bottom-4 -right-4';
      case 3: return '-bottom-4 -left-4';
      case 4: return 'top-1/2 -left-8 -translate-y-1/2';
      default: return '-top-2 -right-2';
    }
  };

  const showFace = shouldReveal && player.cards && !player.isFolded;
  const flyInClass = isDealing ? `animate-deal-${seatIndex}` : '';

  const getChipPosition = (idx: number) => {
    switch(idx) {
      case 0: return '-top-12 left-1/2 -translate-x-1/2';
      case 1: return 'top-1/2 left-24 -translate-y-1/2';
      case 2: return '-bottom-10 left-1/2 -translate-x-1/2';
      case 3: return '-bottom-10 right-1/2 translate-x-1/2';
      case 4: return 'top-1/2 right-24 -translate-y-1/2';
      default: return '-top-12';
    }
  };

  return (
    <div className={`absolute flex flex-col items-center justify-center transition-all duration-500 w-20 ${positionClass} ${player.isFolded ? 'opacity-50 grayscale' : ''}`}>

      {/* Dealer Button */}
      {player.isDealer && (
        <div className={`absolute ${getDealerPosition(seatIndex)} z-40 transition-all duration-500`}>
           <div className="w-6 h-6 bg-gradient-to-br from-white to-slate-200 border border-slate-400 rounded-full flex items-center justify-center shadow-[0_2px_5px_rgba(0,0,0,0.5)]">
              <span className="text-[10px] font-black text-slate-800">D</span>
           </div>
        </div>
      )}

      {/* Chips Stack (Round Bet) */}
      {player.roundBet > 0 && !player.isFolded && (
         <div className={`absolute ${getChipPosition(seatIndex)} z-20 transition-all duration-500`}>
             <ChipStack amount={player.roundBet} />
         </div>
      )}

      {/* Action Bubble */}
      <div className={`absolute -top-6 left-1/2 transform -translate-x-1/2 transition-all duration-300 z-50 ${player.action && !player.isWinner ? 'opacity-100 scale-100' : 'opacity-0 scale-75'}`}>
         {player.action && (
            <div className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap border shadow-md backdrop-blur-sm ${player.action === 'All-in' ? 'bg-red-600 border-red-400 animate-pulse' : 'bg-slate-900/90 border-yellow-500/50'}`}>
              <span className="uppercase text-yellow-400 mr-1">{player.action}</span>
            </div>
         )}
      </div>

      {/* Cards */}
      {!player.isFolded && player.cards && (
        <div className={`relative flex -space-x-1 mb-1 z-10 transition-transform duration-300 ${player.isTurn ? 'translate-y-1 scale-105' : ''} ${flyInClass}`}>
            <Card
              card={showFace ? player.cards[0] : undefined}
              small={true}
              highlight={highlightCards ? highlightCards[0] : player.isWinner}
            />
            <Card
              card={showFace ? player.cards[1] : undefined}
              small={true}
              className="transform translate-y-1"
              highlight={highlightCards ? highlightCards[1] : player.isWinner}
            />
        </div>
      )}

      {/* Avatar Container & Timer */}
      <div className="relative">
        <div className={`relative w-10 h-10 md:w-12 md:h-12 rounded-full border-[3px] ${player.isWinner ? 'border-yellow-400 shadow-[0_0_20px_rgba(250,204,21,0.8)]' : player.isTurn ? 'border-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.6)]' : 'border-slate-700'} bg-slate-800 z-20 overflow-hidden transition-all duration-500`}>
          <img src={player.avatarUrl} alt={player.name} className={`w-full h-full object-cover ${player.balance === 0 && !player.isAllIn ? 'grayscale' : ''}`} />
        </div>
      </div>

      {/* Name/Balance Plate with Timer Strip */}
      <div className="relative mt-[-6px] z-30">
          <div className="bg-black/80 border border-slate-600 rounded px-1.5 py-0.5 text-center min-w-[64px] shadow-lg backdrop-blur-md relative overflow-hidden">
            <div className="text-[9px] text-slate-300 font-bold truncate max-w-[60px] mx-auto leading-tight relative z-10">{player.name}</div>
            <div className={`text-[9px] font-bold leading-tight relative z-10 ${player.balance === 0 ? 'text-red-500' : 'text-yellow-500'}`}>${player.balance}</div>
            {player.isTurn && <div className="absolute bottom-0 left-0 h-[2px] bg-yellow-400 w-full animate-countdown"></div>}
          </div>
      </div>
      <style>{`@keyframes countdown { from { width: 100%; } to { width: 0%; } } .animate-countdown { animation: countdown 15s linear forwards; }`}</style>
    </div>
  );
};