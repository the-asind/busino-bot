// src/frontend/utils/audio.ts

// --- AUDIO MAP CONFIGURATION ---
const AUDIO_BASE = '/app/assets/audio'; // Served via /app prefix

type AudioCategory = 'file' | 'folder';

export interface AudioConfig {
    type: AudioCategory;
    path: string;
    count?: number; // Only for folders
}

export const SOUND_MAP: Record<string, AudioConfig> = {
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
    'call_raise': { type: 'folder', path: 'call_rase/cr', count: 3 }, // Call/Raise
    'deal_hole': { type: 'folder', path: 'cards_to_player/deal_', count: 3 },
};

// Web Audio API Context
let audioCtx: AudioContext | null = null;
const audioBufferCache: Record<string, AudioBuffer> = {};

// Initialize Audio Context lazily and handle unlock (Chrome/iOS policy)
const initAudioContext = () => {
    if (!audioCtx) {
        // Cross-browser support
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }

    // Resume if suspended (common browser policy requirement)
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(e => console.error('Audio resume failed:', e));
    }
};

// Global unlocker listener
const unlockAudio = () => {
    initAudioContext();
    if (audioCtx) {
        // Play silent buffer to unlock
        const buffer = audioCtx.createBuffer(1, 1, 22050);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start(0);

        // Remove listeners once unlocked
        document.removeEventListener('click', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
    }
};

// Add listeners immediately
if (typeof window !== 'undefined') {
    document.addEventListener('click', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
}

const fetchAndDecode = async (path: string): Promise<AudioBuffer | null> => {
    if (audioBufferCache[path]) return audioBufferCache[path];
    if (!audioCtx) initAudioContext();
    if (!audioCtx) return null;

    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to fetch ${path}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        audioBufferCache[path] = audioBuffer;
        return audioBuffer;
    } catch (e) {
        console.error(`Error loading audio ${path}:`, e);
        return null;
    }
};

export const playSound = async (soundName: string) => {
    // Ensure context exists and is running
    initAudioContext();
    if (!audioCtx) return;

    const config = SOUND_MAP[soundName];
    if (!config) {
        console.warn(`Sound not found: ${soundName}`);
        return;
    }

    let srcPath = '';
    if (config.type === 'file') {
        srcPath = `${AUDIO_BASE}/${config.path}`;
    } else {
        const idx = Math.floor(Math.random() * (config.count || 1)) + 1;
        srcPath = `${AUDIO_BASE}/${config.path}${idx}.ogg`;
    }

    try {
        const buffer = await fetchAndDecode(srcPath);
        if (buffer) {
            const source = audioCtx.createBufferSource();
            source.buffer = buffer;
            // Create a gain node for volume control (optional, default 0.5 matching previous logic)
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = 0.5;

            source.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            source.start(0);
        }
    } catch (e) {
        console.error('Play sound failed:', e);
    }
};

export const playTurnAlert = () => {
    playSound('time_to_act');
};
