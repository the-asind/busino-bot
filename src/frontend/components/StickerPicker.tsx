import React, { useState, useEffect } from 'react';

interface StickerPickerProps {
    onSelect: (stickerId: number) => void;
    onClose: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
    const [stickers, setStickers] = useState<number[]>([]);

    useEffect(() => {
        // Sequential scanning logic
        // We try to fetch 0.webp, 1.webp, etc.
        // Since we can't directory list, we chain requests.

        let active = true;
        const found: number[] = [];

        const checkSticker = async (idx: number) => {
            if (!active) return;
            try {
                const res = await fetch(`/app/assets/stickers/${idx}.webp`, { method: 'HEAD' });
                if (res.ok) {
                    found.push(idx);
                    setStickers([...found]);
                    checkSticker(idx + 1);
                }
            } catch (e) {
                // Stop scanning
            }
        };

        checkSticker(0);

        return () => { active = false; };
    }, []);

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
                {stickers.length === 0 && <div className="col-span-4 text-center text-slate-500 text-xs">Загрузка...</div>}
            </div>
        </div>
    );
};
