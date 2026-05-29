# Propuesta automática de contrapartida en la importación del extracto bancario

**Fecha:** 2026-05-29
**Empresa de prueba:** ALQUILA Y DESCANSA TAP S.L. (extractos BBVA)
**Archivos:** `public/index.html` (frontend, todo el flujo de importación)

## Problema

Al importar el extracto bancario, todos los movimientos se contabilizan contra
`55500000` (Partidas pendientes de aplicación). Reasignar la contrapartida a mano
en cada movimiento es mucho trabajo. Los programas comerciales (Sage 50, a3innuva,
Contasol) **proponen** la contrapartida automáticamente mediante reglas, maestros de
terceros, conceptos predefinidos del C43 y aprendizaje de patrones de uso; solo lo
desconocido queda pendiente.

## Objetivo

Que la importación **proponga** una contrapartida por cada movimiento (editable; el
usuario revisa y confirma) y que **aprenda** de las correcciones, reduciendo al mínimo
los movimientos que quedan en 555. La conexión directa con bancos (PSD2) prevista a
futuro entrega los mismos datos, así que el motor se reutiliza igual.

## Alcance

- Mantener el asiento bancario simple: **2 líneas, Banco (572) ↔ contrapartida, SIN IVA**.
- Mantener la deduplicación robusta por huella (id determinista con saldo) ya existente.
- Nivel de automatismo: **proponer + el usuario revisa** (nada se contabiliza sin OK).
- Fuera de alcance (por ahora): conciliación contra facturas pendientes concretas,
  cuadre por importe con saldos abiertos, conceptos C43 por código numérico.

## Diseño

### 1. Motor `proponerContrapartida(texto, beneficiario)`

Devuelve `{cuenta, motivo, motivoDet}`. Cascada, primer acierto gana. Solo se usa la
**cuenta** (nunca el IVA de la regla). Si una cuenta candidata no existe en el plan, se
ignora y se baja al siguiente nivel.

1. **Reglas del usuario / aprendidas** (`state.rules` cuyo `id` NO empieza por `r_d`):
   regex `r.p` sobre `beneficiario + " " + texto`. → `r.a`, motivo "Regla".
2. **Maestros**: `beneficiario` normalizado (mayúsculas, sin `S.L./S.A./S.COOP`, sin
   puntuación) contra `masters.supplier`/`masters.client` por nombre (igualdad o
   "contiene", longitud ≥ 4) o CIF. → cuenta del tercero (400x/410x/430x), motivo
   "Proveedor"/"Cliente". Se prioriza sobre las reglas por defecto para **no duplicar
   el gasto** ya registrado por la factura del proveedor.
3. **Reglas por defecto** (`state.rules` con `id` que empieza por `r_d`: NÓMINA→640,
   SEG.SOCIAL→642, HACIENDA→475, COMISIÓN→626, IBERDROLA→628, ALQUILER→621, etc.).
   → `r.a`, motivo "Concepto".
4. **Sin acierto** → `55500000`, motivo "Pendiente".

### 2. Parsing (`processImportRows`)

Además de lo actual, capturar `beneficiario` (columna BENEFICIARIO/ORDENANTE) por
movimiento. Para cada `txn` calcular `prop = proponerContrapartida(concept, beneficiario)`
y guardar `txn.cuenta = prop.cuenta`, `txn.motivo = prop.motivo`, `txn.beneficiario`.

### 3. Previsualización (`showImportResults`)

- Nueva columna **Contrapartida**: `<input>` editable con el código propuesto + nombre
  de la cuenta (se actualiza al teclear vía `datalist` de todas las cuentas).
- Badge de **motivo** (Regla / Proveedor / Cliente / Concepto / Pendiente).
- Se mantiene: checkbox por fila, dedup (duplicados desmarcados), contador, dedup por
  huella.

### 4. Contabilización (`importAll`)

- Por cada fila marcada: leer la cuenta del `<input>` (`impAcct{i}`); si vacía o no
  existe → `55500000`.
- Asiento de 2 líneas: ingreso → `572` Debe / contrapartida Haber; cargo → contrapartida
  Debe / `572` Haber. Sin IVA. Concepto literal del banco. `id` determinista (dedup).
- **Aprendizaje**: si la cuenta final difiere de la que `proponerContrapartida` daría
  ahora (el usuario la cambió o era "Pendiente") y hay `beneficiario` (≥ 4 car.), crear
  una regla aprendida `r_auto_…` con patrón = beneficiario escapado para regex → cuenta.
  No duplicar (saltar si ya existe ese patrón→cuenta). No pisar reglas del usuario.

### 5. Seguridad / casos límite

- Matching de tercero por CIF si existe; si no, por nombre normalizado con igualdad o
  "contiene" (evita falsos positivos por subcadenas muy cortas: mínimo 4 caracteres).
- Regla cuya cuenta no existe en el plan → ignorada.
- El aprendizaje solo añade reglas `r_auto_`, nunca modifica/borra reglas del usuario, y
  no crea patrones duplicados.
- Sigue siendo "el usuario revisa": ninguna contabilización sin confirmación; la dedup
  por huella (saldo) sigue evitando movimientos duplicados al reimportar.

## Verificación

- Movimiento con beneficiario que es proveedor en maestros → propone su 400x/410x.
- Movimiento "RECIBO IBERDROLA…" sin proveedor en maestros → propone 628 (regla por
  defecto), motivo "Concepto".
- Movimiento desconocido → 555, motivo "Pendiente".
- Tras asignar a mano una cuenta a un beneficiario desconocido y contabilizar →
  reimportar un movimiento del mismo beneficiario lo propone automáticamente (regla
  aprendida).
- Cada asiento generado cuadra (Debe = Haber) y no lleva líneas de IVA.
