// src/frontend/utils/audio.ts

// --- AUDIO MAP CONFIGURATION ---
const AUDIO_BASE = '/app/assets/audio'; // Served via /app prefix

type AudioCategory = 'file' | 'folder';

interface AudioConfig {
    type: AudioCategory;
    path: string;
    count?: number; // Only for folders
}

const SOUND_MAP: Record<string, AudioConfig> = {
    'button_click': { type: 'file', path: 'btn.ogg' },
    'check': { type: 'file', path: 'check.ogg' },
    'coins_clang': { type: 'file', path: 'coins_clang.ogg' },
    'new_message': { type: 'file', path: 'new_msg.ogg' },
    'time_to_act': { type: 'file', path: 'time_to_act.ogg' },
    'win': { type: 'file', path: 'win.ogg' },

    // Folders
    'cards_to_deck': { type: 'folder', path: 'cards_to_deck/t2d_', count: 3 },
    'deal_community': { type: 'folder', path: 'deal/d', count: 3 },
    'spend_coins': { type: 'folder', path: 'spend_coins/sc_', count: 3 },
    'bet': { type: 'folder', path: 'trow_beat/trow_', count: 3 }, // Raise/Bet
    'call_raise': { type: 'folder', path: 'call_rase/cr', count: 3 }, // Call/Raise (Assuming 'cr' prefix based on 'cr1.ogg')
    'deal_hole': { type: 'folder', path: 'cards_to_player/deal_', count: 3 },
};

// Preload cache not strictly necessary for modern browsers but good for repeated sounds
const audioCache: Record<string, HTMLAudioElement> = {};

export const playSound = (soundName: string) => {
    const config = SOUND_MAP[soundName];
    if (!config) {
        console.warn(`Sound not found: ${soundName}`);
        return;
    }

    let src = '';
    if (config.type === 'file') {
        src = `${AUDIO_BASE}/${config.path}`;
    } else {
        const idx = Math.floor(Math.random() * (config.count || 1)) + 1;
        src = `${AUDIO_BASE}/${config.path}${idx}.ogg`;
    }

    const audio = new Audio(src);
    audio.volume = 0.5;
    audio.play().catch(e => console.error('Audio play error:', e));
};

export const playTurnAlert = () => {
    playSound('time_to_act');
};
