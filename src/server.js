const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cf_sec_' + require('crypto').randomBytes(32).toString('hex');
const TOKEN_EXPIRY = '24h';
const BCRYPT_ROUNDS = 10;

// ── Database setup (SQLite — persistent on Railway volume) ──
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'cimafondos.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

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

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Migration: add group_id columns if not exist ──
try { db.exec('ALTER TABLE companies ADD COLUMN group_id TEXT REFERENCES groups(id)'); } catch(e) {}
try { db.exec('ALTER TABLE users ADD COLUMN group_id TEXT REFERENCES groups(id)'); } catch(e) {}

// ═══ FULL RESET: Clean slate — only PGC survives ═══
const RESET_FLAG = db.prepare("SELECT COUNT(*) as c FROM companies WHERE name = '__RESET_V7_DONE__'").get().c;
if (!RESET_FLAG) {
  console.log('🔄 FULL RESET: Cleaning all data...');
  // Backup first
  try { autoBackup('pre-reset'); } catch(e) {}
  // Delete everything
    db.exec('PRAGMA foreign_keys = OFF');
  db.exec('DELETE FROM entry_lines');
  db.exec('DELETE FROM entries');
  db.exec('DELETE FROM transactions');
  db.exec('DELETE FROM rules');
  db.exec('DELETE FROM masters');
  db.exec('DELETE FROM user_companies');
  db.exec('DELETE FROM users');
  db.exec('DELETE FROM companies');
  db.exec('DELETE FROM groups');
  db.exec('DELETE FROM accounts');
  try { db.exec('DELETE FROM audit_log'); } catch(e) {}
    db.exec('PRAGMA foreign_keys = ON');
      // Mark reset as done
  db.prepare("INSERT INTO companies VALUES ('__reset__', '__RESET_V7_DONE__', '', '', '{}', NULL)").run();
  db.prepare("DELETE FROM companies WHERE id = '__reset__'").run();
  console.log('✓ FULL RESET complete');
}

// ── Seed default data if empty ──
const companyCount = db.prepare('SELECT COUNT(*) as c FROM companies').get().c;
if (companyCount === 0) {
  // Create default group
  db.prepare("INSERT INTO groups VALUES ('g_default', 'Principal', datetime('now'))").run();
  
  // Only admin and javier — no other users
  const users = [
    ['u1', 'admin', 'admin', 'Administrador', 'superadmin', null],
    ['u2', 'javier', '1234', 'Javier', 'superadmin', null],
  ];
  const insertUser = db.prepare('INSERT INTO users (id, username, password, name, role, company_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
  users.forEach(u => insertUser.run(u[0], u[1], u[2], u[3], u[4], u[5], 'g_default'));

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
  // Store PGC as template (company_id = '_pgc_template_') for loading into new companies
  db.prepare("INSERT OR IGNORE INTO companies VALUES ('_pgc_template_', 'PGC Template', '', '', '{}', NULL)").run();
  const insertAcct = db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)');
  pgc.forEach(a => insertAcct.run(a[0], a[1], a[2], a[3], '_pgc_template_'));

  console.log('✓ Database reset: 2 users (admin, javier), PGC template, no companies');
}

// ── Middleware ──
// Force HTTPS in production
app.use((req, res, next) => {
  if (process.env.RAILWAY_ENVIRONMENT && req.headers['x-forwarded-proto'] !== 'https') {
    return res.redirect('https://' + req.headers.host + req.url);
  }
  next();
});
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Rate limiting (login) ──
const loginAttempts = {};
function rateLimitLogin(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = [];
  loginAttempts[ip] = loginAttempts[ip].filter(t => now - t < 60000);
  if (loginAttempts[ip].length >= 5) return res.status(429).json({ error: 'Demasiados intentos. Espera 1 minuto.' });
  loginAttempts[ip].push(now);
  next();
}

// ── JWT Auth middleware ──
function authRequired(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Token requerido' });
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'Token inválido o expirado' }); }
}
function adminRequired(req, res, next) {
  if (!req.user || (req.user.role !== 'superadmin' && req.user.role !== 'admin')) return res.status(403).json({ error: 'Solo administradores' });
  next();
}
function superadminRequired(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') return res.status(403).json({ error: 'Solo superadministradores' });
  next();
}
// Group admin can manage their own group
function groupAdminRequired(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'No autorizado' });
  if (req.user.role === 'superadmin') return next(); // superadmin can do everything
  if (req.user.role === 'group_admin' || req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Solo administradores de grupo' });
}

