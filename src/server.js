const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Database setup (SQLite — persistent on Railway volume) ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cimafondos.db');
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Create tables ──
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cif TEXT,
    address TEXT,
    config TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS accounts (
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    group_num INTEGER,
    type TEXT,
    company_id TEXT REFERENCES companies(id),
    PRIMARY KEY (code, company_id)
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    concept TEXT,
    type TEXT DEFAULT 'manual',
    company_id TEXT REFERENCES companies(id),
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    deleted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS entry_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id TEXT REFERENCES entries(id),
    account TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    date TEXT,
    amount REAL,
    description TEXT,
    matched INTEGER DEFAULT 0,
    matched_account TEXT,
    matched_rule TEXT,
    iva TEXT,
    paid_by TEXT,
    company_id TEXT REFERENCES companies(id),
    deleted INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    account TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 1,
    iva TEXT DEFAULT 'na',
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS masters (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    company_id TEXT REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    entry_id TEXT REFERENCES entries(id),
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_companies (
    user_id TEXT REFERENCES users(id),
    company_id TEXT REFERENCES companies(id),
    PRIMARY KEY (user_id, company_id)
  );
`);

// ── Seed default data if empty ──
const companyCount = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
if (companyCount === 0) {
  db.prepare('INSERT INTO companies VALUES (?, ?, ?, ?, ?)').run(
    'c1', 'Cimafondos S.L.', 'B98000001', 'Valencia', '{}'
  );
  
  const users = [
    ['u1', 'admin', 'admin', 'Administrador', 'admin', 'c1'],
    ['u2', 'javier', '1234', 'Javier', 'admin', 'c1'],
    ['u3', 'pepe', '1234', 'Pepe', 'user', 'c1'],
    ['u4', 'santi', '1234', 'Santi', 'user', 'c1'],
  ];
  const insertUser = db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)');
  users.forEach(u => insertUser.run(...u));

  // Default PGC accounts - Plan General Contable Pymes completo (219 cuentas)
  const pgc = [
    // GRUPO 1 - FINANCIACIÓN BÁSICA
    ['10000000','Capital social',1,'P'],['10100000','Fondo social',1,'P'],['10200000','Capital',1,'P'],
    ['10300000','Socios por desembolsos no exigidos',1,'A'],['10400000','Socios por aportaciones no dinerarias ptes.',1,'A'],
    ['11000000','Prima de emisión o asunción',1,'P'],['11200000','Reserva legal',1,'P'],
    ['11300000','Reservas voluntarias',1,'P'],['11400000','Reservas especiales',1,'P'],
    ['11800000','Aportaciones de socios o propietarios',1,'P'],['11900000','Diferencias por ajuste de capital a euros',1,'P'],
    ['12000000','Remanente',1,'P'],['12100000','Resultados negativos de ejercicios anteriores',1,'A'],
    ['12900000','Resultado del ejercicio',1,'P'],
    ['13000000','Subvenciones oficiales de capital',1,'P'],['13100000','Donaciones y legados de capital',1,'P'],
    ['14100000','Provisión para impuestos',1,'P'],['14200000','Provisión otras responsabilidades',1,'P'],
    ['14300000','Provisión por desmantelamiento, retiro o rehabilitación',1,'P'],
    ['17000000','Deudas LP con entidades de crédito',1,'P'],['17100000','Deudas a largo plazo',1,'P'],
    ['17200000','Deudas LP transformables en subvenciones',1,'P'],['17300000','Proveedores de inmovilizado a largo plazo',1,'P'],
    ['17400000','Acreedores por arrendamiento financiero LP',1,'P'],['17500000','Efectos a pagar a largo plazo',1,'P'],
    ['18000000','Fianzas recibidas a largo plazo',1,'P'],['18100000','Anticipos recibidos por ventas LP',1,'P'],
    // GRUPO 2 - ACTIVO NO CORRIENTE
    ['20000000','Gastos de investigación',2,'A'],['20100000','Desarrollo',2,'A'],
    ['20200000','Concesiones administrativas',2,'A'],['20300000','Propiedad industrial',2,'A'],
    ['20500000','Derechos de traspaso',2,'A'],['20600000','Aplicaciones informáticas',2,'A'],
    ['21000000','Terrenos y bienes naturales',2,'A'],['21100000','Construcciones',2,'A'],
    ['21200000','Instalaciones técnicas',2,'A'],['21300000','Maquinaria',2,'A'],
    ['21400000','Utillaje',2,'A'],['21500000','Otras instalaciones',2,'A'],
    ['21600000','Mobiliario',2,'A'],['21700000','Equipos para procesos de información',2,'A'],
    ['21800000','Elementos de transporte',2,'A'],['21900000','Otro inmovilizado material',2,'A'],
    ['22000000','Inversiones en terrenos y bienes naturales',2,'A'],['22100000','Inversiones en construcciones',2,'A'],
    ['23000000','Adaptación de terrenos y bienes naturales',2,'A'],['23100000','Construcciones en curso',2,'A'],
    ['23200000','Instalaciones técnicas en montaje',2,'A'],['23300000','Maquinaria en montaje',2,'A'],
    ['25000000','Inversiones financieras LP instrumentos patrimonio',2,'A'],['25100000','Valores representativos de deuda LP',2,'A'],
    ['25200000','Créditos a largo plazo',2,'A'],['25300000','Créditos LP por enajenación de inmovilizado',2,'A'],
    ['26000000','Fianzas constituidas a largo plazo',2,'A'],['26500000','Depósitos constituidos a largo plazo',2,'A'],
    ['28000000','Amort. acum. inmovilizado intangible',2,'A'],['28100000','Amort. acum. inmovilizado material',2,'A'],
    ['28200000','Amort. acum. inversiones inmobiliarias',2,'A'],
    ['29000000','Deterioro valor inmovilizado intangible',2,'A'],['29100000','Deterioro valor inmovilizado material',2,'A'],
    ['29200000','Deterioro valor inversiones inmobiliarias',2,'A'],['29700000','Deterioro valor créditos LP',2,'A'],
    ['29800000','Deterioro valor participaciones LP',2,'A'],
    // GRUPO 3 - EXISTENCIAS
    ['30000000','Mercaderías A',3,'A'],['30100000','Mercaderías B',3,'A'],
    ['31000000','Materias primas A',3,'A'],['32000000','Otros aprovisionamientos',3,'A'],
    ['32800000','Material de oficina',3,'A'],['33000000','Productos en curso A',3,'A'],
    ['34000000','Productos semiterminados A',3,'A'],['35000000','Productos terminados A',3,'A'],
    ['36000000','Subproductos, residuos y materiales recuperados',3,'A'],
    ['39000000','Deterioro valor mercaderías',3,'A'],['39100000','Deterioro valor materias primas',3,'A'],
    ['39200000','Deterioro valor otros aprovisionamientos',3,'A'],['39300000','Deterioro valor productos en curso',3,'A'],
    ['39400000','Deterioro valor productos semiterminados',3,'A'],['39500000','Deterioro valor productos terminados',3,'A'],
    ['39600000','Deterioro valor subproductos',3,'A'],
    // GRUPO 4 - ACREEDORES Y DEUDORES
    ['40000000','Proveedores',4,'P'],['40100000','Proveedores, efectos comerciales a pagar',4,'P'],
    ['40300000','Proveedores, empresas del grupo',4,'P'],['40600000','Envases y embalajes a devolver a proveedores',4,'A'],
    ['40700000','Anticipos a proveedores',4,'A'],
    ['41000000','Acreedores por prestaciones de servicios',4,'P'],['41100000','Acreedores, efectos comerciales a pagar',4,'P'],
    ['43000000','Clientes',4,'A'],['43100000','Clientes, efectos comerciales a cobrar',4,'A'],
    ['43200000','Clientes, operaciones de factoring',4,'A'],['43500000','Clientes de dudoso cobro',4,'A'],
    ['43600000','Clientes de dudoso cobro, efectos comerciales',4,'A'],
    ['43700000','Envases y embalajes a devolver por clientes',4,'P'],['43800000','Anticipos de clientes',4,'P'],
    ['44000000','Deudores',4,'A'],['44100000','Deudores, efectos comerciales a cobrar',4,'A'],
    ['46000000','Anticipos de remuneraciones',4,'A'],['46500000','Remuneraciones pendientes de pago',4,'P'],
    ['47000000','HP deudora por diversos conceptos',4,'A'],['47100000','Organismos SS acreedores',4,'P'],
    ['47200000','HP IVA soportado',4,'A'],['47200001','HP Recargo equivalencia soportado',4,'A'],
    ['47300000','HP retenciones y pagos a cuenta',4,'A'],['47400000','Activos por impuesto diferido',4,'A'],
    ['47500000','HP acreedora por conceptos fiscales',4,'P'],['47510000','HP acreedora retenciones practicadas',4,'P'],
    ['47520000','HP acreedora impuesto sociedades',4,'P'],
    ['47700000','HP IVA repercutido',4,'P'],['47700001','HP Recargo equivalencia repercutido',4,'P'],
    ['47900000','Pasivos por diferencias temporarias imponibles',4,'P'],
    ['48000000','Gastos anticipados',4,'A'],['48500000','Ingresos anticipados',4,'P'],
    ['49000000','Deterioro valor créditos operaciones comerciales',4,'A'],
    ['49300000','Deterioro valor créditos operaciones comerciales',4,'A'],
    ['49400000','Provisiones por operaciones comerciales',4,'P'],
    // GRUPO 5 - CUENTAS FINANCIERAS
    ['52000000','Deudas CP con entidades de crédito',5,'P'],['52100000','Deudas a corto plazo',5,'P'],
    ['52200000','Deudas CP transformables en subvenciones',5,'P'],['52300000','Proveedores de inmovilizado CP',5,'P'],
    ['52400000','Acreedores arrendamiento financiero CP',5,'P'],['52500000','Efectos a pagar CP',5,'P'],
    ['52600000','Dividendo activo a pagar',5,'P'],
    ['55100000','Cuenta corriente con socios y administradores',5,'P'],['55500000','Partidas pendientes de aplicación',5,'P'],
    ['56000000','Fianzas recibidas CP',5,'P'],['56100000','Depósitos recibidos CP',5,'P'],
    ['56500000','Fianzas constituidas CP',5,'A'],['56600000','Depósitos constituidos CP',5,'A'],
    ['57000000','Caja, euros',5,'A'],['57100000','Caja, moneda extranjera',5,'A'],
    ['57200000','Bancos c/c vista, euros',5,'A'],['57300000','Bancos, cuentas de ahorro',5,'A'],
    ['57400000','Bancos, moneda extranjera',5,'A'],
    // GRUPO 6 - COMPRAS Y GASTOS
    ['60000000','Compras de mercaderías',6,'G'],['60100000','Compras de materias primas',6,'G'],
    ['60200000','Compras de otros aprovisionamientos',6,'G'],['60600000','Descuentos s/ compras por pronto pago',6,'G'],
    ['60700000','Trabajos realizados por otras empresas',6,'G'],['60800000','Devoluciones de compras',6,'G'],
    ['60900000','Rappels por compras',6,'G'],
    ['61000000','Variación existencias mercaderías',6,'G'],['61100000','Variación existencias materias primas',6,'G'],
    ['61200000','Variación existencias otros aprovisionamientos',6,'G'],
    ['62100000','Arrendamientos y cánones',6,'G'],['62200000','Reparaciones y conservación',6,'G'],
    ['62300000','Servicios profesionales independientes',6,'G'],['62400000','Transportes',6,'G'],
    ['62500000','Primas de seguros',6,'G'],['62600000','Servicios bancarios y similares',6,'G'],
    ['62700000','Publicidad, propaganda y RRPP',6,'G'],['62800000','Suministros',6,'G'],
    ['62900000','Otros servicios',6,'G'],
    ['63000000','Impuesto sobre beneficios',6,'G'],['63100000','Otros tributos',6,'G'],
    ['63300000','Ajustes negativos imposición s/ beneficios',6,'G'],['63400000','Ajustes negativos imposición indirecta',6,'G'],
    ['63600000','Devolución de impuestos',6,'G'],
    ['64000000','Sueldos y salarios',6,'G'],['64100000','Indemnizaciones',6,'G'],
    ['64200000','Seguridad Social a cargo de la empresa',6,'G'],['64900000','Otros gastos sociales',6,'G'],
    ['65000000','Pérdidas créditos comerciales incobrables',6,'G'],['65900000','Otras pérdidas en gestión corriente',6,'G'],
    ['66200000','Intereses de deudas',6,'G'],['66500000','Intereses descuento efectos y factoring',6,'G'],
    ['66600000','Pérdidas en participaciones y val. repr. deuda',6,'G'],['66700000','Pérdidas de créditos no comerciales',6,'G'],
    ['66800000','Diferencias negativas de cambio',6,'G'],['66900000','Otros gastos financieros',6,'G'],
    ['67000000','Pérdidas procedentes inmovilizado intangible',6,'G'],['67100000','Pérdidas procedentes inmovilizado material',6,'G'],
    ['67200000','Pérdidas procedentes inversiones inmobiliarias',6,'G'],
    ['68000000','Amortización inmovilizado intangible',6,'G'],['68100000','Amortización inmovilizado material',6,'G'],
    ['68200000','Amortización inversiones inmobiliarias',6,'G'],
    ['69000000','Pérdidas deterioro inmovilizado intangible',6,'G'],['69100000','Pérdidas deterioro inmovilizado material',6,'G'],
    ['69200000','Pérdidas deterioro inversiones inmobiliarias',6,'G'],['69300000','Pérdidas deterioro existencias',6,'G'],
    ['69400000','Pérdidas deterioro créditos comerciales',6,'G'],['69500000','Dotación provisión operaciones comerciales',6,'G'],
    ['69600000','Pérdidas deterioro participaciones val. repr. deuda LP',6,'G'],
    ['69800000','Pérdidas deterioro participaciones val. repr. deuda CP',6,'G'],
    // GRUPO 7 - VENTAS E INGRESOS
    ['70000000','Ventas de mercaderías',7,'I'],['70100000','Ventas de productos terminados',7,'I'],
    ['70200000','Ventas de productos semiterminados',7,'I'],['70300000','Ventas de subproductos y residuos',7,'I'],
    ['70400000','Ventas de envases y embalajes',7,'I'],['70500000','Prestaciones de servicios',7,'I'],
    ['70600000','Descuentos s/ ventas por pronto pago',7,'I'],['70800000','Devoluciones de ventas',7,'I'],
    ['70900000','Rappels sobre ventas',7,'I'],
    ['71000000','Variación existencias productos en curso',7,'I'],['71100000','Variación existencias productos semiterminados',7,'I'],
    ['71200000','Variación existencias productos terminados',7,'I'],
    ['73000000','Trabajos realizados para inmovilizado intangible',7,'I'],['73100000','Trabajos realizados para inmovilizado material',7,'I'],
    ['74000000','Subvenciones, donaciones y legados a la explotación',7,'I'],
    ['74600000','Subvenciones, donaciones y legados de capital transferidos',7,'I'],
    ['75200000','Ingresos por arrendamientos',7,'I'],['75300000','Ingresos propiedad industrial cedida',7,'I'],
    ['75400000','Ingresos por comisiones',7,'I'],['75500000','Ingresos por servicios al personal',7,'I'],
    ['75900000','Ingresos por servicios diversos',7,'I'],
    ['76000000','Ingresos participaciones instrumentos patrimonio',7,'I'],['76100000','Ingresos valores representativos deuda',7,'I'],
    ['76200000','Ingresos de créditos',7,'I'],['76800000','Diferencias positivas de cambio',7,'I'],
    ['76900000','Otros ingresos financieros',7,'I'],
    ['77000000','Beneficios procedentes inmovilizado intangible',7,'I'],['77100000','Beneficios procedentes inmovilizado material',7,'I'],
    ['77200000','Beneficios procedentes inversiones inmobiliarias',7,'I'],
    ['79000000','Reversión deterioro inmovilizado intangible',7,'I'],['79100000','Reversión deterioro inmovilizado material',7,'I'],
    ['79200000','Reversión deterioro inversiones inmobiliarias',7,'I'],['79300000','Reversión deterioro existencias',7,'I'],
    ['79400000','Reversión deterioro créditos comerciales',7,'I'],['79500000','Exceso de provisiones',7,'I'],
    ['79600000','Reversión deterioro participaciones val. repr. deuda LP',7,'I'],
    ['79800000','Reversión deterioro participaciones val. repr. deuda CP',7,'I'],
  ];
  const insertAcct = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)');
  pgc.forEach(a => insertAcct.run(a[0], a[1], a[2], a[3], 'c1'));

  // Seed user_companies (all users can access c1)
  const insertUC = db.prepare('INSERT OR IGNORE INTO user_companies VALUES (?, ?)');
  users.forEach(u => insertUC.run(u[0], 'c1'));

  // Default rules
  const rules = [
    ['r1','ALQUILER|ARRENDAMIENTO|RENTA','62100000','Alquiler',1,'general'],
    ['r2','SEGURO|MAPFRE|ALLIANZ','62500000','Seguros',1,'exento'],
    ['r3','NOMINA|SALARIO|SUELDO','64000000','Nóminas',1,'na'],
    ['r4','SEGURIDAD SOCIAL|TGSS','64200000','Seg. Social',1,'na'],
    ['r5','COMISION|COMISIÓN','62600000','Comisiones banco',2,'exento'],
    ['r6','INTERES|INTERÉS','66200000','Intereses',2,'exento'],
    ['r7','ENDESA|IBERDROLA|NATURGY|LUZ','62800000','Suministros',1,'general'],
    ['r8','VODAFONE|MOVISTAR|ORANGE|TELEFON','62900000','Comunicaciones',1,'general'],
    ['r9','HACIENDA|AEAT|MODELO','47500000','Hacienda',1,'na'],
    ['r10','NOTARI|REGISTRO|ESCRITURA','62300000','Notaría/Registro',1,'general'],
    ['r11','ABOGADO|PROCURADOR|LETRADO','62300000','Abogado',1,'general'],
    ['r12','RESTAURANTE|COMIDA|CENA|ALMUERZO|BAR|CAFETERIA','62700000','Gtos. representación',1,'nodeducible'],
    ['r13','HOTEL|ALOJAMIENTO|HOSTAL|BOOKING','62900000','Viajes/Alojamiento',1,'nodeducible'],
    ['r14','TAXI|UBER|CABIFY|PARKING|GASOLINA|REPSOL|CEPSA','62400000','Transportes',1,'general'],
  ];
  const insertRule = db.prepare('INSERT INTO rules VALUES (?, ?, ?, ?, ?, ?, ?)');
  rules.forEach(r => insertRule.run(r[0], r[1], r[2], r[3], r[4], r[5], 'c1'));

  // Default masters (clients, suppliers, banks)
  const masters = [
    ['cl1', 'client', JSON.stringify({name:'Gusiluz Inversiones S.L.',cif:'B12345678',phone:'963000000',email:'info@gusiluz.es',contact:'Luis Martínez'}), 'c1'],
    ['su1', 'supplier', JSON.stringify({name:'Notaría Pérez Sanchis',cif:'12345678A',phone:'963111111',email:'notaria@perez.es',acct:'62300000'}), 'c1'],
    ['bk1', 'bank', JSON.stringify({name:'Santander',iban:'ES12 0049 XXXX XXXX',notes:'Cuenta principal',acct:'57200000'}), 'c1'],
    ['bk2', 'bank', JSON.stringify({name:'CaixaBank',iban:'ES34 2100 XXXX XXXX',notes:'Secundaria',acct:'57200001'}), 'c1'],
  ];
  const insertMaster = db.prepare('INSERT INTO masters VALUES (?, ?, ?, ?)');
  masters.forEach(m => insertMaster.run(...m));

  console.log('✓ Database seeded with default data');
}

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── AUTH ──
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, name, role, company_id FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(user.company_id);
  res.json({ user, company });
});

// ── Helper: auto-create company if needed, with full PGC ──
function ensureCompany(companyId) {
  const existing = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!existing) {
    db.prepare('INSERT INTO companies VALUES (?, ?, ?, ?, ?)').run(companyId, companyId, '', '', '{}');
    // Copy PGC accounts from c1 (the seed company has full PGC)
    const defaultAccounts = db.prepare('SELECT code, name, group_num, type FROM accounts WHERE company_id = ?').all('c1');
    const insertAcct = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)');
    defaultAccounts.forEach(a => insertAcct.run(a.code, a.name, a.group_num, a.type, companyId));
  }
}

// ── Helper: load PGC into existing company that has few accounts ──
function loadPGCForCompany(companyId) {
  const defaultAccounts = db.prepare('SELECT code, name, group_num, type FROM accounts WHERE company_id = ?').all('c1');
  const insertAcct = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  defaultAccounts.forEach(a => {
    const exists = db.prepare('SELECT code FROM accounts WHERE code = ? AND company_id = ?').get(a.code, companyId);
    if (!exists) { insertAcct.run(a.code, a.name, a.group_num, a.type, companyId); added++; }
  });
  return added;
}

// ── ACCOUNTS ──
app.get('/api/accounts/:companyId', (req, res) => {
  const rows = db.prepare('SELECT code, name, group_num as g, type as t FROM accounts WHERE company_id = ? ORDER BY code').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/accounts/:companyId', (req, res) => {
  const { code, name, g, t } = req.body;
  ensureCompany(req.params.companyId);
  try {
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)').run(code, name, g, t, req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── ENTRIES ──
app.get('/api/entries/:companyId', (req, res) => {
  const showDeleted = req.query.deleted === '1';
  const entries = db.prepare('SELECT * FROM entries WHERE company_id = ?' + (showDeleted ? '' : ' AND deleted = 0') + ' ORDER BY date').all(req.params.companyId);
  const lines = db.prepare('SELECT * FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?' + (showDeleted ? '' : ' AND deleted = 0') + ')').all(req.params.companyId);
  const lineMap = {};
  lines.forEach(l => { if (!lineMap[l.entry_id]) lineMap[l.entry_id] = []; lineMap[l.entry_id].push({ a: l.account, d: l.debit, h: l.credit }); });
  const result = entries.map(e => ({ ...e, del: !!e.deleted, lines: lineMap[e.id] || [] }));
  res.json(result);
});

app.post('/api/entries/:companyId', (req, res) => {
  const { id, date, concept, type, lines } = req.body;
  const companyId = req.params.companyId;
  ensureCompany(companyId);

  // Validate entry balance (Debe = Haber)
  if (lines && lines.length > 0) {
    const totalD = lines.reduce((s, l) => s + (l.d || 0), 0);
    const totalH = lines.reduce((s, l) => s + (l.h || 0), 0);
    if (Math.abs(totalD - totalH) > 0.01) {
      console.warn(`⚠ Asiento descuadrado rechazado: ${id} D=${totalD} H=${totalH} diff=${Math.abs(totalD-totalH)}`);
      return res.status(400).json({ error: 'Asiento descuadrado', debe: totalD, haber: totalH, diff: Math.abs(totalD - totalH) });
    }
  }

  // Validate company isolation - account codes should not contain other company references
  const insertEntry = db.prepare('INSERT OR REPLACE INTO entries (id, date, concept, type, company_id, deleted) VALUES (?, ?, ?, ?, ?, 0)');
  const deleteLine = db.prepare('DELETE FROM entry_lines WHERE entry_id = ?');
  const insertLine = db.prepare('INSERT INTO entry_lines (entry_id, account, debit, credit) VALUES (?, ?, ?, ?)');
  
  const tx = db.transaction(() => {
    insertEntry.run(id, date, concept, type || 'manual', companyId);
    deleteLine.run(id);
    (lines || []).forEach(l => insertLine.run(id, l.a, l.d || 0, l.h || 0));
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/entries/:companyId/:id', (req, res) => {
  db.prepare('UPDATE entries SET deleted = 1 WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// Delete ALL entries for a company (or all companies)
app.delete('/api/entries-all/:companyId', (req, res) => {
  const cid = req.params.companyId;
  if (cid === '_all_') {
    const count = db.prepare('SELECT COUNT(*) as c FROM entries').get().c;
    db.prepare('DELETE FROM entry_lines').run();
    db.prepare('DELETE FROM entries').run();
    db.prepare('DELETE FROM transactions').run();
    res.json({ ok: true, deleted: count });
  } else {
    const count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ?').get(cid).c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?)').run(cid);
    db.prepare('DELETE FROM entries WHERE company_id = ?').run(cid);
    db.prepare('DELETE FROM transactions WHERE company_id = ?').run(cid);
    res.json({ ok: true, deleted: count });
  }
});

// Delete all accounts for a company (to reimport clean)
app.delete('/api/accounts-all/:companyId', (req, res) => {
  const cid = req.params.companyId;
  const count = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE company_id = ?').get(cid).c;
  db.prepare('DELETE FROM accounts WHERE company_id = ?').run(cid);
  res.json({ ok: true, deleted: count });
});

// Soft-delete: mark entries as deleted (recoverable)
app.post('/api/soft-delete-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 0').get().c;
    db.prepare('UPDATE entries SET deleted = 1 WHERE deleted = 0').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 0').get(cid).c;
    db.prepare('UPDATE entries SET deleted = 1 WHERE company_id = ? AND deleted = 0').run(cid);
  }
  res.json({ ok: true, count });
});

// Recover soft-deleted entries
app.post('/api/recover-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 1').get().c;
    db.prepare('UPDATE entries SET deleted = 0 WHERE deleted = 1').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 1').get(cid).c;
    db.prepare('UPDATE entries SET deleted = 0 WHERE company_id = ? AND deleted = 1').run(cid);
  }
  res.json({ ok: true, count });
});

// Purge soft-deleted entries permanently
app.post('/api/purge-entries/:companyId', (req, res) => {
  const cid = req.params.companyId;
  let count;
  if (cid === '_all_') {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE deleted = 1').get().c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE deleted = 1)').run();
    db.prepare('DELETE FROM entries WHERE deleted = 1').run();
  } else {
    count = db.prepare('SELECT COUNT(*) as c FROM entries WHERE company_id = ? AND deleted = 1').get(cid).c;
    db.prepare('DELETE FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ? AND deleted = 1)').run(cid);
    db.prepare('DELETE FROM entries WHERE company_id = ? AND deleted = 1').run(cid);
  }
  res.json({ ok: true, count });
});

// ── TRANSACTIONS (bank imports) ──
app.get('/api/transactions/:companyId', (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE company_id = ? ORDER BY date').all(req.params.companyId);
  res.json(rows.map(r => ({ ...r, del: !!r.deleted, matched: !!r.matched })));
});

app.post('/api/transactions/:companyId', (req, res) => {
  const insert = db.prepare('INSERT OR REPLACE INTO transactions (id, date, amount, description, matched, matched_account, matched_rule, iva, paid_by, company_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)');
  const tx = db.transaction(() => {
    (req.body.transactions || []).forEach(t => {
      insert.run(t.id, t.date, t.amount, t.desc || t.description, t.matched ? 1 : 0, t.mAcct || t.matched_account, t.mRule || t.matched_rule, t.iv || t.iva, t.paidBy || t.paid_by, req.params.companyId);
    });
  });
  tx();
  res.json({ ok: true, count: (req.body.transactions || []).length });
});

// ── RULES ──
app.get('/api/rules/:companyId', (req, res) => {
  const rows = db.prepare('SELECT id, pattern as p, account as a, description as d, priority as pr, iva as iv FROM rules WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/rules/:companyId', (req, res) => {
  const { id, p, a, d, pr, iv } = req.body;
  db.prepare('INSERT OR REPLACE INTO rules VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, p, a, d, pr || 1, iv || 'na', req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/rules/:companyId/:id', (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── MASTERS (clients, suppliers, banks) ──
app.get('/api/masters/:companyId/:type', (req, res) => {
  const rows = db.prepare('SELECT id, data FROM masters WHERE company_id = ? AND type = ?').all(req.params.companyId, req.params.type);
  res.json(rows.map(r => ({ id: r.id, ...JSON.parse(r.data) })));
});

app.post('/api/masters/:companyId/:type', (req, res) => {
  const { id, ...data } = req.body;
  db.prepare('INSERT OR REPLACE INTO masters VALUES (?, ?, ?, ?)').run(id, req.params.type, JSON.stringify(data), req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/masters/:companyId/:type/:id', (req, res) => {
  db.prepare('DELETE FROM masters WHERE id = ? AND type = ? AND company_id = ?').run(req.params.id, req.params.type, req.params.companyId);
  res.json({ ok: true });
});

// ── BACKUP ──
app.get('/api/backup/:companyId', (req, res) => {
  const cid = req.params.companyId;
  const data = {
    version: '6.1',
    date: new Date().toISOString().slice(0, 10),
    company: db.prepare('SELECT * FROM companies WHERE id = ?').get(cid),
    accounts: db.prepare('SELECT code, name, group_num as g, type as t FROM accounts WHERE company_id = ?').all(cid),
    entries: (() => {
      const entries = db.prepare('SELECT * FROM entries WHERE company_id = ?').all(cid);
      const lines = db.prepare('SELECT * FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?)').all(cid);
      const lineMap = {};
      lines.forEach(l => { if (!lineMap[l.entry_id]) lineMap[l.entry_id] = []; lineMap[l.entry_id].push({ a: l.account, d: l.debit, h: l.credit }); });
      return entries.map(e => ({ ...e, del: !!e.deleted, lines: lineMap[e.id] || [] }));
    })(),
    transactions: db.prepare('SELECT * FROM transactions WHERE company_id = ?').all(cid),
    rules: db.prepare('SELECT id, pattern as p, account as a, description as d, priority as pr, iva as iv FROM rules WHERE company_id = ?').all(cid),
    masters: db.prepare('SELECT * FROM masters WHERE company_id = ?').all(cid),
  };
  res.json(data);
});
// — OCR via Claude API —
app.post('/api/ocr', async (req, res) => {
    try {
          const { imageBase64, mediaType } = req.body;
          if (!imageBase64 || !mediaType) {
                  return res.status(400).json({ error: 'Faltan imageBase64 o mediaType' });
          }
          const response = await fetch('https://api.anthropic.com/v1/messages', {
                  method: 'POST',
                  headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': process.env.ANTHROPIC_API_KEY,
                            'anthropic-version': '2023-06-01'
                  },
                  body: JSON.stringify({
                            model: 'claude-opus-4-5',
                            max_tokens: 1024,
                            messages: [{
                                        role: 'user',
                                        content: [
                                          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                                          { type: 'text', text: 'Extrae todos los datos de este ticket/factura. Devuelve SOLO un JSON con: establecimiento, fecha, total, productos (array con nombre y precio). Sin explicaciones.' }
                                                    ]
                            }]
                  })
          });
          if (!response.ok) {
                  const err = await response.json();
                  return res.status(response.status).json({ error: err });
          }
          const data = await response.json();
          res.json({ result: data.content[0].text });
    } catch (err) {
          console.error('Error en /api/ocr:', err);
          res.status(500).json({ error: err.message });
    }
});

// ── USERS MANAGEMENT ──
app.get('/api/users/:companyId', (req, res) => {
  const rows = db.prepare('SELECT id, username, name, role, company_id FROM users WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/users/:companyId', (req, res) => {
  const { id, username, password, name, role } = req.body;
  try {
    db.prepare('INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, username, password, name, role || 'user', req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:companyId/:id', (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── COMPANIES MANAGEMENT (filtered by user access) ──
app.get('/api/companies', (req, res) => {
  const userId = req.query.userId;
  const userRole = req.query.role;
  if (userRole === 'admin') {
    // Admin sees all companies
    const rows = db.prepare('SELECT * FROM companies').all();
    res.json(rows);
  } else if (userId) {
    // Regular user only sees assigned companies
    const rows = db.prepare('SELECT c.* FROM companies c INNER JOIN user_companies uc ON c.id = uc.company_id WHERE uc.user_id = ?').all(userId);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT * FROM companies').all();
    res.json(rows);
  }
});

app.post('/api/companies', (req, res) => {
  const { id, name, cif, address, config } = req.body;
  try {
    db.prepare('INSERT OR REPLACE INTO companies VALUES (?, ?, ?, ?, ?)').run(id, name, cif || '', address || '', config || '{}');
    // Load full PGC for new company
    loadPGCForCompany(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── USER-COMPANY ACCESS ──
app.get('/api/user-companies/:userId', (req, res) => {
  const rows = db.prepare('SELECT company_id FROM user_companies WHERE user_id = ?').all(req.params.userId);
  res.json(rows.map(r => r.company_id));
});

app.post('/api/user-companies', (req, res) => {
  const { userId, companyId } = req.body;
  try {
    db.prepare('INSERT OR IGNORE INTO user_companies VALUES (?, ?)').run(userId, companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/user-companies/:userId/:companyId', (req, res) => {
  db.prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?').run(req.params.userId, req.params.companyId);
  res.json({ ok: true });
});

// ── LOAD PGC for existing company ──
app.post('/api/load-pgc/:companyId', (req, res) => {
  const added = loadPGCForCompany(req.params.companyId);
  res.json({ ok: true, added });
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ──
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Cimafondos v7.0.0 running on port ${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
});
