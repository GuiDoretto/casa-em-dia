import './globals.css';
export const metadata = {
  title: 'Casa em Dia · Cuidar é compartilhar',
  description: 'A agenda da sua república: tarefas bem divididas, uma casa mais leve.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Casa em Dia' },
  icons: { icon: '/favicon.svg', apple: '/icons/apple-touch-icon.png' },
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#234b3b' };
export default function RootLayout({ children }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
