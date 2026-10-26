import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Digital Dental Lab',
  description: 'Aufträge, Produktion und Portal für Ordinationen',
  icons: { icon: '/ddl-mark.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // رابط فقط آلمانی اتریش است؛ هیچ لایهٔ RTL اینجا نیست.
  return (
    <html lang="de-AT" dir="ltr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
