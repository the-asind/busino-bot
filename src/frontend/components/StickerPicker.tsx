import React, { useState } from 'react';

interface StickerPickerProps {
    onSelect: (stickerId: number) => void;
    onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
    // Hardcoded range 0-25
    const stickers = Array.from({ length: 26 }, (_, i) => i);

    return (
        <>
            {/* Click Outside Overlay */}
            <div className="fixed inset-0 z-[99]" onClick={onClose}></div>

            {/* Picker Content */}
            <div className="absolute bottom-0 left-0 right-0 z-[100] bg-slate-900/95 border-t border-slate-700 p-4 rounded-t-2xl shadow-2xl animate-slide-up backdrop-blur-md w-full">
                <div className="grid grid-cols-8 md:grid-cols-10 gap-3 max-h-60 overflow-y-auto custom-scrollbar pb-safe">
                    {stickers.map(id => (
                        <button
                            key={id}
                            onClick={() => onSelect(id)}
                            className="aspect-square hover:bg-slate-700/50 rounded-xl transition-all active:scale-90 flex items-center justify-center"
                        >
                            <img src={`/app/assets/stickers/${id}.webp`} alt={`Sticker ${id}`} className="w-full h-full object-contain drop-shadow-md" />
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
};
