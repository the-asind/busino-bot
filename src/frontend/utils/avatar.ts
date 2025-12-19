export const generateAvatar = (name: string): string => {
    // 1. Generate consistent hash from name
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    // 2. Generate Pastel Color (HSL)
    // Hue: 0-360 (from hash)
    // Saturation: 60-80% (Pastel)
    // Lightness: 70-85% (Pastel/Light)
    const h = Math.abs(hash % 360);
    const s = 70 + (Math.abs(hash) % 20);
    const l = 75 + (Math.abs(hash) % 10);

    const color1 = `hsl(${h}, ${s}%, ${l}%)`;
    const color2 = `hsl(${h}, ${s}%, ${l - 15}%)`; // Slightly darker for subtle gradient

    const letter = name.charAt(0).toUpperCase();

    // 3. Create SVG Data URI
    const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
            </linearGradient>
        </defs>
        <rect width="100" height="100" fill="url(#grad)" />
        <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold" font-size="50">${letter}</text>
    </svg>
    `;

    return `data:image/svg+xml;base64,${btoa(svg)}`;
};
