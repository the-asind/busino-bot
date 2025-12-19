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

    // 2. Preload Stickers (0..25 hardcoded range)
    const preloadSticker = (idx: number): Promise<void> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = `/app/assets/stickers/${idx}.webp`;
        });
    }

    // Parallel load 0-25
    for(let i=0; i<=25; i++) {
        promises.push(preloadSticker(i));
    }

    await Promise.all(promises);
    console.log('Assets preloaded');
};
