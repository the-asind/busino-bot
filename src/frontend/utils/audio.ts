// Simple Audio Manager
// Ensure you place these files in your public/sounds/ folder

const SOUNDS = {
  check: new Audio('/sounds/check.mp3'),
  call: new Audio('/sounds/chips.mp3'), // Chips sound for call/raise
  fold: new Audio('/sounds/fold.mp3'),
  deal: new Audio('/sounds/card-slide.mp3'), // Single card slide
  flip: new Audio('/sounds/card-flip.mp3'), // Board card flip
  win: new Audio('/sounds/win.mp3'),
  lose: new Audio('/sounds/lose.mp3'),
  tick: new Audio('/sounds/tick.mp3'), // Ticking clock
};

// Preload sounds
Object.values(SOUNDS).forEach(audio => {
  audio.load();
  audio.volume = 0.5;
});

type SoundType = keyof typeof SOUNDS;

export const playSound = (type: SoundType) => {
  const audio = SOUNDS[type];
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(e => console.warn("Audio play failed (interaction required):", e));
  }
};

export const stopSound = (type: SoundType) => {
    const audio = SOUNDS[type];
    if (audio) {
        audio.pause();
        audio.currentTime = 0;
    }
};
