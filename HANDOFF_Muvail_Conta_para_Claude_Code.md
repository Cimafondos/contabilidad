# HANDOFF — Muvail Conta (para continuar en Claude Code)

**Fecha:** 29/05/2026
**De:** sesión de chat web → **Para:** Claude Code
**Usuario:** Javier (Cimafondos / Valentia Alimentación S.L.)

---

## 0. CONTEXTO CRÍTICO SOBRE EL FLUJO GIT (léelo primero)

- Repo: **`github.com/Cimafondos/contabilidad`**
- Despliegue automático en **Railway**: `https://contabilidad-production-bf48.up.railway.app`
- Archivo principal frontend: **`public/index.html`** (~7.970 líneas, todo en un solo archivo: HTML + CSS + 3 bloques `<script>`).
- Backend: `src/server.js` (~1.790 líneas), Node.js + SQLite.
- Versión actual en repo: **v10.7.1**

**Sobre quién sube a Git:**
- En **Claude Code (este entorno) SÍ puedes hacerlo tú directamente**: clone, edit, commit, push. En una sesión previa (28/05) se hizo push directo con éxito (`5c81e2b..c2fcd46 main -> main`) usando un token `ghp_...`. Railway redespliega solo tras el push.
- En el **chat web** (de donde viene este handoff) Claude NO tiene acceso de red a GitHub/Railway, por eso ahí el flujo era manual (Javier descargaba el `index.html` y hacía Commit+Push en GitHub Desktop).
- **Acción para Claude Code:** pídele a Javier el token de GitHub (PAT classic con scope `repo`) si no está ya configurado en el entorno, clona el repo y trabaja directamente. Token previo: `contabilidad2`, caducaba 11/06/2026 — puede haber sido regenerado, **pedir el vigente**. (Si algún token quedó expuesto en texto plano, recomendar revocarlo.)

**Flujo de trabajo correcto en Claude Code:**
1. `git clone` del repo (o `git pull` si ya está).
2. Editar `public/index.html`.
3. **Validar sintaxis JS** antes de commit (extraer los 3 bloques `<script>` y `new Function(s)` sobre cada uno).
4. `git commit` + `git push`.
5. Esperar redeploy de Railway (~1-2 min) y pedir a Javier Ctrl+F5.

⚠️ **OJO con versiones desincronizadas:** en sesiones pasadas hubo líos porque Javier subía una versión antigua del `index.html` por error y el repo iba commits por delante. **Siempre `git pull` y trabajar sobre la versión real del repo (HEAD), nunca sobre un archivo local que pueda estar viejo.** Verificar versión con `grep 'v10\.[0-9]\.[0-9]' public/index.html`.

---

## 1. EMPRESA Y DATOS DE PRUEBA

- Empresa activa: **Valentia Alimentación S.L.** (comercio minorista, **régimen de recargo de equivalencia**).
- Otra empresa en el sistema: **Cimafondos** (inversión NPL). Multi-tenant verificado y aislado correctamente (sin fugas de datos entre empresas).
- Dataset de prueba cargado: **142 asientos, 37 facturas (22 emitidas + 15 recibidas), 246 cuentas**.
- Cifras clave del dataset test (todas verificadas correctas):
  - Ventas (cifra negocio) = 198.000 (G7 bruto 200.000 − devol. 708 1.000 − rappel 709 1.000)
  - Compras grupo 6 = 195.619,99 ; Resultado ejercicio = **2.380,01**
  - IVA repercutido 477 = 38.930 ; IVA soportado 472 = 27.541 ; IVA a pagar = 11.389
  - Clientes 430 = 73.930 ; Proveedores 400 = 39.760,99 ; Tesorería = 26.100 (caja 10.000 + bancos 16.100... ojo, en pantalla aparece 36.100 incl. saldos)
  - Retenciones 4751 = 5.500

**Concepto contable clave (recargo de equivalencia):** en Valentia, el recargo soportado NO es IVA deducible; se contabiliza como **mayor coste de la mercancía en el grupo 6** (cuenta 60000000), NO en la 47200001. La 47200001 debe quedar a **cero**. Esto es CORRECTO y deliberado. Cualquier test que espere el recargo en 47200001 está mal planteado.

---

## 2. TRABAJO YA HECHO EN ESTA SESIÓN (pendiente de subir a Git)

Se entregó a Javier un `index.html` parcheado (vía chat web, descarga manual). **Verificar si ya está en el repo o si hay que reaplicar.** Comprobar con:
```
grep -c "iva477Facturas" public/index.html        # debe ser >0 si ya está
grep -c "'490','493','436'" public/index.html      # debe ser >0 si ya está
grep -c "integrado como mayor coste en grupo 6" public/index.html
```

### Parche A — Tests de cuadre fiscal (Admin → "Test de cuadre fiscal")
Los tests usan el campo **`e.type === 'import_factura'`** para identificar asientos de factura (método del repo, mejor que los tags `[VT-]`/`[RC-]` del concepto). Cambios aplicados:

- **Test 7 (IVA repercutido 477):** se creó `iva477Facturas` = solo cuentas 477 de asientos `import_factura` con cuenta 430x/431x. Se conserva `iva477` (total del periodo) porque lo necesita el **Test 10 (Modelo 303)**. Motivo: las rectificaciones de venta (rappels 709, devol. 708) minoran el 477 pero NO son facturas → no están en la tabla invoices → causaban falso descuadre.
- **Test 8 (Recargo equivalencia):** reformulado para verificar que la cuenta **47200001 = 0** (recargo integrado en grupo 6). Detalle nuevo: "En facturas: X€ (integrado como mayor coste en grupo 6) · Cuenta 47200001: 0€".
- **Test 11 (Ventas G7):** ahora solo suma grupo 7 de asientos `import_factura` con cuenta 430x/431x (excluye rappels/devoluciones).
- **Test 12 (Compras G6):** YA estaba correcto en el repo (filtra `import_factura` + cuenta 400/410 y suma el recargo en la base). **NO se tocó.**

