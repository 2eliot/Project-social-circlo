'use client';

import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';

/**
 * Hook que intercepta el botón/gesto nativo de retroceso en Android
 * y decide qué hacer según el estado actual de la app:
 *
 * - Si hay un estado anterior en la pila → ejecuta onBack()
 * - Si no hay más estados → minimizeApp() (cierra la app)
 *
 * Uso:
 *   useAndroidBackButton(canGoBack, onBack);
 *
 * @param canGoBack - false cuando la app está en la pantalla principal
 * @param onBack    - callback que ejecuta la navegación hacia atrás
 */
export function useAndroidBackButton(canGoBack: boolean, onBack: () => void) {
  // Ref para evitar problemas de closures en el listener
  const canGoBackRef = useRef(canGoBack);
  const onBackRef = useRef(onBack);

  useEffect(() => {
    canGoBackRef.current = canGoBack;
    onBackRef.current = onBack;
  }, [canGoBack, onBack]);

  useEffect(() => {
    let unregister: (() => Promise<void>) | null = null;

    (async () => {
      try {
        const handler = await App.addListener('backButton', () => {
          if (canGoBackRef.current) {
            // Hay pantalla anterior — navegar hacia atrás
            onBackRef.current();
          } else {
            // Pantalla principal — minimizar app
            App.minimizeApp();
          }
        });
        unregister = () => handler.remove();
      } catch {
        // No estamos en Capacitor (entorno web/browser)
      }
    })();

    return () => {
      if (unregister) unregister();
    };
  }, []);
}
