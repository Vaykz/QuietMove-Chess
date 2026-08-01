# QuietMove Chess

### Juega una partida. Detente. Pregunta por qué.

QuietMove es un escritorio de estudio para aprender ajedrez jugando. El tablero y Stockfish funcionan localmente; el profesor aparece solo cuando haces una pregunta y utiliza la API que tú configures.

> **Estado actual:** aplicación local funcional. El profesor todavía necesita el servidor local incluido en este repositorio; subir únicamente los archivos estáticos no crea ese backend.

## Empezar

Requisitos: Node.js 22 o posterior y Chrome o Edge actual.

```powershell
npm ci
npm run dev
```

Abre `http://127.0.0.1:5173`.

Para usar el profesor, entra en **Preferencias**, elige OpenAI o Google Gemini y pega tu propia clave. La clave se verifica y permanece solo en la memoria del servidor local; no se guarda en `localStorage`, no se incluye en el registro de la partida y se pierde al cerrar el proceso.

También puedes configurar una clave antes de iniciar:

```powershell
$env:GEMINI_API_KEY = "tu-clave"
npm run dev
```

No pongas claves reales en este repositorio, en capturas, en issues ni en archivos exportados.

## Qué hace QuietMove

- **Partida con profesor:** juegas y preguntas por la posición actual.
- **Partida sin ayuda:** juegas sin profesor durante la partida y la desbloqueas al terminar.
- **Stockfish local:** evaluación, bot, variantes y clasificaciones sin llamadas a la API.
- **Explicaciones verificables:** las variantes se validan contra `chess.js` antes de enviarse al proveedor.
- **Historial navegable:** puedes recorrer la partida, revisar posiciones y, si activas la preferencia, continuar desde una posición anterior.
- **Resumen de partida:** clasificaciones, estimación provisional y exportación explícita de un JSON de la sesión.

La IA se utiliza únicamente al pulsar **Preguntar**. Las consultas envían al proveedor elegido la pregunta, el FEN, el historial, hechos de la posición y líneas de Stockfish. La aplicación no incluye cuentas, telemetría ni un backend remoto propio.

## Arquitectura breve

```text
src/domain       reglas, estado, FEN/PGN y contratos
src/services     Stockfish, clasificaciones, preferencias y API del profesor
src/components   tablero y piezas de Chessground
server           pasarela local para OpenAI y Google Gemini
public           WASM, sonidos e índice local de aperturas
```

El navegador calcula el ajedrez. El servidor local solo hace de puente hacia el proveedor externo para no exponer la clave a la interfaz. Por eso un hosting estático como GitHub Pages puede servir el tablero, pero necesita una función o servidor adicional para el profesor.

## Privacidad y exportaciones

- Stockfish se ejecuta en tu dispositivo.
- Solo se guardan localmente las preferencias de interfaz.
- Las conversaciones no se conservan automáticamente.
- El JSON de una partida puede contener prompts, respuestas, FEN, PGN, tokens y costes estimados: trátalo como un archivo privado.
- `quietmove-partida-*.json` y `quietmove-*.pgn` están excluidos por `.gitignore` para no subirlos por accidente.

## Desarrollo y verificación

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Antes de abrir un pull request, comprueba ambos temas, español e inglés, los dos modos y los estados de carga/error. Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) y [SECURITY.md](./SECURITY.md).

## Documentación del proyecto

- [Guía de diseño web con personalidad](./GUIA_DISENO_WEB_CON_PERSONALIDAD.md)
- [Auditoría visual y límites de diseño](./docs/AUDITORIA_VISUAL.md)
- [Especificación y decisiones de QuietMove](./QuietMove%20Chess.md)
- [Atribuciones de terceros](./THIRD_PARTY_NOTICES.md)

## Licencia

QuietMove se distribuye bajo [GPL-3.0-or-later](./LICENSE). El tablero Chessground y Stockfish también tienen obligaciones GPL; conserva los avisos y publica el código fuente correspondiente cuando distribuyas una versión modificada.
