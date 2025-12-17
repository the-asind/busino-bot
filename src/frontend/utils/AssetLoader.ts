import { SOUND_MAP } from './audio';

export const preloadAssets = async () => {
    const promises: Promise<void>[] = [];

    // 1. Preload Audio
    // Iterate SOUND_MAP
    Object.values(SOUND_MAP).forEach(config => {
        if (config.type === 'file') {
            promises.push(new Promise((resolve) => {
                const audio = new Audio(`/app/assets/audio/${config.path}`);
                audio.oncanplaythrough = () => resolve();
                audio.onerror = () => resolve(); // Don't block
                // Trigger load
                audio.load();
            }));
        } else {
            // Folder
            const count = config.count || 1;
            for (let i = 1; i <= count; i++) {
                promises.push(new Promise((resolve) => {
                    const audio = new Audio(`/app/assets/audio/${config.path}${i}.ogg`);
                    audio.oncanplaythrough = () => resolve();
                    audio.onerror = () => resolve();
                    audio.load();
                }));
            }
        }
    });

    // 2. Preload Stickers (0..15 based on `ls` output, but let's try scanning up to 20 dynamically)
    // Or just fetch all known ones.
    const preloadSticker = (idx: number): Promise<void> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Stop chain or just resolve?
            // If we want to detect end, we handle it in StickerPicker.
            // Here we just want to cache what exists.
            img.src = `/app/assets/stickers/${idx}.webp`;
        });
    }

    // Parallel load 0-20
    for(let i=0; i<=20; i++) {
        promises.push(preloadSticker(i));
    }

    await Promise.all(promises);
    console.log('Assets preloaded');
};
