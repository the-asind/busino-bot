import React from 'react';

interface ChipStackProps {
  amount: number;
  className?: string;
  showValue?: boolean;
}

export const ChipStack: React.FC<ChipStackProps> = ({ amount, className = '', showValue = true }) => {
  if (amount <= 0) return null;

  // Simple logic to determine chip visualization
  const getChips = () => {
    const chips = [];
    // Limit visual height logic
    const maxChipsDisplay = 5;

    // Determine primary color based on magnitude
    let colorClass = 'bg-red-500 border-red-700'; // Default low
    if (amount >= 50) colorClass = 'bg-blue-600 border-blue-800';
    if (amount >= 200) colorClass = 'bg-slate-800 border-slate-950'; // Black
    if (amount >= 1000) colorClass = 'bg-yellow-500 border-yellow-700'; // Gold

    // inner ring color
    let ringColor = 'border-white/30';
    if (amount >= 1000) ringColor = 'border-yellow-200/50';

    // Number of chips to show (logarithmic-ish)
    const count = Math.min(Math.ceil(Math.log10(amount) * 2), maxChipsDisplay);

    for (let i = 0; i < count; i++) {
      chips.push(
        <div
          key={i}
          className={`absolute w-full h-full rounded-full border-2 shadow-sm flex items-center justify-center ${colorClass}`}
          style={{ bottom: `${i * 4}px` }}
        >
          <div className={`w-[70%] h-[70%] rounded-full border border-dashed ${ringColor}`}></div>
        </div>
      );
    }
    return chips;
  };

  return (
    <div className={`relative w-8 h-8 md:w-10 md:h-10 flex flex-col items-center justify-end z-20 ${className}`}>
      <div className="relative w-full h-full">
         {getChips()}
      </div>
      {showValue && (
        <div className="absolute -bottom-4 bg-black/80 px-1.5 rounded text-[10px] md:text-xs font-bold text-white shadow-sm whitespace-nowrap z-30">
          ${amount}
        </div>
      )}
    </div>
  );
};