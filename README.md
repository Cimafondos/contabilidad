# Cimafondos — Sistema Contable v6.1

Sistema de contabilidad para Cimafondos S.L. (inversión en NPL/deuda hipotecaria).

## Despliegue en Railway

1. Crear proyecto en Railway
2. Conectar este repositorio de GitHub
3. Añadir variable de entorno: `DB_PATH=/app/data/cimafondos.db`
4. Añadir volumen: montar en `/app/data`
5. Deploy automático

## API Endpoints

- `POST /api/login` — Autenticación
- `GET/POST /api/accounts/:companyId` — Plan de cuentas
- `GET/POST/DELETE /api/entries/:companyId` — Asientos contables
- `GET/POST /api/transactions/:companyId` — Movimientos bancarios
- `GET/POST/DELETE /api/rules/:companyId` — Reglas de matching
- `GET/POST/DELETE /api/masters/:companyId/:type` — Maestros (clientes, proveedores, bancos)
- `GET /api/backup/:companyId` — Backup completo

## Usuarios por defecto

- admin/admin (Administrador)
- javier/1234 (Admin)
- pepe/1234 (Usuario)
- santi/1234 (Usuario)
