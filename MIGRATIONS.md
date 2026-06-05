# Migraciones de Base de Datos

Este documento explica cómo agregar nuevas tablas o columnas a la base de datos **sin perder datos**.

## Flujo de trabajo seguro

### 1. En local (desarrollo)

Editas el archivo `backend/prisma/schema.prisma` con los cambios que necesitas (nuevos modelos, nuevos campos, etc.).

Luego creas una migración:

```bash
cd backend
npx prisma migrate dev --name descripcion_de_los_cambios
```

Esto genera automáticamente una carpeta nueva en `backend/prisma/migrations/` con el SQL necesario.

Commit y push:

```bash
git add -A
git commit -m "feat: add X to Y model"
git push
```

### 2. En el VPS (producción)

```bash
# Traer el código nuevo (incluye los archivos de migración)
cd /root/appchat && git pull origin main

# Aplicar SOLO las migraciones nuevas (NUNCA borra datos existentes)
docker compose -f docker-compose.vps.yml exec backend npx prisma migrate deploy

# Si cambió package.json, reconstruir e iniciar
docker compose -f docker-compose.vps.yml build backend
docker compose -f docker-compose.vps.yml up -d
```

## Comandos que NUNCA usar en producción

| Comando | Motivo |
|---------|--------|
| `prisma migrate reset` | Borra TODOS los datos de la base de datos |
| `prisma db push` | Puede causar inconsistencias entre schema y migraciones |
| `prisma migrate dev` | Solo para entorno local, no para producción |

## Comandos seguros

```bash
# Aplicar migraciones pendientes (solo agrega tablas/columnas nuevas)
docker compose -f docker-compose.vps.yml exec backend npx prisma migrate deploy

# Verificar estado de las migraciones
docker compose -f docker-compose.vps.yml exec backend npx prisma migrate status

# Ejecutar seed (solo si necesitas recrear cuentas admin)
docker compose -f docker-compose.vps.yml exec backend npx prisma db seed
```