// ── Server-side audit log ──
db.exec('CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT DEFAULT (datetime(\'now\')), username TEXT, action TEXT, detail TEXT, ip TEXT)');
function auditLog(req, action, detail) {
  try { db.prepare('INSERT INTO audit_log (username, action, detail, ip) VALUES (?, ?, ?, ?)').run(req.user ? req.user.username : 'anon', action, (detail||'').slice(0,500), req.ip||''); } catch(e) {}
}

// ── Auto-backup ──
function autoBackup(label) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bp = path.join(BACKUP_DIR, 'backup_' + label + '_' + ts + '.db');
    db.backup(bp).then(() => {
      console.log('✓ Auto-backup:', bp);
      const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
      while (files.length > 20) { fs.unlinkSync(path.join(BACKUP_DIR, files.shift())); }
    }).catch(e => console.error('Backup failed:', e.message));
  } catch(e) { console.error('Auto-backup error:', e.message); }
}

// ── Ensure passwords are correct (force reset if needed) ──
function migratePasswords() {
  // Always force known passwords for admin and javier
  const knownUsers = [
    { username: 'admin', password: 'admin' },
    { username: 'javier', password: '1234' },
    { username: 'Santi', password: '1234' },
  ];
  knownUsers.forEach(ku => {
    const user = db.prepare('SELECT id, password FROM users WHERE username = ?').get(ku.username);
    if (user) {
      const hashed = bcrypt.hashSync(ku.password, BCRYPT_ROUNDS);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
    }
  });
  // Hash any remaining plain-text passwords
  const users = db.prepare('SELECT id, password FROM users').all();
  const update = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  users.forEach(u => {
    if (!u.password.startsWith('$2')) {
      update.run(bcrypt.hashSync(u.password, BCRYPT_ROUNDS), u.id);
    }
  });
}

function scheduleDailyBackup() {
  autoBackup('startup');
  setInterval(() => autoBackup('daily'), 24 * 60 * 60 * 1000);
}

// ── AUTH ──
app.post('/api/login', rateLimitLogin, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT id, username, password, name, role, company_id, group_id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const valid = user.password.startsWith('$2') ? bcrypt.compareSync(password, user.password) : password === user.password;
  if (!valid) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const token = jwt.sign({ id: user.id, username: user.username, name: user.name, role: user.role, company_id: user.company_id, group_id: user.group_id }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  // Get company: first try user's assigned company, then first company in their group, then any accessible
  let company = null;
  if (user.company_id) company = db.prepare("SELECT * FROM companies WHERE id = ? AND id != '_pgc_template_'").get(user.company_id);
  if (!company && user.group_id) company = db.prepare("SELECT * FROM companies WHERE group_id = ? AND id != '_pgc_template_' LIMIT 1").get(user.group_id);
  if (!company) company = { id: '_none_', name: 'Sin empresa', cif: '', address: '', config: '{}' };
  if (loginAttempts[req.ip]) delete loginAttempts[req.ip];
  auditLog(req, 'login', username);
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role }, company, token });
});

// ── Helper: auto-create company if needed, with full PGC ──
function ensureCompany(companyId) {
  if (companyId === '_none_' || companyId === '_pgc_template_') return;
  const existing = db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
  if (!existing) {
    db.prepare("INSERT INTO companies VALUES (?, ?, '', '', '{}', NULL)").run(companyId, companyId);
    loadPGCForCompany(companyId);
  }
}

// ── Helper: load PGC into existing company that has few accounts ──
function loadPGCForCompany(companyId) {
  // Copy PGC from template
  const defaultAccounts = db.prepare('SELECT code, name, group_num, type FROM accounts WHERE company_id = ?').all('_pgc_template_');
  if (!defaultAccounts.length) {
    // Fallback: try from any company that has accounts
    const anyCompany = db.prepare('SELECT DISTINCT company_id FROM accounts WHERE company_id != ? LIMIT 1').get('_pgc_template_');
    if (anyCompany) {
      const fallback = db.prepare('SELECT code, name, group_num, type FROM accounts WHERE company_id = ?').all(anyCompany.company_id);
      const insertAcct = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)');
      let added = 0;
      fallback.forEach(a => { insertAcct.run(a.code, a.name, a.group_num, a.type, companyId); added++; });
      return added;
    }
    return 0;
  }
  const insertAcct = db.prepare('INSERT OR IGNORE INTO accounts VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  defaultAccounts.forEach(a => {
    const exists = db.prepare('SELECT code FROM accounts WHERE code = ? AND company_id = ?').get(a.code, companyId);
    if (!exists) { insertAcct.run(a.code, a.name, a.group_num, a.type, companyId); added++; }
  });
  return added;
}

