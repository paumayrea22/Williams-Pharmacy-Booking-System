import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            // Instructs the Service Worker to update clients automatically on reload
            registerType: 'autoUpdate',
            // Files to cache preemptively for offline or weak network scenarios
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: "William's Pharmacy Booking System",
                short_name: 'PharmacyBook',
                description: 'Internal clinical scheduling and staff management infrastructure.',
                theme_color: '#F7F1E4', // Matches pharmacy-cream
                background_color: '#F7F1E4',
                display: 'standalone',
                orientation: 'portrait-primary',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any maskable'
                    }
                ]
            }
        })
    ]
});