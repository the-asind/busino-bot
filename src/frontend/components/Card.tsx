import React from 'react';
import { CardData, Suit, Rank } from '../types';

interface CardProps {
  card?: CardData; // If undefined, it's face down
  className?: string;
  small?: boolean;
  highlight?: boolean;
}

export const Card: React.FC<CardProps> = ({ card, className = '', small = false, highlight = false }) => {
  // Dimensions: Small (Hand) vs Normal (Board)
  const dimensions = small ? 'w-10 h-14 md:w-12 md:h-16 rounded' : 'w-12 h-16 md:w-16 md:h-24 rounded-md';

  // Font Sizes
  const rankSize = small ? 'text-[10px]' : 'text-xs md:text-base';
  const suitSize = small ? 'text-[8px]' : 'text-[10px] md:text-sm';
  const centerSize = small ? 'text-lg' : 'text-2xl md:text-4xl';

  // Highlight Styles
  const highlightClass = highlight
    ? 'ring-2 ring-yellow-400 shadow-[0_0_15px_rgba(250,204,21,0.8)] z-10 scale-110 transition-transform duration-500'
    : '';

  if (!card) {
    // Back of card
    return (
      <div className={`relative bg-indigo-900 border border-indigo-300/20 shadow-sm overflow-hidden ${dimensions} ${className} ${highlightClass}`}>
        {/* Geometric Pattern */}
        <div className="absolute inset-0 opacity-20"
             style={{ backgroundImage: 'radial-gradient(circle, #6366f1 1px, transparent 1px)', backgroundSize: '6px 6px' }}>
        </div>
        <div className="absolute inset-1 border border-indigo-400/30 rounded-sm"></div>
        <div className="absolute inset-0 flex items-center justify-center">
            <div className={`rounded-full bg-indigo-950/80 flex items-center justify-center border border-indigo-500/30 ${small ? 'w-5 h-5' : 'w-6 h-6 md:w-8 md:h-8'}`}>
               <span className="text-indigo-200 text-[8px] md:text-xs">♠</span>
            </div>
        </div>
      </div>
    );
  }

  const isRed = card.suit === Suit.HEARTS || card.suit === Suit.DIAMONDS;
  const colorClass = isRed ? 'text-red-600' : 'text-slate-900';

  const isFace = [Rank.JACK, Rank.QUEEN, Rank.KING, Rank.ACE].includes(card.rank);

  return (
    <div className={`relative bg-white shadow-sm flex flex-col justify-between p-0.5 md:p-1 select-none border border-slate-300 ${dimensions} ${className} ${highlightClass}`}>

      {/* Top Left: Rank */}
      <div className={`absolute top-0.5 left-0.5 md:top-1 md:left-1 flex flex-col items-center leading-none ${colorClass}`}>
        <span className={`font-bold tracking-tighter ${rankSize}`}>{card.rank}</span>
      </div>

      {/* Top Right: Suit */}
      <div className={`absolute top-0.5 right-0.5 md:top-1 md:right-1 flex flex-col items-center leading-none ${colorClass}`}>
        <span className={suitSize}>{card.suit}</span>
      </div>

      {/* Center Art */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none ${colorClass}`}>
         {isFace ? (
             <span className={`${centerSize} font-serif opacity-30 font-black`}>
                 {card.rank}
             </span>
         ) : (
             <span className={`${centerSize} opacity-30`}>
                 {card.suit}
             </span>
         )}
      </div>

      {/* Bottom Left: Suit (Rotated 180) */}
      <div className={`absolute bottom-0.5 left-0.5 md:bottom-1 md:left-1 flex flex-col items-center leading-none transform rotate-180 ${colorClass}`}>
        <span className={suitSize}>{card.suit}</span>
      </div>

      {/* Bottom Right: Rank (Rotated 180) */}
      <div className={`absolute bottom-0.5 right-0.5 md:bottom-1 md:right-1 flex flex-col items-center leading-none transform rotate-180 ${colorClass}`}>
        <span className={`font-bold tracking-tighter ${rankSize}`}>{card.rank}</span>
      </div>
    </div>
  );
};