// ── ACCOUNTS ──
app.get('/api/accounts/:companyId', authRequired, (req, res) => {
  const rows = db.prepare('SELECT code, name, group_num as g, type as t FROM accounts WHERE company_id = ? ORDER BY code').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/accounts/:companyId', authRequired, (req, res) => {
  const { code, name, g, t } = req.body;
  // Validate account code: max 8 digits, only numbers
  if (!code || !/^\d{1,8}$/.test(code)) {
    return res.status(400).json({ error: 'Código de cuenta inválido: solo números, máximo 8 dígitos. Recibido: ' + code });
  }
  ensureCompany(req.params.companyId);
  try {
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?, ?)').run(code, name, g, t, req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── ENTRIES ──
app.get('/api/entries/:companyId', authRequired, (req, res) => {
  const showDeleted = req.query.deleted === '1';
  const entries = db.prepare('SELECT * FROM entries WHERE company_id = ?' + (showDeleted ? '' : ' AND deleted = 0') + ' ORDER BY date').all(req.params.companyId);
  const lines = db.prepare('SELECT * FROM entry_lines WHERE entry_id IN (SELECT id FROM entries WHERE company_id = ?' + (showDeleted ? '' : ' AND deleted = 0') + ')').all(req.params.companyId);
  const lineMap = {};
  lines.forEach(l => { if (!lineMap[l.entry_id]) lineMap[l.entry_id] = []; lineMap[l.entry_id].push({ a: l.account, d: l.debit, h: l.credit }); });
  const result = entries.map(e => ({ ...e, del: !!e.deleted, lines: lineMap[e.id] || [] }));
  res.json(result);
});

app.post('/api/entries/:companyId', authRequired, (req, res) => {
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

app.delete('/api/entries/:companyId/:id', authRequired, (req, res) => {
  db.prepare('UPDATE entries SET deleted = 1 WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// Delete ALL entries for a company (or all companies)
app.delete('/api/entries-all/:companyId', authRequired, adminRequired, (req, res) => {
  autoBackup('pre-delete-all');
  auditLog(req, 'delete-all-entries', req.params.companyId);
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
app.delete('/api/accounts-all/:companyId', authRequired, adminRequired, (req, res) => {
  const cid = req.params.companyId;
  const count = db.prepare('SELECT COUNT(*) as c FROM accounts WHERE company_id = ?').get(cid).c;
  db.prepare('DELETE FROM accounts WHERE company_id = ?').run(cid);
  res.json({ ok: true, deleted: count });
});

// Soft-delete: mark entries as deleted (recoverable)
app.post('/api/soft-delete-entries/:companyId', authRequired, adminRequired, (req, res) => {
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
app.post('/api/recover-entries/:companyId', authRequired, adminRequired, (req, res) => {
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
app.post('/api/purge-entries/:companyId', authRequired, adminRequired, (req, res) => {
  autoBackup('pre-purge');
  auditLog(req, 'purge-entries', req.params.companyId);
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
app.get('/api/transactions/:companyId', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM transactions WHERE company_id = ? ORDER BY date').all(req.params.companyId);
  res.json(rows.map(r => ({ ...r, del: !!r.deleted, matched: !!r.matched })));
});

app.post('/api/transactions/:companyId', authRequired, (req, res) => {
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
app.get('/api/rules/:companyId', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, pattern as p, account as a, description as d, priority as pr, iva as iv FROM rules WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/rules/:companyId', authRequired, (req, res) => {
  const { id, p, a, d, pr, iv } = req.body;
  db.prepare('INSERT OR REPLACE INTO rules VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, p, a, d, pr || 1, iv || 'na', req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/rules/:companyId/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM rules WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── MASTERS (clients, suppliers, banks) ──
app.get('/api/masters/:companyId/:type', authRequired, (req, res) => {
  const rows = db.prepare('SELECT id, data FROM masters WHERE company_id = ? AND type = ?').all(req.params.companyId, req.params.type);
  res.json(rows.map(r => ({ id: r.id, ...JSON.parse(r.data) })));
});

app.post('/api/masters/:companyId/:type', authRequired, (req, res) => {
  const { id, ...data } = req.body;
  db.prepare('INSERT OR REPLACE INTO masters VALUES (?, ?, ?, ?)').run(id, req.params.type, JSON.stringify(data), req.params.companyId);
  res.json({ ok: true });
});

app.delete('/api/masters/:companyId/:type/:id', authRequired, (req, res) => {
  db.prepare('DELETE FROM masters WHERE id = ? AND type = ? AND company_id = ?').run(req.params.id, req.params.type, req.params.companyId);
  res.json({ ok: true });
});

// ── BACKUP ──
app.get('/api/backup/:companyId', authRequired, (req, res) => {
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

// ── CHANGE PASSWORD ──
app.post('/api/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos' });
  if (newPassword.length < 4) return res.status(400).json({ error: 'Mínimo 4 caracteres' });
  
  const user = db.prepare('SELECT id, password FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  
  // Verify old password
  const valid = user.password.startsWith('$2') 
    ? bcrypt.compareSync(oldPassword, user.password)
    : oldPassword === user.password;
  if (!valid) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  
  // Hash and save new password
  const hashed = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
  auditLog(req, 'change-password', `User ${req.user.username} changed password`);
  res.json({ ok: true });
});

// ── USERS MANAGEMENT ──
app.get('/api/users/:companyId', authRequired, adminRequired, (req, res) => {
  const rows = db.prepare('SELECT id, username, name, role, company_id FROM users WHERE company_id = ?').all(req.params.companyId);
  res.json(rows);
});

app.post('/api/users/:companyId', authRequired, adminRequired, (req, res) => {
  const { id, username, password, name, role } = req.body;
  try {
    db.prepare('INSERT OR REPLACE INTO users VALUES (?, ?, ?, ?, ?, ?)').run(id, username, password, name, role || 'user', req.params.companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:companyId/:id', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND company_id = ?').run(req.params.id, req.params.companyId);
  res.json({ ok: true });
});

// ── COMPANIES MANAGEMENT (filtered by user group) ──
app.get('/api/companies', authRequired, (req, res) => {
  const hidePGC = " AND c.id != '_pgc_template_'";
  if (req.user.role === 'superadmin') {
    const rows = db.prepare('SELECT c.*, g.name as group_name FROM companies c LEFT JOIN groups g ON c.group_id = g.id WHERE 1=1' + hidePGC).all();
    res.json(rows);
  } else if (req.user.group_id) {
    const rows = db.prepare('SELECT c.*, g.name as group_name FROM companies c LEFT JOIN groups g ON c.group_id = g.id WHERE c.group_id = ?' + hidePGC).all(req.user.group_id);
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT c.* FROM companies c INNER JOIN user_companies uc ON c.id = uc.company_id WHERE uc.user_id = ?' + hidePGC).all(req.user.id);
    res.json(rows);
  }
});

app.post('/api/companies', authRequired, groupAdminRequired, (req, res) => {
  const { id, name, cif, address, config } = req.body;
  // Group admins can only create companies in their own group
  const groupId = req.user.role === 'superadmin' ? (req.body.group_id || req.user.group_id) : req.user.group_id;
  try {
    db.prepare('INSERT OR REPLACE INTO companies VALUES (?, ?, ?, ?, ?, ?)').run(id, name, cif || '', address || '', config || '{}', groupId);
    loadPGCForCompany(id);
    // Auto-assign the creator to this company
    db.prepare('INSERT OR IGNORE INTO user_companies VALUES (?, ?)').run(req.user.id, id);
    auditLog(req, 'create-company', name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── GROUPS MANAGEMENT ──
app.get('/api/groups', authRequired, (req, res) => {
  if (req.user.role === 'superadmin') {
    res.json(db.prepare('SELECT * FROM groups').all());
  } else {
    res.json(db.prepare('SELECT * FROM groups WHERE id = ?').all(req.user.group_id));
  }
});

app.post('/api/groups', authRequired, superadminRequired, (req, res) => {
  const { id, name } = req.body;
  try {
    db.prepare("INSERT OR REPLACE INTO groups VALUES (?, ?, datetime('now'))").run(id, name);
    auditLog(req, 'create-group', name);
    res.json({ ok: true });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

// ── GROUP-SCOPED USERS ──
app.get('/api/group-users', authRequired, groupAdminRequired, (req, res) => {
  if (req.user.role === 'superadmin') {
    const rows = db.prepare('SELECT u.id, u.username, u.name, u.role, u.group_id, g.name as group_name FROM users u LEFT JOIN groups g ON u.group_id = g.id').all();
    res.json(rows);
  } else {
    const rows = db.prepare('SELECT id, username, name, role, group_id FROM users WHERE group_id = ?').all(req.user.group_id);
    res.json(rows);
  }
});

app.post('/api/group-users', authRequired, groupAdminRequired, (req, res) => {
  const { id, username, password, name, role } = req.body;
  const safeRole = req.user.role === 'superadmin' ? (role || 'user') : (role === 'superadmin' ? 'user' : (role || 'user'));
  const hashed = password ? bcrypt.hashSync(password, BCRYPT_ROUNDS) : null;
  
  // Determine group: group_admin gets their own group, others stay in creator's group
  let groupId = req.body.group_id || req.user.group_id;
  if (safeRole === 'group_admin' && !req.body.group_id) {
    // Create a dedicated group for this group_admin
    const gid = 'g_' + username.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    try { db.prepare("INSERT OR IGNORE INTO groups VALUES (?, ?, datetime('now'))").run(gid, name); } catch(e) {}
    groupId = gid;
  }
  
  try {
    const existing = db.prepare('SELECT id, password FROM users WHERE id = ?').get(id);
    const pwd = hashed || (existing ? existing.password : bcrypt.hashSync('1234', BCRYPT_ROUNDS));
    db.prepare('INSERT OR REPLACE INTO users (id, username, password, name, role, company_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, username, pwd, name, safeRole, null, groupId
    );
    auditLog(req, 'manage-user', `${username} role=${safeRole} group=${groupId}`);
    res.json({ ok: true });
  } catch(err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/group-users/:userId', authRequired, groupAdminRequired, (req, res) => {
  const target = db.prepare('SELECT group_id, role FROM users WHERE id = ?').get(req.params.userId);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  // Can't delete superadmin, can't delete users from other groups
  if (target.role === 'superadmin') return res.status(403).json({ error: 'No se puede eliminar un superadmin' });
  if (req.user.role !== 'superadmin' && target.group_id !== req.user.group_id) return res.status(403).json({ error: 'No puedes eliminar usuarios de otro grupo' });
  db.prepare('DELETE FROM user_companies WHERE user_id = ?').run(req.params.userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.userId);
  auditLog(req, 'delete-user', req.params.userId);
  res.json({ ok: true });
});

// ── USER-COMPANY ACCESS ──
app.get('/api/user-companies/:userId', authRequired, (req, res) => {
  const rows = db.prepare('SELECT company_id FROM user_companies WHERE user_id = ?').all(req.params.userId);
  res.json(rows);
});

app.post('/api/user-companies/sync', authRequired, groupAdminRequired, (req, res) => {
  const { userId, companyIds } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requerido' });
  // Delete all current assignments for this user
  db.prepare('DELETE FROM user_companies WHERE user_id = ?').run(userId);
  // Insert new assignments
  const insert = db.prepare('INSERT OR IGNORE INTO user_companies VALUES (?, ?)');
  (companyIds || []).forEach(cid => insert.run(userId, cid));
  auditLog(req, 'sync-user-companies', `${userId}: ${(companyIds||[]).join(', ')}`);
  res.json({ ok: true });
});
app.get('/api/user-companies/:userId', authRequired, (req, res) => {
  const rows = db.prepare('SELECT company_id FROM user_companies WHERE user_id = ?').all(req.params.userId);
  res.json(rows.map(r => r.company_id));
});

app.post('/api/user-companies', authRequired, adminRequired, (req, res) => {
  const { userId, companyId } = req.body;
  try {
    db.prepare('INSERT OR IGNORE INTO user_companies VALUES (?, ?)').run(userId, companyId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/user-companies/:userId/:companyId', authRequired, adminRequired, (req, res) => {
  db.prepare('DELETE FROM user_companies WHERE user_id = ? AND company_id = ?').run(req.params.userId, req.params.companyId);
  res.json({ ok: true });
});

// ── LOAD PGC for existing company ──
app.post('/api/load-pgc/:companyId', authRequired, adminRequired, (req, res) => {
  // Clean up invalid accounts (non-numeric codes, codes > 8 digits)
  const invalid = db.prepare("DELETE FROM accounts WHERE company_id = ? AND (length(code) > 8 OR code GLOB '*[^0-9]*')").run(req.params.companyId);
  const added = loadPGCForCompany(req.params.companyId);
  auditLog(req, 'load-pgc', `${req.params.companyId}: added=${added}, cleaned=${invalid.changes}`);
  res.json({ ok: true, added, cleaned: invalid.changes });
});

// ── MOVE COMPANY BETWEEN GROUPS ──
app.post('/api/move-company-group', authRequired, superadminRequired, (req, res) => {
  const { companyId, groupId } = req.body;
  if (!companyId || !groupId) return res.status(400).json({ error: 'Faltan campos' });
  db.prepare('UPDATE companies SET group_id = ? WHERE id = ?').run(groupId, companyId);
  auditLog(req, 'move-company-group', `${companyId} -> ${groupId}`);
  res.json({ ok: true });
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ──
migratePasswords();
scheduleDailyBackup();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Cimafondos v7.1.0 running on port ${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`  Backups: ${BACKUP_DIR}`);
  console.log(`  JWT: active, ${TOKEN_EXPIRY} expiry`);
});
