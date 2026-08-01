# Publicar QuietMove en GitHub

Esta guía asume un repositorio público para el código fuente. QuietMove no incluye todavía un despliegue público del profesor: el backend actual es local.

## 1. Crear el repositorio

En GitHub crea un repositorio nuevo, vacío y público. No generes otro README, `.gitignore` ni licencia: ya están en este proyecto.

## 2. Revisión local antes de subir

```powershell
git status --short
git check-ignore -v .env .env.local quietmove-partida-prueba.json quietmove-prueba.pgn
rg -n -i --glob '!node_modules/**' --glob '!dist/**' '(AIza|sk-[A-Za-z0-9]{20,}|api[_-]?key\s*[:=])' .
npm test
npm run build
```

El último comando debe terminar correctamente. Si `npm run build` falla por el entorno local, no publiques ese estado como una versión verificada.

## 3. Conectar y subir

Sustituye la URL por la del repositorio recién creado:

```powershell
git remote add origin https://github.com/TU_USUARIO/quietmove-chess.git
git branch -M main
git add .
git commit -m "chore: prepare public repository"
git push -u origin main
```

## 4. Ajustes recomendados en GitHub

- Activa Issues y Discussions solo si vas a revisar y responder aportes.
- Activa Dependabot para las actualizaciones de npm.
- Protege `main` cuando empiecen a llegar pull requests.
- Mantén habilitado el escaneo de secretos si está disponible.
- Añade una descripción breve y enlaza `README.md`, `SECURITY.md` y `THIRD_PARTY_NOTICES.md`.
- No publiques archivos `.env`, claves, logs, capturas privadas ni exportaciones de partidas.

## 5. Qué no hacer todavía

No actives GitHub Pages esperando que el profesor funcione. Pages puede servir la interfaz estática, pero `/api/teacher/respond` necesita una función o servidor adicional. Para una demo pública habrá que adaptar ese backend y decidir si las personas usan su propia clave o si QuietMove proporciona una con límites.
