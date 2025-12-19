import React, { useState } from 'react';

interface StickerPickerProps {
    onSelect: (stickerId: number) => void;
    onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
    // Hardcoded range 0-25
    const stickers = Array.from({ length: 26 }, (_, i) => i);

    return (
        <div className="absolute bottom-20 left-4 z-[100] bg-slate-800 border border-slate-600 p-3 rounded-xl shadow-2xl animate-fade-in w-64">
            <div className="flex justify-between items-center mb-2">
                <span className="text-white text-xs font-bold uppercase">Стикеры</span>
                <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
            </div>
            <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto custom-scrollbar">
                {stickers.map(id => (
                    <button
                        key={id}
                        onClick={() => onSelect(id)}
                        className="hover:bg-slate-700 p-1 rounded transition-colors"
                    >
                        <img src={`/app/assets/stickers/${id}.webp`} alt={`Sticker ${id}`} className="w-12 h-12 object-contain" />
                    </button>
                ))}
            </div>
        </div>
    );
};
