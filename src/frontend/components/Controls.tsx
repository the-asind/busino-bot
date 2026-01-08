import React, { useState, useEffect } from 'react';

interface ControlsProps {
  isMyTurn: boolean;
  isFolded: boolean;
  currentCallAmount: number; // The table's highest bet in current round
  myRoundBet: number; // What I have bet in this round
  minRaise: number;
  balance: number;
  canShowCards?: boolean;
  showCardsDisabled?: boolean;
  onAction: (action: string, amount?: number) => void;
  onRequestRaise: () => void;
}

export const Controls: React.FC<ControlsProps> = ({
  isMyTurn,
  isFolded,
  currentCallAmount,
  myRoundBet,
  canShowCards = false,
  showCardsDisabled = false,
  onRequestRaise,
  onAction
}) => {
  const [preMove, setPreMove] = useState<string | null>(null);

  // Amounts
  const callCost = currentCallAmount - myRoundBet;
  const canCheck = callCost <= 0;

  // Handle Pre-moves when turn becomes active
  useEffect(() => {
    if (isMyTurn && preMove) {
      let actionTaken = false;

      switch (preMove) {
        case 'check_fold':
          // 1. Check/Fold: Check if free, otherwise Fold immediately
          if (canCheck) {
            onAction('Check');
          } else {
            onAction('Fold');
          }
          actionTaken = true;
          break;

        case 'check':
          // 2. Check: Check if free. If not free, do NOTHING (waiting for player)
          if (canCheck) {
            onAction('Check');
            actionTaken = true;
          }
          // If !canCheck, we simply clear the preMove below,
          // revealing the standard buttons for the user to decide.
          break;

        case 'call_any':
          // 3. Call Any: Always call regardless of amount
          onAction('Call');
          actionTaken = true;
          break;
      }

      // Always clear pre-move once our turn starts
      setPreMove(null);
    }
  }, [isMyTurn, preMove, canCheck, onAction]);

  // If folded (or spectator), show nothing
  // Exception: If I won by others folding, I might have "Show Cards" option.
  // But isFolded check below prevents seeing it?
  // "if all except player folded... appear one button SHOW CARDS".
  // If I won, `isFolded` is false for me.

  if (canShowCards) {
      return (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-3 pb-8 backdrop-blur-md z-50 flex justify-center">
            <button
              onClick={() => !showCardsDisabled && onAction('ShowCards')}
              disabled={showCardsDisabled}
              className={`w-full max-w-sm font-bold py-3 rounded-xl shadow-lg border-b-4 transition-all ${
                  showCardsDisabled
                  ? 'bg-slate-600 text-slate-400 border-slate-800 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white border-purple-800 active:border-b-0 active:translate-y-1'
              }`}
            >
              SHOW CARDS
            </button>
        </div>
      );
  }

  if (isFolded) {
      return null;
  }

  if (!isMyTurn) {
    // PRE-MOVES
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-2 pb-6 flex justify-around items-center backdrop-blur-md z-50 h-24">
        <PreMoveButton
          label="Check/Fold"
          active={preMove === 'check_fold'}
          icon="✕"
          onClick={() => setPreMove(preMove === 'check_fold' ? null : 'check_fold')}
        />
        <PreMoveButton
          label="Check"
          active={preMove === 'check'}
          icon="✓"
          // Removed subText="Fold на ставку" as requested
          onClick={() => setPreMove(preMove === 'check' ? null : 'check')}
        />
        <PreMoveButton
          label="Call Any"
          active={preMove === 'call_any'}
          icon="⟳"
          onClick={() => setPreMove(preMove === 'call_any' ? null : 'call_any')}
        />
      </div>
    );
  }

  // ACTIVE MOVES
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-slate-900/95 border-t border-slate-700 p-3 pb-8 backdrop-blur-md z-50">
      <div className="flex gap-3 justify-center w-full max-w-lg mx-auto">

        {/* FOLD */}
        <button
          onClick={() => onAction('Fold')}
          className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl shadow-lg border-b-4 border-red-800 active:border-b-0 active:translate-y-1 transition-all flex flex-col items-center justify-center"
        >
          <span className="text-base md:text-lg">FOLD</span>
        </button>

        {/* CHECK / CALL */}
        <button
          onClick={() => onAction(canCheck ? 'Check' : 'Call')}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-lg border-b-4 border-emerald-800 active:border-b-0 active:translate-y-1 transition-all flex flex-col items-center justify-center"
        >
          <span className="text-base md:text-lg">{canCheck ? 'CHECK' : 'CALL'}</span>
          {!canCheck && <span className="text-xs text-emerald-200">${callCost}</span>}
        </button>

        {/* RAISE REQUEST */}
        <button
          onClick={onRequestRaise}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-lg border-b-4 border-blue-800 active:border-b-0 active:translate-y-1 transition-all flex flex-col items-center justify-center"
        >
          <span className="text-base md:text-lg">{canCheck ? 'BET' : 'RAISE'}</span>
          <span className="text-xs text-blue-200">
             ...
          </span>
        </button>

      </div>
    </div>
  );
};

const PreMoveButton: React.FC<{label: string, active: boolean, onClick: () => void, icon: string, subText?: string}> = ({
  label, active, onClick, icon, subText
}) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center w-20 h-14 rounded-lg transition-colors border ${
      active ? 'bg-slate-700 border-yellow-500 text-yellow-400' : 'bg-transparent border-slate-600 text-slate-400 hover:bg-slate-800'
    }`}
  >
    <div className="text-lg font-bold leading-none mb-1">{icon}</div>
    <div className="text-[10px] font-semibold leading-none">{label}</div>
    {subText && <div className="text-[9px] opacity-70 mt-0.5">{subText}</div>}
  </button>
);