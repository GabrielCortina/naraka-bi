'use client';

export function MercadoLivreLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#FFE600"/>
      <path d="M16 8C11.6 8 8 11.6 8 16s3.6 8 8 8 8-3.6 8-8-3.6-8-8-8z" fill="#009EE3"/>
      <path d="M16 10l2 4h4l-3 2.5 1 4-4-2.5-4 2.5 1-4-3-2.5h4z" fill="#FFE600"/>
    </svg>
  );
}

export function ShopeeLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#EE4D2D"/>
      <path d="M16 7c-2.8 0-5 2.2-5 5h2c0-1.7 1.3-3 3-3s3 1.3 3 3h2c0-2.8-2.2-5-5-5z" fill="white"/>
      <rect x="9" y="12" width="14" height="12" rx="2" fill="white"/>
      <circle cx="13" cy="18" r="1.5" fill="#EE4D2D"/>
      <circle cx="19" cy="18" r="1.5" fill="#EE4D2D"/>
    </svg>
  );
}

export function TikTokLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#000000"/>
      <path d="M20 8h-3v10.5c0 1.4-1.1 2.5-2.5 2.5S12 19.9 12 18.5s1.1-2.5 2.5-2.5c.3 0 .5 0 .8.1V13c-.3 0-.5-.1-.8-.1C11 12.9 8.5 15.4 8.5 18.5S11 24 14.5 24s6-2.5 6-5.5V13c1 .7 2.3 1 3.5 1v-3c-2 0-4-1.7-4-3z" fill="white"/>
    </svg>
  );
}

export function SheinLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="16" fill="#000000"/>
      <text x="6" y="21" fontSize="11" fontWeight="bold" fill="white" fontFamily="Arial">SHE</text>
    </svg>
  );
}

export function MarketplaceLogo({ marketplace }: { marketplace: string }) {
  switch (marketplace) {
    case 'mercado_livre': return <MercadoLivreLogo />;
    case 'shopee': return <ShopeeLogo />;
    case 'tiktok': return <TikTokLogo />;
    case 'shein': return <SheinLogo />;
    default: return <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#888' }} />;
  }
}
