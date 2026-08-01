# Contribuir a QuietMove

Gracias por ayudar a mejorar QuietMove. El proyecto prioriza la legalidad del ajedrez, las explicaciones comprobables y una interfaz tranquila y legible.

## Flujo local

```powershell
npm ci
npm test
npm run build
```

Las pruebas de navegador requieren Chromium:

```powershell
npx playwright install chromium
npm run test:e2e
```

## Antes de abrir un pull request

- No incluyas API keys, prompts privados, JSON de partidas ni capturas con datos sensibles.
- Comprueba español e inglés, tema claro y oscuro, escritorio y móvil.
- Si cambias la interfaz, describe la decisión visual y adjunta una captura si es útil.
- Si cambias reglas, FEN, PGN, SAN, Stockfish o contratos, añade pruebas.
- No conviertas una heurística en una afirmación atribuida a Stockfish.
- Mantén separadas la posición real, la posición histórica y las variantes educativas.

## Cambios en el profesor

El profesor recibe una sola pregunta por solicitud. Stockfish y `chess.js` son la autoridad para legalidad y variantes; el proveedor solo redacta la explicación. No añadas llamadas automáticas al proveedor para evaluar el tablero.

## Licencia

Las contribuciones se publican bajo GPL-3.0-or-later junto con QuietMove. Revisa [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) antes de añadir una dependencia o un recurso visual.
