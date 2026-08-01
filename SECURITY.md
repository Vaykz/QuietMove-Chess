# Seguridad y privacidad

## No publiques secretos

No abras issues ni pull requests con:

- API keys de OpenAI o Gemini;
- archivos `.env`;
- prompts o respuestas que contengan información privada;
- exportaciones `quietmove-partida-*.json`;
- credenciales, tokens o certificados.

Si una clave fue publicada por accidente, revócala en el proveedor y genera otra. Borrarla del último commit no basta para considerarla segura.

## Reportar una vulnerabilidad

Cuando el repositorio tenga habilitadas las alertas privadas de GitHub, utiliza un **GitHub Security Advisory**. Si esa opción todavía no está disponible, contacta al mantenedor por un canal privado antes de publicar los detalles.

Incluye pasos reproducibles, versión afectada, impacto y una corrección sugerida si la conoces. No incluyas claves reales ni datos de terceros.

## Alcance actual

QuietMove no tiene cuentas ni telemetría propia. La clave introducida en la interfaz se mantiene en la memoria del servidor local. Las preguntas, FEN, historial y variantes se envían al proveedor que el usuario haya elegido al pulsar **Preguntar**, según sus propias condiciones.