### Parche B — Pantalla Balance, falso "Descuadre 5.000,00€" (RESUELTO)
- **Causa raíz confirmada por consola:** la cuenta **49000000 (Deterioro de valor de créditos por operaciones comerciales)**, saldo −5.000 (provisión insolvencias), NO estaba clasificada en ninguna lista de `renderBalance()` → sus −5.000 quedaban fuera del balance → falso descuadre de 5.000€.
- **La contabilidad NUNCA estuvo descuadrada.** Verificado: Activo 540.671 = PN+Pasivo 540.671 (diff 0). Asientos cuadrados (Debe=Haber global).
- **Fix aplicado** (función `renderBalance`, ~línea 2248): se añadieron prefijos `'490','493','436'` a la lista `aDeudores` (deudores comerciales del activo). La 490 es cuenta correctora de activo (PGC), así aparece restando en "III. Deudores comerciales" y el balance cuadra.
- Nota: el **Test 4** del cuadre fiscal ya manejaba bien la 490 (la metía en pasivo por su saldo acreedor), por eso ese test daba "OK". Pantalla y test discrepaban en presentación; ahora la pantalla la coloca en el activo (lo correcto).

**Sintaxis validada OK** (3 bloques script) tras ambos parches.

---

## 3. PENDIENTE / SIGUIENTES PASOS

1. **[URGENTE] Subir a Git los parches A y B** (si no están ya) y verificar en producción tras deploy:
   - Balance debe decir "Cuadrado" (no "Descuadre 5.000€"); la 49000000 aparece en Deudores con −5.000.
   - Test de cuadre fiscal: los 17 tests en verde con cifras reales.

2. **[Timing / bug intermitente] "Facturas: 0,00€" en el test tras deploy.** Síntoma: al recargar justo tras el deploy, el test de cuadre comparaba contra 0 facturas (tests 6,7,9,11,12,15,16 daban diffs enormes). Causa: el test se ejecuta ANTES de que termine `loadInvoices()` (se vio un `401 /api/companies/1` puntual de sesión no lista). Con Ctrl+F5 y carga completa se resuelve. **Mejora propuesta:** hacer que el test de cuadre espere a que `state.invoices` esté cargado antes de comparar (await loadInvoices / guard). Confirmado que las 37 facturas SÍ cargan bien (`[loadInvoices] valentia_alimentacion_s_l : 37 facturas`).

3. **[Pendiente] Reset completo + reimportar Valentia real.** El botón "Generar datos test" limpia asientos/facturas pero NO el plan de cuentas. Quedan **7 cuentas de terceros reales residuales con saldo** mezcladas con los datos test (40000007, 40000012, 40000014, 40000015, 43000002, 43000003, 43000004 — p.ej. CARSOJUSO, JOAO MESSIAS, TRANSPORTES SERRANIA, y Valentia figurando como cliente de sí misma 43000004 = 7.990€). Aparecían en pantalla "Pendientes". Solución: "Reset completo empresa" + reimportar Valentia desde Gestor Documental.

4. **[Mejora] "Generar datos test"** debería hacer reset completo previo (incluido plan de cuentas) para datasets 100% aislados.

5. **[Menor] Modelo 347:** está incluyendo exportación exenta (CLIENTE EXPORT) y terceros bajo el umbral de 3.005,06€ que no deberían declararse. Filtrar.

6. **[Menor] Unificar "IVA a pagar"** entre Panel (11.389) y pantalla Modelo 303 (mostraba 19.579 por usar distinto IVA soportado). Revisar qué base de IVA soportado usa cada uno.

---

## 4. REFERENCIAS DE CÓDIGO (en `public/index.html`, v10.7.1)

- `renderBalance(c)` — ~línea 2230. Listas de clasificación de cuentas ~2245-2253. Cálculo resultado ~2238-2240. **Parche B en línea 2248.**
- Test de cuadre fiscal — bloque ~5300-5520. Test 4 (balance) ~5309; Test 5 (PyG) ~5335; **Test 7 ~5367**; **Test 8 ~5385**; Test 9 ~5399; Test 10 (303) ~5418; **Test 11 ~5434**; Test 12 ~5452.
- `getInvoiceData({tipo:'emitida'|'recibida'})` — fuente de facturas para los tests.
- Identificación de asiento de factura: `e.type === 'import_factura'`.
- Cuenta resultado en cierre: `12900000`. Plan de cuentas base incluye `{code:'12900000',name:'Resultado del ejercicio',g:1,t:'P'}`.

---

## 5. CÓMO VERIFICAR DESCUADRES POR CONSOLA (técnica útil)

Para localizar cuentas "huérfanas" (con saldo pero sin clasificar en el balance), se replican las listas de prefijos de `renderBalance` y se busca qué cuentas con saldo no caen en ACTIVO/PASIVO/RESULTADO. Así se localizó la 490. Si vuelve a aparecer un descuadre en pantalla, ese es el método: comparar la suma neta por grupos (debe dar 0) y, si los asientos cuadran pero la pantalla no, buscar la cuenta huérfana en la clasificación de `renderBalance`.
