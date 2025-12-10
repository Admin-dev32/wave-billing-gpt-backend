import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'wave-billing-gpt-backend',
  description: 'Backend endpoints for Wave billing GPT integrations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
