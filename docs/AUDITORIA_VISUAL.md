# Auditoría visual de QuietMove

## Veredicto

La interfaz actual tiene una dirección propia y coherente con un escritorio de estudio de ajedrez. En la revisión visual local no aparecen señales fuertes de una plantilla genérica de IA: no usa la tipografía Inter/Roboto como identidad, no depende de morados, glassmorphism, tarjetas flotantes repetidas ni iconografía de “asistente mágico”.

## Identidad que conviene conservar

- **Tipografía:** Andika para lectura y controles; Bitter para títulos y rótulos editoriales.
- **Paleta:** marfil, nogal, verde biblioteca y óxido, con contraste suficiente para el tablero.
- **Composición:** tablero como protagonista, navegación lateral sobria y panel del profesor como una hoja de estudio.
- **Textura:** grano y papel muy discretos; sirven para dar materialidad, no para decorar cada superficie.
- **Voz:** frases cortas y directas. El producto explica ajedrez; no necesita vender “inteligencia artificial”.

## Límites para futuras contribuciones

Antes de añadir una pantalla o componente, comprobar que no introduce:

- una fuente sans genérica como nueva identidad;
- gradientes llamativos, neón, morado o fondos de marketing;
- una cuadrícula de tarjetas con el mismo tratamiento visual;
- sombras grandes, vidrio translúcido o animaciones de demostración;
- iconos de cerebro, destellos o robots que sustituyan al contenido;
- texto de relleno, claims grandilocuentes o etiquetas que no ayuden a jugar.

Las texturas y transiciones existentes deben seguir siendo contenidas y respetar `prefers-reduced-motion`. La legibilidad, el foco de teclado y el contraste tienen prioridad sobre cualquier efecto visual.

## Comprobación rápida

1. Abrir la aplicación con `npm run dev`.
2. Revisar Profesor y Sin ayuda en escritorio y una pantalla estrecha.
3. Confirmar que el tablero, el historial y el profesor se entienden sin leer una explicación de marketing.
4. Revisar tema claro y oscuro, español e inglés.
5. Si el cambio altera tipografías, colores o densidad, adjuntar una captura en el pull request y explicar qué problema de aprendizaje resuelve.
